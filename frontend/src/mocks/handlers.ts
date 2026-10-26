/* =========================================================================
 * Mock REST 핸들러 — 실제 백엔드 엔드포인트와 1:1 대응
 * 전역 규칙을 서버 측에서도 강제: AI 산출물은 사람 결정 없이 상태가 확정되지 않는다.
 * 고장 DB·대시보드에는 기사가 확정한 리포트만 반영된다 (확정 = CLOSED).
 * ========================================================================= */
import type {
  ApprovalRecord,
  CustomerReport,
  DefectDashboard,
  Diagnosis,
  Page,
  Part,
  PhotoRequest,
  PurchaseOrder,
  Repair,
  RepairImage,
  RepairQuery,
  RepairReport,
  RepairStatusCounts,
  RepairSummaryCounts,
  Role,
  StockHistoryEntry,
  StockReservation,
  TripPart,
  User,
  Warranty,
  WarrantyPeriod,
  FieldVisit,
  CaseSync,
  PreVisitReport,
  PreVisitReview,
  TechnicianReportEdit,
  CountItem,
  RetryAttempt,
  RetryRecord,
} from '@/types'
import type {
  AdditionalInfoRequest,
  ApprovalRequest,
  CreateOrderRequest,
  CreateRepairRequest,
  LoginRequest,
  LoginResponse,
  OrderDecisionRequest,
  ConfirmReportRequest,
  CustomerIntakeRequest,
  CustomerIntakeResponse,
  ReanalysisRequest,
  SaveReportDraftRequest,
  UploadImageRequest,
  SignupRequest,
  SavePreVisitEditRequest,
  ChangeServiceTypeRequest,
} from '@/types/api'
import { ApiError } from '@/api/http'
import { FAULT_AREA_LABEL, STATUS_GROUPS } from '@/constants/status'
import { MODELS, productFromSerial, SERVICE_CENTERS, stagesFor, USERS, type DefectRecord } from './data'
import { approvedRecords, baseDefectRecords, db, nextId, persist } from './db'
import { restartAnalysis, runAnalysis } from './engine'
import { uid } from '@/utils/format'
import { canViewRepair, inListScope } from '@/utils/workScope'
import { canBringToCenter, isProductType, PRODUCT_TYPE_DETAIL_MAX, PRODUCT_TYPE_LABEL } from '@/constants/products'
import { SERVICE_TYPE_LABEL } from '@/constants/serviceType'

let currentUser: User | null = null
export function setMockUser(u: User | null) {
  currentUser = u
}
function me(): User {
  if (!currentUser) throw new ApiError(401, '로그인이 필요합니다.')
  return currentUser
}
function requireRole(...roles: Role[]) {
  const u = me()
  if (!roles.includes(u.role)) throw new ApiError(403, '이 작업을 할 권한이 없습니다.')
  return u
}
function repairOr404(id: number): Repair {
  const r = db.repairs.find((x) => x.id === id)
  if (!r) throw new ApiError(404, '수리 건을 찾을 수 없습니다.')
  return r
}
function log(r: Repair, rec: Omit<ApprovalRecord, 'id' | 'at'>) {
  r.history.push({ ...rec, id: uid('h'), at: new Date().toISOString() })
  r.updatedAt = new Date().toISOString()
}
function latestDiagnosis(id: number): Diagnosis | undefined {
  const list = db.diagnoses[id]
  return list?.[list.length - 1]
}
function toImage(req: UploadImageRequest): RepairImage {
  return { id: uid('img'), kind: req.kind, url: req.dataUrl ?? '', name: req.file?.name ?? 'image.jpg', uploadedAt: new Date().toISOString(), ...(req.quality ? { quality: req.quality } : {}) }
}

/* ---------------- 인증 ---------------- */
export function login(req: LoginRequest): LoginResponse {
  const id = req.username.trim().toUpperCase()
  const u = [...USERS, ...(db.users ?? [])].find((x) => x.employeeId === id)
  if (!u || u.password !== req.password) throw new ApiError(401, '아이디 또는 비밀번호가 올바르지 않습니다.')
  const { password: _pw, ...user } = u
  void _pw
  currentUser = user
  return { token: `mock-token-${user.employeeId}`, user }
}

/** Mock 계정 정보 (비밀번호 제외) — 저장된 세션에 없는 필드(기사 유형 등) 채우기용 */
export function findMockUser(employeeId: string): User | undefined {
  const u = [...USERS, ...(db.users ?? [])].find((x) => x.employeeId === employeeId)
  if (!u) return undefined
  const { password: _pw, ...user } = u
  void _pw
  return user
}

/** 회원가입 (Mock) — 아이디는 대문자로 저장(로그인 시 대소문자 구분 없음). 역할은 그대로 저장되며 로그인 응답에 담긴다
 *  ※ Mock 은 브라우저 저장소에 비밀번호를 그대로 둔다 (데모 전용) */
export function signup(req: SignupRequest): void {
  const id = req.username.trim().toUpperCase()
  if (!/^[A-Z0-9._-]{3,30}$/.test(id)) throw new ApiError(422, '아이디는 영문·숫자 3~30자로 입력해 주세요.')
  if (req.password.length < 8 || !/[A-Za-z]/.test(req.password) || !/\d/.test(req.password)) throw new ApiError(422, '비밀번호는 영문과 숫자를 섞어 8자 이상으로 입력해 주세요.')
  if (!req.name.trim()) throw new ApiError(422, '이름을 입력해 주세요.')
  if (req.role !== 'TECHNICIAN' && req.role !== 'QUALITY_MANAGER') throw new ApiError(422, '담당 역할을 선택해 주세요.')
  if (req.role === 'TECHNICIAN' && req.technicianType !== 'FIELD' && req.technicianType !== 'CENTER') throw new ApiError(422, '기사 유형을 선택해 주세요.')
  db.users ??= []
  if ([...USERS, ...db.users].some((x) => x.employeeId === id)) throw new ApiError(409, '이미 사용 중인 아이디예요.')
  db.users.push({
    employeeId: id,
    password: req.password,
    name: req.name.trim(),
    role: req.role,
    // 데모 데이터가 보이도록 기본 소속 지정 (실서버는 소속을 관리자가 지정)
    branch: req.role === 'TECHNICIAN' ? '강남 서비스센터' : '본사 품질혁신팀',
    technicianType: req.role === 'TECHNICIAN' ? (req.technicianType ?? 'CENTER') : undefined,
  })
  persist()
}

/* ---------------- 제품 조회 ---------------- */
export function getProduct(serial: string) {
  const p = productFromSerial(serial)
  if (!p) throw new ApiError(404, '등록되지 않은 시리얼 번호입니다. 제품 라벨의 12자리(RC + 숫자 10자리)를 확인해 주세요.')
  return p
}

/* ---------------- 수리 목록 ---------------- */
export function listRepairs(q: RepairQuery): Page<Repair> & { counts: RepairSummaryCounts; statusCounts: RepairStatusCounts } {
  const u = me()
  // 품질 담당자는 전체. 기사: 수리 접수 관리(center)는 CENTER 자기 담당 건 · FIELD 0건, 수리 작업·이력(assigned)은 배정된 모든 건
  let items = db.repairs.filter((r) => inListScope(r, u, q.scope))
  const scope = items
  if (q.model) items = items.filter((r) => r.product.model === q.model)
  if (q.keyword) {
    const k = q.keyword.trim().toLowerCase()
    const idMatch = /^#(\d+)$/.exec(k)
    // "#101" 처럼 수리 ID 로 검색하면 해당 건만 정확히 반환
    items = idMatch
      ? items.filter((r) => r.id === Number(idMatch[1]))
      : items.filter((r) =>
          [r.receiptNo, r.product.serialNumber, r.product.model, r.technician, r.symptom, ...r.errorCodes].some((v) => v.toLowerCase().includes(k)),
        )
  }
  // 칩 건수: 검색어·모델 필터는 반영하고 상태 필터는 적용하기 전 기준 (칩을 눌렀을 때 나올 건수)
  const statusCounts: RepairStatusCounts = {}
  items.forEach((r) => (statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1))
  if (q.status && q.status !== 'ALL') items = items.filter((r) => r.status === q.status)
  else if (q.group) {
    const g = STATUS_GROUPS.find((x) => x.key === q.group)
    if (g) items = items.filter((r) => g.statuses.includes(r.status))
  }
  const sort = q.sort ?? 'receivedAt_desc'
  items = [...items].sort((a, b) => (sort === 'receivedAt_asc' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt)))
  const c = (s: Repair['status'][]) => scope.filter((r) => s.includes(r.status)).length
  return {
    items,
    total: items.length,
    statusCounts,
    counts: {
      needPhoto: c(['ADDITIONAL_INFO_NEEDED']),
      technicianReview: c(['DIAGNOSIS_COMPLETED']),
      reportPending: c(['TECHNICIAN_REVIEW']),
      completed: c(['APPROVED', 'CLOSED']),
      analyzing: c(['RECEIVED', 'QUEUED', 'ANALYZING']),
      manualReview: c(['MANUAL_REVIEW']),
    },
  }
}

