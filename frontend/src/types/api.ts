import type { ServiceType, VisitSlot } from '@/constants/serviceType'
import type { ProductType } from '@/constants/products'
/* REST 요청/응답 DTO */
import type { PhotoKind, PhotoQualityRecord, PrivacyConsent, ProductInfo, VisitAddress, ReportContent, Role, Urgency, User, VisitInfo } from './index'

/** Mock: username = 사번 / 실서버: username = 이메일 (form-urlencoded) */
export interface LoginRequest {
  username: string
  password: string
}
/** Mock 전용 로그인 응답 (실서버는 세션 쿠키 + GET /api/auth/me) */
export interface LoginResponse {
  token: string
  user: User
}

/** 회원가입 — 역할은 사용자가 고르지만, 서버가 검증·승인해야 한다 (본사 권한을 스스로 고를 수 있으므로) */
export interface SignupRequest {
  username: string
  password: string
  name: string
  role: Role
  /** 기사(TECHNICIAN)만: 출장기사 FIELD / 센터 수리자 CENTER */
  technicianType?: 'FIELD' | 'CENTER'
}

/** 고객(비회원) 고장 접수 — 직원 계정·역할과 무관. 사진은 별도로 함께 보낸다 */
export interface CustomerIntakeRequest {
  customerName: string
  phone: string
  /** 제품 종류 Enum (src/constants/products.ts). 한국어 라벨이 아니라 영문 값을 보낸다. 기타 = 'unknown' */
  productType: ProductType
  /** productType 이 'unknown'(기타)일 때 고객이 직접 입력한 제품명 (앞뒤 공백 제거). 그 외에는 null */
  productTypeDetail: string | null
  /** 제조사 (선택 · 모르면 보내지 않음) */
  manufacturer?: string
  /** 제품 모델명 (목록에서 고르거나 직접 입력) */
  model: string
  /** 시리얼 번호 (필수 · 앞뒤 공백 제거 · 대문자) */
  serial: string
  symptom: string
  /** 구매일 (YYYY-MM-DD, 선택) — 무상 수리 여부 확인용 */
  purchaseDate?: string
  preferredDate: string
  /** 수리 방법 — 방문 수리면 주소·시간대, 센터 방문이면 서비스센터. (실서버는 FEATURES.visitInfo 일 때만 전송) */
  serviceType: ServiceType
  centerId?: string
  visitSlot?: VisitSlot
  /** 기존 계약: 한 줄 주소 "도로명주소, 상세주소" (adapters/address 의 toAddressLine 으로 조합) · 센터 방문이면 없음 */
  address?: string
  /** 구조화 주소 (우편번호 · 도로명 · 지번 · 상세 · 건물명) · 센터 방문이면 없음 */
  visitAddress?: VisitAddress
  consent: PrivacyConsent
}
export interface CustomerIntakeResponse {
  receiptNo: string
  /** 조회 링크용 토큰 (/service/track/:token) */
  token: string
}

/** GET /api/auth/me */
export interface MeResponse {
  id: string
  username?: string
  email: string
  name: string
  active: boolean
  role: Role
  centerId: string | null
  /** 기사 유형 — 로그인 응답에 포함된다고 가정. 없으면 CENTER 로 취급 */
  technicianType?: 'FIELD' | 'CENTER'
}

/** POST /api/repairs */
export interface CreateRepairRequest {
  product: ProductInfo
  symptom: string
  /** 기사 소견 (선택, 최대 1000자) */
  technicianNote?: string
  errorCodes: string[]
  /** 접수 화면에서 더 이상 보내지 않음 */
  urgency?: Urgency
  /** 출장 방문 정보 · 동의 — userInput(AI 입력)과 분리된 별도 필드 */
  visitInfo?: VisitInfo
  consent?: PrivacyConsent
  /** 접수 기사가 기본 수리 방법을 바꿨으면 그 사유 (이력에 기록) */
  serviceTypeChange?: { from: ServiceType; reason: string }
}

/** [Mock 전용] 수리 방법 변경 (사유 필수 · 이력 기록) */
export interface ChangeServiceTypeRequest {
  serviceType: ServiceType
  centerId?: string
  reason: string
}

/** POST /api/repairs/{id}/images · additional-images (실서버는 multipart/form-data) */
export interface UploadImageRequest {
  kind: PhotoKind
  file: File
  /** Mock 모드에서만 사용: 압축된 dataURL */
  dataUrl?: string
  photoRequestId?: string
  /** [Mock 전용] 접수 사진 품질 검사 기록 (확인자·확인 시각 포함) */
  quality?: PhotoQualityRecord
}

/** POST /api/repairs/{id}/additional-images — 추가 자료 (사진 또는 설명 중 하나 이상) */
export interface AdditionalInfoRequest {
  photos: UploadImageRequest[]
  note?: string
  photoRequestId?: string
}

/** POST /api/repairs/{id}/approval */
export type ApprovalTargetDto = 'DIAGNOSIS' | 'MANUAL_REVIEW'
export type ApprovalActionDto = 'APPROVE' | 'REJECT' | 'REQUEST_CHANGE' | 'REQUEST_HQ_REVIEW' | 'COMMENT' | 'RETURN_TO_TECHNICIAN'
export interface ApprovalRequest {
  target: ApprovalTargetDto
  action: ApprovalActionDto
  comment?: string
  diagnosisVersion?: number
}

/** POST /api/repairs/{id}/reanalysis */
export interface ReanalysisRequest {
  reason: string
  scope?: ('PCB' | 'MOTOR')[]
}

/** PUT /api/repairs/{id}/report — 리포트 초안 저장
 *  version: 클라이언트가 마지막으로 받은 report.version (처음 저장이면 null). 다르면 409 REPORT_VERSION */
export interface SaveReportDraftRequest {
  version: number | null
  content: ReportContent
}

/** [Mock 전용] 출장 전 리포트 기사 수정안 저장 — expectedVersion 이 현재 수정 버전과 다르면 409 */
export interface SavePreVisitEditRequest {
  expectedVersion: number
  diagnosisVersion: number
  suspectedCauseComment?: string
  inspectionPlan?: string
  repairMethod?: string
  technicianMemo?: string
  parts: { partId: string; quantity: number }[]
}

/** POST /api/repairs/{id}/report/confirm — 저장된 초안을 확정 (고장 DB·대시보드 반영) */
export interface ConfirmReportRequest {
  version: number
}

/** POST /api/repairs/{id}/orders */
export interface CreateOrderRequest {
  draftOrderId?: string
  partId: string
  quantity: number
  fromWarehouse: string
  comment?: string
}

/** POST /api/orders/{id}/decision (본사 품질 담당자) */
export interface OrderDecisionRequest {
  action: 'APPROVE' | 'REJECT'
  comment?: string
}

export interface SessionUser extends User {
  roleLabel?: string
}

export type { Role }
