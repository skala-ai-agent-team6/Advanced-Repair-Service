/* =========================================================================
 * RobotCare AI 도메인 타입
 * 핵심 원칙: AI 산출물은 항상 `origin: 'AI'` + `decision` 을 가진 "초안"이며,
 * 사람의 결정(Decision)이 기록되기 전까지는 확정 데이터로 취급하지 않는다.
 * ========================================================================= */

/** 백엔드 Role enum 과 동일 */
export type Role = 'TECHNICIAN' | 'QUALITY_MANAGER'

/** 기사 유형: 출장기사 / 센터 수리자 */
export type TechnicianType = 'FIELD' | 'CENTER'

export interface User {
  /** 로그인 식별자 — Mock: 사번, 실서버: 이메일 */
  employeeId: string
  name: string
  role: Role
  branch: string // 소속 (서비스센터 / 본사)
  /** 기사 유형 (TECHNICIAN 만). 로그인 응답의 값을 쓰고, 없으면 CENTER 로 취급 */
  technicianType?: TechnicianType
  /** 실서버 GET /api/auth/me 값 (bigint 십진수 문자열) */
  id?: string
  email?: string
  centerId?: string | null
}

export type RepairStatus =
  | 'DRAFT'
  | 'RECEIVED'
  | 'QUEUED'
  | 'ANALYZING'
  | 'ADDITIONAL_INFO_NEEDED'
  | 'DIAGNOSIS_COMPLETED'
  | 'TECHNICIAN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'MANUAL_REVIEW'
  | 'CLOSED'
  /** 실서버 전용: 접수 취소 */
  | 'CANCELLED'

/** 접수 사진은 PCB · MOTOR(모터·외관 변형 등) 2종 */
// [통합] MECHANICAL → MOTOR: 백엔드 DB(attachment.target)·에이전트가 MOTOR를 쓴다
export type PhotoKind = 'PCB' | 'MOTOR' | 'ADDITIONAL' | 'BEFORE' | 'AFTER'

export interface RepairImage {
  id: string
  kind: PhotoKind
  url: string
  name: string
  uploadedAt: string
  note?: string
  /** 접수 시 사진 품질 검사 기록 (Mock 전용) */
  quality?: PhotoQualityRecord
  /** 몇 번째 입력에서 올라온 사진인지: 0 = 접수, n = n차 추가 사진 (Mock 전용, 없으면 사진 종류로 추정) */
  round?: number
}

export interface ProductInfo {
  /** 제품 종류 Enum (고객 접수: vacuum · washing_machine · air_conditioner · unknown). 기존 로봇청소기 데이터는 없음 */
  productType?: import('@/constants/products').ProductType
  /** productType 이 unknown 일 때 고객이 직접 입력한 제품명 */
  productTypeDetail?: string
  /** 제조사 (고객 접수) */
  manufacturer?: string
  /** 실서버 product.id (접수 시 productId 로 전송) */
  id?: string
  serialNumber: string
  model: string
  modelName: string
  manufacturedAt: string
  factory: string
  warrantyUntil: string
  firmware: string
}

export interface Repair {
  id: number
  receiptNo: string
  product: ProductInfo
  symptom: string
  /** 기사 소견 (접수 시 선택 입력, AI 분석에 함께 사용) */
  technicianNote?: string
  errorCodes: string[]
  branch: string
  technician: string
  technicianId: string
  receivedAt: string
  updatedAt: string
  status: RepairStatus
  /** 화면에서 쓰지 않음. 백엔드가 보내도 깨지지 않게 optional 로만 남김 */
  urgency?: Urgency
  images: RepairImage[]
  photoRequestCount: number
  /** AI 입력 개정 번호: 접수 = 1, 추가 사진을 낼 때마다 +1 (같은 수리 ID 유지). Mock 전용, 없으면 표시 안 함 */
  inputRevision?: number
  /** 진단 진행 중의 단계 상태 (SSE 로 갱신) */
  stages: AnalysisStageState[]
  /** '분석 진행' 단계에서 실행된 도구 (도착 순서). 실서버: TOOL_EXECUTED · /diagnosis/tools */
  tools?: AnalysisToolRun[]
  progress: number
  progressMessage?: string
  /** 분석 실패 사유 (있으면 진단 진행 화면에 실패 배너 표시) */
  analysisError?: string
  /** 진단/검토/발주/본사 결정의 전체 이력 */
  history: ApprovalRecord[]
  /** 기사 수리 리포트 (초안 → 확정). 확정본만 고장 DB·대시보드에 반영 */
  report?: RepairReport
  /** 목록 응답용 요약: 최신 AI 진단 원인 */
  aiTopCause?: string
  /** 출장 방문 정보 · 개인정보 동의 (Mock 전용 저장, 실서버는 FEATURES.visitInfo 로 켬) */
  visitInfo?: VisitInfo
  consent?: PrivacyConsent
  /** 접수 경로: 직원(기사) 접수 / 고객 온라인 접수. 고객 접수 건은 배정 전(technicianId 비움)으로 들어와
   *  기사를 배정하면 그 기사의 업무 목록에 그대로 나타난다. 없으면 STAFF */
  source?: 'STAFF' | 'CUSTOMER'
  /** 고객 조회 링크용 토큰 (Mock 전용 · 고객 직접 접수 건) */
  customerToken?: string
  /** 데모 시나리오 제어용 (Mock 전용) */
  mockScenario?: 'NORMAL' | 'NEED_PHOTO' | 'FAIL'
}

