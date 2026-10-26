import { http, mockDelay, USE_MOCK } from './http'
import * as mock from '@/mocks/handlers'
import { dashboardRange, dayRange, toDefectDashboard, toItems } from './adapters/dashboard'
import type { BeDashboardGroupBy, BeDashboardRow, BeRepairPage } from './adapters/types'
import type { CountItem, DefectDashboard, Notification } from '@/types'
import type { DefectRecord } from '@/mocks/data'

export type DrillDim = 'part' | 'model' | 'branch' | 'factory' | 'month' | 'cause'
export type { DefectRecord }

const GROUPS: BeDashboardGroupBy[] = ['PERIOD', 'PART', 'CENTER', 'FACTORY', 'AREA']

export const dashboardApi = {
  /**
   * 품질 대시보드
   *  실서버: GET /api/dashboard?from&to&groupBy= 를 PERIOD·PART·CENTER·FACTORY·AREA 별로 호출해 합친다.
   *  전체 접수 건수는 GET /api/repairs 의 total.
   */
  async defects(months = 6): Promise<DefectDashboard> {
    if (USE_MOCK) return mockDelay(() => mock.dashboard(months), 600)
    const { from, to } = dashboardRange(months)
    const [total, ...lists] = await Promise.all([
      http.get<BeRepairPage>('/repairs', { params: { page: 0, size: 1 } }).then((r) => r.data.total),
      ...GROUPS.map((groupBy) => http.get<BeDashboardRow[]>('/dashboard', { params: { from, to, groupBy } }).then((r) => r.data)),
    ])
    const rows = Object.fromEntries(GROUPS.map((g, i) => [g, lists[i]]))
    return toDefectDashboard(rows, { from, to, totalReceived: total })
  },

  /**
   * 부품별 고장 TOP n (최근 days 일) — 홈 미리보기 그래프
   *  실서버: 기존 GET /api/dashboard?from&to&groupBy=PART 를 기간만 바꿔 호출 (확정 리포트만 집계하는 같은 API)
   */
  async partTop(days = 30, limit = 5): Promise<CountItem[]> {
    if (USE_MOCK) return mockDelay(() => mock.dashboardPartTop(days, limit), 500)
    const { from, to } = dayRange(days)
    const rows = (await http.get<BeDashboardRow[]>('/dashboard', { params: { from, to, groupBy: 'PART' } })).data
    return toItems(rows).filter((x) => x.count > 0).slice(0, limit)
  },

  /** [Mock 전용] 그래프 클릭 시 관련 수리 목록 — 실서버에는 드릴다운 API 가 없다 */
  async records(dim: DrillDim, value: string): Promise<DefectRecord[]> {
    if (USE_MOCK) return mockDelay(() => mock.dashboardRecords({ dim, value }))
    return []
  },
}

/** [Mock 전용] 알림 — 실서버에는 알림 API 가 없어 빈 목록 */
export const notificationApi = {
  async list(): Promise<Notification[]> {
    if (USE_MOCK) return mockDelay(() => mock.listNotifications(), 200)
    return []
  },
  async read(id: string) {
    if (USE_MOCK) return mockDelay(() => mock.readNotification(id), 50)
  },
  async readAll() {
    if (USE_MOCK) return mockDelay(() => mock.readAllNotifications(), 50)
  },
}
