/* 방문 주소 변환 — 프론트는 구조화 주소(VisitAddress)로 다루고, 한 줄 주소만 받는 계약에는 여기서 조합한다 */
import type { VisitAddress } from '@/types'

/** 상세주소 최대 길이 */
export const DETAIL_ADDRESS_MAX = 100

export const emptyVisitAddress = (): VisitAddress => ({ postalCode: '', roadAddress: '', jibunAddress: '', detailAddress: '', buildingName: '' })

/** 앞뒤 공백 제거 + 빈 선택 항목은 뺀다 */
export function normalizeVisitAddress(a: VisitAddress): VisitAddress {
  const jibun = a.jibunAddress?.trim()
  const building = a.buildingName?.trim()
  return {
    postalCode: a.postalCode.trim(),
    roadAddress: a.roadAddress.trim(),
    ...(jibun ? { jibunAddress: jibun } : {}),
    detailAddress: a.detailAddress.trim(),
    ...(building ? { buildingName: building } : {}),
  }
}

/** 한 줄 주소: "서울특별시 강남구 테헤란로 123, 101동 1001호" */
export function toAddressLine(a: VisitAddress): string {
  const road = a.roadAddress.trim()
  const detail = a.detailAddress.trim()
  return detail ? `${road}, ${detail}` : road
}
