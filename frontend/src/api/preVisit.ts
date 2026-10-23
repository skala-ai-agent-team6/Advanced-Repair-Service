/* 출장 전 진단 리포트 — 기사 수정안 · 기사 확인(TECHNICIAN_REVIEWED)
 *  실서버에 API 가 없다 → FEATURES.preVisitReportEdit 가 false 면 화면이 [수정]을 숨기고 이 함수를 부르지 않는다.
 *  (혹시 불려도 요청을 보내지 않고 501) */
import { ApiError, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import type { PreVisitReport } from '@/types'
import type { SavePreVisitEditRequest } from '@/types/api'

const notSupported = () => new ApiError(501, '리포트 수정은 아직 백엔드에서 지원하지 않습니다.', 'NOT_SUPPORTED')
const enabled = () => USE_MOCK && FEATURES.preVisitReportEdit

export const preVisitApi = {
  async get(repairId: number): Promise<PreVisitReport> {
    if (enabled()) return mockDelay(() => mock.getPreVisitReport(repairId), 200)
    throw notSupported()
  },
  async saveEdit(repairId: number, req: SavePreVisitEditRequest): Promise<PreVisitReport> {
    if (enabled()) return mockDelay(() => mock.savePreVisitEdit(repairId, req), 500)
    throw notSupported()
  },
  async markReviewed(repairId: number, editVersion: number): Promise<PreVisitReport> {
    if (enabled()) return mockDelay(() => mock.markPreVisitReviewed(repairId, editVersion), 300)
    throw notSupported()
  },
}
