/* 접수 · 진단 · 추가 사진 · 리포트 API
 * Mock: src/mocks/handlers.ts / 실서버: 백엔드 API v2 (응답은 src/api/adapters 에서 프론트 타입으로 변환) */
import { FEATURES } from './features'
import { canViewRepair, getWorkScope, inListScope } from '@/utils/workScope'
import { ApiError, http, mockDelay, USE_MOCK } from './http'
import * as mock from '@/mocks/handlers'
import { partApi } from './parts'
import { STATUS_GROUPS } from '@/constants/status'
import { latestTask, toPhotoRequest, toProductInfo, toRepair, toRepairDetail, toTools } from './adapters/repair'
import { toBeContent, toRepairReport } from './adapters/report'
import { toDiagnosis } from './adapters/diagnosis'
import { toBeRepairStatus } from './adapters/status'
import type { BeAccepted, BeProduct, BeReport, BeRepairDetail, BeRepairPage, BeTask, BeToolExecution, BeUploaded } from './adapters/types'
import type { AnalysisToolRun, Diagnosis, Page, PhotoRequest, ProductInfo, Repair, RepairImage, RepairQuery, RepairStatusCounts, RepairSummaryCounts } from '@/types'
import type {
  AdditionalInfoRequest,
  ApprovalRequest,
  ConfirmReportRequest,
  CreateRepairRequest,
  ReanalysisRequest,
  SaveReportDraftRequest,
  UploadImageRequest,
  ChangeServiceTypeRequest,
} from '@/types/api'

export type RepairListResponse = Page<Repair> & { counts: RepairSummaryCounts; statusCounts: RepairStatusCounts }
export interface DiagnosisResponse {
  current: Diagnosis | null
  versions: Diagnosis[]
}

const notSupported = (what: string) => new ApiError(501, `${what}은(는) 아직 백엔드에서 지원하지 않습니다.`, 'NOT_SUPPORTED')