export function getRepair(id: number) {
  const r = repairOr404(id)
  // 기사는 자기 담당 건만 (다른 기사 건은 없는 건처럼)
  if (!canViewRepair(r, me())) throw new ApiError(404, '수리 건을 찾을 수 없습니다.')
  if (['RECEIVED', 'QUEUED', 'ANALYZING'].includes(r.status)) void runAnalysis(id)
  return r
}

/* ---------------- 접수 ---------------- */
export function createRepair(req: CreateRepairRequest): Repair {
  const u = requireRole('TECHNICIAN')
  const id = nextId()
  const now = new Date().toISOString()
  // 데모: 증상에 "흐림"/"사진" 포함 시 추가 사진 시나리오, "실패" 포함 시 실패 시나리오
  const scenario: Repair['mockScenario'] = /실패/.test(req.symptom) ? 'FAIL' : /흐림|덜컹|흔들/.test(req.symptom) ? 'NEED_PHOTO' : 'NORMAL'
  const r: Repair = {
    id,
    receiptNo: `SR-2026-${String(10000 + id * 7).padStart(5, '0')}`,
    product: { ...req.product },
    symptom: req.symptom,
    technicianNote: req.technicianNote?.trim() || undefined,
    errorCodes: [...req.errorCodes],
    visitInfo: req.visitInfo ? { ...req.visitInfo } : undefined,
    consent: req.consent ? { ...req.consent } : undefined,
    branch: u.branch,
    technician: u.name,
    technicianId: u.employeeId,
    receivedAt: now,
    updatedAt: now,
    status: 'DRAFT',
    urgency: req.urgency,
    images: [],
    photoRequestCount: 0,
    stages: stagesFor('DRAFT'),
    progress: 0,
    history: [],
    mockScenario: scenario,
  }
  log(r, { target: 'SYSTEM', action: 'CREATED', actor: u.name, actorRole: 'TECHNICIAN', comment: '수리 접수 작성' })
  if (req.serviceTypeChange && req.visitInfo?.serviceType) {
    log(r, { target: 'SYSTEM', action: 'COMMENTED', actor: u.name, actorRole: 'TECHNICIAN', comment: `수리 방법 변경: ${SERVICE_TYPE_LABEL[req.serviceTypeChange.from]} → ${SERVICE_TYPE_LABEL[req.visitInfo.serviceType]} · 사유: ${req.serviceTypeChange.reason}` })
  }
  db.repairs.unshift(r)
  persist()
  return r
}

export function uploadImage(id: number, req: UploadImageRequest): RepairImage {
  const r = repairOr404(id)
  const img = toImage(req)
  r.images.push(img)
  persist()
  return img
}

/** POST /api/repairs/{id}/submit — 사진 업로드 후 진단 요청 */
export function submitRepair(id: number): Repair {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  const kinds = new Set(r.images.map((i) => i.kind))
  if (!kinds.has('PCB') || !kinds.has('MOTOR')) throw new ApiError(422, 'PCB 사진과 기계·찌그러짐 사진이 모두 필요합니다.')
  r.status = 'RECEIVED'
  log(r, { target: 'SYSTEM', action: 'SUBMITTED', actor: u.name, actorRole: 'TECHNICIAN', comment: `사진 ${r.images.length}장 등록 · AI 진단 요청` })
  persist()
  restartAnalysis(r)
  return r
}

/* ---------------- 추가 사진 ---------------- */
export function getPhotoRequests(id: number): PhotoRequest[] {
  return db.photoRequests[id] ?? []
}

export function uploadAdditionalImages(id: number, req: AdditionalInfoRequest): Repair {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  if (r.status !== 'ADDITIONAL_INFO_NEEDED') throw new ApiError(409, '추가 사진을 요청받은 상태가 아닙니다.')
  const note = req.note?.trim()
  if (!req.photos.length && !note) throw new ApiError(422, '추가 사진이나 설명 중 하나는 입력해 주세요.')
  const pending = (db.photoRequests[id] ?? []).find((p) => !p.resolved)
  // 같은 수리 ID 에 새 입력 개정(inputRevision)을 만든다. 기존 사진은 그대로 두고 새 사진에 몇 차 요청인지 표시
  const round = pending?.requestNo ?? r.photoRequestCount
  r.inputRevision = (r.inputRevision ?? 1) + 1
  req.photos.forEach((q) => r.images.push({ ...toImage({ ...q, kind: 'ADDITIONAL' }), note: pending?.target, round }))
  if (pending) pending.resolved = true
  const what = [req.photos.length ? `추가 사진 ${req.photos.length}장` : '', note ? '추가 설명' : ''].filter(Boolean).join(' · ')
  log(r, { target: 'PHOTO', action: 'PHOTO_ADDED', actor: u.name, actorRole: 'TECHNICIAN', comment: `${what} 제출 (${pending?.target ?? '추가'}) · 입력 r${r.inputRevision}${note ? `\n설명: ${note}` : ''}` })
  // 데모: 추가 사진 등록 후 정상 진행
  r.mockScenario = 'NORMAL'
  restartAnalysis(r, 'ANALYSIS')
  return r
}

/* ---------------- 진단 ---------------- */
export function getDiagnosis(id: number): { current: Diagnosis | null; versions: Diagnosis[] } {
  repairOr404(id)
  const list = db.diagnoses[id] ?? []
  return { current: list[list.length - 1] ?? null, versions: list }
}

export function approval(id: number, req: ApprovalRequest): Repair {
  const u = me()
  const r = repairOr404(id)
  const now = new Date().toISOString()
  const decision = (state: Diagnosis['technicianDecision']['state']) => ({ state, decidedBy: u.name, decidedByRole: u.role, decidedAt: now, comment: req.comment })

  if (req.target === 'DIAGNOSIS') {
    requireRole('TECHNICIAN')
    const latest = latestDiagnosis(id)
    // 분석 실패 건은 진단 없이도 본사 수동 검토를 요청할 수 있음
    if (req.action === 'REQUEST_HQ_REVIEW' && (r.analysisError || r.status === 'ADDITIONAL_INFO_NEEDED')) {
      r.status = 'MANUAL_REVIEW'
      log(r, { target: 'DIAGNOSIS', action: 'HQ_REVIEW_REQUESTED', actor: u.name, actorRole: u.role, comment: req.comment || 'AI 분석 실패로 본사 수동 검토 요청' })
      db.notifications.unshift({ id: uid('n'), title: '본사 검토 요청', body: `수리 #${r.id} 분석 실패 건 수동 검토 요청`, at: now, read: false, link: `/approvals/${r.id}`, roles: ['QUALITY_MANAGER'] })
      persist()
      return r
    }
    if (!latest) throw new ApiError(404, '진단 결과가 없습니다.')
    const d = latest
    if (r.status !== 'DIAGNOSIS_COMPLETED' && req.action !== 'COMMENT') throw new ApiError(409, '이미 처리된 진단입니다. 화면을 새로고침해 주세요.')
    switch (req.action) {
      case 'APPROVE':
        d.technicianDecision = decision('APPROVED')
        r.status = 'TECHNICIAN_REVIEW'
        log(r, { target: 'DIAGNOSIS', action: 'CONFIRMED', actor: u.name, actorRole: u.role, comment: req.comment || `AI 진단 v${d.version} 확인 · 점검 진행` })
        break
      case 'REJECT':
        if (!req.comment) throw new ApiError(422, '반려 사유를 입력해 주세요.')
        d.technicianDecision = decision('REJECTED')
        r.status = 'TECHNICIAN_REVIEW' // AI 진단은 버리고 기사가 직접 점검·입력
        log(r, { target: 'DIAGNOSIS', action: 'REJECTED', actor: u.name, actorRole: u.role, comment: req.comment })
        break
      case 'REQUEST_HQ_REVIEW':
        d.technicianDecision = decision('CHANGE_REQUESTED')
        r.status = 'MANUAL_REVIEW'
        log(r, { target: 'DIAGNOSIS', action: 'HQ_REVIEW_REQUESTED', actor: u.name, actorRole: u.role, comment: req.comment })
        db.notifications.unshift({ id: uid('n'), title: '본사 검토 요청', body: `수리 #${r.id} 기사가 본사 검토를 요청했습니다.`, at: now, read: false, link: `/approvals/${r.id}`, roles: ['QUALITY_MANAGER'] })
        break
      case 'COMMENT':
        log(r, { target: 'DIAGNOSIS', action: 'COMMENTED', actor: u.name, actorRole: u.role, comment: req.comment })
        break
      default:
        throw new ApiError(400, '지원하지 않는 처리입니다.')
    }
  } else if (req.target === 'MANUAL_REVIEW') {
    requireRole('QUALITY_MANAGER')
    if (r.status !== 'MANUAL_REVIEW') throw new ApiError(409, '수동 검토 상태가 아닙니다.')
    if (!req.comment) throw new ApiError(422, '검토 의견을 입력해 주세요.')
    r.status = 'TECHNICIAN_REVIEW'
    log(r, { target: 'DIAGNOSIS', action: 'CHANGE_REQUESTED', actor: u.name, actorRole: u.role, comment: `본사 수동 진단: ${req.comment}` })
    db.notifications.unshift({ id: uid('n'), title: '본사 수동 진단 회신', body: `수리 #${r.id}: ${req.comment}`, at: now, read: false, link: `/repairs/${r.id}/review`, roles: ['TECHNICIAN'] })
  }
  persist()
  return r
}

