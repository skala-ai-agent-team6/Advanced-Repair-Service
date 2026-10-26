/* =========================================================================
 * 백엔드(Spring) 응답 DTO — skala-ai-agent-team6/backend docs/openapi.json 기준
 * DB 조회 응답은 snake_case, 업무 ID 는 bigint 십진수 문자열("101").
 * 이 파일의 타입은 src/api/adapters/ 안에서만 쓰고, 화면·스토어에는 프론트 타입(src/types)만 노출한다.
 * ========================================================================= */

export type BeId = string

export type BeRepairStatus = 'RECEIVED' | 'DIAGNOSING' | 'WAITING_INPUT' | 'DIAGNOSED' | 'MANUAL_REVIEW' | 'REPAIRING' | 'CLOSED' | 'CANCELLED'
export type BeTaskStatus = 'QUEUED' | 'RUNNING' | 'WAITING_INPUT' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
export type BeOrderStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ORDERED' | 'RECEIVED' | 'CANCELLED'

export interface BeComponent {
  id: BeId
  part_id: BeId
  slot_code: string
  factory_id: BeId | null
  factory_name: string | null
  region: string | null
}

export interface BePart {
  id: BeId
  part_number: string
  name: string
  category: 'PCB' | 'MOTOR' | 'OTHER'
}

/** GET /api/products?serialNumber= */
export interface BeProduct {
  id: BeId
  serial_number: string
  model_id: BeId
  model_code: string
  model_name: string
  manufactured_on: string | null
  information: Record<string, unknown>
  components: BeComponent[]
  compatibleParts: BePart[]
}

/** POST /api/repairs → 202 */
export interface BeAccepted {
  repairId: BeId
  taskId: BeId | null
  status?: string
  /** [사진 품질] true 면 품질 확인 뒤 POST /repairs/{id}/diagnosis 로 진단을 따로 시작해야 한다 */
  requiresDiagnosisRequest?: boolean
  attachments?: { attachmentId: string }[]
}

export interface BeRepair {
  id: BeId
  case_number: string
  center_id: BeId
  product_id: BeId
  technician_id: BeId
  symptom: string
  error_codes: string[]
  firmware_version: string | null
  /** 프론트가 접수 시 보낸 userInput 그대로 { technicianNote, photoKinds, urgency } */
  user_input: Record<string, unknown>
  product_snapshot: Record<string, unknown>
  status: BeRepairStatus
  procurement_status: 'NOT_STARTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED'
  created_at: string
  closed_at: string | null
  version: number
}

export interface BeRepairPage {
  page: number
  size: number
  total: number
  items: BeRepair[]
}

export interface BeAttachment {
  id: BeId
  request_id: BeId | null
  kind: 'IMAGE' | 'LOG' | 'DOCUMENT'
  target: string | null
  original_name: string
  mime_type: string
  byte_size: number
  created_at: string
}

export interface BeCandidate {
  rank: number
  cause: string
  /** 0~1 또는 0~100 (어댑터에서 % 로 정규화) */
  confidence: number
  explanation: string
  /** 에이전트 v2 추가 필드 (없을 수 있음) */
  causeCode?: string
  scoreKind?: 'DETECTION' | 'CASE_BASED'
  evidenceNotes?: string[]
  sourceIds?: string[]
}
export interface BeEvidence {
  type: string
  attachmentId?: BeId
  annotation?: Record<string, unknown>
  citation?: string
}
export interface BeRecommendedPart {
  partId: BeId
  quantity: number
}
export interface BeDiagnosisResult {
  summary: string
  modelVersion: string
  repairMethod: string
  candidates: BeCandidate[]
  recommendedParts: BeRecommendedPart[]
  evidence: BeEvidence[]
  /** 에이전트 v2 추가 필드 (없을 수 있음) */
  topCause?: string
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW'
  agents?: BeAgent[]
  sources?: { id: string; type: string; title: string; ref: string }[]
  similarCases?: BeSimilarCase[]
  inspectionSteps?: string[]
  repairSteps?: string[]
}
/** 사진 분석 에이전트 결과. annotations 좌표는 이미지 대비 0~1 */
export interface BeAgent {
  agent: string
  tool: string
  verdict: string
  summary: string
  findings: string[]
  confidence: number
  attachmentIds: BeId[]
  modelVersion?: string
  annotations: { attachmentId: BeId; label: string; score: number; x: number; y: number; width: number; height: number }[]
}
export interface BeSimilarCase {
  caseId: string
  origin: string
  sourceUri?: string
  summaryKo: string
  similarity: number
  originalText?: string
}

