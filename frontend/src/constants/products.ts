/* 고객 접수용 제품 종류 · 제조사 · 모델 · 증상 (일반 가전제품)
 * 로봇청소기 모델(RC-A100 등)은 기존 데이터와 같은 값을 써서 기사 화면·Mock 진단과 그대로 연결된다 */

export interface ProductModel {
  name: string
  manufacturer: string
}

export interface ProductCategory {
  key: string
  label: string
  /** 이 제품군에서 자주 쓰는 모델 (고르거나 직접 입력) */
  models: ProductModel[]
  /** 이 제품군에만 있는 증상 (공통 증상과 함께 표시) */
  symptoms: string[]
}

/** 모든 제품에 공통으로 보여 주는 증상 */
export const COMMON_SYMPTOMS = ['전원이 켜지지 않음', '작동 중 멈춤', '이상 소음 발생', '물이 새거나 냄새가 남', '화면에 에러 코드 표시', '성능 저하', '기타']

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    key: 'ROBOT_VACUUM',
    label: '로봇청소기',
    models: [
      { name: 'RC-A100', manufacturer: 'ROVIA' },
      { name: 'RC-S300', manufacturer: 'ROVIA' },
      { name: 'RC-X700', manufacturer: 'ROVIA' },
      { name: 'CleanBot A100', manufacturer: 'CleanBot' },
    ],
    symptoms: ['충전이 되지 않음', '바퀴가 돌지 않음', '흡입력이 약함', '한쪽으로만 회전'],
  },
  {
    key: 'VACUUM',
    label: '청소기',
    models: [
      { name: 'StickPro 7', manufacturer: 'ROVIA' },
      { name: 'CleanBot S9', manufacturer: 'CleanBot' },
    ],
    symptoms: ['흡입력이 약함', '배터리가 빨리 닳음', '브러시가 돌지 않음'],
  },
  {
    key: 'WASHER',
    label: '세탁기',
    models: [
      { name: 'ROVA AirWash 24', manufacturer: 'ROVA' },
      { name: 'ROVA AirWash 21', manufacturer: 'ROVA' },
    ],
    symptoms: ['탈수가 되지 않음', '배수가 되지 않음', '문이 열리지 않음', '진동이 심함'],
  },
  {
    key: 'DRYER',
    label: '건조기',
    models: [{ name: 'ROVA DryCare 19', manufacturer: 'ROVA' }],
    symptoms: ['건조가 덜 됨', '열이 나지 않음', '필터 경고가 계속 뜸'],
  },
  {
    key: 'FRIDGE',
    label: '냉장고',
    models: [{ name: 'ROVA FreshCube 870', manufacturer: 'ROVA' }],
    symptoms: ['냉장·냉동이 약함', '성에가 많이 낌', '문 알림이 계속 울림'],
  },
  {
    key: 'AIRCON',
    label: '에어컨',
    models: [{ name: 'ROVA CoolWind 18', manufacturer: 'ROVA' }],
    symptoms: ['찬바람이 나오지 않음', '실내기에서 물이 떨어짐', '리모컨이 작동하지 않음'],
  },
  {
    key: 'TV',
    label: 'TV',
    models: [{ name: 'ROVA Vision 65', manufacturer: 'ROVA' }],
    symptoms: ['화면이 나오지 않음', '소리가 나지 않음', '화면에 줄이 생김'],
  },
  {
    key: 'DISHWASHER',
    label: '식기세척기',
    models: [{ name: 'ROVA DishPro 12', manufacturer: 'ROVA' }],
    symptoms: ['세척이 덜 됨', '배수가 되지 않음', '세제가 녹지 않음'],
  },
  { key: 'OTHER', label: '기타', models: [], symptoms: [] },
]

export const categoryOf = (key: string) => PRODUCT_CATEGORIES.find((c) => c.key === key)

/** 제품 종류의 증상 선택지 = 제품군 증상 + 공통 증상 (겹치는 것은 한 번, '기타'는 맨 끝) */
export function symptomsFor(key: string): string[] {
  const own = categoryOf(key)?.symptoms ?? []
  const common = COMMON_SYMPTOMS.filter((s) => s !== '기타' && !own.includes(s))
  return [...own, ...common, '기타']
}