export function reanalysis(id: number, req: ReanalysisRequest): Repair {
  const u = me()
  const r = repairOr404(id)
  if (!req.reason?.trim()) throw new ApiError(422, '재분석 요청 사유를 입력해 주세요.')
  const d = latestDiagnosis(id)
  if (d && d.technicianDecision.state === 'PENDING') {
    d.technicianDecision = { state: 'REANALYSIS_REQUESTED', decidedBy: u.name, decidedByRole: u.role, decidedAt: new Date().toISOString(), comment: req.reason }
  }
  log(r, { target: 'DIAGNOSIS', action: 'REANALYSIS_REQUESTED', actor: u.name, actorRole: u.role, comment: req.reason })
  r.mockScenario = 'NORMAL'
  restartAnalysis(r)
  return r
}

/* ---------------- 수리 리포트 (초안 저장 → 확정) ---------------- */
function checkReportVersion(r: Repair, version: number | null) {
  if ((r.report?.version ?? null) !== version) {
    throw new ApiError(409, '다른 곳에서 리포트가 먼저 수정되었습니다. 최신 내용을 불러온 뒤 다시 시도해 주세요.', 'REPORT_VERSION')
  }
}

/** PUT /api/repairs/{id}/report — 초안 저장. 확정된 리포트를 수정하면 revision+1 의 새 초안이 된다 */
export function saveReportDraft(id: number, req: SaveReportDraftRequest): Repair {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  if (r.status !== 'TECHNICIAN_REVIEW' && r.status !== 'CLOSED') throw new ApiError(409, '진단 확인 후에 리포트를 작성할 수 있습니다.')
  checkReportVersion(r, req.version)
  const now = new Date().toISOString()
  const content = { ...req.content }
  // 고장 없음이면 고장 부위는 비우고, AI 진단이 없던 건은 수용 여부를 NOT_AVAILABLE 로 고정
  if (content.outcome === 'NO_FAULT_FOUND') content.faults = []
  if (!latestDiagnosis(id)) content.aiAcceptance = 'NOT_AVAILABLE'

  const prev = r.report
  let report: RepairReport
  if (!prev) {
    report = { id: `RPT-${id}`, repairId: id, version: 1, revision: 1, status: 'DRAFT', content, createdBy: u.name, updatedBy: u.name, updatedAt: now, confirmations: [] }
  } else {
    const reopened = prev.status === 'CONFIRMED'
    report = {
      ...prev,
      version: prev.version + 1,
      revision: reopened ? prev.revision + 1 : prev.revision,
      status: 'DRAFT',
      content,
      updatedBy: u.name,
      updatedAt: now,
      confirmedBy: undefined,
      confirmedAt: undefined,
    }
  }
  r.report = report
  log(r, { target: 'REPORT', action: 'DRAFT_SAVED', actor: u.name, actorRole: u.role, comment: `리포트 초안 r${report.revision} 저장` })
  persist()
  return r
}

/** POST /api/repairs/{id}/report/confirm — 확정. 고장 DB 레코드를 이 수리 건 기준으로 교체(upsert) 하고 CLOSED 로 */
export function confirmReport(id: number, req: ConfirmReportRequest): Repair {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  const rep = r.report
  if (!rep) throw new ApiError(409, '저장된 리포트 초안이 없습니다.')
  checkReportVersion(r, req.version)
  if (rep.status === 'CONFIRMED') throw new ApiError(409, '이미 확정된 리포트입니다.')
  const c = rep.content
  if (!c.actualCause.trim()) throw new ApiError(422, '실제 원인을 입력해 주세요.')
  if (!c.actualAction.trim()) throw new ApiError(422, '실제 조치 내용을 입력해 주세요.')
  if (c.outcome !== 'NO_FAULT_FOUND' && !c.faults.length) throw new ApiError(422, '고장 부위를 1개 이상 입력해 주세요.')

  const now = new Date().toISOString()
  Object.assign(rep, { status: 'CONFIRMED', version: rep.version + 1, confirmedBy: u.name, confirmedAt: now, updatedBy: u.name, updatedAt: now })
  rep.confirmations.push({ revision: rep.revision, confirmedBy: u.name, confirmedAt: now })
  // 사내 사례 동기화 대기열에 올림 (US-08 · Mock 시뮬레이션)
  db.caseSyncs = { ...(db.caseSyncs ?? {}), [id]: { revision: rep.revision, queuedAt: now } }
  r.status = 'CLOSED'

  // ★ 확정본만 고장 DB 에 반영. 같은 수리 건의 이전 확정본은 교체
  const idx = approvedRecords.findIndex((x) => x.repairId === id)
  if (idx >= 0) approvedRecords.splice(idx, 1)
  if (c.outcome !== 'NO_FAULT_FOUND') {
    const f = c.faults[0]
    const part = f.partId ? db.parts.find((p) => p.id === f.partId) : undefined
    const rec: DefectRecord = {
      repairId: r.id,
      receiptNo: r.receiptNo,
      model: r.product.model,
      part: part?.name ?? `${FAULT_AREA_LABEL[f.area]} (부품 교체 없음)`,
      cause: c.actualCause,
      branch: r.branch,
      factory: r.product.factory,
      month: now.slice(0, 7),
      aiMatched: c.aiAcceptance === 'ACCEPTED' || c.aiAcceptance === 'PARTIAL',
      approvedAt: now,
    }
    approvedRecords.push(rec)
  }
  log(r, {
    target: 'REPORT',
    action: 'CONFIRMED',
    actor: u.name,
    actorRole: u.role,
    comment: `리포트 r${rep.revision} 확정 · ${c.outcome === 'NO_FAULT_FOUND' ? '고장 없음 (고장 DB 미반영)' : rep.revision > 1 ? '고장 DB 반영 내용 교체' : '고장 DB 반영'}`,
  })
  persist()
  return r
}

/* ---------------- 부품·발주 ---------------- */
export function listParts(): Part[] {
  return db.parts
}
export function getPartInventory(partId: string): Part {
  const p = db.parts.find((x) => x.id === partId)
  if (!p) throw new ApiError(404, '부품 정보를 찾을 수 없습니다.')
  return p
}

/** AI 발주안이 없으면 진단의 필요 부품으로부터 생성 (AI_DRAFT — 아직 요청 아님)
 *  전체 창고 재고가 필요 수량 이상이면 재고로 수리하므로 발주안을 만들지 않는다 */
export function listRepairOrders(id: number): PurchaseOrder[] {
  const r = repairOr404(id)
  const d = latestDiagnosis(id)
  if (d && d.technicianDecision.state === 'APPROVED') {
    for (const rec of d.parts) {
      if (db.orders.some((o) => o.repairId === id && o.partId === rec.partId)) continue
      const part = db.parts.find((p) => p.id === rec.partId)
      const total = part?.stocks.reduce((a, s) => a + s.quantity, 0) ?? 0
      if (total >= rec.quantity) continue
      const best = part?.stocks.slice().sort((a, b) => b.quantity - a.quantity)[0]
      db.orders.push({
        id: uid('PO'),
        repairId: id,
        receiptNo: r.receiptNo,
        partId: rec.partId,
        partNo: rec.partNo,
        partName: rec.partName,
        quantity: rec.quantity,
        fromWarehouse: best?.warehouse ?? '-',
        aiReason: `${rec.reason}. 전체 창고 재고 ${total}개로 필요 수량 ${rec.quantity}개에 부족 · ${part?.factory} 생산 요청 필요 (예상 ${part?.leadTimeDays}일)`,
        aiConfidence: d.confidence,
        sourceIds: d.candidates[0]?.sourceIds ?? [],
        status: 'AI_DRAFT',
        decision: { state: 'PENDING' },
        createdAt: new Date().toISOString(),
      })
    }
    persist()
  }
  return db.orders.filter((o) => o.repairId === id)
}

export function listOrders(): PurchaseOrder[] {
  const u = me()
  // 기사: 자신에게 배정된 수리 건의 발주만 (출장기사 · 센터 수리자 공통)
  const list = u.role === 'TECHNICIAN' ? db.orders.filter((o) => canViewRepair(db.repairs.find((r) => r.id === o.repairId) ?? {}, u)) : db.orders
  return [...list].sort((a, b) => (b.requestedAt ?? b.createdAt).localeCompare(a.requestedAt ?? a.createdAt))
}

