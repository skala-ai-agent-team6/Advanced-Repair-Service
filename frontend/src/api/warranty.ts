/* 보증 판정 (무상/유상)
 *  Mock: 구매일 + 12개월 이내 & 제품 결함 → FREE, 사용자 과실·보증 만료 → PAID, 구매일 모름 → UNKNOWN
 *  실서버: 아직 API 없음 → FEATURES.warranty 가 false 면 화면에서 카드를 숨긴다 */
import { ApiError, http, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import type { Warranty, WarrantyPeriod } from '@/types'

const notReady = () => new ApiError(501, '보증 판정은 아직 백엔드에서 지원하지 않습니다.', 'NOT_SUPPORTED')

/** GET /api/repairs/{id}/warranty (경로는 백엔드 확정 후 맞출 것) */
export async function getWarranty(repairId: number): Promise<Warranty> {
  if (USE_MOCK) return mockDelay(() => mock.getWarranty(repairId), 300)
  if (!FEATURES.warranty) throw notReady()
  return (await http.get<Warranty>(`/repairs/${repairId}/warranty`)).data
}

/** POST /api/repairs/{id}/warranty/decision {result, reason} — 기사 확정. AI 제안과 다르면 사유 필수 */
export async function decideWarranty(repairId: number, result: 'FREE' | 'PAID', reason?: string): Promise<Warranty> {
  if (USE_MOCK) return mockDelay(() => mock.decideWarranty(repairId, result, reason), 400)
  if (!FEATURES.warranty) throw notReady()
  return (await http.post<Warranty>(`/repairs/${repairId}/warranty/decision`, { result, reason })).data
}

/** 보증 기간 조회 (접수 화면 안내용) — POST /api/warranty/period {serial, purchaseDate?}
 *  응답은 보증 상태·만료일·근거만. 소유자·수리 이력 등은 담지 않는다 */
export async function checkWarrantyPeriod(serial: string, purchaseDate?: string): Promise<WarrantyPeriod> {
  if (USE_MOCK) return mockDelay(() => mock.checkWarrantyPeriod(serial, purchaseDate), 300)
  if (!FEATURES.warranty) throw notReady()
  return (await http.post<WarrantyPeriod>('/warranty/period', { serial, purchaseDate })).data
}