export type Urgency = 'HIGH' | 'MEDIUM' | 'LOW'

/* ---------------- 출장 방문 정보 · 개인정보 동의 ----------------
 * 고객 개인정보. AI 로 가는 userInput 에는 절대 넣지 않는다. (현재 Mock 에만 저장) */
/** 방문 주소 (구조화) — 프론트 내부 상태는 항상 이 형태. 한 줄 문자열은 adapters/address 의 toAddressLine 으로만 만든다 */
export interface VisitAddress {
  postalCode: string
  roadAddress: string
  jibunAddress?: string
  /** 동·호수 등 고객이 직접 입력 (최대 100자) */
  detailAddress: string
  /** 건물명 또는 참고 항목 */
  buildingName?: string
}

/** 주소 검색 결과 한 건 (Mock · Daum 우편번호 공통) */
export interface AddressSearchResult {
  postalCode: string
  roadAddress: string
  jibunAddress?: string
  buildingName?: string
}

export interface VisitInfo {
  customerName: string
  phone: string
  /** 한 줄 주소 (도로명주소, 상세주소) — 기존 화면·API 계약 */
  address: string
  /** 구조화 주소 (고객 온라인 접수 · Mock 저장) */
  visitAddress?: VisitAddress
  /** 수리 방법: VISIT 방문 수리(기사 방문) / CENTER 센터 방문(고객이 가져옴) — 고객이 접수 때 고르고 기사가 이어받음 */
  serviceType?: import('@/constants/serviceType').ServiceType
  /** 센터 방문일 때 서비스센터 */
  centerId?: string
  centerName?: string
  /** 방문 수리 시간대 */
  visitSlot?: import('@/constants/serviceType').VisitSlot
  /** 희망 방문일 (YYYY-MM-DD) */
  preferredDate: string
  /** 구매일 (YYYY-MM-DD) — 무상 수리 여부 확인용. 고객이 모르면 null */
  purchaseDate: string | null
  /** 기사가 확정한 방문일 (YYYY-MM-DD). 확정 전이면 없음 */
  confirmedDate?: string
}

/* ---------------- 출장 일정 (출장기사 FIELD) ----------------
 * 출장기사에게 배정된 방문 일정. 주소는 구·동까지만 담는다 */
export interface FieldVisit {
  /** 방문 일정 ID (출장 전 리포트 모달에 함께 전달) */
  visitId: string
  repairId: number
  /** 배정된 기사 (Mock: 사번) */
  technicianId: string
  /** 방문일 (YYYY-MM-DD, 한국 시간) */
  visitDate: string
  /** 방문 시간 (HH:mm, 한국 시간) */
  visitTime: string
  customerName: string
  district: string
  neighborhood: string
  model: string
  symptom: string
  /** 수리 건 상태 */
  status: RepairStatus
  /** 방문 진행: 예정 / 방문 완료 */
  visitStatus: 'SCHEDULED' | 'DONE'
}

/* ---------------- 소비자용 수리 진행 조회 ----------------
 * 고객에게는 기사가 확정한 내용만 쉬운 말로 보여 준다.
 * AI 초안·판단 점수·부품번호·재고 정보는 이 응답에 담지 않는다 (서버에서 걸러서 내려줌) */
