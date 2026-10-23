/* 기사·품질 담당자 홈 진행률 / 주간 그래프 계산 (기존 API 결과를 프론트에서 셈, 새 API 없음)
 * 날짜는 모두 한국 시간 기준.
 *  - FIELD   오늘 출장 완료      : 오늘 리포트가 확정된 출장 건 / 오늘 배정된 전체 출장 건
 *  - CENTER  오늘 수리 처리 현황  : 오늘 CLOSED 된 내 담당 건 / 오늘 내가 담당하는 전체 건(진행 중 + 오늘 완료)
 *  - QM      오늘 승인 처리 현황  : 오늘 승인·반려 처리한 발주 / 오늘 처리 대상(승인 대기 + 오늘 처리)
 *  - 이번 주 처리 건수: 월~일 날짜별로 내가 CLOSED 한 건수 (완료 시각 = 리포트 확정 시각, 없으면 마지막 갱신) */
import { kstDay, kstToday } from '@/utils/kst'
import type { FieldVisit, PurchaseOrder, Repair, User } from '@/types'

export interface Progress {
  done: number
  total: number
}

const ENDED = ['APPROVED', 'CLOSED', 'CANCELLED']

/** 내가 담당한 건 (Mock: 사번 / 실서버: 사용자 id) */
export const isMine = (r: Repair, u: User | null) => !!u && [u.employeeId, u.id].filter(Boolean).includes(String(r.technicianId))
/** 리포트 확정(CLOSED)된 한국 날짜 */
export const closedDay = (r: Repair) => (r.status === 'CLOSED' ? kstDay(r.report?.confirmedAt ?? r.updatedAt) : null)

/** CENTER: 오늘 수리 처리 현황 */
export function centerProgress(items: Repair[], u: User | null, today = kstToday()): Progress {
  const mine = items.filter((r) => isMine(r, u))
  const done = mine.filter((r) => closedDay(r) === today).length
  const open = mine.filter((r) => !ENDED.includes(r.status)).length
  return { done, total: open + done }
}

/** FIELD: 오늘 출장 완료 — 출장 건의 리포트 확정일은 수리 목록에서 찾고, 목록에 없으면 출장 일정의 상태(CLOSED)로 판단 */
export function fieldProgress(todayVisits: FieldVisit[], items: Repair[], today = kstToday()): Progress {
  const done = todayVisits.filter((v) => {
    const r = items.find((x) => x.id === v.repairId)
    return r ? closedDay(r) === today : v.status === 'CLOSED'
  }).length
  return { done, total: todayVisits.length }
}

/** QUALITY_MANAGER: 오늘 승인 처리 현황 (승인·반려 모두 처리 완료로 봄) */
export function approvalProgress(orders: PurchaseOrder[], today = kstToday()): Progress {
  const decidedToday = orders.filter((o) => (o.status === 'APPROVED' || o.status === 'REJECTED' || o.status === 'ORDERED' || o.status === 'RECEIVED') && o.decision.decidedAt && kstDay(o.decision.decidedAt) === today).length
  const pending = orders.filter((o) => o.status === 'REQUESTED').length
  return { done: decidedToday, total: pending + decidedToday }
}

export const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const

/** 이번 주 월요일부터 일요일까지 (한국 날짜) */
export function thisWeek(today = kstToday()): string[] {
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const monday = d - ((base.getUTCDay() + 6) % 7)
  return WEEK_LABELS.map((_, i) => new Date(Date.UTC(y, m - 1, monday + i)).toISOString().slice(0, 10))
}

export function weeklyClosed(items: Repair[], u: User | null, days = thisWeek()) {
  const mine = items.filter((r) => isMine(r, u))
  return days.map((day) => mine.filter((r) => closedDay(r) === day).length)
}
