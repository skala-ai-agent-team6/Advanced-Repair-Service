/* 도로명주소 검색
 *  Mock: 아래 가짜 주소에서 도로명·건물명·지번으로 찾는다 (0.4초 지연). 검색어에 '오류'·error 가 있으면 오류를 흉내
 *  실서버: Daum 우편번호 서비스를 모달 안에 띄운다 (useAddressSearch 의 loadDaumPostcode) → 이 함수는 쓰지 않음
 *  검색어·주소는 콘솔에 남기지 않는다 */
import { ApiError, mockDelay, USE_MOCK } from './http'
import type { AddressSearchResult } from '@/types'

/** 주소 검색 방식: Mock 은 자체 결과 목록, 실서버는 Daum 우편번호 화면 */
export const ADDRESS_PROVIDER: 'mock' | 'daum' = USE_MOCK ? 'mock' : 'daum'

/** Mock 전용 가짜 주소 (실제 고객 주소 아님) */
const MOCK_ADDRESSES: AddressSearchResult[] = [
  { postalCode: '06236', roadAddress: '서울특별시 강남구 테헤란로 123', jibunAddress: '서울특별시 강남구 역삼동 123-4', buildingName: 'ROVIA 타워' },
  { postalCode: '06234', roadAddress: '서울특별시 강남구 테헤란로 152', jibunAddress: '서울특별시 강남구 역삼동 737', buildingName: '강남파이낸스센터' },
  { postalCode: '06164', roadAddress: '서울특별시 강남구 테헤란로 521', jibunAddress: '서울특별시 강남구 삼성동 159', buildingName: '파르나스타워' },
  { postalCode: '04524', roadAddress: '서울특별시 중구 세종대로 110', jibunAddress: '서울특별시 중구 태평로1가 31', buildingName: '서울특별시청' },
  { postalCode: '13529', roadAddress: '경기도 성남시 분당구 판교역로 235', jibunAddress: '경기도 성남시 분당구 삼평동 681', buildingName: '에이치스퀘어' },
  { postalCode: '48058', roadAddress: '부산광역시 해운대구 센텀중앙로 79', jibunAddress: '부산광역시 해운대구 우동 1505', buildingName: '센텀사이언스파크' },
  { postalCode: '48303', roadAddress: '부산광역시 수영구 광안해변로 219', jibunAddress: '부산광역시 수영구 광안동 192-20' },
  { postalCode: '39371', roadAddress: '경상북도 구미시 1공단로 172', jibunAddress: '경상북도 구미시 공단동 259' },
]

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

export async function searchAddress(keyword: string): Promise<AddressSearchResult[]> {
  const k = norm(keyword)
  if (!USE_MOCK) throw new ApiError(501, '주소 검색은 Daum 우편번호 화면을 사용합니다.', 'NOT_SUPPORTED')
  return mockDelay(() => {
    if (/오류|error/.test(k)) throw new ApiError(503, '주소 검색 중 오류가 발생했습니다.', 'ADDRESS_SEARCH_FAILED')
    return MOCK_ADDRESSES.filter((a) => [a.roadAddress, a.jibunAddress ?? '', a.buildingName ?? ''].some((v) => norm(v).includes(k)))
  }, 400)
}