export function createOrder(id: number, req: CreateOrderRequest): PurchaseOrder {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  if (req.quantity < 1) throw new ApiError(422, '발주 수량은 1개 이상이어야 합니다.')
  const part = getPartInventory(req.partId)
  let o = req.draftOrderId ? db.orders.find((x) => x.id === req.draftOrderId) : undefined
  if (!o) {
    o = { id: uid('PO'), repairId: id, receiptNo: r.receiptNo, partId: part.id, partNo: part.partNo, partName: part.name, quantity: req.quantity, fromWarehouse: req.fromWarehouse, aiReason: '기사 직접 요청 (AI 발주안 아님)', aiConfidence: 0, sourceIds: [], status: 'AI_DRAFT', decision: { state: 'PENDING' }, createdAt: new Date().toISOString() }
    db.orders.push(o)
  }
  if (o.status !== 'AI_DRAFT' && o.status !== 'REJECTED') throw new ApiError(409, '이미 요청된 발주입니다.')
  Object.assign(o, { quantity: req.quantity, fromWarehouse: req.fromWarehouse, status: 'REQUESTED', requestedBy: u.name, requestedAt: new Date().toISOString(), requestComment: req.comment, decision: { state: 'PENDING' } })
  log(r, { target: 'ORDER', action: 'ORDER_REQUESTED', actor: u.name, actorRole: u.role, comment: `${o.partName}(${o.partNo}) ${o.quantity}개 · ${o.fromWarehouse}` })
  db.notifications.unshift({ id: uid('n'), title: '발주 승인 요청', body: `${o.partName}(${o.partNo}) ${o.quantity}개 · 수리 #${r.id}`, at: new Date().toISOString(), read: false, link: '/order-approvals', roles: ['QUALITY_MANAGER'] })
  persist()
  return o
}

export function decideOrder(orderId: string, req: OrderDecisionRequest): PurchaseOrder {
  const u = requireRole('QUALITY_MANAGER')
  const o = db.orders.find((x) => x.id === orderId)
  if (!o) throw new ApiError(404, '발주 요청을 찾을 수 없습니다.')
  if (o.status !== 'REQUESTED') throw new ApiError(409, '승인 대기 상태가 아닙니다.')
  if (req.action === 'REJECT' && !req.comment) throw new ApiError(422, '반려 사유를 입력해 주세요.')
  o.status = req.action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  o.decision = { state: req.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: u.name, decidedByRole: u.role, decidedAt: new Date().toISOString(), comment: req.comment }
  if (req.action === 'APPROVE') {
    const stock = db.parts.find((p) => p.id === o.partId)?.stocks.find((s) => s.warehouse === o.fromWarehouse)
    if (stock) stock.quantity = Math.max(0, stock.quantity - o.quantity)
  }
  const r = db.repairs.find((x) => x.id === o.repairId)
  if (r) log(r, { target: 'ORDER', action: req.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', actor: u.name, actorRole: u.role, comment: `${o.partName} 발주 ${req.action === 'APPROVE' ? '승인' : '반려'}${req.comment ? ` · ${req.comment}` : ''}` })
  persist()
  return o
}

/* ---------------- 대시보드 ---------------- */
function allRecords() {
  return [...baseDefectRecords, ...approvedRecords]
}
function countBy(list: DefectRecord[], key: keyof DefectRecord) {
  const m = new Map<string, number>()
  list.forEach((r) => m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1))
  return [...m.entries()].map(([k, count]) => ({ key: k, label: k, count })).sort((a, b) => b.count - a.count)
}

export function dashboard(months = 6): DefectDashboard {
  requireRole('QUALITY_MANAGER')
  const recs = allRecords()
  const monthKeys = [...new Set(recs.map((r) => r.month))].sort().slice(-months)
  const inRange = recs.filter((r) => monthKeys.includes(r.month))
  const received = inRange.length + Math.round(inRange.length * 0.14) + db.repairs.length // 승인 전·반려 건 포함 접수
  const matchRate = Math.round((inRange.filter((r) => r.aiMatched).length / Math.max(1, inRange.length)) * 1000) / 10
  const trend = monthKeys.map((m) => {
    const d = inRange.filter((r) => r.month === m).length
    return { month: m, received: d + Math.round(d * 0.14), defects: d }
  })
  const causes = countBy(inRange, 'cause').slice(0, 5)
  const half = monthKeys.slice(-2)
  const recurring = causes.map((c) => {
    const recent = inRange.filter((r) => r.cause === c.key && half.includes(r.month)).length
    const prev = inRange.filter((r) => r.cause === c.key && !half.includes(r.month)).length / Math.max(1, monthKeys.length - 2)
    const avgRecent = recent / Math.max(1, half.length)
    return {
      type: c.key,
      count: c.count,
      models: [...new Set(inRange.filter((r) => r.cause === c.key).map((r) => r.model))],
      trend: (avgRecent > prev * 1.15 ? 'UP' : avgRecent < prev * 0.85 ? 'DOWN' : 'FLAT') as 'UP' | 'DOWN' | 'FLAT',
    }
  })
  return {
    periodLabel: `${monthKeys[0]} ~ ${monthKeys[monthKeys.length - 1]}`,
    totalReceived: received,
    completed: inRange.length,
    aiSuccessRate: 96.4,
    aiMatchRate: matchRate,
    approvedCount: inRange.length,
    byPart: countBy(inRange, 'part'),
    byModel: countBy(inRange, 'model'),
    byBranch: countBy(inRange, 'branch'),
    byFactory: countBy(inRange, 'factory'),
    trend,
    recurring,
  }
}

/** 최근 n일 동안 확정된 고장(기사·담당자가 확정한 리포트만, AI 초안 제외)의 부품별 건수 — 많은 순 */
export function dashboardPartTop(days = 30, limit = 5): CountItem[] {
  requireRole('QUALITY_MANAGER')
  const since = Date.now() - days * 86_400_000
  return countBy(allRecords().filter((r) => new Date(r.approvedAt).getTime() >= since), 'part').slice(0, limit)
}

export function dashboardRecords(filter: { dim: 'part' | 'model' | 'branch' | 'factory' | 'month' | 'cause'; value: string }): DefectRecord[] {
  requireRole('QUALITY_MANAGER')
  return allRecords()
    .filter((r) => r[filter.dim] === filter.value)
    .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt))
}

/* ---------------- 알림 ---------------- */
export function listNotifications() {
  const u = me()
  return db.notifications.filter((n) => n.roles.includes(u.role)).slice(0, 20)
}
export function readNotification(id: string) {
  const n = db.notifications.find((x) => x.id === id)
  if (n) n.read = true
  persist()
}
export function readAllNotifications() {
  const u = me()
  db.notifications.filter((n) => n.roles.includes(u.role)).forEach((n) => (n.read = true))
  persist()
}

/* ---------------- 보증 판정 ---------------- */
const WARRANTY_MONTHS = 12

/** 구매일부터 지금까지 지난 개월 수 (일 단위 내림) */
function monthsSince(date: string, now = new Date()): number {
  const d = new Date(`${date}T00:00:00`)
  let m = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  if (now.getDate() < d.getDate()) m--
  return Math.max(0, m)
}

export function getWarranty(id: number): Warranty {
  const r = repairOr404(id)
  db.warranty ??= {}
  const saved = db.warranty[id] ?? {}
  const d = latestDiagnosis(id)
  // 고장 원인: 시드 지정값 > AI 진단 원인(제품 결함으로 간주) > 진단 전
  const fault = saved.fault ?? (d ? { type: 'PRODUCT_DEFECT' as const, label: `제품 결함 (${d.topCause})` } : { type: 'UNKNOWN' as const, label: '원인 미확정 (AI 진단 전)' })
  const purchaseDate = r.visitInfo?.purchaseDate ?? undefined
  const elapsed = purchaseDate ? monthsSince(purchaseDate) : null
  const expired = elapsed !== null && elapsed >= WARRANTY_MONTHS

  let suggestion: Warranty['suggestion']
  if (!purchaseDate) suggestion = 'UNKNOWN'
  else if (expired || fault.type === 'USER_FAULT') suggestion = 'PAID'
  else if (fault.type === 'PRODUCT_DEFECT') suggestion = 'FREE'
  else suggestion = 'UNKNOWN'

  const purchaseLine = !purchaseDate
    ? '구매일: 모름 (고객 확인 필요)'
    : expired
      ? `구매일: ${purchaseDate} (보증 기간 1년 · ${elapsed}개월 경과로 만료)`
      : `구매일: ${purchaseDate} (보증 기간 1년 중 ${elapsed}개월 경과)`
  return {
    suggestion,
    purchaseDate,
    warrantyMonths: WARRANTY_MONTHS,
    faultType: fault.type,
    reasons: [purchaseLine, `고장 원인: ${fault.label}`, '판단 근거: AI 진단 원인 + 보증 규칙 (구매 후 12개월 이내 제품 결함은 무상, 사용자 과실·기간 만료는 유상)'],
    decision: saved.decision,
  }
}

