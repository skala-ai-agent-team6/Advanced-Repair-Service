/* 기사 대시보드 숫자 카드 ↔ 수리 접수 관리 필터 (프론트에서 기존 API 결과를 세어 계산, 새 API 없음)
 *  - 오늘 접수: 오늘 접수된 건
 *  - 수리 중: 끝나지 않았고 부품을 기다리지 않는 건
 *  - 부품 대기: 끝나지 않았고 요청·승인·출고됐지만 아직 수령하지 않은 발주가 있는 건
 *  - 완료: 리포트 확정(APPROVED · CLOSED)
 *  - 오늘의 출장(출장 기사): 방문일(확정일, 없으면 희망일)이 오늘인 진행 중 건 */
import type { PurchaseOrder, Repair, RepairStatus } from '@/types'

export type RepairPreset = 'TRIP_TODAY' | 'TODAY' | 'IN_REPAIR' | 'PARTS_WAITING' | 'DONE'

export const PRESET_LABEL: Record<RepairPreset, string> = {
  TRIP_TODAY: '오늘의 출장',
  TODAY: '오늘 접수',
  IN_REPAIR: '수리 중',
  PARTS_WAITING: '부품 대기',
  DONE: '완료',
}
export const isPreset = (v: unknown): v is RepairPreset => typeof v === 'string' && v in PRESET_LABEL

const DONE: RepairStatus[] = ['APPROVED', 'CLOSED']
const ENDED: RepairStatus[] = [...DONE, 'CANCELLED']
const WAITING_ORDER: PurchaseOrder['status'][] = ['REQUESTED', 'APPROVED', 'ORDERED']

/** 로컬 날짜 YYYY-MM-DD */
export function localDay(d: Date | string = new Date()): string {
  const t = typeof d === 'string' ? new Date(d) : d
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** 부품을 기다리는 수리 ID (수령 전 발주가 있는 건) */
export const partsWaitingIds = (orders: PurchaseOrder[]) => new Set(orders.filter((o) => WAITING_ORDER.includes(o.status)).map((o) => o.repairId))

export function matchPreset(r: Repair, preset: RepairPreset, waiting: Set<number>, today = localDay()): boolean {
  const open = !ENDED.includes(r.status)
  switch (preset) {
    case 'TODAY':
      return localDay(r.receivedAt) === today
    case 'IN_REPAIR':
      return open && !waiting.has(r.id)
    case 'PARTS_WAITING':
      return open && waiting.has(r.id)
    case 'DONE':
      return DONE.includes(r.status)
    case 'TRIP_TODAY':
      return open && (r.visitInfo?.confirmedDate ?? r.visitInfo?.preferredDate) === today
  }
}

/** 부품 정보(발주 목록)가 있어야 셀 수 있는 필터 */
export const presetNeedsOrders = (p: RepairPreset) => p === 'IN_REPAIR' || p === 'PARTS_WAITING'