/** GET /api/repairs/{id}/diagnosis — Task (+ 정규화 candidates/evidence/recommendedParts) */
export interface BeTask {
  id: BeId
  case_id: BeId
  status: BeTaskStatus
  input_revision: number
  photo_request_count: number
  stage: string | null
  error_code: string | null
  error_message: string | null
  result: BeDiagnosisResult | null
  created_at: string
  updated_at: string
  finished_at: string | null
  candidates?: BeCandidate[]
  evidence?: BeEvidence[]
  recommendedParts?: BeRecommendedPart[]
}

export interface BePhotoRequest {
  id: BeId
  job_id: BeId
  round_no: number
  instruction: string
  target: string
  status: 'OPEN' | 'SUBMITTED' | 'EXPIRED' | 'CANCELLED'
  created_at: string
  submitted_at: string | null
}

export interface BeReportHeader {
  id: BeId
  case_id: BeId
  author_id: BeId
  outcome: 'FIXED' | 'NOT_FIXED' | 'NO_FAULT_FOUND'
  confirmed_at: string | null
  version: number
  latest_revision: number
  confirmed_revision: number | null
  created_at: string
}

export interface BeOrderHeader {
  id: BeId
  case_id: BeId
  requested_by: BeId
  status: BeOrderStatus
  decided_by: BeId | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
  version: number
}

/** GET /api/repairs/{id} */
export interface BeRepairDetail extends BeRepair {
  attachments: BeAttachment[]
  tasks: BeTask[]
  photoRequests: BePhotoRequest[]
  reports: BeReportHeader[]
  orders: BeOrderHeader[]
}

export interface BeToolExecution {
  id: BeId
  job_id: BeId
  agent_type: string
  tool_name: string
  model_version: string | null
  status: string
  output_payload: Record<string, unknown> | null
  error_message: string | null
  started_at: string
  finished_at: string | null
}

export interface BeUploaded {
  attachmentId: BeId
  mimeType: string
  size: number
}

export interface BeFault {
  area: 'PCB' | 'MOTOR' | 'SW' | 'OTHER'
  componentId?: BeId | null
  partId?: BeId | null
}
export interface BeReportContent {
  actualCause: string
  faults: BeFault[]
  actualAction: string
  technicianOpinion: string
  repairSuccessful: boolean
  aiAcceptance: 'ACCEPTED' | 'PARTIAL' | 'REJECTED' | 'NOT_AVAILABLE'
  outcome?: 'FIXED' | 'NOT_FIXED' | 'NO_FAULT_FOUND' | null
}
export interface BeRevision {
  report_id: BeId
  revision: number
  content: BeReportContent
  author_id: BeId
  created_at: string
  confirmed_at: string | null
}
/** GET /api/repairs/{id}/report */
export interface BeReport extends BeReportHeader {
  revisions: BeRevision[]
  comments: unknown[]
}

export interface BeStock {
  warehouse_id: BeId
  part_id: BeId
  on_hand: number
  reserved: number
  available: number
  warehouse_name: string
  region: string
  address: string
  phone: string | null
}

export interface BeFactory {
  id: BeId
  name: string
  country: string
  region: string
  address: string
  phone: string
  lead_days: number | null
}

export interface BeOrderItem {
  id: BeId
  order_id: BeId
  part_id: BeId
  quantity: number
  source: 'WAREHOUSE' | 'FACTORY'
  warehouse_id: BeId | null
  factory_id: BeId | null
}
export interface BeOrder extends BeOrderHeader {
  items: BeOrderItem[]
}

/** GET /api/repairs/{id}/procurement — snapshots[].body 는 스키마가 정해지지 않은 object */
export interface BeProcurement {
  status: string
  snapshots: { id: BeId; case_id: BeId; body: Record<string, unknown>; created_at: string }[]
  orders: BeOrderHeader[]
}

export type BeDashboardGroupBy = 'PERIOD' | 'PART' | 'CENTER' | 'FACTORY' | 'REGION' | 'AREA'
export interface BeDashboardRow {
  dimension: string
  count: number
}