export function decideWarranty(id: number, result: 'FREE' | 'PAID', reason?: string): Warranty {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  const w = getWarranty(id)
  if (w.decision) throw new ApiError(409, '이미 보증 판정을 확정했습니다.')
  const comment = reason?.trim() || undefined
  if (result !== w.suggestion && !comment) throw new ApiError(422, 'AI 제안과 다르게 확정할 때는 사유를 입력해 주세요.')
  db.warranty[id] = { ...db.warranty[id], decision: { result, reason: comment, decidedBy: u.name, decidedAt: new Date().toISOString() } }
  log(r, { target: 'SYSTEM', action: 'CONFIRMED', actor: u.name, actorRole: u.role, comment: `보증 판정 ${result === 'FREE' ? '무상' : '유상'} 확정${comment ? ` · ${comment}` : ''}` })
  persist()
  return getWarranty(id)
}

/* ---------------- 출장 준비 · 재고 예약 ----------------
 * 창고 stock.quantity = 가용 수량. 예약하면 가용에서 빼고, 예약 수량은 예약 목록(RESERVED)의 합으로 계산한다 */
const RESERVATION_HOURS = 24
const PHOTO_WORD: Record<string, string> = { PCB: 'PCB 사진', MOTOR: '기계 사진' }

function stockLog(e: Omit<StockHistoryEntry, 'id' | 'at'>, at = new Date().toISOString()) {
  db.stockHistory.unshift({ id: uid('SH'), at, ...e })
}
function stockOf(partId: string, warehouse: string) {
  const s = db.parts.find((p) => p.id === partId)?.stocks.find((x) => x.warehouse === warehouse)
  if (!s) throw new ApiError(404, '재고 정보를 찾을 수 없습니다.')
  return s
}
/** 24시간 지난 예약을 만료 처리 (조회할 때마다 확인) */
function expireReservations() {
  db.reservations ??= []
  db.stockHistory ??= []
  const now = Date.now()
  let changed = false
  for (const r of db.reservations) {
    if (r.status !== 'RESERVED' || new Date(r.expiresAt).getTime() > now) continue
    r.status = 'EXPIRED'
    r.closedAt = r.expiresAt
    stockOf(r.partId, r.warehouse).quantity += r.quantity
    stockLog({ partId: r.partId, change: 'EXPIRE', delta: r.quantity, quantity: r.quantity, warehouse: r.warehouse, actor: '시스템 (24시간 만료)', repairId: r.repairId }, r.expiresAt)
    changed = true
  }
  if (changed) persist()
}
const reservedAt = (partId: string, warehouse: string) =>
  db.reservations.filter((r) => r.partId === partId && r.warehouse === warehouse && r.status === 'RESERVED').reduce((a, r) => a + r.quantity, 0)

export function getTripParts(repairId: number): TripPart[] {
  repairOr404(repairId)
  expireReservations()
  const d = latestDiagnosis(repairId)
  if (!d) return []
  // 예측 근거: 이상·의심 판정이 나온 부위의 사진 분석 요약
  const finding = d.agents.find((a) => a.verdict === 'ABNORMAL') ?? d.agents.find((a) => a.verdict === 'SUSPICIOUS')
  return d.parts.map((rec) => {
    const part = db.parts.find((p) => p.id === rec.partId)
    const mine = db.reservations.filter((r) => r.partId === rec.partId && r.repairId === repairId)
    return {
      partId: rec.partId,
      partName: rec.partName,
      partNo: rec.partNo,
      quantity: rec.quantity,
      reason: finding ? `${PHOTO_WORD[finding.agent]}: ${finding.summary} → ${rec.reason}` : rec.reason,
      stocks: (part?.stocks ?? []).map((s) => ({ warehouse: s.warehouse, location: s.location, available: s.quantity, reserved: reservedAt(rec.partId, s.warehouse) })),
      reservation: mine.sort((a, b) => b.reservedAt.localeCompare(a.reservedAt))[0],
    }
  })
}

export function reserveStock(partId: string, quantity: number, repairId: number): StockReservation {
  const u = requireRole('TECHNICIAN')
  repairOr404(repairId)
  expireReservations()
  if (quantity < 1) throw new ApiError(422, '예약 수량은 1개 이상이어야 합니다.')
  if (db.reservations.some((r) => r.partId === partId && r.repairId === repairId && r.status === 'RESERVED')) throw new ApiError(409, '이미 예약한 부품입니다.')
  const part = db.parts.find((p) => p.id === partId)
  if (!part) throw new ApiError(404, '부품을 찾을 수 없습니다.')
  const stock = [...part.stocks].filter((s) => s.quantity >= quantity).sort((a, b) => b.quantity - a.quantity)[0]
  if (!stock) throw new ApiError(409, '가용 재고가 부족합니다. 주문 요청을 이용해 주세요.', 'INSUFFICIENT_STOCK')

  // 동시 예약 시연: 1개만 남았거나 10% 확률로 다른 기사가 먼저 예약한 것으로 처리
  if (stock.quantity === 1 || Math.random() < 0.1) {
    const other = USERS.find((x) => x.role === 'TECHNICIAN' && x.name !== u.name)?.name ?? '다른 기사'
    const take = Math.min(stock.quantity, quantity)
    const otherRepair = db.repairs.find((r) => r.id !== repairId)?.id ?? repairId
    const now = new Date()
    db.reservations.push({ id: uid('RSV'), partId, repairId: otherRepair, warehouse: stock.warehouse, quantity: take, status: 'RESERVED', reservedBy: other, reservedAt: now.toISOString(), expiresAt: new Date(now.getTime() + RESERVATION_HOURS * 3_600_000).toISOString() })
    stock.quantity -= take
    stockLog({ partId, change: 'RESERVE', delta: -take, quantity: take, warehouse: stock.warehouse, actor: other, repairId: otherRepair })
    persist()
    throw new ApiError(409, '다른 기사가 먼저 예약해서 재고가 바뀌었어요.', 'STOCK_CONFLICT')
  }

  const now = new Date()
  const r: StockReservation = {
    id: uid('RSV'),
    partId,
    repairId,
    warehouse: stock.warehouse,
    quantity,
    status: 'RESERVED',
    reservedBy: u.name,
    reservedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESERVATION_HOURS * 3_600_000).toISOString(),
  }
  stock.quantity -= quantity
  db.reservations.push(r)
  stockLog({ partId, change: 'RESERVE', delta: -quantity, quantity, warehouse: stock.warehouse, actor: u.name, repairId })
  persist()
  return r
}

function activeReservation(id: string): StockReservation {
  expireReservations()
  const r = db.reservations.find((x) => x.id === id)
  if (!r) throw new ApiError(404, '예약을 찾을 수 없습니다.')
  if (r.status !== 'RESERVED') throw new ApiError(409, r.status === 'EXPIRED' ? '예약이 만료되었습니다. 다시 예약해 주세요.' : '이미 처리된 예약입니다.')
  return r
}

export function cancelReservation(id: string): StockReservation {
  const u = requireRole('TECHNICIAN')
  const r = activeReservation(id)
  r.status = 'CANCELLED'
  r.closedAt = new Date().toISOString()
  stockOf(r.partId, r.warehouse).quantity += r.quantity
  stockLog({ partId: r.partId, change: 'CANCEL', delta: r.quantity, quantity: r.quantity, warehouse: r.warehouse, actor: u.name, repairId: r.repairId })
  persist()
  return r
}

/** 출고: 예약분을 실제로 가져감 (가용은 예약 때 이미 빠졌으므로 변화 없음, 예약에서 차감) */
export function releaseStock(id: string): StockReservation {
  const u = requireRole('TECHNICIAN')
  const r = activeReservation(id)
  r.status = 'RELEASED'
  r.closedAt = new Date().toISOString()
  stockLog({ partId: r.partId, change: 'RELEASE', delta: 0, quantity: r.quantity, warehouse: r.warehouse, actor: u.name, repairId: r.repairId })
  persist()
  return r
}

export function getStockHistory(partId: string): StockHistoryEntry[] {
  expireReservations()
  return db.stockHistory.filter((h) => h.partId === partId).sort((a, b) => b.at.localeCompare(a.at))
}

/* ---------------- 소비자용 수리 진행 조회 (로그인 없음) ----------------
 * 기사가 확정한 내용만 쉬운 말로. AI 초안·판단 점수·부품번호·재고는 담지 않는다 */