export type CustomerStage = 'RECEIVED' | 'PHOTO_CHECK' | 'DIAGNOSED' | 'VISIT_SCHEDULED' | 'COMPLETED'

export interface CustomerReport {
  receiptNo: string
  productName: string
  receivedAt: string
  stage: CustomerStage
  /** 지금 단계에 대한 안내 한 줄 (예: 추가 사진 요청, 접수 취소) */
  notice?: string
  /** 담당 기사 (배정 전이면 없음) */
  technicianName?: string
  /** 기사가 확정한 고장 원인 (쉬운 말). 확정 전이면 없음 */
  cause?: string
  /** 최종 수리 결과 (수리 완료 후). 그 전이면 없음 */
  result?: string
  /** 기사가 확정한 무상/유상. 확정 전이면 null */
  warranty: 'FREE' | 'PAID' | null
  visit: { preferredDate?: string; confirmedDate?: string }
  cancelled?: boolean
}

/* ---------------- 출장 준비 · 재고 예약 ----------------
 * 출장 전에 필요한 부품을 창고 재고에서 예약(가용 → 예약)하고, 가져갈 때 출고 처리한다.
 * 예약은 24시간 뒤 만료되어 가용 재고로 돌아간다 */
export type ReservationStatus = 'RESERVED' | 'RELEASED' | 'CANCELLED' | 'EXPIRED'

export interface StockReservation {
  id: string
  partId: string
  repairId: number
  warehouse: string
  quantity: number
  status: ReservationStatus
  reservedBy: string
  reservedAt: string
  expiresAt: string
  closedAt?: string
}

export interface TripStock {
  warehouse: string
  location: string
  /** 지금 예약·출고할 수 있는 수량 */
  available: number
  /** 다른 수리 건 포함 예약 중인 수량 */
  reserved: number
}

/** 고객 사진으로 예측한 출장 필요 부품 */
export interface TripPart {
  partId: string
  partName: string
  partNo: string
  quantity: number
  /** 예측 근거 한 줄 */
  reason: string
  stocks: TripStock[]
  /** 이 수리 건의 가장 최근 예약 (없으면 미예약) */
  reservation?: StockReservation
}

export type StockChange = 'RESERVE' | 'CANCEL' | 'EXPIRE' | 'RELEASE'

export interface StockHistoryEntry {
  id: string
  partId: string
  at: string
  change: StockChange
  /** 가용 재고 변화 (예약 -n · 취소/만료 +n · 출고 0) */
  delta: number
  quantity: number
  warehouse: string
  actor: string
  repairId: number
}

/* ---------------- 보증 기간 안내 (접수 화면) ----------------
 * 보증 상태와 만료일만 담는다. 제품 소유자·수리 이력 등 다른 정보는 절대 넣지 않는다 */
export interface WarrantyPeriod {
  status: 'IN_WARRANTY' | 'EXPIRED' | 'UNKNOWN'
  /** 보증 만료일 (YYYY-MM-DD). 화면에는 연·월만 표시 */
  until?: string
  /** 고객이 입력한 구매일 기준 / 제조일로 추정 */
  basis: 'CUSTOMER_INPUT' | 'MANUFACTURE_DATE_ESTIMATE'
}

/* ---------------- 보증 판정 (무상/유상) ----------------
 * AI 가 구매일 + 진단 원인 + 보증 규칙으로 제안(suggestion)하고, 기사가 확정(decision)한다 */
export type WarrantySuggestion = 'FREE' | 'PAID' | 'UNKNOWN'
export type WarrantyFaultType = 'PRODUCT_DEFECT' | 'USER_FAULT' | 'UNKNOWN'

export interface WarrantyDecision {
  result: 'FREE' | 'PAID'
  reason?: string
  decidedBy: string
  decidedAt: string
}

export interface Warranty {
  suggestion: WarrantySuggestion
  /** 구매일 (YYYY-MM-DD). 모르면 없음 */
  purchaseDate?: string
  warrantyMonths: number
  faultType: WarrantyFaultType
  /** 화면에 그대로 보여 줄 근거 (구매일 · 고장 원인 · 판단 근거) */
  reasons: string[]
  decision?: WarrantyDecision
}

/* ---------------- 접수 사진 품질 검사 ---------------- */
export type PhotoQualityIssue = 'BLUR' | 'GLARE' | 'TOO_FAR' | 'WRONG_PART' | 'DARK' | 'LOW_RES'

