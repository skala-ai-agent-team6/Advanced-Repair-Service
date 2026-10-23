/* 대시보드 변환: GET /api/dashboard?groupBy=… 를 여러 번 받아 DefectDashboard 하나로
 * 백엔드에 없는 지표(모델별·AI 일치율·AI 성공률·반복 고장 추세)는 NaN·빈 배열 → 화면에서 "준비 중" */
import type { CountItem, DefectDashboard } from '@/types'
import type { BeDashboardGroupBy, BeDashboardRow } from './types'

const AREA_LABEL: Record<string, string> = { PCB: 'PCB', MOTOR: '모터', SW: '소프트웨어', OTHER: '기타', UNKNOWN: '미상' }

/** 집계 행 → 건수 항목 (많은 순) */
export const toItems = (rows: BeDashboardRow[], label: (d: string) => string = (d) => d): CountItem[] =>
  rows.map((r) => ({ key: r.dimension, label: label(r.dimension), count: r.count })).sort((a, b) => b.count - a.count)

/** 기간: 최근 n개월 1일 ~ 내일 (to 는 미포함 [from, to)) */
export function dashboardRange(months: number, now = new Date()) {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const from = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { from: ymd(from), to: ymd(to) }
}

/** 기간: 최근 n일 (오늘 포함) ~ 내일 (to 는 미포함 [from, to)) */
export function dayRange(days: number, now = new Date()) {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { from: ymd(from), to: ymd(to) }
}

export function toDefectDashboard(
  rows: Partial<Record<BeDashboardGroupBy, BeDashboardRow[]>>,
  ctx: { from: string; to: string; totalReceived: number },
): DefectDashboard {
  const period = [...(rows.PERIOD ?? [])].sort((a, b) => a.dimension.localeCompare(b.dimension))
  const confirmed = period.reduce((a, r) => a + r.count, 0)
  return {
    periodLabel: `${ctx.from} ~ ${ctx.to}`,
    totalReceived: ctx.totalReceived,
    completed: confirmed,
    aiSuccessRate: NaN,
    aiMatchRate: NaN,
    approvedCount: confirmed,
    byPart: toItems(rows.PART ?? []),
    byModel: [],
    byBranch: toItems(rows.CENTER ?? [], (d) => (/^\d+$/.test(d) ? `서비스센터 #${d}` : d)),
    byFactory: toItems(rows.FACTORY ?? [], (d) => (d === 'UNKNOWN' ? '미상' : d)),
    // 기간별: 확정 건수만 있음 (접수 건수 추이는 없음)
    trend: period.map((r) => ({ month: r.dimension.slice(0, 7), received: r.count, defects: r.count })),
    recurring: [],
    byArea: toItems(rows.AREA ?? [], (d) => AREA_LABEL[d] ?? d),
  }
}