/* ---------- 실서버 공통 ---------- */
/** 상세는 한 화면에서 여러 번(상세·사진 요청·진단) 쓰이므로 1.5초 안의 중복 요청을 합친다 */
const detailCache = new Map<number, { at: number; p: Promise<BeRepairDetail> }>()
function fetchDetail(id: number, fresh = false): Promise<BeRepairDetail> {
  const hit = detailCache.get(id)
  if (!fresh && hit && Date.now() - hit.at < 1500) return hit.p
  const p = http.get<BeRepairDetail>(`/repairs/${id}`).then((r) => r.data)
  detailCache.set(id, { at: Date.now(), p })
  p.catch(() => detailCache.delete(id))
  return p
}
async function fetchReport(id: number): Promise<BeReport | null> {
  try {
    return (await http.get<BeReport>(`/repairs/${id}/report`)).data
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}
/** GET /api/repairs/{id}/diagnosis/tools — 진단 전이거나 없으면 빈 배열 */
const fetchTools = (id: number) =>
  http
    .get<BeToolExecution[]>(`/repairs/${id}/diagnosis/tools`)
    .then((r) => r.data)
    .catch(() => [] as BeToolExecution[])

async function realGet(id: number, fresh = false): Promise<Repair> {
  const [d, execs] = await Promise.all([fetchDetail(id, fresh), fetchTools(id)])
  const report = d.reports?.length ? await fetchReport(id) : null
  const repair = toRepairDetail(d, report ? toRepairReport(report) : undefined, toTools(execs))
  // 기사는 자기 담당 건만 (백엔드에 담당 필터가 없어 프론트 데이터 레이어에서 막음)
  if (!canViewRepair(repair, getWorkScope())) throw new ApiError(404, '수리 건을 찾을 수 없습니다.', 'NOT_FOUND')
  return repair
}

/** 목록 요약 카운트 (화면 상단 카드) */
function summarize(items: Repair[]): RepairSummaryCounts {
  const c = (s: Repair['status'][]) => items.filter((r) => s.includes(r.status)).length
  return {
    needPhoto: c(['ADDITIONAL_INFO_NEEDED']),
    technicianReview: c(['DIAGNOSIS_COMPLETED']),
    reportPending: c(['TECHNICIAN_REVIEW']),
    completed: c(['CLOSED']),
    analyzing: c(['RECEIVED', 'QUEUED', 'ANALYZING']),
    manualReview: c(['MANUAL_REVIEW']),
  }
}

/** 시리얼처럼 보이는 검색어만 백엔드 serial 필터로 보낸다 (공백 없음 · 8자 이상 · 숫자 포함) */
const asSerial = (k: string) => (/^[A-Za-z0-9-]{8,}$/.test(k) && /\d/.test(k) ? k : undefined)
const PAGE_SIZE = 100

async function realList(q: RepairQuery): Promise<RepairListResponse> {
  const kw = q.keyword?.trim() ?? ''
  const serial = asSerial(kw)
  const status = q.status && q.status !== 'ALL' ? toBeRepairStatus(q.status) : undefined
  const get = (st?: string) => http.get<BeRepairPage>('/repairs', { params: { page: 0, size: PAGE_SIZE, status: st, serial } }).then((r) => r.data.items.map((x) => toRepair(x)))
  // 상단 카운트는 상태 필터 없이, 목록은 상태 필터(백엔드)로 조회
  // 기사 업무 범위 (CENTER: 자기 담당 건 · FIELD: 0건) — 카운트와 목록 모두 같은 기준
  const scope = getWorkScope()
  const inScope = (list: Repair[]) => list.filter((r) => inListScope(r, scope, q.scope))
  const [all, byStatus] = await Promise.all([get().then(inScope), status ? get(status).then(inScope) : Promise.resolve(null)])
  let items = q.status && q.status !== 'ALL' ? (status ? byStatus! : []) : all
  if (q.group && (!q.status || q.status === 'ALL')) {
    const g = STATUS_GROUPS.find((x) => x.key === q.group)
    if (g) items = items.filter((r) => g.statuses.includes(r.status))
  }
  if (q.model) items = items.filter((r) => r.product.model === q.model)
  // serial 로 보내지 않은 검색어는 받은 목록 안에서 거른다
  if (kw && !serial) {
    const k = kw.toLowerCase()
    const id = /^#(\d+)$/.exec(k)
    items = id
      ? items.filter((r) => r.id === Number(id[1]))
      : items.filter((r) => [r.receiptNo, r.product.serialNumber, r.product.model, r.symptom, ...r.errorCodes].some((v) => v.toLowerCase().includes(k)))
  }
  const sort = q.sort ?? 'receivedAt_desc'
  items = [...items].sort((a, b) => (sort === 'receivedAt_asc' ? a.receivedAt.localeCompare(b.receivedAt) : b.receivedAt.localeCompare(a.receivedAt)))
  // 상태별 건수(statusCounts)는 백엔드에 없음 → 빈 객체 = 칩 건수 숨김
  return { items, total: items.length, counts: summarize(all), statusCounts: {} }
}

/** 사진 품질 검사 완료 대기(최대 30초) → 경고 사진 사용 확인 → POST /repairs/{id}/diagnosis */
async function startAfterQuality(repairId: number, attachmentIds: string[]) {
  type Q = { status: string; latest?: { id: string; verdict?: string } | null }
  const deadline = Date.now() + 30_000
  let results: Q[] = []
  for (;;) {
    results = await Promise.all(attachmentIds.map(async (id) => (await http.get<Q>(`/attachments/${id}/quality`)).data))
    if (results.every((q) => q.status !== 'PENDING' && q.status !== 'RUNNING') || Date.now() > deadline) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  for (const [i, q] of results.entries())
    if (q.latest?.verdict === 'WARNING') await http.post(`/attachments/${attachmentIds[i]}/quality/acknowledgment`, { resultId: Number(q.latest.id) })
  await http.post(`/repairs/${repairId}/diagnosis`, { attachmentIds: attachmentIds.map(Number) }, { headers: { 'Idempotency-Key': crypto.randomUUID() } })
}

export const repairApi = {
  /** GET /api/products?serialNumber= — 시리얼로 제품 정보 자동 조회 */
  async lookupProduct(serial: string): Promise<ProductInfo> {
    if (USE_MOCK) return mockDelay(() => mock.getProduct(serial), 600)
    return toProductInfo((await http.get<BeProduct>('/products', { params: { serialNumber: serial } })).data)
  },

  /** [Mock 전용] 라벨 사진 → 시리얼 번호 인식 (FEATURES.labelOcr). 결과는 기사가 확인·수정한다
   *  Mock: 파일 이름에 RC + 숫자 10자리가 있으면 그 값, 없으면 데모 시리얼 */
  async recognizeLabel(file: File): Promise<{ serial: string }> {
    if (USE_MOCK && FEATURES.labelOcr) return mockDelay(() => ({ serial: (/RC\d{10}/i.exec(file.name)?.[0] ?? 'RC2026000187').toUpperCase() }), 900)
    throw notSupported('라벨 인식')
  },

  /** 수리 방법 변경 (사유 필수 · 이력 기록) — 실서버는 FEATURES.visitInfo 가 켜질 때까지 지원하지 않음 */
  async changeServiceType(id: number, req: ChangeServiceTypeRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.changeServiceType(id, req), 400)
    if (!FEATURES.visitInfo) throw notSupported('수리 방법 변경')
    await http.post(`/repairs/${id}/service-type`, req)
    return realGet(id, true)
  },

  /** GET /api/repairs?page&size&status&serial */
  async list(q: RepairQuery = {}): Promise<RepairListResponse> {
    if (USE_MOCK) return mockDelay(() => mock.listRepairs(q))
    return realList(q)
  },

  /** GET /api/repairs/{id} (+ 리포트가 있으면 GET /api/repairs/{id}/report) */
  async get(id: number): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.getRepair(id), 250)
    return realGet(id)
  },

  /**
   * 접수 + 사진 + 진단 요청
   *  Mock: 접수 생성 → 사진 업로드 → 진단 요청 3단계
   *  실서버: POST /api/repairs multipart 한 번 (data: JSON, files: 사진 1~10장) → 202 {repairId, taskId, status}
   */
  async intake(req: CreateRepairRequest, photos: UploadImageRequest[]): Promise<{ repairId: number }> {
    if (USE_MOCK) {
      const r = await this.create(req)
      for (const p of photos) await this.uploadImage(r.id, p)
      await this.submit(r.id)
      return { repairId: r.id }
    }
    if (!req.product.id) throw new ApiError(400, '제품 정보를 다시 조회해 주세요.', 'INVALID_INPUT')
    const data = {
      productId: req.product.id,
      symptoms: req.symptom,
      errorCodes: req.errorCodes,
      firmware: req.product.firmware,
      // 백엔드 user_input 에 그대로 저장 → 상세 조회 시 사진 종류·기사 소견 복원에 사용 (AI 에이전트 입력)
      // ※ 방문 정보·동의(개인정보)는 여기에 넣지 않는다
      userInput: { technicianNote: req.technicianNote ?? '', photoKinds: photos.map((p) => p.kind) },
      // 출장 방문 정보 · 개인정보 동의: userInput 과 분리된 별도 필드. 백엔드 지원 전까지 FEATURES.visitInfo 로 꺼 둔다
      ...(FEATURES.visitInfo && req.visitInfo && req.consent ? { visitInfo: req.visitInfo, consent: req.consent } : {}),
    }
    const f = new FormData()
    f.append('data', new Blob([JSON.stringify(data)], { type: 'application/json' }))
    photos.forEach((p) => f.append('files', p.file))
    // 사진별 종류(PCB/MOTOR)를 같은 순서로 보낸다 → 백엔드 attachment.target 에 저장, 에이전트가 사진을 나눠 분석
    const targets = photos.map((p) => p.kind)
    const res = (await http.post<BeAccepted>('/repairs', f, { params: { targets }, paramsSerializer: { indexes: null } })).data
    // [사진 품질] 백엔드가 품질 검사를 켜면 접수만 되고 진단은 시작되지 않는다(taskId=null, requiresDiagnosisRequest=true).
    // 품질 검사가 끝나길 기다렸다가, 경고 사진은 기사가 올린 그대로 쓰겠다고 확인 기록을 남기고 진단을 시작한다.
    if (res.requiresDiagnosisRequest && res.attachments?.length) await startAfterQuality(Number(res.repairId), res.attachments.map((a) => a.attachmentId))
    return { repairId: Number(res.repairId) }
  },

  /** [Mock 전용] 접수 생성 (DRAFT) — 실서버는 intake() 한 번으로 처리 */
  async create(req: CreateRepairRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.createRepair(req))
    throw notSupported('단계별 접수')
  },

  /** [Mock 전용] 사진 업로드 (접수 사진 · 수리 전·후 사진) */
  async uploadImage(id: number, req: UploadImageRequest): Promise<RepairImage> {
    if (USE_MOCK) return mockDelay(() => mock.uploadImage(id, req), 400)
    throw notSupported('수리 전·후 사진 업로드')
  },

  /** [Mock 전용] 접수 확정 + AI 진단 요청 */
  async submit(id: number): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.submitRepair(id))
    throw notSupported('단계별 접수')
  },

  /** '분석 진행' 단계의 실행 도구 목록 — 실서버: GET /api/repairs/{id}/diagnosis/tools (TOOL_EXECUTED 수신 시 재조회) */
  async tools(id: number): Promise<AnalysisToolRun[]> {
    if (USE_MOCK) return mockDelay(() => mock.getRepair(id).tools ?? [], 100)
    return toTools(await fetchTools(id))
  },

  /** 추가 사진 요청 — 실서버는 상세(photoRequests)에서 꺼냄 */
  async photoRequests(id: number): Promise<PhotoRequest[]> {
    if (USE_MOCK) return mockDelay(() => mock.getPhotoRequests(id), 200)
    return (await fetchDetail(id)).photoRequests.map(toPhotoRequest)
  },

  /**
   * 추가 자료 제출
   *  실서버: 사진마다 POST /api/repairs/{id}/attachments?requestId= → attachmentId 수집
   *          → POST /api/repairs/{id}/diagnosis/resume {requestId, submissionKey, attachmentIds, note}
   *  note 는 백엔드 Resume 스키마에 없어 무시될 수 있다. 실서버는 사진 1장 이상 필요.
   */
  async uploadAdditional(id: number, req: AdditionalInfoRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.uploadAdditionalImages(id, req), 600)
    if (!req.photos.length) throw new ApiError(400, '추가 사진을 1장 이상 올려 주세요. (설명만 제출하는 기능은 아직 지원되지 않습니다)', 'INVALID_INPUT')
    const open = (await fetchDetail(id, true)).photoRequests.filter((p) => p.status === 'OPEN')
    const request = open.find((p) => p.id === req.photoRequestId) ?? open[0]
    const requestId = req.photoRequestId ?? request?.id
    if (!requestId) throw new ApiError(409, '열려 있는 추가 사진 요청이 없습니다. 화면을 새로고침해 주세요.', 'NOT_FOUND')
    const target = request?.target ?? 'GENERAL' // AI가 요청한 부위(PCB/MOTOR/GENERAL)로 저장
    const attachmentIds: string[] = []
    for (const p of req.photos) {
      const f = new FormData()
      f.append('file', p.file)
      attachmentIds.push((await http.post<BeUploaded>(`/repairs/${id}/attachments`, f, { params: { requestId, target } })).data.attachmentId)
    }
    await http.post(`/repairs/${id}/diagnosis/resume`, { requestId, submissionKey: crypto.randomUUID(), attachmentIds, note: req.note?.trim() || undefined })
    return realGet(id, true)
  },

  /** GET /api/repairs/{id}/diagnosis (+ /diagnosis/tools 로 Agent 별 결과) */
  async diagnosis(id: number): Promise<DiagnosisResponse> {
    if (USE_MOCK) return mockDelay(() => mock.getDiagnosis(id))
    const [task, tools, parts, detail] = await Promise.all([
      http
        .get<BeTask>(`/repairs/${id}/diagnosis`)
        .then((r) => r.data)
        .catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
      fetchTools(id),
      partApi.list().catch(() => []),
      fetchDetail(id),
    ])
    if (!task) return { current: null, versions: [] }
    const repair = toRepair(detail, { task: latestTask(detail.tasks) })
    // 진단 확인 API 가 없어 접수 상태로 판단: 수리 중(REPAIRING)·종결이면 기사가 진단을 확인한 것으로 본다
    const confirmed = detail.status === 'REPAIRING' || detail.status === 'CLOSED'
    const d = toDiagnosis(task, { parts, tools, urgency: repair.urgency, decision: { state: confirmed ? 'APPROVED' : 'PENDING' } })
    return { current: d, versions: d ? [d] : [] }
  },

  /** [Mock 전용] 진단 확인·반려·본사 검토 요청·수동 진단 회신 */
  async approval(id: number, req: ApprovalRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.approval(id, req), 500)
    // [통합] 백엔드에 같은 경로·본문으로 추가함 (target, action, comment). 확인·반려 → REPAIRING, 본사 검토 → MANUAL_REVIEW
    await http.post(`/repairs/${id}/approval`, { target: req.target, action: req.action, comment: req.comment })
    return realGet(id, true)
  },

  /** [Mock 전용] 추가 분석(재진단) 요청 */
  async reanalysis(id: number, req: ReanalysisRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.reanalysis(id, req), 500)
    throw notSupported('추가 분석(재진단) 요청')
  },

  /** PUT /api/repairs/{id}/report/draft {version, content} — 처음이면 version 0. 불일치 409 REPORT_VERSION */
  async saveReportDraft(id: number, req: SaveReportDraftRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.saveReportDraft(id, req), 400)
    await http.put(`/repairs/${id}/report/draft`, { version: req.version ?? 0, content: toBeContent(req.content) })
    return realGet(id, true)
  },

  /** POST /api/reports/{reportId}/confirm {version, revision} — 리포트 id·최신 revision 은 GET /report 로 확인 */
  async confirmReport(id: number, req: ConfirmReportRequest): Promise<Repair> {
    if (USE_MOCK) return mockDelay(() => mock.confirmReport(id, req), 500)
    const rep = await fetchReport(id)
    if (!rep) throw new ApiError(409, '저장된 리포트 초안이 없습니다.', 'NOT_FOUND')
    await http.post(`/reports/${rep.id}/confirm`, { version: req.version, revision: rep.latest_revision })
    return realGet(id, true)
  },
}