const CUSTOMER_NOT_FOUND = '접수 정보를 찾을 수 없어요. 접수번호를 다시 확인해 주세요.'
const AREA_WORD: Record<string, string> = { PCB: '내부 전원 회로 기판', MOTOR: '바퀴를 움직이는 모터 부분', SW: '제품 소프트웨어', OTHER: '일부 부품' }

/** 진단 원인 → 쉬운 말 (전문 용어·부품번호 없이) */
function plainArea(cause: string): string {
  if (/모터|하우징/.test(cause)) return AREA_WORD.MOTOR
  if (/센서|휠|바퀴/.test(cause)) return '바퀴 회전을 감지하는 센서'
  if (/PCB|전원|기판/.test(cause)) return AREA_WORD.PCB
  return '고장 부위'
}

export function getCustomerReport(receiptNo: string, phoneLast4: string): CustomerReport {
  const no = receiptNo.trim().toUpperCase()
  const last4 = phoneLast4.replace(/\D/g, '')
  const r = db.repairs.find((x) => x.receiptNo.toUpperCase() === no)
  const phone = r?.visitInfo?.phone.replace(/\D/g, '') ?? ''
  // 접수번호 없음 · 연락처 없음 · 뒷자리 불일치 모두 같은 응답
  if (!r || last4.length !== 4 || !phone || !phone.endsWith(last4)) throw new ApiError(404, CUSTOMER_NOT_FOUND, 'NOT_FOUND')
  return customerReportOf(r)
}

/** 조회 링크 토큰으로 조회 (고객 직접 접수 건) */
export function getCustomerReportByToken(token: string): CustomerReport {
  const r = token ? db.repairs.find((x) => x.customerToken === token) : undefined
  if (!r) throw new ApiError(404, CUSTOMER_NOT_FOUND, 'NOT_FOUND')
  return customerReportOf(r)
}

/** 고객에게 보여 줄 내용만 골라 만든다 (미확정 AI 진단·점수·재고·생산 공장·MCP·내부 코멘트 없음) */
function customerReportOf(r: Repair): CustomerReport {
  const d = latestDiagnosis(r.id)
  const diagConfirmed = d?.technicianDecision.state === 'APPROVED'
  const visit = { preferredDate: r.visitInfo?.preferredDate, confirmedDate: r.visitInfo?.confirmedDate }
  let stage: CustomerReport['stage'] = 'RECEIVED'
  let notice: string | undefined
  let cause: string | undefined
  let result: string | undefined

  switch (r.status) {
    case 'DRAFT':
    case 'RECEIVED':
      break
    case 'QUEUED':
    case 'ANALYZING':
    case 'DIAGNOSIS_COMPLETED':
      // AI 초안이 있어도 기사 확인 전에는 '사진 확인 중'으로만 안내
      stage = 'PHOTO_CHECK'
      break
    case 'ADDITIONAL_INFO_NEEDED':
      stage = 'PHOTO_CHECK'
      notice = '사진을 한 번 더 확인해야 해서 기사님이 연락드릴 예정이에요.'
      break
    case 'MANUAL_REVIEW':
      stage = 'PHOTO_CHECK'
      notice = '전문 담당자가 사진을 한 번 더 확인하고 있어요.'
      break
    case 'REJECTED':
      stage = 'PHOTO_CHECK'
      notice = '기사님이 고장 부위를 직접 확인하고 있어요.'
      break
    case 'TECHNICIAN_REVIEW':
      stage = visit.confirmedDate ? 'VISIT_SCHEDULED' : 'DIAGNOSED'
      break
    case 'APPROVED':
    case 'CLOSED':
      stage = 'COMPLETED'
      break
    case 'CANCELLED':
      notice = '접수가 취소되었어요. 궁금한 점은 고객센터로 문의해 주세요.'
      break
  }

  if (stage === 'COMPLETED' && r.report) {
    const c = r.report.content
    const area = AREA_WORD[c.faults[0]?.area ?? 'OTHER']
    cause = c.outcome === 'NO_FAULT_FOUND' ? '점검 결과 고장 난 곳을 찾지 못했어요.' : `${area}에 문제가 있었어요.`
    result =
      c.outcome === 'FIXED'
        ? '고장 난 부분을 수리해 정상적으로 작동해요.'
        : c.outcome === 'NOT_FIXED'
          ? '수리 후에도 증상이 남아 있어 기사님이 추가로 확인할 예정이에요.'
          : '같은 증상이 다시 생기면 다시 접수해 주세요.'
  } else if ((stage === 'DIAGNOSED' || stage === 'VISIT_SCHEDULED') && d && diagConfirmed) {
    cause = `${plainArea(d.topCause)}에 문제가 있어요.`
    notice ??= d.parts.length ? '방문해서 해당 부품을 교체해 드릴 예정이에요.' : '방문해서 점검·수리해 드릴 예정이에요.'
  }

  return {
    receiptNo: r.receiptNo,
    productName: r.product.modelName,
    receivedAt: r.receivedAt,
    stage,
    notice,
    // 담당 기사: 배정된 경우만
    technicianName: r.technicianId ? r.technician : undefined,
    cause,
    result,
    // 기사가 확정한 결과만 (AI 제안은 보내지 않음)
    warranty: db.warranty?.[r.id]?.decision?.result ?? null,
    visit,
    cancelled: r.status === 'CANCELLED' || undefined,
  }
}

/* ---------------- 고객(비회원) 고장 접수 ----------------
 * 직원 계정·로그인과 무관. 접수 건은 기사 배정 전(technicianId 비움)으로 강남 서비스센터 목록에 들어가고,
 * 고객이 찍은 사진은 외관(기계) 사진으로 분류해 AI 분석을 시작한다 (고객은 내부 PCB 를 찍을 수 없음) */
export function customerIntake(req: CustomerIntakeRequest, photos: { name: string; dataUrl: string }[]): CustomerIntakeResponse {
  const name = req.customerName.trim()
  const phone = req.phone.trim()
  if (!name || !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(phone)) throw new ApiError(422, '이름과 휴대폰 번호를 확인해 주세요.')
  // 영문 Enum 값만 받는다 (한국어 라벨 · 옛 키는 거부)
  if (!isProductType(req.productType)) throw new ApiError(422, '제품 종류를 선택해 주세요.')
  const productType = req.productType
  const productTypeDetail = productType === 'unknown' ? req.productTypeDetail?.trim() : undefined
  if (productTypeDetail && productTypeDetail.length > PRODUCT_TYPE_DETAIL_MAX) throw new ApiError(422, `제품 종류는 ${PRODUCT_TYPE_DETAIL_MAX}자 이하로 입력해 주세요.`)
  /** 화면에 보일 제품 종류 이름 (기타 → 직접 입력값) */
  const catLabel = productTypeDetail || PRODUCT_TYPE_LABEL[productType]
  // 시리얼 필수 · 제조사 선택 (화면 검사와 같은 기준)
  if (!req.serial?.trim()) throw new ApiError(422, '시리얼 번호를 입력해 주세요.')
  if (!req.manufacturer?.trim()) throw new ApiError(422, '제조사를 입력해 주세요.')
  if (!req.model?.trim()) throw new ApiError(422, '제품 모델명을 입력해 주세요.')
  if (req.symptom.trim().length < 5) throw new ApiError(422, '고장 증상을 5자 이상 적어 주세요.')
  if (!photos.length) throw new ApiError(422, '제품 사진을 1장 이상 올려 주세요.')
  if (!req.consent?.agreed) throw new ApiError(422, '개인정보 수집·이용에 동의해 주세요.')
  // 수리 방법별 필수 항목: 방문 수리 = 주소 · 시간대 / 센터 방문 = 서비스센터 (큰 제품은 센터 방문 불가)
  const service = req.serviceType
  if (service !== 'VISIT' && service !== 'CENTER') throw new ApiError(422, '수리 방법을 골라 주세요.')
  const center = service === 'CENTER' ? SERVICE_CENTERS.find((c) => c.id === req.centerId) : undefined
  if (service === 'CENTER') {
    if (!canBringToCenter(productType)) throw new ApiError(422, '이 제품은 방문 수리만 가능해요.')
    if (!center) throw new ApiError(422, '서비스센터를 골라 주세요.')
  } else {
    if (!req.visitAddress?.roadAddress?.trim()) throw new ApiError(422, '방문 주소를 검색해 주세요.')
    if (!req.visitAddress.detailAddress?.trim()) throw new ApiError(422, '상세주소를 입력해 주세요.')
    if (req.visitSlot !== 'AM' && req.visitSlot !== 'PM') throw new ApiError(422, '방문 시간대를 골라 주세요.')
  }
  const serial = req.serial.trim().toUpperCase()
  const model = req.model.trim()
  const manufacturer = req.manufacturer?.trim()
  // 로봇청소기 기존 모델이면 기존 제품 데이터(시리얼 조회·모델 정보)를 그대로 사용
  const fromSerial = serial ? productFromSerial(serial) : null
  const meta = MODELS[model]
  const base: Repair['product'] =
    fromSerial && fromSerial.model === model
      ? fromSerial
      : meta
        ? { serialNumber: serial || '미입력', model, modelName: meta.modelName, manufacturedAt: '', factory: meta.factory, warrantyUntil: '', firmware: meta.firmware }
        : { serialNumber: serial || '미입력', model, modelName: `${catLabel} ${model}`, manufacturedAt: '', factory: '', warrantyUntil: '', firmware: '' }
  const product: Repair['product'] = { ...base, productType, ...(productTypeDetail ? { productTypeDetail } : {}), ...(manufacturer ? { manufacturer } : {}) }
  const id = nextId()
  const now = new Date().toISOString()
  const token = `${uid('trk')}-${Math.random().toString(36).slice(2, 10)}`
  const r: Repair = {
    id,
    receiptNo: `SR-2026-${String(10000 + id * 7).padStart(5, '0')}`,
    product,
    symptom: req.symptom.trim(),
    errorCodes: [],
    // 센터 방문은 고른 센터, 방문 수리는 기본 접수 센터
    branch: center?.name ?? '강남 서비스센터',
    technician: '배정 대기',
    technicianId: '',
    receivedAt: now,
    updatedAt: now,
    status: 'RECEIVED',
    images: photos.slice(0, 5).map((p, i) => ({ id: uid('img'), kind: 'MOTOR' as const, url: p.dataUrl, name: p.name || `photo-${i + 1}.jpg`, uploadedAt: now })),
    photoRequestCount: 0,
    stages: stagesFor('RECEIVED'),
    progress: 0,
    history: [],
    visitInfo: {
      customerName: name,
      phone,
      address: service === 'VISIT' ? (req.address ?? '').trim() : '',
      ...(service === 'VISIT' && req.visitAddress ? { visitAddress: { ...req.visitAddress } } : {}),
      preferredDate: req.preferredDate,
      purchaseDate: req.purchaseDate || null,
      serviceType: service,
      ...(center ? { centerId: center.id, centerName: center.name } : {}),
      ...(service === 'VISIT' ? { visitSlot: req.visitSlot } : {}),
    },
    consent: { ...req.consent },
    customerToken: token,
    source: 'CUSTOMER',
    mockScenario: 'NORMAL',
  }
  log(r, { target: 'SYSTEM', action: 'CREATED', actor: name, actorRole: 'CUSTOMER', comment: `고객 온라인 접수 · 사진 ${r.images.length}장` })
  db.repairs.unshift(r)
  db.notifications.unshift({ id: uid('n'), title: '고객 온라인 접수', body: `수리 #${id} (${catLabel} ${model}) 고객이 직접 접수했습니다.`, at: now, read: false, link: `/repairs/${id}/diagnosis`, roles: ['QUALITY_MANAGER'] })
  persist()
  restartAnalysis(r)
  return { receiptNo: r.receiptNo, token }
}

