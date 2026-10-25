/* 소비자용 수리 진행 조회 (로그인 없음)
 *  접수번호 + 휴대폰 번호 뒷자리 4개. 어느 값이 틀렸는지는 알려 주지 않는다.
 *  응답에는 기사가 확정한 내용만 쉬운 말로 담는다 (AI 초안·점수·부품번호·재고 없음).
 *  실서버: 아직 API 없음 → FEATURES.customerReport 가 false 면 화면에서 준비 중 안내 (경로는 백엔드 확정 후 맞출 것)
 *  ※ 실서버는 뒷자리 4자리 대입을 막도록 조회 횟수 제한이 꼭 필요하다 */
import { API_ORIGIN, ApiError, http, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import type { CustomerReport, CustomerStage } from '@/types'
import type { ServiceCenter } from '@/constants/serviceType'
import type { CustomerIntakeRequest, CustomerIntakeResponse } from '@/types/api'

export const CUSTOMER_NOT_FOUND = '접수 정보를 찾을 수 없어요. 접수번호를 다시 확인해 주세요.'

export async function getCustomerReport(receiptNo: string, phoneLast4: string): Promise<CustomerReport> {
  try {
    if (USE_MOCK) return await mockDelay(() => mock.getCustomerReport(receiptNo, phoneLast4), 600)
    if (!FEATURES.customerReport) throw new ApiError(501, '수리 진행 조회는 아직 준비 중이에요.', 'NOT_SUPPORTED')
    // 개인정보가 URL·로그에 남지 않도록 POST 본문으로 보낸다
    // 공개 화면: 401 이 와도 기사용 로그인 화면으로 보내지 않음
    // [출장] 실서버는 접수번호+조회 키(접수 완료 때 발급)로만 조회한다. 휴대폰 뒷자리 대입을 막기 위함
    void phoneLast4
    if (receiptNo.includes('.')) return await getCustomerReportByToken(receiptNo)
    throw new ApiError(404, CUSTOMER_NOT_FOUND, 'NOT_FOUND')
  } catch (e) {
    // 없음·불일치·형식 오류는 모두 같은 문구로 (어떤 값이 틀렸는지 노출하지 않음)
    if (e instanceof ApiError && [400, 401, 403, 404, 422].includes(e.status)) throw new ApiError(404, CUSTOMER_NOT_FOUND, 'NOT_FOUND')
    throw e
  }
}

/** 조회 링크(/service/track/:token)로 조회 — 토큰이 없거나 틀리면 같은 안내 */
export async function getCustomerReportByToken(token: string): Promise<CustomerReport> {
  try {
    if (USE_MOCK) return await mockDelay(() => mock.getCustomerReportByToken(token), 500)
    if (!FEATURES.customerReport) throw new ApiError(501, '수리 진행 조회는 아직 준비 중이에요.', 'NOT_SUPPORTED')
    // [출장] 토큰 = "접수번호.조회키". 조회 키는 Authorization 헤더로만 보낸다 (URL·로그에 남기지 않음)
    const dot = token.lastIndexOf('.')
    if (dot < 1) throw new ApiError(404, CUSTOMER_NOT_FOUND, 'NOT_FOUND')
    const number = token.slice(0, dot)
    const be = (await http.get<BePublicCase>(`/public/cases/${encodeURIComponent(number)}`, { baseURL: API_ORIGIN, headers: { Authorization: `Bearer ${token.slice(dot + 1)}` }, skipAuthExpired: true })).data
    return toCustomerReport(be)
  } catch (e) {
    if (e instanceof ApiError && [400, 401, 403, 404, 422].includes(e.status)) throw new ApiError(404, CUSTOMER_NOT_FOUND, 'NOT_FOUND')
    throw e
  }
}

/**
 * 고객(비회원) 고장 접수 — 직원 계정을 만들지 않고, 로그인 상태도 바꾸지 않는다.
 *  Mock: 접수 생성 + 사진 + AI 분석 시작 → 접수번호·조회 토큰
 *  실서버: 아직 API 없음 → FEATURES.customerIntake 가 false 면 호출하지 않음 (경로는 백엔드 확정 후 맞출 것)
 */
export async function submitCustomerRequest(req: CustomerIntakeRequest, photos: { file: File; dataUrl: string }[]): Promise<CustomerIntakeResponse> {
  if (USE_MOCK) return mockDelay(() => mock.customerIntake(req, photos.map((p) => ({ name: p.file.name, dataUrl: p.dataUrl }))), 900)
  if (!FEATURES.customerIntake) throw new ApiError(501, '온라인 고장 접수는 아직 준비 중이에요. 고객센터로 문의해 주세요.', 'NOT_SUPPORTED')
  // [출장] 백엔드 POST /public/cases 형식으로 바꿔 보낸다 (모델은 이름·코드로 찾고, 없으면 같은 제품 종류의 첫 모델)
  const options = (await http.get<{ centers: { id: string }[]; models: { model_code: string; name: string; appliance_type?: string }[] }>('/public/intake-options', { baseURL: API_ORIGIN, skipAuthExpired: true })).data
  const m = req.model.trim().toLowerCase()
  const model = options.models.find((x) => x.model_code.toLowerCase() === m || x.name.toLowerCase() === m)
    ?? options.models.find((x) => (x.appliance_type ?? '').toLowerCase().replace(/[^a-z]/g, '') === req.productType.replace(/[^a-z]/g, ''))
    ?? options.models[0]
  const body = {
    symptoms: req.symptom, purchaseDate: req.purchaseDate || null, serialNumber: req.serial, modelCode: model?.model_code,
    centerId: req.centerId ?? options.centers[0]?.id, serviceType: req.serviceType === 'VISIT' ? 'FIELD' : 'CENTER',  // 프론트 VISIT(방문 수리) = 백엔드 FIELD
    contactName: req.customerName, contactPhone: req.phone, visitAddress: req.address ?? null,
    preferredDate: req.preferredDate || null, visitSlot: req.visitSlot ?? null,
  }
  const f = new FormData()
  f.append('data', new Blob([JSON.stringify(body)], { type: 'application/json' }))
  photos.forEach((p) => f.append('files', p.file))
  const res = (await http.post<{ caseNumber: string; lookupKey: string }>('/public/cases', f, { baseURL: API_ORIGIN, skipAuthExpired: true })).data
  return { receiptNo: res.caseNumber, token: `${res.caseNumber}.${res.lookupKey}` }
}

/** 서비스센터 목록 (센터 방문 · 수리 방법 변경) — 실서버는 FEATURES.visitInfo 일 때만 조회, 아니면 빈 목록 */
export async function getServiceCenters(): Promise<ServiceCenter[]> {
  if (USE_MOCK) return mockDelay(() => mock.listServiceCenters(), 150)
  if (!FEATURES.visitInfo) return []
  return (await http.get<ServiceCenter[]>('/public/service-centers', { skipAuthExpired: true })).data
}

/** [출장] GET /public/cases/{number} 응답 */
interface BePublicCase {
  caseNumber: string
  status: 'RECEIVED' | 'UNDER_REVIEW' | 'REPAIRING' | 'COMPLETED' | 'CANCELLED'
  productName?: string
  receivedAt?: string
  technicianName?: string | null
  visitAt?: string | null
  warrantyDecision?: 'FREE' | 'PAID' | null
  report?: { kind: string; cause_summary: string; planned_work: string } | null
  photos?: { status: string }[]
}

function toCustomerReport(b: BePublicCase): CustomerReport {
  const checking = (b.photos ?? []).some((p) => p.status === 'PENDING' || p.status === 'RUNNING')
  const stage: CustomerStage = b.status === 'COMPLETED' ? 'COMPLETED' : b.status === 'REPAIRING' ? 'VISIT_SCHEDULED'
    : b.status === 'UNDER_REVIEW' ? (b.report ? 'DIAGNOSED' : checking ? 'PHOTO_CHECK' : 'DIAGNOSED') : 'RECEIVED'
  return {
    receiptNo: b.caseNumber,
    productName: b.productName ?? '제품',
    receivedAt: b.receivedAt ?? '',
    stage,
    technicianName: b.technicianName ?? undefined,
    // 기사가 고객용으로 공개한 내용만
    cause: b.report?.cause_summary,
    result: b.status === 'COMPLETED' ? b.report?.planned_work : undefined,
    warranty: b.warrantyDecision ?? null,
    visit: { confirmedDate: b.visitAt ?? undefined },
    cancelled: b.status === 'CANCELLED',
  }
}