/** 사진 품질 검사 상태 — PENDING 검사 중 / PASSED 통과 / WARNING 확인 필요 / FAILED 불합격(재촬영) / ERROR 검사 실패(재검사) */
export type PhotoQualityStatus = 'PENDING' | 'PASSED' | 'WARNING' | 'FAILED' | 'ERROR'

export interface PhotoQualityMetrics {
  width: number
  height: number
  /** 밝기 0~100 */
  brightness: number
  /** 선명도 0~100 (낮을수록 흐림) */
  sharpness: number
}

export interface PhotoQualityResult {
  ok: boolean
  issues: PhotoQualityIssue[]
  score?: number
  /** 판정 (없으면 ok 로 PASSED / WARNING 을 정한다) */
  status?: 'PASSED' | 'WARNING' | 'FAILED'
  metrics?: PhotoQualityMetrics
  checkedAt?: string
}

/** 접수 사진 한 장의 품질 검사 기록 (Mock 저장 · 실서버는 FEATURES.photoQualityCheck) */
export interface PhotoQualityRecord {
  status: PhotoQualityStatus
  issues: PhotoQualityIssue[]
  metrics?: PhotoQualityMetrics
  checkedAt?: string
  /** WARNING 사진을 기사가 [현재 사진 사용]으로 확인한 경우 */
  acknowledgedBy?: string
  acknowledgedAt?: string
  /** 같은 칸에서 바꾸기 전 사진들의 검사 결과 (오래된 순) */
  history: { name: string; status: PhotoQualityStatus; checkedAt?: string }[]
}

export interface PrivacyConsent {
  agreed: true
  agreedAt: string
  version: 'v1'
}

/* ---------------- 진단 진행 (SSE) ---------------- */

/** 고정 단계는 3개뿐: 접수·대기열 → 분석 진행 → 결과 종합.
 *  '분석 진행' 안에는 실제로 실행된 도구(AnalysisToolRun)가 도착한 순서대로 추가된다. */
export type AnalysisStage = 'QUEUED' | 'ANALYSIS' | 'SYNTHESIS'

export type StageRunState = 'PENDING' | 'RUNNING' | 'DONE' | 'SKIPPED' | 'FAILED' | 'WAITING_INPUT'

export interface AnalysisStageState {
  stage: AnalysisStage
  state: StageRunState
  message?: string
  startedAt?: string
  finishedAt?: string
}

/** 분석 도구 종류 — 실서버 agentType: PCB · MOTOR(기계) · RAG(매뉴얼·유사 사례), 그 외는 OTHER(도구 이름 표시) */
export type AnalysisToolKind = 'PCB' | 'MOTOR' | 'RAG' | 'OTHER'

/** '분석 진행' 단계 안에서 실제로 실행된 도구 하나 (도착한 순서대로) */
export interface AnalysisToolRun {
  id: string
  kind: AnalysisToolKind
  label: string
  state: StageRunState
  message?: string
  startedAt?: string
  finishedAt?: string
}

/** 백엔드 SSE `GET /api/repairs/{id}/events` 로 수신하는 이벤트 */
export interface RepairEvent {
  repairId: number
  status: RepairStatus
  stage?: AnalysisStage
  stageState?: StageRunState
  /** 도구 실행 이벤트 (분석 진행 단계 안의 항목 추가·갱신) */
  tool?: AnalysisToolRun
  message: string
  progress: number
  at?: string
  photoRequest?: PhotoRequest
}

/* ---------------- 추가 사진 요청 ---------------- */

export interface PhotoRequest {
  id: string
  target: string // 촬영 부위
  reason: string // 필요 이유
  guide: string // 올바른 촬영 방법
  requestNo: number // 몇 번째 요청인지
  maxRequests: number // 최대 요청 횟수 (3)
  requestedBy: string // 요청한 Agent
  requestedAt: string
  resolved: boolean
}

/* ---------------- AI 진단 결과 ---------------- */

export type DecisionState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGE_REQUESTED' | 'REANALYSIS_REQUESTED'

/** 모든 승인 영역이 공유하는 "사람의 결정" */
export interface Decision {
  state: DecisionState
  decidedBy?: string
  decidedByRole?: Role
  decidedAt?: string
  comment?: string
}