/* ---------------- 보증 기간 안내 (접수 화면) ----------------
 * 구매일이 있으면 구매일 + 12개월, 없으면 제조월 + 3개월(유통 기간 추정) + 12개월.
 * 결과에는 보증 상태·만료일·근거만 담는다 */
/** 시리얼별 제조월 시드 (데모). 없으면 제품 시드의 제조일 사용, null 이면 제조 정보 없음 → UNKNOWN */
const MANUFACTURE_MONTH: Record<string, string | null> = {
  RC2026000187: '2026-02', // 보증 기간 안 (추정)
  RC2024001234: '2024-03', // 보증 기간 지남
  RC2026000999: null, // 제조 정보 없음 → 안내 숨김
}
const SHIP_MONTHS = 3
const WARRANTY_PERIOD_MONTHS = 12

function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y, m - 1 + n, 1)
  // 말일 보정 (예: 1월 31일 + 1개월 → 2월 말일)
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()
  t.setDate(Math.min(d, last))
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function checkWarrantyPeriod(serial: string, purchaseDate?: string): WarrantyPeriod {
  const s = serial.trim().toUpperCase()
  const today = new Date().toISOString().slice(0, 10)
  const statusOf = (until: string): WarrantyPeriod['status'] => (until >= today ? 'IN_WARRANTY' : 'EXPIRED')
  if (purchaseDate && /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) && productFromSerial(s)) {
    const until = addMonths(purchaseDate, WARRANTY_PERIOD_MONTHS)
    return { status: statusOf(until), until, basis: 'CUSTOMER_INPUT' }
  }
  const month = s in MANUFACTURE_MONTH ? MANUFACTURE_MONTH[s] : productFromSerial(s)?.manufacturedAt.slice(0, 7)
  if (!month) return { status: 'UNKNOWN', basis: 'MANUFACTURE_DATE_ESTIMATE' }
  const until = addMonths(`${month}-01`, SHIP_MONTHS + WARRANTY_PERIOD_MONTHS)
  return { status: statusOf(until), until, basis: 'MANUFACTURE_DATE_ESTIMATE' }
}

/* ---------------- 출장 일정 (출장기사) ----------------
 * 로그인한 기사에게 배정된 오늘(한국 시간) 이후 방문 일정, 방문 시간 순.
 * 모델·증상·상태는 수리 건의 최신 값으로 채운다 (센터 수리자는 배정이 없어 빈 목록) */
export function getMyFieldVisits(today: string): FieldVisit[] {
  const u = requireRole('TECHNICIAN')
  return (db.fieldVisits ?? [])
    // 데모 시드의 'TODAY' 는 오늘(한국 시간)로
    .map((v) => (v.visitDate === 'TODAY' ? { ...v, visitDate: today } : v))
    .filter((v) => v.technicianId === u.employeeId && v.visitDate >= today)
    // 오늘의 출장에는 방문 수리 건만 (기사가 센터 방문으로 바꾼 건은 빠짐)
    .filter((v) => db.repairs.find((x) => x.id === v.repairId)?.visitInfo?.serviceType !== 'CENTER')
    .map((v) => {
      const r = db.repairs.find((x) => x.id === v.repairId)
      return r ? { ...v, model: r.product.model, symptom: r.symptom, status: r.status } : v
    })
    .sort((a, b) => `${a.visitDate} ${a.visitTime}`.localeCompare(`${b.visitDate} ${b.visitTime}`))
}

/* ---------------- 사내 사례 동기화 (US-08 · Mock 시뮬레이션) ----------------
 * 확정 후 4초 WAITING → 10초까지 SYNCING → COMPLETED. #107 은 시드에서 FAILED (실패 안내 시연)
 * 시드의 확정 리포트(동기화 기록 없음)는 확정 1분 30초 뒤 반영된 것으로 본다 */
const SYNC_FAILED_SEEDS = [107]
export function getCaseSync(id: number): CaseSync | null {
  const r = repairOr404(id)
  if (!canViewRepair(r, me())) throw new ApiError(404, '수리 건을 찾을 수 없습니다.')
  const rep = r.report
  const last = rep?.confirmations[rep.confirmations.length - 1]
  if (!rep || !last) return null
  const base = { repairId: id, reportId: rep.id ?? `RPT-${id}`, reportRevision: last.revision, confirmedAt: last.confirmedAt, source: '사내 확정 사례' as const }
  const rec = db.caseSyncs?.[id]
  if (!rec || rec.revision !== last.revision) {
    if (SYNC_FAILED_SEEDS.includes(id)) return { ...base, status: 'FAILED', failureMessage: '사내 사례 저장소에 같은 사례 번호가 있어 반영하지 못했습니다. 본사 품질 담당자가 확인 중입니다.' }
    return { ...base, status: 'COMPLETED', lastSyncedAt: new Date(new Date(last.confirmedAt).getTime() + 90_000).toISOString() }
  }
  const t = Date.now() - new Date(rec.queuedAt).getTime()
  if (rec.fail && t >= 10_000) return { ...base, status: 'FAILED', failureMessage: '사내 사례 저장소 응답이 없어 반영하지 못했습니다.' }
  if (t < 4_000) return { ...base, status: 'WAITING' }
  if (t < 10_000) return { ...base, status: 'SYNCING' }
  return { ...base, status: 'COMPLETED', lastSyncedAt: new Date(new Date(rec.queuedAt).getTime() + 10_000).toISOString() }
}

/* ---------------- 재처리 상태 (US-10 · Mock 시뮬레이션) ----------------
 *  #111 PCB 분석 실패 후 자동 재처리 3회 모두 실패 → FINAL_FAILED (분석 실패가 난 뒤에만 보임)
 *  #103 유사 사례 검색 시간 초과 → RETRY_SCHEDULED → RETRYING → RECOVERED (처음 조회한 때부터 8초·14초)
 *  #107 사내 사례 동기화 실패 → FINAL_FAILED
 *  상세(오류 코드·executionId·시도 이력)는 본사 품질 담당자에게만 내려준다 */
