/* 고객 접수 제품 종류 (고정 Enum) · 제품별 추천 모델 · 증상 — 제품 종류 목록은 이 파일 하나에서만 관리한다
 * 화면에는 한국어 라벨, API 요청에는 영문 Enum 값(ProductType)을 보낸다.
 * 청소기의 로봇청소기 모델(RC-A100 등)은 기존 데이터와 같은 값을 써서 기사 화면·Mock 진단과 그대로 연결된다 */

export type ProductType = 'vacuum' | 'washing_machine' | 'air_conditioner' | 'unknown'

/** 드롭다운 항목 (순서 = 화면 순서) */
export const PRODUCT_TYPE_OPTIONS = [
  { value: 'vacuum', label: '청소기' },
  { value: 'washing_machine', label: '세탁기' },
  { value: 'air_conditioner', label: '에어컨' },
  { value: 'unknown', label: '기타' },
] as const satisfies readonly { value: ProductType; label: string }[]

/** 접수 폼의 제품 종류 입력 상태. productTypeDetail 은 'unknown'(기타)일 때만 쓰는 직접 입력값 */
export interface ProductTypeForm {
  productType: ProductType | ''
  productTypeDetail: string
}

/** 기타(unknown) 직접 입력 최대 길이 */
export const PRODUCT_TYPE_DETAIL_MAX = 30

export const PRODUCT_TYPE_LABEL = Object.fromEntries(PRODUCT_TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<ProductType, string>

/** 허용된 Enum 값인지 (한국어 라벨·옛 키는 거부) */
export const isProductType = (v: unknown): v is ProductType => typeof v === 'string' && v in PRODUCT_TYPE_LABEL

export interface ProductModel {
  name: string
  manufacturer: string
}

/** 모든 제품에 공통으로 보여 주는 증상 */
export const COMMON_SYMPTOMS = ['전원이 켜지지 않음', '작동 중 멈춤', '이상 소음 발생', '물이 새거나 냄새가 남', '화면에 에러 코드 표시', '성능 저하', '기타']

/** 제품 종류별 보조 정보: 자주 쓰는 모델(고르거나 직접 입력) · 이 제품군에만 있는 증상 */
const PRODUCT_TYPE_HINTS: Record<ProductType, { models: ProductModel[]; symptoms: string[] }> = {
  vacuum: {
    models: [
      { name: 'RC-A100', manufacturer: 'ROVIA' },
      { name: 'RC-S300', manufacturer: 'ROVIA' },
      { name: 'RC-X700', manufacturer: 'ROVIA' },
      { name: 'CleanBot A100', manufacturer: 'CleanBot' },
      { name: 'StickPro 7', manufacturer: 'ROVIA' },
      { name: 'CleanBot S9', manufacturer: 'CleanBot' },
    ],
    symptoms: ['흡입력이 약함', '충전이 되지 않음', '바퀴가 돌지 않음', '브러시가 돌지 않음', '배터리가 빨리 닳음'],
  },
  washing_machine: {
    models: [
      { name: 'ROVA AirWash 24', manufacturer: 'ROVA' },
      { name: 'ROVA AirWash 21', manufacturer: 'ROVA' },
    ],
    symptoms: ['탈수가 되지 않음', '배수가 되지 않음', '문이 열리지 않음', '진동이 심함'],
  },
  air_conditioner: {
    models: [{ name: 'ROVA CoolWind 18', manufacturer: 'ROVA' }],
    symptoms: ['찬바람이 나오지 않음', '실내기에서 물이 떨어짐', '리모컨이 작동하지 않음'],
  },
  unknown: { models: [], symptoms: [] },
}

/** 센터 방문(제품을 가져오기) 가능 여부 — 에어컨·세탁기처럼 큰 제품은 방문 수리만 */
export const CENTER_SERVICE_AVAILABLE: Record<ProductType, boolean> = {
  vacuum: true,
  washing_machine: false,
  air_conditioner: false,
  unknown: true,
}
export const canBringToCenter = (t: ProductType | '') => !t || CENTER_SERVICE_AVAILABLE[t]

export const modelsFor = (t: ProductType | ''): ProductModel[] => (t ? PRODUCT_TYPE_HINTS[t].models : [])

/** 제품 종류의 증상 선택지 = 제품군 증상 + 공통 증상 (겹치는 것은 한 번, '기타'는 맨 끝) */
export function symptomsFor(t: ProductType | ''): string[] {
  const own = t ? PRODUCT_TYPE_HINTS[t].symptoms : []
  const common = COMMON_SYMPTOMS.filter((s) => s !== '기타' && !own.includes(s))
  return [...own, ...common, '기타']
}