export interface DataSource {
  id: string
  type: 'MANUAL' | 'REPAIR_DB' | 'SENSOR_LOG' | 'IMAGE' | 'ERROR_CODE_TABLE'
  title: string
  ref: string // 문서 번호, 페이지, 로그 키 등
}

export interface CauseCandidate {
  rank: number
  cause: string
  part?: string
  confidence: number // 0~100
  evidence: string[]
  sourceIds: string[]
}

/** 부위별 분석: PCB · 기계(MOTOR). SW 분석은 없음 */
export type AgentType = 'PCB' | 'MOTOR'
export type AgentVerdict = 'NORMAL' | 'ABNORMAL' | 'SUSPICIOUS' | 'SKIPPED'

export interface ImageAnnotation {
  imageId: string
  label: string
  /** 이미지 대비 % 좌표 (0~100) */
  x: number
  y: number
  w: number
  h: number
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface AgentResult {
  agent: AgentType
  verdict: AgentVerdict
  summary: string
  findings: string[]
  confidence: number
  annotations: ImageAnnotation[]
  sourceIds: string[]
  durationSec: number
}

export interface ErrorCodeAnalysis {
  code: string
  meaning: string
  relatedParts: string[]
  interpretation: string
}

export interface SimilarCase {
  receiptNo: string
  model: string
  cause: string
  resolution: string
  similarity: number
  closedAt: string
  /** 사례 출처: INTERNAL = 사내 확정 사례(기사가 확정한 수리 리포트), EXTERNAL = 공개 사례(외부 자료). 없으면 표시 안 함 */
  origin?: 'INTERNAL' | 'EXTERNAL'
}

export interface PartRecommendation {
  partId: string
  partName: string
  partNo: string
  quantity: number
  reason: string
}

export interface Diagnosis {
  id: string
  repairId: number
  version: number // 재분석마다 증가
  origin: 'AI'
  /** AI 원문 결과 (실서버: 진단 작업 result 그대로). 없으면 화면에서 진단 필드로 한 줄 JSON 을 만든다 */
  raw?: unknown
  generatedAt: string
  topCause: string
  confidence: number
  /** 화면에서 쓰지 않음 (optional 로만 남김) */
  urgency?: Urgency
  candidates: CauseCandidate[]
  agents: AgentResult[]
  errorCodes: ErrorCodeAnalysis[]
  similarCases: SimilarCase[]
  similarCaseCount: number
  inspectionSteps: string[]
  repairMethod: string[]
  parts: PartRecommendation[]
  sources: DataSource[]
  /** 기사의 결정 */
  technicianDecision: Decision
}

/* ---------------- 수리 리포트 (백엔드 ReportContent 와 동일 구조) ---------------- */

export type FaultArea = 'PCB' | 'MOTOR' | 'SW' | 'OTHER'
export type RepairOutcome = 'FIXED' | 'NOT_FIXED' | 'NO_FAULT_FOUND'
/** AI 진단 수용 여부. AI 진단이 없던 건은 NOT_AVAILABLE */
export type AiAcceptance = 'ACCEPTED' | 'PARTIAL' | 'REJECTED' | 'NOT_AVAILABLE'

export interface ReportFault {
  area: FaultArea
  partId?: string
}

export interface ReportContent {
  actualCause: string
  actualAction: string
  technicianOpinion: string
  /** 고장 없음(NO_FAULT_FOUND)이면 빈 배열 */
  faults: ReportFault[]
  repairSuccessful: boolean
  outcome: RepairOutcome
  aiAcceptance: AiAcceptance
}

export type ReportStatus = 'DRAFT' | 'CONFIRMED'

/** 확정 이력 한 줄 (revision 별 확정자·시각) */
export interface ReportConfirmation {
  revision: number
  confirmedBy: string
  confirmedAt: string
}

export interface RepairReport {
  /** 리포트 ID (실서버: report header id, Mock: RPT-{수리 ID}) */
  id?: string
  repairId: number
  /** 낙관적 잠금 버전. 저장·확정마다 +1, 요청 version 과 다르면 409 REPORT_VERSION */
  version: number
  /** 내용 개정 번호. 확정 후 다시 수정하면 +1 된 새 초안이 된다 */
  revision: number
  status: ReportStatus
  content: ReportContent
  createdBy: string
  updatedBy: string
  updatedAt: string
  /** 현재 revision 이 확정된 경우에만 값이 있음 */
  confirmedBy?: string
  confirmedAt?: string
  /** 지금까지 확정된 revision 목록 (오래된 순) */
  confirmations: ReportConfirmation[]
}

/* ---------------- 부품 / 발주 ---------------- */

export interface WarehouseStock {
  warehouse: string
  location: string // 랙 위치 (실서버: 창고 주소)
  /** 출고 가능 수량 (실서버: available = on_hand - reserved) */
  quantity: number
  /** 실서버 warehouse_id (발주 source=WAREHOUSE 일 때 전송) */
  warehouseId?: string
  phone?: string | null
}

export interface Part {
  id: string
  name: string
  /** 부품 사진 (없으면 아이콘) */
  imageUrl?: string
  partNo: string
  compatibleModels: string[]
  stocks: WarehouseStock[]
  factory: string
  factoryContact: { manager: string; phone: string; email: string }
  leadTimeDays: number
  unitPrice: number
  /** 실서버: PCB | MOTOR | OTHER */
  category?: 'PCB' | 'MOTOR' | 'OTHER'
  /** 실서버 공급 공장 factory_id (발주 source=FACTORY 일 때 전송) */
  factoryId?: string
}

/** 실서버 발주 상태 PENDING→REQUESTED, APPROVED, ORDERED(출고), RECEIVED(수령), REJECTED, CANCELLED */
export type OrderStatus = 'AI_DRAFT' | 'REQUESTED' | 'APPROVED' | 'ORDERED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED'

export interface PurchaseOrder {
  id: string
  repairId: number
  receiptNo: string
  partId: string
  partNo: string
  partName: string
  quantity: number
  fromWarehouse: string
  aiReason: string
  aiConfidence: number
  sourceIds: string[]
  status: OrderStatus
  requestedBy?: string
  requestedAt?: string
  requestComment?: string
  decision: Decision // 본사 품질 담당자 결정
  createdAt: string
}

/* ---------------- 승인 이력 ---------------- */

export type ApprovalTarget = 'DIAGNOSIS' | 'REPORT' | 'ORDER' | 'PHOTO' | 'SYSTEM'
export type ApprovalAction =
  | 'CREATED'
  | 'AI_GENERATED'
  | 'CONFIRMED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGE_REQUESTED'
  | 'REANALYSIS_REQUESTED'
  | 'HQ_REVIEW_REQUESTED'
  | 'SUBMITTED'
  | 'DRAFT_SAVED'
  | 'PHOTO_ADDED'
  | 'ORDER_REQUESTED'
  | 'COMMENTED'

export interface ApprovalRecord {
  id: string
  target: ApprovalTarget
  action: ApprovalAction
  actor: string // 'AI Orchestrator' 또는 사람 이름
  /** CUSTOMER: 고객 직접 접수 (직원 역할 아님) */
  actorRole: Role | 'AI' | 'CUSTOMER'
  at: string
  comment?: string
}

/* ---------------- 대시보드 ---------------- */

export interface DashboardFilter {
  from: string
  to: string
}

export interface CountItem {
  key: string
  label: string
  count: number
}

export interface DefectDashboard {
  periodLabel: string
  totalReceived: number
  completed: number
  aiSuccessRate: number // AI 진단 성공(결과 생성) 비율
  aiMatchRate: number // AI 진단 vs 실제 원인 일치율 (승인 데이터 기준)
  approvedCount: number
  byPart: CountItem[]
  byModel: CountItem[]
  byBranch: CountItem[]
  byFactory: CountItem[]
  trend: { month: string; received: number; defects: number }[]
  recurring: { type: string; count: number; models: string[]; trend: 'UP' | 'FLAT' | 'DOWN' }[]
  /** 실서버: 고장 부위(PCB·MOTOR·SW·OTHER)별 건수 (groupBy=AREA) */
  byArea?: CountItem[]
}

/* ---------------- 공통 ---------------- */

export interface Page<T> {
  items: T[]
  total: number
}

/** 상태 필터 그룹 (표시 순서·일괄 필터용) */
export type StatusGroupKey = 'AI_ANALYSIS' | 'TECHNICIAN' | 'HQ' | 'DONE'

export interface RepairQuery {
  /** 기사 범위: 'center' = 수리 접수 관리(센터 수리자 담당 건, 출장기사 0건 · 기본값) / 'assigned' = 이 기사에게 배정된 모든 건(수리 작업 · 수리 이력) */
  scope?: 'center' | 'assigned'
  status?: RepairStatus | 'ALL'
  /** 그룹 단위 필터. status 와 함께 쓰지 않는다 */
  group?: StatusGroupKey
  keyword?: string
  sort?: 'receivedAt_desc' | 'receivedAt_asc'
  part?: string
  model?: string
  branch?: string
  factory?: string
}

export interface RepairSummaryCounts {
  needPhoto: number
  /** 진단 초안 확인 대기 (DIAGNOSIS_COMPLETED) */
  technicianReview: number
  /** 진단 확인 후 리포트 확정 전 (TECHNICIAN_REVIEW) */
  reportPending: number
  completed: number
  analyzing: number
  manualReview: number
}

/** 상태별 건수 (상태 필터 적용 전 · 검색어/모델 필터 적용 후) */
export type RepairStatusCounts = Partial<Record<RepairStatus, number>>

export interface Notification {
  id: string
  title: string
  body: string
  at: string
  read: boolean
  link?: string
  roles: Role[]
}

/* ---------------- 사내 사례 동기화 (US-08 · Mock 전용, FEATURES.caseSync) ---------------- */

/** 확정 리포트 → 사내 확정 사례(유사 사례 검색 대상) 반영 상태 */
export type CaseSyncStatus = 'WAITING' | 'SYNCING' | 'COMPLETED' | 'FAILED'

export interface CaseSync {
  repairId: number
  reportId: string
  /** 동기화 대상 리포트 개정 (r1, r2 …) */
  reportRevision: number
  confirmedAt: string
  status: CaseSyncStatus
  lastSyncedAt?: string
  /** 반영되는 곳 */
  source: '사내 확정 사례'
  /** FAILED 일 때 안내 */
  failureMessage?: string
}

/* ---------------- 재처리 상태 (US-10 · Mock 전용, FEATURES.retryStatus) ---------------- */

export type RetryStatus = 'FAILED' | 'RETRY_SCHEDULED' | 'RETRYING' | 'RECOVERED' | 'FINAL_FAILED'

export interface RetryAttempt {
  attempt: number
  at: string
  result: 'FAILED' | 'SUCCEEDED'
  errorCode?: string
  message?: string
}

/** 자동 재처리 한 건. 상세(오류 코드·executionId·시도 이력)는 본사 품질 담당자에게만 내려온다 */
export interface RetryRecord {
  id: string
  repairId: number
  status: RetryStatus
  /** 실패한 단계 (예: PCB 분석, 사내 사례 동기화) */
  stage: string
  failedAt: string
  attempt: number
  maxAttempts: number
  nextRetryAt?: string
  /** 더 이상 자동 재처리하지 않음 */
  final: boolean
  /** 본사 품질 담당자에게만 */
  errorCode?: string
  executionId?: string
  attempts?: RetryAttempt[]
}

/* ---------------- 출장 전 진단 리포트: 기사 수정안 · 기사 확인 (Mock 전용, FEATURES.preVisitReportEdit) ----------------
 * AI 원본(aiDraft)은 기존 진단(Diagnosis)을 그대로 쓰고 절대 덮어쓰지 않는다. 기사가 고친 내용은 technicianEdit 에 따로 쌓는다 */

export interface TechnicianReportEdit {
  repairId: number
  /** 예상 원인에 대한 기사 의견 */
  suspectedCauseComment?: string
  /** 현장 점검 예정 내용 */
  inspectionPlan?: string
  /** 권장 수리 방법 */
  repairMethod?: string
  technicianMemo?: string
  /** 준비할 부품 · 수량 */
  parts: { partId: string; quantity: number }[]
  editedBy: string
  editedAt: string
  /** 수정 버전 (저장할 때마다 +1) */
  version: number
  /** 이 수정안이 기준으로 삼은 AI 진단 버전 */
  diagnosisVersion: number
}

/** 기사 리포트 확인 (최종 수리 확정 아님). editVersion: 확인 당시 수정 버전 (수정안이 없으면 0) */
export interface PreVisitReview {
  state: 'TECHNICIAN_REVIEWED'
  reviewedBy: string
  reviewedAt: string
  editVersion: number
}

/** 출장 전 리포트의 사람 쪽 데이터. AI 원본(aiDraft)은 진단 API 의 Diagnosis */
export interface PreVisitReport {
  repairId: number
  technicianEdit: TechnicianReportEdit | null
  review: PreVisitReview | null
}