let retryDemoStart = 0
const at = (base: number, ms: number) => new Date(base + ms).toISOString()
function retryRecordsOf(r: Repair): RetryRecord[] {
  if (r.id === 111 && r.analysisError) {
    const end = new Date(r.updatedAt).getTime()
    const attempts: RetryAttempt[] = [1, 2, 3].map((n) => ({ attempt: n, at: at(end, (n - 3) * 60_000), result: 'FAILED', errorCode: 'PCB_IMAGE_UNREADABLE', message: 'PCB 사진 해상도 부족으로 판독 실패' }))
    return [{ id: 'RT-111-1', repairId: 111, status: 'FINAL_FAILED', stage: 'PCB 분석', failedAt: attempts[0].at, attempt: 3, maxAttempts: 3, final: true, errorCode: 'PCB_IMAGE_UNREADABLE', executionId: 'exec-111-7f3a9c', attempts }]
  }
  if (r.id === 103) {
    if (!retryDemoStart) retryDemoStart = Date.now()
    const s = retryDemoStart
    const t = Date.now() - s
    const first: RetryAttempt = { attempt: 1, at: at(s, -5_000), result: 'FAILED', errorCode: 'RAG_TIMEOUT', message: '유사 사례 검색 응답 시간 초과 (30초)' }
    const base = { id: 'RT-103-1', repairId: 103, stage: '매뉴얼·유사 사례 검색', failedAt: first.at, maxAttempts: 3, errorCode: 'RAG_TIMEOUT', executionId: 'exec-103-2b81d0' }
    if (t < 8_000) return [{ ...base, status: 'RETRY_SCHEDULED', attempt: 1, nextRetryAt: at(s, 8_000), final: false, attempts: [first] }]
    if (t < 14_000) return [{ ...base, status: 'RETRYING', attempt: 2, final: false, attempts: [first] }]
    return [{ ...base, status: 'RECOVERED', attempt: 2, final: true, attempts: [first, { attempt: 2, at: at(s, 14_000), result: 'SUCCEEDED' }] }]
  }
  if (SYNC_FAILED_SEEDS.includes(r.id)) {
    const c = r.report?.confirmedAt ? new Date(r.report.confirmedAt).getTime() : Date.now()
    const attempts: RetryAttempt[] = [1, 2, 3].map((n) => ({ attempt: n, at: at(c, n * 120_000), result: 'FAILED', errorCode: 'CASE_SYNC_DUPLICATE', message: '사례 번호 중복' }))
    return [{ id: `RT-${r.id}-1`, repairId: r.id, status: 'FINAL_FAILED', stage: '사내 사례 동기화', failedAt: attempts[0].at, attempt: 3, maxAttempts: 3, final: true, errorCode: 'CASE_SYNC_DUPLICATE', executionId: `exec-${r.id}-c41e07`, attempts }]
  }
  return []
}
export function getRetryRecords(id: number): RetryRecord[] {
  const u = me()
  const r = repairOr404(id)
  if (!canViewRepair(r, u)) throw new ApiError(404, '수리 건을 찾을 수 없습니다.')
  const list = retryRecordsOf(r)
  if (u.role === 'QUALITY_MANAGER') return list
  // 기사: 간단 정보만
  return list.map(({ errorCode: _e, executionId: _x, attempts: _a, ...rest }) => rest)
}

/* ---------------- 출장 전 리포트: 기사 수정안 · 기사 확인 (Mock) ----------------
 * AI 진단(db.diagnoses)은 건드리지 않고 db.preVisit 에 따로 저장. 수정·확인은 그 수리 건에 배정된 기사만 */
function preVisitOf(id: number) {
  return db.preVisit?.[id] ?? { technicianEdit: null, review: null }
}
function assignedTechOr403(id: number) {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  if (!canViewRepair(r, u)) throw new ApiError(403, '이 출장 건에 배정된 기사만 수정할 수 있습니다.')
  return { u, r }
}
export function getPreVisitReport(id: number): PreVisitReport {
  const r = repairOr404(id)
  if (!canViewRepair(r, me())) throw new ApiError(404, '수리 건을 찾을 수 없습니다.')
  return { repairId: id, ...preVisitOf(id) }
}
export function savePreVisitEdit(id: number, req: SavePreVisitEditRequest): PreVisitReport {
  const { u, r } = assignedTechOr403(id)
  const cur = preVisitOf(id)
  const curVersion = cur.technicianEdit?.version ?? 0
  if (req.expectedVersion !== curVersion) throw new ApiError(409, '다른 곳에서 리포트 수정 내용이 먼저 저장되었습니다. 새로고침 후 다시 수정해 주세요.', 'EDIT_VERSION')
  const parts = req.parts.filter((p) => p.partId)
  if (parts.some((p) => !Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 99)) throw new ApiError(422, '부품 수량은 1~99개로 입력해 주세요.')
  if (parts.some((p) => !db.parts.some((x) => x.id === p.partId))) throw new ApiError(422, '없는 부품이 포함되어 있습니다.')
  const text = (v?: string) => v?.trim() || undefined
  const edit: TechnicianReportEdit = {
    repairId: id,
    suspectedCauseComment: text(req.suspectedCauseComment),
    inspectionPlan: text(req.inspectionPlan),
    repairMethod: text(req.repairMethod),
    technicianMemo: text(req.technicianMemo),
    parts,
    editedBy: u.name,
    editedAt: new Date().toISOString(),
    version: curVersion + 1,
    diagnosisVersion: req.diagnosisVersion,
  }
  db.preVisit = { ...(db.preVisit ?? {}), [id]: { technicianEdit: edit, review: cur.review } }
  log(r, { target: 'DIAGNOSIS', action: 'DRAFT_SAVED', actor: u.name, actorRole: u.role, comment: `출장 전 리포트 기사 수정 v${edit.version} 저장` })
  persist()
  return { repairId: id, ...preVisitOf(id) }
}
/** 기사 리포트 확인 (TECHNICIAN_REVIEWED) — 최종 수리 확정이 아니라 상태 기록만 */
export function markPreVisitReviewed(id: number, editVersion: number): PreVisitReport {
  const { u, r } = assignedTechOr403(id)
  const cur = preVisitOf(id)
  if (editVersion !== (cur.technicianEdit?.version ?? 0)) throw new ApiError(409, '리포트 수정 내용이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.', 'EDIT_VERSION')
  const review: PreVisitReview = { state: 'TECHNICIAN_REVIEWED', reviewedBy: u.name, reviewedAt: new Date().toISOString(), editVersion }
  db.preVisit = { ...(db.preVisit ?? {}), [id]: { technicianEdit: cur.technicianEdit, review } }
  log(r, { target: 'DIAGNOSIS', action: 'CONFIRMED', actor: u.name, actorRole: u.role, comment: editVersion ? `출장 전 리포트 확인 완료 (기사 수정 v${editVersion})` : '출장 전 리포트 확인 완료' })
  persist()
  return { repairId: id, ...preVisitOf(id) }
}

/* ---------------- 수리 방법 (방문 수리 / 센터 방문) ---------------- */
export function listServiceCenters() {
  return SERVICE_CENTERS
}
/** 기사가 고객이 고른 수리 방법을 바꿈 — 사유 필수, 이력에 (누가 · 언제 · 무엇에서 무엇으로 · 사유) */
export function changeServiceType(id: number, req: ChangeServiceTypeRequest): Repair {
  const u = requireRole('TECHNICIAN')
  const r = repairOr404(id)
  if (!canViewRepair(r, u)) throw new ApiError(403, '배정된 기사만 수리 방법을 바꿀 수 있습니다.')
  if (!r.visitInfo?.serviceType) throw new ApiError(409, '수리 방법 정보가 없는 접수입니다.')
  const reason = req.reason?.trim()
  if (!reason || reason.length < 2) throw new ApiError(422, '변경 사유를 입력해 주세요.')
  const center = req.serviceType === 'CENTER' ? SERVICE_CENTERS.find((c) => c.id === req.centerId) : undefined
  if (req.serviceType === 'CENTER' && !center) throw new ApiError(422, '서비스센터를 골라 주세요.')
  const prev = r.visitInfo
  if (prev.serviceType === req.serviceType && (req.serviceType === 'VISIT' || prev.centerId === center?.id)) throw new ApiError(422, '지금과 같은 수리 방법입니다.')
  const fromText = `${SERVICE_TYPE_LABEL[prev.serviceType!]}${prev.centerName ? `(${prev.centerName})` : ''}`
  const toText = `${SERVICE_TYPE_LABEL[req.serviceType]}${center ? `(${center.name})` : ''}`
  r.visitInfo = { ...prev, serviceType: req.serviceType, centerId: center?.id, centerName: center?.name }
  r.updatedAt = new Date().toISOString()
  log(r, { target: 'SYSTEM', action: 'COMMENTED', actor: u.name, actorRole: u.role, comment: `수리 방법 변경: ${fromText} → ${toText} · 사유: ${reason}` })
  persist()
  return r
}
