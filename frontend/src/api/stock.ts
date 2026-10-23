/* 출장 준비 · 재고 예약
 *  Mock: 예약 시 가용 감소·예약 증가, 취소·만료 시 복구, 출고 시 예약에서 차감. 모든 변경을 이력에 기록.
 *        10% 확률 또는 고른 창고에 1개만 남았을 때 409 STOCK_CONFLICT (동시 예약 시연)
 *  실서버: 아직 API 없음 → FEATURES.stockReservation 가 false 면 화면에서 예약 UI 를 숨긴다 (경로는 백엔드 확정 후 맞출 것) */
import { ApiError, http, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import type { StockHistoryEntry, StockReservation, TripPart } from '@/types'

const notReady = () => new ApiError(501, '재고 예약은 아직 백엔드에서 지원하지 않습니다.', 'NOT_SUPPORTED')
function guard() {
  if (!FEATURES.stockReservation) throw notReady()
}

/** 다른 기사가 먼저 예약해 재고가 바뀐 경우 (409 STOCK_CONFLICT) */
export const isStockConflict = (e: unknown) => e instanceof ApiError && e.status === 409 && e.code === 'STOCK_CONFLICT'

/** GET /api/repairs/{id}/trip-parts */
export async function getTripParts(repairId: number): Promise<TripPart[]> {
  if (USE_MOCK) return mockDelay(() => mock.getTripParts(repairId), 300)
  guard()
  return (await http.get<TripPart[]>(`/repairs/${repairId}/trip-parts`)).data
}

/** POST /api/stock/reservations {partId, quantity, repairId} */
export async function reserveStock(partId: string, quantity: number, repairId: number): Promise<StockReservation> {
  if (USE_MOCK) return mockDelay(() => mock.reserveStock(partId, quantity, repairId), 500)
  guard()
  return (await http.post<StockReservation>('/stock/reservations', { partId, quantity, repairId })).data
}

/** POST /api/stock/reservations/{id}/cancel */
export async function cancelReservation(id: string): Promise<StockReservation> {
  if (USE_MOCK) return mockDelay(() => mock.cancelReservation(id), 400)
  guard()
  return (await http.post<StockReservation>(`/stock/reservations/${id}/cancel`)).data
}

/** POST /api/stock/reservations/{id}/release — 출고 */
export async function releaseStock(reservationId: string): Promise<StockReservation> {
  if (USE_MOCK) return mockDelay(() => mock.releaseStock(reservationId), 400)
  guard()
  return (await http.post<StockReservation>(`/stock/reservations/${reservationId}/release`)).data
}

/** GET /api/parts/{id}/stock-history */
export async function getStockHistory(partId: string): Promise<StockHistoryEntry[]> {
  if (USE_MOCK) return mockDelay(() => mock.getStockHistory(partId), 300)
  guard()
  return (await http.get<StockHistoryEntry[]>(`/parts/${partId}/stock-history`)).data
}
