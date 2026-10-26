/* =========================================================================
 * Mock 시드 데이터
 * 백엔드 응답 스키마와 동일한 구조(src/types)를 따른다.
 * 대표 사례: 접수 101 / RC2026000187 / RC-A100 / E103 / 모터 하우징 변형 87%
 * ========================================================================= */
import type {
  AgentResult,
  AnalysisStageState,
  AnalysisToolRun,
  ApprovalRecord,
  DataSource,
  Diagnosis,
  Notification,
  Part,
  ProductInfo,
  PurchaseOrder,
  Repair,
  RepairImage,
  RepairReport,
  RepairStatus,
  Urgency,
  User,
} from '@/types'
import { STAGE_ORDER, TOOL_KIND_LABEL } from '@/constants/status'
import { ERROR_MESSAGES } from '@/constants/errors'
import { isoAgo } from '@/utils/format'

/* ---------------- 사용자 ---------------- */
export const USERS: (User & { password: string })[] = [
  { employeeId: 'T1001', password: '1234', name: '김정훈', role: 'TECHNICIAN', branch: '강남 서비스센터', technicianType: 'CENTER' },
  { employeeId: 'T1002', password: '1234', name: '박민수', role: 'TECHNICIAN', branch: '부산 서비스센터', technicianType: 'FIELD' },
  { employeeId: 'Q2001', password: '1234', name: '이서연', role: 'QUALITY_MANAGER', branch: '본사 품질혁신팀' },
]

/* ---------------- 제품 카탈로그 (시리얼 → 제품 정보) ---------------- */
export const MODELS: Record<string, { modelName: string; factory: string; firmware: string }> = {
  'RC-A100': { modelName: '로봇청소기 RC-A100', factory: '구미 제2공장', firmware: 'v3.4.2' },
  'RC-S300': { modelName: '로봇청소기 RC-S300 (물걸레)', factory: '광주 제1공장', firmware: 'v2.9.0' },
  'RC-X700': { modelName: '로봇청소기 RC-X700 (올인원)', factory: '구미 제2공장', firmware: 'v4.1.1' },
}

export function productFromSerial(serial: string): ProductInfo | null {
  const s = serial.trim().toUpperCase()
  if (!/^RC\d{10}$/.test(s)) return null
  const n = Number(s.slice(-3))
  const model = KNOWN_SERIALS[s] ?? (n % 3 === 0 ? 'RC-X700' : n % 3 === 1 ? 'RC-A100' : 'RC-S300')
  const meta = MODELS[model]
  const year = Number(s.slice(2, 6))
  return {
    serialNumber: s,
    model,
    modelName: meta.modelName,
    manufacturedAt: `${year}-0${(n % 9) + 1}-1${n % 9}`,
    factory: meta.factory,
    warrantyUntil: `${year + 2}-0${(n % 9) + 1}-1${n % 9}`,
    firmware: meta.firmware,
  }
}

const KNOWN_SERIALS: Record<string, string> = {
  RC2026000187: 'RC-A100',
  RC2026000342: 'RC-A100',
  RC2026000415: 'RC-S300',
  RC2025009921: 'RC-X700',
  RC2025008812: 'RC-A100',
  RC2025007710: 'RC-S300',
  RC2025006601: 'RC-X700',
  RC2025005502: 'RC-A100',
  RC2025004403: 'RC-S300',
  RC2025003304: 'RC-A100',
  RC2026000501: 'RC-X700',
  RC2025002205: 'RC-A100',
  RC2026000610: 'RC-S300',
}

/* ---------------- 부품 ---------------- */
/** 서비스센터 (고객 센터 방문 · 수리 방법 변경에서 고름) — 기존 시드 지역 */
export const SERVICE_CENTERS: import('@/constants/serviceType').ServiceCenter[] = [
  { id: 'SC-GANGNAM', name: '강남 서비스센터', address: '서울특별시 강남구 테헤란로 152' },
  { id: 'SC-BUSAN', name: '부산 서비스센터', address: '부산광역시 해운대구 센텀중앙로 79' },
  { id: 'SC-DAEJEON', name: '대전 서비스센터', address: '대전광역시 서구 둔산로 100' },
  { id: 'SC-GWANGJU', name: '광주 서비스센터', address: '광주광역시 서구 상무중앙로 61' },
  { id: 'SC-DAEGU', name: '대구 서비스센터', address: '대구광역시 수성구 달구벌대로 2450' },
]

export const PARTS: Part[] = [
  {
    id: 'P-103',
    name: '모터 어셈블리',
    partNo: 'RM-MT-103',
    compatibleModels: ['RC-A100', 'RC-X700'],
    stocks: [
      // 데모: 1개만 남아 있어 예약 시 409 STOCK_CONFLICT(다른 기사가 먼저 예약)를 시연
      { warehouse: '수원 창고', location: 'B동 3열 2단', quantity: 1 },
      { warehouse: '대전 창고', location: 'A동 1열 4단', quantity: 0 },
    ],
    factory: '구미 제2공장',
    factoryContact: { manager: '정우성 과장', phone: '054-470-2103', email: 'motor.gumi2@robotcare.co.kr' },
    leadTimeDays: 2,
    unitPrice: 48000,
  },
  {
    id: 'P-221',
    name: '휠 회전 센서',
    partNo: 'RM-SN-221',
    compatibleModels: ['RC-A100', 'RC-S300', 'RC-X700'],
    stocks: [
      { warehouse: '수원 창고', location: 'C동 2열 1단', quantity: 24 },
      { warehouse: '부산 창고', location: '1동 4열 2단', quantity: 9 },
    ],
    factory: '광주 제1공장',
    factoryContact: { manager: '한지민 대리', phone: '062-940-1221', email: 'sensor.gwangju1@robotcare.co.kr' },
    leadTimeDays: 3,
    unitPrice: 9500,
  },
  {
    id: 'P-310',
    name: '메인 PCB',
    partNo: 'RM-PC-310',
    compatibleModels: ['RC-S300'],
    stocks: [{ warehouse: '수원 창고', location: 'E동 보안랙 1', quantity: 0 }],
    factory: '광주 제1공장',
    factoryContact: { manager: '오세훈 차장', phone: '062-940-1310', email: 'pcb.gwangju1@robotcare.co.kr' },
    leadTimeDays: 7,
    unitPrice: 132000,
  },
  {
    id: 'P-115',
    name: '메인 브러시 모터',
    partNo: 'RM-BR-115',
    compatibleModels: ['RC-A100', 'RC-S300', 'RC-X700'],
    stocks: [
      { warehouse: '수원 창고', location: 'B동 1열 3단', quantity: 3 },
      { warehouse: '부산 창고', location: '2동 1열 1단', quantity: 1 },
    ],
    factory: '구미 제2공장',
    factoryContact: { manager: '정우성 과장', phone: '054-470-2103', email: 'motor.gumi2@robotcare.co.kr' },
    leadTimeDays: 4,
    unitPrice: 27000,
  },
  {
    id: 'P-208',
    name: '구동 휠 모듈',
    partNo: 'RM-WH-208',
    compatibleModels: ['RC-X700'],
    stocks: [{ warehouse: '대전 창고', location: 'A동 2열 2단', quantity: 5 }],
    factory: '구미 제2공장',
    factoryContact: { manager: '김태희 대리', phone: '054-470-2208', email: 'wheel.gumi2@robotcare.co.kr' },
    leadTimeDays: 3,
    unitPrice: 35000,
  },
]

/* ---------------- 공통 데이터 출처 ---------------- */
const SOURCES: DataSource[] = [
  { id: 'S1', type: 'MANUAL', title: 'RC-A100 서비스 매뉴얼 v3.2', ref: '7장 구동부 · p.112~118' },
  { id: 'S2', type: 'ERROR_CODE_TABLE', title: '에러 코드 정의서 2026-Q2', ref: 'E103 모터 회전 감지 실패' },
  { id: 'S3', type: 'REPAIR_DB', title: '사내 고장 DB · 유사 사례 12건', ref: '2025-01 ~ 2026-09, 유사도 0.78 이상' },
  { id: 'S4', type: 'SENSOR_LOG', title: '기기 업로드 로그', ref: 'motor_rpm.log · 14:02:11 ~ 14:02:19' },
  { id: 'S5', type: 'IMAGE', title: '접수 사진 3장', ref: '제품 전체 · 모터 · PCB' },
  { id: 'S6', type: 'MANUAL', title: '품질 기술 공지 QN-2026-031', ref: '구미 제2공장 2026-03 생산분 하우징 사출 편차' },
]

/* ---------------- 이미지 ---------------- */
function baseImages(prefix: string, minutesAgo: number): RepairImage[] {
  const at = isoAgo(minutesAgo)
  return [
    { id: `${prefix}-img-m`, kind: 'MOTOR', url: '/mock/motor.svg', name: 'mechanical.jpg', uploadedAt: at },
    { id: `${prefix}-img-c`, kind: 'PCB', url: '/mock/pcb.svg', name: 'pcb.jpg', uploadedAt: at },
  ]
}

/* ---------------- 단계 상태 ---------------- */
const ANALYZED: RepairStatus[] = ['DIAGNOSIS_COMPLETED', 'TECHNICIAN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED', 'MANUAL_REVIEW']

/** 고정 3단계 상태. 분석이 끝난 건은 모두 DONE (수동 검토 전환 건은 분석 진행이 FAILED) */
export function stagesFor(status: RepairStatus): AnalysisStageState[] {
  const done = ANALYZED.includes(status)
  return STAGE_ORDER.map((stage) => ({
    stage,
    state: !done ? 'PENDING' : status === 'MANUAL_REVIEW' && stage !== 'QUEUED' ? (stage === 'ANALYSIS' ? 'FAILED' : 'PENDING') : 'DONE',
  }))
}

const tool = (repairId: number, kind: 'PCB' | 'MOTOR' | 'RAG', state: AnalysisToolRun['state'], message?: string): AnalysisToolRun => ({
  id: `${repairId}-${kind}`,
  kind,
  label: TOOL_KIND_LABEL[kind],
  state,
  message,
})

/** 분석이 끝난 건의 실행 도구 목록 (도착 순서) */
export function toolsFor(repairId: number, status: RepairStatus): AnalysisToolRun[] {
  if (!ANALYZED.includes(status)) return []
  if (status === 'MANUAL_REVIEW') {
    return [tool(repairId, 'PCB', 'DONE'), tool(repairId, 'RAG', 'DONE'), tool(repairId, 'MOTOR', 'FAILED', ERROR_MESSAGES.INCONCLUSIVE_AFTER_THIRD_PHOTO)]
  }
  return [tool(repairId, 'PCB', 'DONE'), tool(repairId, 'MOTOR', 'DONE'), tool(repairId, 'RAG', 'DONE')]
}

/* ---------------- 진단 템플릿 ---------------- */
type DiagTemplate = Omit<Diagnosis, 'id' | 'repairId' | 'version' | 'generatedAt' | 'technicianDecision'>

function motorHousingDiagnosis(imgPrefix: string): DiagTemplate {
  const agents: AgentResult[] = [
    {
      agent: 'PCB',
      verdict: 'NORMAL',
      summary: '모터 드라이버 회로 정상 · 전기적 원인 가능성 낮음',
      findings: ['모터 드라이버 IC 주변 소손·변색 없음', '커넥터 J4 납땜 상태 정상', '전해 콘덴서 팽창 없음'],
      confidence: 92,
      annotations: [{ imageId: `${imgPrefix}-img-c`, label: '모터 드라이버 IC · 정상', x: 40, y: 37, w: 21, h: 23, severity: 'LOW' }],
      sourceIds: ['S1', 'S4', 'S5'],
      durationSec: 14,
    },
    {
      agent: 'MOTOR',
      verdict: 'ABNORMAL',
      summary: '하단 연결부 변형 탐지 · 매뉴얼 기준 교체 대상',
      findings: ['하우징 하단 우측 연결부 약 2mm 들뜸', '연결부 주변 균열선 1개 확인', '로터 회전축 정렬 편차 의심'],
      confidence: 89,
      annotations: [
        { imageId: `${imgPrefix}-img-m`, label: '하단 연결부 변형', x: 47, y: 70, w: 15, h: 13, severity: 'HIGH' },
        { imageId: `${imgPrefix}-img-m`, label: '회전축 정렬 확인 필요', x: 53, y: 33, w: 19, h: 25, severity: 'MEDIUM' },
      ],
      sourceIds: ['S1', 'S3', 'S5', 'S6'],
      durationSec: 21,
    },
  ]
  return {
    origin: 'AI',
    topCause: '모터 하우징 변형',
    confidence: 87,
    urgency: 'HIGH',
    candidates: [
      {
        rank: 1,
        cause: '모터 하우징 변형 (하단 연결부)',
        part: '모터 어셈블리',
        confidence: 87,
        evidence: ['모터 사진에서 하단 연결부 변형 탐지', 'E103 + RPM 급감 로그 패턴 일치', '동일 생산분 유사 사례 12건 중 9건 동일 원인'],
        sourceIds: ['S1', 'S3', 'S4', 'S5'],
      },
      {
        rank: 2,
        cause: '모터 회전 센서 단독 불량',
        part: '휠 회전 센서',
        confidence: 41,
        evidence: ['센서 펄스 누락은 확인되나 외관 변형이 동반됨', '센서 단독 불량 시 소음 발생 사례 적음'],
        sourceIds: ['S2', 'S4'],
      },
      {
        rank: 3,
        cause: '이물질 끼임에 의한 과부하',
        confidence: 18,
        evidence: ['사진상 이물질 미확인', '과부하 에러(E105) 미발생'],
        sourceIds: ['S2', 'S5'],
      },
    ],
    agents,
    errorCodes: [
      {
        code: 'E103',
        meaning: '구동 모터 회전 감지 실패',
        relatedParts: ['모터 어셈블리', '휠 회전 센서', '모터 드라이버(PCB)'],
        interpretation: 'PCB 정상 판정과 RPM 급감 로그를 함께 보면 기계적 저항(변형·걸림)에 의한 회전 정지 가능성이 높습니다.',
      },
    ],
    similarCases: [
      { receiptNo: 'SR-2026-04812', model: 'RC-A100', cause: '하단 연결부 들뜸으로 E103 · 주행 소음', resolution: '모터 어셈블리 교체 후 RPM 정상', similarity: 94, closedAt: isoAgo(60 * 24 * 21), origin: 'INTERNAL' },
      { receiptNo: 'SR-2026-03377', model: 'RC-A100', cause: '구미 제2공장 3월 생산분 하우징 변형', resolution: '모터 어셈블리 교체 · 동일 로트 점검', similarity: 91, closedAt: isoAgo(60 * 24 * 40), origin: 'INTERNAL' },
      { receiptNo: 'SR-2026-02150', model: 'RC-X700', cause: '하우징 균열로 회전축 편심', resolution: '모터 어셈블리 교체', similarity: 86, closedAt: isoAgo(60 * 24 * 66), origin: 'EXTERNAL' },
    ],
    similarCaseCount: 12,
    inspectionSteps: [
      '전원 차단 후 배터리 분리',
      '모터 하단 연결부 육안·촉진 점검 (들뜸, 균열)',
      '모터 회전축 수동 회전 저항 확인',
      '회전 센서 커넥터 체결 상태 확인',
      '모터 단품 구동 테스트 (서비스 모드 M-03)',
    ],
    repairMethod: ['모터 연결부 점검 후 모터 어셈블리(RM-MT-103) 교체', '교체 후 서비스 모드 M-03 으로 RPM 정상 범위(1,700~1,900) 확인', '에러 로그 초기화 후 10분 주행 테스트'],
    parts: [{ partId: 'P-103', partName: '모터 어셈블리', partNo: 'RM-MT-103', quantity: 1, reason: '하우징 변형은 부분 수리 불가 · 어셈블리 단위 교체 필요' }],
    sources: SOURCES,
  }
}

function wheelSensorDiagnosis(imgPrefix: string): DiagTemplate {
  const t = motorHousingDiagnosis(imgPrefix)
  return {
    ...t,
    topCause: '휠 회전 센서 접촉 불량',
    confidence: 74,
    urgency: 'MEDIUM',
    candidates: [
      { rank: 1, cause: '휠 회전 센서 접촉 불량', part: '휠 회전 센서', confidence: 74, evidence: ['센서 펄스 간헐 누락', '외관 변형 없음'], sourceIds: ['S2', 'S4'] },
      { rank: 2, cause: '모터 하우징 변형', part: '모터 어셈블리', confidence: 38, evidence: ['소음 증상은 일치하나 사진상 변형 미확인'], sourceIds: ['S5'] },
    ],
    agents: t.agents.map((a) =>
      a.agent === 'MOTOR'
        ? { ...a, verdict: 'SUSPICIOUS', summary: '외관 변형 없음 · 휠 센서 접점 의심', findings: ['하우징 변형 없음', '연결부 체결 정상', '휠 회전 센서 커넥터 접점 마모 흔적'], confidence: 77, annotations: [{ imageId: `${imgPrefix}-img-m`, label: '휠 회전 센서 커넥터 접점 마모', x: 18, y: 58, w: 18, h: 16, severity: 'HIGH' as const }] }
        : a,
    ),
    similarCases: [
      { receiptNo: 'SR-2025-11902', model: 'RC-A100', cause: '회전 센서 커넥터 접점 마모로 펄스 누락', resolution: '휠 회전 센서 교체', similarity: 88, closedAt: isoAgo(60 * 24 * 130), origin: 'EXTERNAL' },
      { receiptNo: 'SR-2026-01544', model: 'RC-A100', cause: '센서 커넥터 반삽입 · 간헐적 한쪽 회전', resolution: '커넥터 재체결로 해결', similarity: 81, closedAt: isoAgo(60 * 24 * 95), origin: 'INTERNAL' },
    ],
    similarCaseCount: 5,
    parts: [{ partId: 'P-221', partName: '휠 회전 센서', partNo: 'RM-SN-221', quantity: 1, reason: '센서 접촉부 마모 시 단품 교체 권장' }],
    repairMethod: ['센서 커넥터 재체결 후 증상 재현 확인', '재현 시 휠 회전 센서(RM-SN-221) 교체'],
  }
}

function pcbDiagnosis(imgPrefix: string): DiagTemplate {
  const t = motorHousingDiagnosis(imgPrefix)
  return {
    ...t,
    topCause: '메인 PCB 전원부 소손',
    confidence: 68,
    urgency: 'HIGH',
    candidates: [
      { rank: 1, cause: '메인 PCB 전원부 소손', part: '메인 PCB', confidence: 68, evidence: ['PCB 사진 우상단 변색 영역', '전원 투입 직후 리셋 로그'], sourceIds: ['S1', 'S4', 'S5'] },
      { rank: 2, cause: '배터리 보호회로 동작', confidence: 35, evidence: ['배터리 전압 순간 강하 1회'], sourceIds: ['S4'] },
    ],
    agents: t.agents.map((a) =>
      a.agent === 'PCB'
        ? {
            ...a,
            verdict: 'ABNORMAL',
            summary: '전원부 변색·소손 의심 · 보드 교체 검토',
            findings: ['전원 IC 주변 변색', '콘덴서 C21 미세 팽창'],
            confidence: 71,
            annotations: [{ imageId: `${imgPrefix}-img-c`, label: '전원부 변색', x: 66, y: 25, w: 15, h: 15, severity: 'HIGH' }],
          }
        : a.agent === 'MOTOR'
          ? { ...a, verdict: 'NORMAL', summary: '기계부 이상 없음', findings: ['하우징·연결부 외관 정상', '회전축 정렬 정상'], confidence: 88, annotations: [] }
          : a,
    ),
    similarCases: [
      { receiptNo: 'SR-2026-05120', model: 'RC-A100', cause: '전원 IC 주변 소손 · 충전 중 재부팅', resolution: '메인 PCB 교체 · 펌웨어 재설치', similarity: 90, closedAt: isoAgo(60 * 24 * 14), origin: 'INTERNAL' },
      { receiptNo: 'SR-2026-02981', model: 'RC-X700', cause: '콘덴서 팽창으로 전원 불안정', resolution: '메인 PCB 교체', similarity: 83, closedAt: isoAgo(60 * 24 * 52), origin: 'INTERNAL' },
      { receiptNo: 'SR-2025-12077', model: 'RC-A100', cause: '배터리 보호회로 동작 (PCB 정상)', resolution: '배터리 팩 교체', similarity: 72, closedAt: isoAgo(60 * 24 * 120), origin: 'EXTERNAL' },
    ],
    similarCaseCount: 7,
    parts: [{ partId: 'P-310', partName: '메인 PCB', partNo: 'RM-PC-310', quantity: 1, reason: '전원부 소손은 보드 단위 교체' }],
    repairMethod: ['메인 PCB(RM-PC-310) 교체', '펌웨어 최신 버전 재설치'],
  }
}

const TEMPLATES = { MOTOR_HOUSING: motorHousingDiagnosis, WHEEL_SENSOR: wheelSensorDiagnosis, PCB: pcbDiagnosis }
export type DiagnosisTemplateKey = keyof typeof TEMPLATES

export function buildDiagnosis(repair: Repair, key: DiagnosisTemplateKey, version = 1, minutesAgo = 30): Diagnosis {
  const prefix = repair.images.find((i) => i.kind === 'MOTOR')?.id.replace(/-img-m$/, '') ?? `r${repair.id}`
  const t = TEMPLATES[key](prefix)
  // 실제 업로드 이미지 ID 와 연결 (신규 접수 건 대응)
  const imgByKind = (k: string) => repair.images.find((i) => i.kind === k)?.id
  const agents = t.agents.map((a) => ({
    ...a,
    annotations: a.annotations.map((an) => ({
      ...an,
      imageId: an.imageId.endsWith('-img-m') ? (imgByKind('MOTOR') ?? an.imageId) : an.imageId.endsWith('-img-c') ? (imgByKind('PCB') ?? an.imageId) : an.imageId,
    })),
  }))
  return {
    ...t,
    agents,
    id: `D-${repair.id}-v${version}`,
    repairId: repair.id,
    version,
    generatedAt: isoAgo(minutesAgo),
    technicianDecision: { state: 'PENDING' },
  }
}

/* ---------------- 수리 건 ---------------- */
interface Seed {
  id: number
  serial: string
  symptom: string
  errorCodes: string[]
  status: RepairStatus
  tech: User
  minutesAgo: number
  urgency: Urgency
  photoRequestCount?: number
  diag?: DiagnosisTemplateKey
  scenario?: Repair['mockScenario']
}

const [KIM, PARK] = USERS
const SEEDS: Seed[] = [
  { id: 101, serial: 'RC2026000187', symptom: '청소 도중 큰 소음이 발생하고 움직임이 멈춤', errorCodes: ['E103'], status: 'DIAGNOSIS_COMPLETED', tech: KIM, minutesAgo: 95, urgency: 'HIGH', diag: 'MOTOR_HOUSING' },
  { id: 102, serial: 'RC2026000342', symptom: '주행 중 덜컹거리는 소리 후 한쪽으로 회전함', errorCodes: ['E103', 'E210'], status: 'ADDITIONAL_INFO_NEEDED', tech: KIM, minutesAgo: 140, urgency: 'MEDIUM', photoRequestCount: 1, scenario: 'NEED_PHOTO' },
  { id: 103, serial: 'RC2026000415', symptom: '충전 거치대에서 충전되지 않음', errorCodes: ['E401'], status: 'ANALYZING', tech: KIM, minutesAgo: 12, urgency: 'MEDIUM', scenario: 'NORMAL' },
  { id: 111, serial: 'RC2026000501', symptom: '전원 버튼을 눌러도 반응 없음', errorCodes: [], status: 'QUEUED', tech: KIM, minutesAgo: 4, urgency: 'LOW', scenario: 'FAIL' },
  { id: 104, serial: 'RC2025009921', symptom: '바퀴 회전이 간헐적으로 멈춤', errorCodes: ['E210'], status: 'TECHNICIAN_REVIEW', tech: KIM, minutesAgo: 60 * 26, urgency: 'MEDIUM', diag: 'WHEEL_SENSOR' },
  { id: 105, serial: 'RC2025008812', symptom: '청소 시작 3분 후 소음과 함께 정지', errorCodes: ['E103'], status: 'CLOSED', tech: KIM, minutesAgo: 60 * 50, urgency: 'HIGH', diag: 'MOTOR_HOUSING' },
  { id: 106, serial: 'RC2025007710', symptom: '전원 투입 직후 재부팅 반복', errorCodes: ['E501'], status: 'CLOSED', tech: PARK, minutesAgo: 60 * 30, urgency: 'HIGH', diag: 'PCB' },
  // 재고 없는 부품(메인 PCB, 재고 0) → 발주 필요 사례. #101(모터 어셈블리, 수원 7개)은 재고로 수리 가능 사례
  { id: 114, serial: 'RC2026000722', symptom: '전원 투입 후 바로 꺼지고 충전 표시등이 깜빡임', errorCodes: ['E501'], status: 'TECHNICIAN_REVIEW', tech: KIM, minutesAgo: 60 * 3, urgency: 'MEDIUM', diag: 'PCB' },
  { id: 113, serial: 'RC2026000610', symptom: '물걸레 모듈 장착 후 주행 멈춤', errorCodes: ['E103'], status: 'DIAGNOSIS_COMPLETED', tech: PARK, minutesAgo: 70, urgency: 'MEDIUM', diag: 'WHEEL_SENSOR' },
  { id: 107, serial: 'RC2025006601', symptom: '소음 후 주행 불가', errorCodes: ['E103'], status: 'CLOSED', tech: KIM, minutesAgo: 60 * 24 * 4, urgency: 'HIGH', diag: 'MOTOR_HOUSING' },
  { id: 112, serial: 'RC2025002205', symptom: '좌측 바퀴 헛돎', errorCodes: ['E210'], status: 'CLOSED', tech: PARK, minutesAgo: 60 * 24 * 6, urgency: 'LOW', diag: 'WHEEL_SENSOR' },
  { id: 108, serial: 'RC2025005502', symptom: '청소 중 정지 후 경고음', errorCodes: ['E103'], status: 'TECHNICIAN_REVIEW', tech: KIM, minutesAgo: 60 * 24 * 3, urgency: 'MEDIUM', diag: 'MOTOR_HOUSING' },
  // 출장기사(T1002·부산) 오늘의 출장 데모용
  { id: 115, serial: 'RC2026000815', symptom: '주행 중 덜컹 소리가 나고 멈춤', errorCodes: ['E103'], status: 'TECHNICIAN_REVIEW', tech: PARK, minutesAgo: 60 * 5, urgency: 'MEDIUM', diag: 'MOTOR_HOUSING' },
  { id: 116, serial: 'RC2026000816', symptom: '충전 후 전원이 바로 꺼짐', errorCodes: ['E501'], status: 'TECHNICIAN_REVIEW', tech: PARK, minutesAgo: 60 * 7, urgency: 'MEDIUM', diag: 'PCB' },
  { id: 109, serial: 'RC2025004403', symptom: '간헐적 전원 꺼짐, 재현 어려움', errorCodes: [], status: 'MANUAL_REVIEW', tech: PARK, minutesAgo: 60 * 24 * 2, urgency: 'MEDIUM', photoRequestCount: 3 },
  // 같은 제품(RC2026000187)의 이전 수리 건: 시리얼은 겹치므로 수리 ID 로 구분
  { id: 98, serial: 'RC2026000187', symptom: '흡입력 약해짐, 브러시 회전 느림', errorCodes: ['E302'], status: 'CLOSED', tech: KIM, minutesAgo: 60 * 24 * 45, urgency: 'LOW', diag: 'WHEEL_SENSOR' },
  { id: 110, serial: 'RC2025003304', symptom: '흡입력 저하', errorCodes: ['E302'], status: 'CLOSED', tech: KIM, minutesAgo: 60 * 24 * 12, urgency: 'LOW', diag: 'WHEEL_SENSOR' },
]

/** 리포트 초안 저장(r1)까지 진행된 시드 — 확정 전 상태 데모용 */
const DRAFT_SEEDS = [108]
/** 확정 후 수정·재확정(r2)한 시드 — 확정 이력 데모용 */
const REVISED_SEEDS = [106]

function history(seed: Seed): ApprovalRecord[] {
  const r: ApprovalRecord[] = [
    { id: `h${seed.id}-1`, target: 'SYSTEM', action: 'CREATED', actor: seed.tech.name, actorRole: 'TECHNICIAN', at: isoAgo(seed.minutesAgo), comment: '수리 접수 및 사진 2장 등록 (PCB · 기계)' },
  ]
  if (seed.diag) {
    r.push({ id: `h${seed.id}-2`, target: 'DIAGNOSIS', action: 'AI_GENERATED', actor: 'AI Orchestrator', actorRole: 'AI', at: isoAgo(seed.minutesAgo - 3), comment: 'AI 진단 초안 v1 생성' })
  }
  if (['TECHNICIAN_REVIEW', 'CLOSED'].includes(seed.status)) {
    r.push({ id: `h${seed.id}-3`, target: 'DIAGNOSIS', action: 'CONFIRMED', actor: seed.tech.name, actorRole: 'TECHNICIAN', at: isoAgo(seed.minutesAgo - 20), comment: '진단 내용 확인, 점검 진행' })
  }
  if (DRAFT_SEEDS.includes(seed.id)) {
    r.push({ id: `h${seed.id}-4`, target: 'REPORT', action: 'DRAFT_SAVED', actor: seed.tech.name, actorRole: 'TECHNICIAN', at: isoAgo(seed.minutesAgo - 240), comment: '리포트 초안 r1 저장' })
  }
  if (seed.status === 'CLOSED') {
    r.push({ id: `h${seed.id}-4`, target: 'REPORT', action: 'CONFIRMED', actor: seed.tech.name, actorRole: 'TECHNICIAN', at: isoAgo(seed.minutesAgo - 240), comment: '리포트 r1 확정 · 고장 DB 반영' })
    if (REVISED_SEEDS.includes(seed.id)) {
      r.push({ id: `h${seed.id}-5`, target: 'REPORT', action: 'CONFIRMED', actor: seed.tech.name, actorRole: 'TECHNICIAN', at: isoAgo(seed.minutesAgo - 600), comment: '리포트 r2 확정 · 실제 원인 정정 (고장 DB 반영 내용 교체)' })
    }
  }
  if (seed.status === 'MANUAL_REVIEW') {
    r.push(
      { id: `h${seed.id}-6`, target: 'PHOTO', action: 'COMMENTED', actor: 'AI Orchestrator', actorRole: 'AI', at: isoAgo(seed.minutesAgo - 90), comment: '추가 사진 요청 3회 초과 → 본사 수동 검토로 전환' },
    )
  }
  return r
}

function seedReport(seed: Seed): RepairReport | undefined {
  const draft = DRAFT_SEEDS.includes(seed.id)
  if (seed.status !== 'CLOSED' && !draft) return undefined
  const revised = REVISED_SEEDS.includes(seed.id)
  const motor = seed.diag === 'MOTOR_HOUSING'
  const pcb = seed.diag === 'PCB'
  const confirmedAt = isoAgo(seed.minutesAgo - 240)
  const lastAt = revised ? isoAgo(seed.minutesAgo - 600) : confirmedAt
  const content: RepairReport['content'] = pcb
    ? {
        // 106: AI 는 PCB 를 지목했지만 실제로는 배터리 커넥터 문제 → r2 에서 원인 정정
        actualCause: '배터리 커넥터 접촉 불량 (PCB 정상)',
        actualAction: '배터리 커넥터 세척 및 재체결, PCB 교체하지 않음',
        technicianOpinion: 'PCB 변색은 생산 시 마킹 잉크로 확인. 실제로는 배터리 커넥터 산화로 인한 순간 전원 차단이었음. AI가 PCB 변색을 과대 판단.',
        faults: [{ area: 'OTHER' }],
        repairSuccessful: true,
        outcome: 'FIXED',
        aiAcceptance: 'REJECTED',
      }
    : motor
      ? {
          actualCause: '모터 하우징 변형',
          actualAction: '모터 어셈블리 교체 후 RPM 테스트 정상 확인',
          technicianOpinion: '진단대로 하단 연결부 들뜸 확인. 교체 후 정상 동작.',
          faults: [{ area: 'MOTOR', partId: 'P-103' }],
          repairSuccessful: true,
          outcome: 'FIXED',
          aiAcceptance: 'ACCEPTED',
        }
      : {
          actualCause: '휠 회전 센서 접촉 불량',
          actualAction: '센서 교체 후 주행 테스트',
          technicianOpinion: draft ? '센서 교체 완료, 주행 테스트 결과 확인 후 확정 예정' : '센서 커넥터 산화 확인. 교체 후 정상.',
          faults: [{ area: 'MOTOR', partId: 'P-221' }],
          repairSuccessful: !draft,
          outcome: draft ? 'NOT_FIXED' : 'FIXED',
          aiAcceptance: 'ACCEPTED',
        }
  if (draft) {
    return { id: `RPT-${seed.id}`, repairId: seed.id, version: 1, revision: 1, status: 'DRAFT', content, createdBy: seed.tech.name, updatedBy: seed.tech.name, updatedAt: isoAgo(seed.minutesAgo - 240), confirmations: [] }
  }
  const confirmations = [{ revision: 1, confirmedBy: seed.tech.name, confirmedAt }]
  if (revised) confirmations.push({ revision: 2, confirmedBy: seed.tech.name, confirmedAt: lastAt })
  const revision = confirmations.length
  return {
    id: `RPT-${seed.id}`,
    repairId: seed.id,
    // 확정본 1개 = 저장 1 + 확정 1, 재확정이면 그만큼 더
    version: revision * 2,
    revision,
    status: 'CONFIRMED',
    content,
    createdBy: seed.tech.name,
    updatedBy: seed.tech.name,
    updatedAt: lastAt,
    confirmedBy: seed.tech.name,
    confirmedAt: lastAt,
    confirmations,
  }
}

export interface MockDbState {
  repairs: Repair[]
  diagnoses: Record<number, Diagnosis[]> // repairId → 버전 목록 (마지막이 최신)
  photoRequests: Record<number, import('@/types').PhotoRequest[]>
  orders: PurchaseOrder[]
  parts: Part[]
  notifications: Notification[]
  /** 보증 판정: 고장 원인 유형(시드에서 지정할 때만) · 기사 확정 결과 */
  warranty: Record<number, { fault?: { type: import('@/types').WarrantyFaultType; label: string }; decision?: import('@/types').WarrantyDecision }>
  /** 출장 일정 (출장기사 배정) */
  fieldVisits?: import('@/types').FieldVisit[]
  /** 회원가입으로 만든 Mock 계정 (기본 데모 계정은 USERS) */
  users?: (User & { password: string })[]
  /** 재고 예약 (출장 준비) · 재고 변경 이력 */
  reservations: import('@/types').StockReservation[]
  stockHistory: import('@/types').StockHistoryEntry[]
  /** 사내 사례 동기화 (확정 때 생성). 없는 확정 리포트는 시드로 보고 COMPLETED */
  caseSyncs?: Record<number, { revision: number; queuedAt: string; fail?: boolean }>
  /** 출장 전 리포트: 기사 수정안 · 기사 확인 (AI 진단 원본과 따로 저장) */
  preVisit?: Record<number, { technicianEdit: import('@/types').TechnicianReportEdit | null; review: import('@/types').PreVisitReview | null }>
  seq: number
}

export function createSeed(): MockDbState {
  const repairs: Repair[] = SEEDS.map((s) => {
    const product = productFromSerial(s.serial)!
    const status = s.status
    return {
      id: s.id,
      receiptNo: `SR-2026-${String(10000 + s.id * 7).padStart(5, '0')}`,
      product,
      symptom: s.symptom,
      errorCodes: s.errorCodes,
      branch: s.tech.branch,
      technician: s.tech.name,
      technicianId: s.tech.employeeId,
      receivedAt: isoAgo(s.minutesAgo),
      updatedAt: isoAgo(Math.max(1, s.minutesAgo - 20)),
      status,
      urgency: s.urgency,
      images: baseImages(`r${s.id}`, s.minutesAgo),
      photoRequestCount: s.photoRequestCount ?? 0,
      stages: stagesFor(status),
      tools: toolsFor(s.id, status),
      progress: s.diag ? 100 : 0,
      history: history(s),
      report: seedReport(s),
      mockScenario: s.scenario,
    }
  })

  // 진행 중인 건의 단계 상태를 현실적으로 세팅
  const r102 = repairs.find((r) => r.id === 102)!
  r102.stages = [
    { stage: 'QUEUED', state: 'DONE', message: '대기열 등록 완료' },
    { stage: 'ANALYSIS', state: 'WAITING_INPUT', message: '기계 분석 · 추가 사진 대기' },
    { stage: 'SYNTHESIS', state: 'PENDING' },
  ]
  r102.tools = [tool(102, 'PCB', 'DONE', 'PCB 분석 완료'), tool(102, 'RAG', 'DONE', '유사 사례 12건 · 매뉴얼 3건 확인'), tool(102, 'MOTOR', 'WAITING_INPUT', '하단 연결부 판독 불가 · 추가 사진 대기')]
  r102.progress = 48
  r102.progressMessage = '모터 하단 연결부 추가 사진이 필요합니다.'

  const r103 = repairs.find((r) => r.id === 103)!
  r103.stages = [
    { stage: 'QUEUED', state: 'DONE', message: '대기열 등록 완료' },
    { stage: 'ANALYSIS', state: 'RUNNING' },
    { stage: 'SYNTHESIS', state: 'PENDING' },
  ]
  r103.tools = [tool(103, 'PCB', 'RUNNING')]
  r103.progress = 25
  r103.progressMessage = 'PCB 사진을 분석하고 있습니다.'

  const diagnoses: MockDbState['diagnoses'] = {}
  for (const s of SEEDS) {
    if (!s.diag) continue
    const repair = repairs.find((r) => r.id === s.id)!
    const d = buildDiagnosis(repair, s.diag, 1, s.minutesAgo - 3)
    if (['TECHNICIAN_REVIEW', 'CLOSED'].includes(s.status)) {
      d.technicianDecision = { state: 'APPROVED', decidedBy: s.tech.name, decidedByRole: 'TECHNICIAN', decidedAt: isoAgo(s.minutesAgo - 20), comment: '진단 내용 확인, 점검 진행' }
    }
    diagnoses[s.id] = [d]
  }
  // US-04 부분 실패 시연: #114 는 매뉴얼·유사 사례 검색 도구만 실패 → 나머지(PCB·기계) 결과로 만든 진단, 유사 사례는 '미확인'
  const r114 = repairs.find((r) => r.id === 114)
  if (r114 && diagnoses[114]) {
    r114.tools = [tool(114, 'PCB', 'DONE'), tool(114, 'MOTOR', 'DONE'), tool(114, 'RAG', 'FAILED', '유사 사례 검색 응답 시간 초과')]
    diagnoses[114][0].similarCases = []
    diagnoses[114][0].similarCaseCount = 0
  }

  const photoRequests: MockDbState['photoRequests'] = {
    102: [
      {
        id: 'PR-102-1',
        target: '모터 하단 연결부',
        reason: '현재 사진에서는 외관 변형 여부를 확인하기 어렵습니다.',
        guide: '연결부가 정면으로 보이도록 촬영해 주세요. 그림자가 지지 않게 측면 조명을 켜고 20cm 거리에서 찍어 주세요.',
        requestNo: 1,
        maxRequests: 3,
        requestedBy: '기계 분석',
        requestedAt: isoAgo(130),
        resolved: false,
      },
    ],
  }

  const orders: PurchaseOrder[] = [
    {
      id: 'PO-104-1', repairId: 104, receiptNo: repairs.find((r) => r.id === 104)!.receiptNo,
      partId: 'P-221', partNo: 'RM-SN-221', partName: '휠 회전 센서', quantity: 1, fromWarehouse: '수원 창고',
      aiReason: 'AI 진단 1순위 원인(휠 회전 센서 접촉 불량)의 교체 부품 · 수원 창고 재고 24개로 당일 출고 가능', aiConfidence: 74, sourceIds: ['S2', 'S4'],
      status: 'REQUESTED', requestedBy: '김정훈', requestedAt: isoAgo(60 * 20), requestComment: '커넥터 재체결로 재현됨, 센서 교체 필요', decision: { state: 'PENDING' }, createdAt: isoAgo(60 * 25),
    },
    {
      id: 'PO-105-1', repairId: 105, receiptNo: repairs.find((r) => r.id === 105)!.receiptNo,
      partId: 'P-103', partNo: 'RM-MT-103', partName: '모터 어셈블리', quantity: 1, fromWarehouse: '수원 창고',
      aiReason: '하우징 변형은 어셈블리 단위 교체 필요', aiConfidence: 87, sourceIds: ['S1', 'S3'],
      status: 'APPROVED', requestedBy: '김정훈', requestedAt: isoAgo(60 * 48), decision: { state: 'APPROVED', decidedBy: '이서연', decidedByRole: 'QUALITY_MANAGER', decidedAt: isoAgo(60 * 47), comment: '수원 창고 출고 지시' }, createdAt: isoAgo(60 * 49),
    },
    {
      id: 'PO-106-1', repairId: 106, receiptNo: repairs.find((r) => r.id === 106)!.receiptNo,
      partId: 'P-310', partNo: 'RM-PC-310', partName: '메인 PCB', quantity: 1, fromWarehouse: '수원 창고',
      aiReason: '전원부 소손 의심 · 보드 단위 교체', aiConfidence: 68, sourceIds: ['S1'],
      status: 'REJECTED', requestedBy: '박민수', requestedAt: isoAgo(60 * 29), decision: { state: 'REJECTED', decidedBy: '이서연', decidedByRole: 'QUALITY_MANAGER', decidedAt: isoAgo(60 * 28), comment: '재고 0개 · 본사 검토 결과 확인 후 재요청 바랍니다' }, createdAt: isoAgo(60 * 29),
    },
  ]

  const notifications: Notification[] = [
    { id: 'N1', title: 'AI 진단 초안 도착', body: '수리 #101 (RC-A100) 진단 초안을 확인해 주세요.', at: isoAgo(90), read: false, link: '/repairs/101/diagnosis', roles: ['TECHNICIAN'] },
    { id: 'N2', title: '추가 사진 요청', body: '수리 #102 모터 하단 연결부 사진이 필요합니다.', at: isoAgo(130), read: false, link: '/repairs/102/progress', roles: ['TECHNICIAN'] },
    { id: 'N4', title: '수동 검토 전환', body: '수리 #109 추가 사진 3회 초과로 수동 검토로 전환되었습니다.', at: isoAgo(60 * 30), read: false, link: '/repairs/109/diagnosis', roles: ['QUALITY_MANAGER'] },
    { id: 'N5', title: '발주 요청 1건', body: '휠 회전 센서(RM-SN-221) 발주 승인이 필요합니다.', at: isoAgo(60 * 20), read: false, link: '/order-approvals', roles: ['QUALITY_MANAGER'] },
  ]

  /* 보증 판정 데모: #101 무상(FREE) · #113 유상(PAID, 침수 흔적) · #114 판단 어려움(UNKNOWN, 구매일 모름) */
  /* 진행 조회 데모: 휴대폰 뒷자리는 수리 ID 와 같게 (예: #101 → 0101) */
  const visit = (name: string, purchaseDate: string | null, last4: string, confirmedDate?: string) => ({ customerName: name, phone: `010-0000-${last4}`, address: '데모시 예시구 샘플로 1', preferredDate: '2026-10-28', purchaseDate, confirmedDate })
  const setVisit = (id: number, v: ReturnType<typeof visit>) => {
    const r = repairs.find((x) => x.id === id)
    if (r) r.visitInfo = v
  }
  setVisit(101, visit('데모 고객A', '2025-12-01', '0101'))
  // 수리 방법: 출장 건(113·115·116)은 방문 수리, 그 밖의 시드는 센터 방문 (아래 setVisit 뒤에 지정)
  // 출장기사(T1002·부산) 대시보드의 "오늘의 출장" 데모: 오늘 방문 확정
  const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  setVisit(113, visit('데모 고객B', '2026-03-15', '0113', todayStr))
  setVisit(114, visit('데모 고객C', null, '0114'))
  setVisit(104, visit('데모 고객D', '2026-02-10', '0104', '2026-10-24'))
  setVisit(105, visit('데모 고객E', '2026-01-20', '0105', '2026-10-20'))
  const warranty: MockDbState['warranty'] = {
    113: { fault: { type: 'USER_FAULT', label: '사용자 과실 의심 (물걸레 모듈 주변 침수 흔적)' } },
    104: { decision: { result: 'FREE', reason: '영수증으로 구매일 확인', decidedBy: '김정훈', decidedAt: isoAgo(60 * 20) } },
    105: { decision: { result: 'FREE', decidedBy: '김정훈', decidedAt: isoAgo(60 * 48) } },
  }

  /* 재고 예약 데모: #104 의 휠 센서 예약은 이미 24시간이 지나 처음 조회할 때 만료 처리된다 */
  const reservations: MockDbState['reservations'] = [
    { id: 'RSV-SEED-1', partId: 'P-221', repairId: 104, warehouse: '수원 창고', quantity: 1, status: 'RESERVED', reservedBy: '김정훈', reservedAt: isoAgo(60 * 26), expiresAt: isoAgo(60 * 2) },
    { id: 'RSV-SEED-2', partId: 'P-103', repairId: 106, warehouse: '수원 창고', quantity: 1, status: 'RELEASED', reservedBy: '박민수', reservedAt: isoAgo(60 * 32), expiresAt: isoAgo(60 * 8), closedAt: isoAgo(60 * 30) },
  ]
  const stockHistory: MockDbState['stockHistory'] = [
    { id: 'SH-SEED-1', partId: 'P-103', at: isoAgo(60 * 32), change: 'RESERVE', delta: -1, quantity: 1, warehouse: '수원 창고', actor: '박민수', repairId: 106 },
    { id: 'SH-SEED-2', partId: 'P-103', at: isoAgo(60 * 30), change: 'RELEASE', delta: 0, quantity: 1, warehouse: '수원 창고', actor: '박민수', repairId: 106 },
    { id: 'SH-SEED-3', partId: 'P-221', at: isoAgo(60 * 26), change: 'RESERVE', delta: -1, quantity: 1, warehouse: '수원 창고', actor: '김정훈', repairId: 104 },
  ]

  /* 오늘의 출장: T1002(출장기사)에게 오늘(한국 시간) 3건 · T1001(센터 수리자)은 0건.
   * 모델·증상·상태는 조회할 때 수리 건의 최신 값으로 채운다 */
  const fieldVisit = (repairId: number, visitTime: string, customerName: string, district: string, neighborhood: string, visitStatus: 'SCHEDULED' | 'DONE') => {
    const r = repairs.find((x) => x.id === repairId)!
    // visitDate 'TODAY': 데모 일정은 조회하는 날의 오늘로 (저장된 데모 데이터가 날짜가 지나도 3건 유지)
    return { visitId: `V-${repairId}`, repairId, technicianId: 'T1002', visitDate: 'TODAY', visitTime, customerName, district, neighborhood, model: r.product.model, symptom: r.symptom, status: r.status, visitStatus }
  }
  const fieldVisits: MockDbState['fieldVisits'] = [
    fieldVisit(113, '13:30', '이○○', '해운대구', '우동', 'SCHEDULED'),
    fieldVisit(116, '09:00', '김○○', '수영구', '광안동', 'DONE'),
    fieldVisit(115, '16:00', '최○○', '남구', '대연동', 'SCHEDULED'),
  ]
  // 고객 진행 조회와 맞추기: 출장 건의 방문 확정일 = 오늘
  setVisit(115, visit('데모 고객F', '2026-02-02', '0115', todayStr))
  setVisit(116, visit('데모 고객G', '2025-12-20', '0116', todayStr))
  for (const r of repairs) {
    if (!r.visitInfo) continue
    const field = [113, 115, 116].includes(r.id)
    const center = SERVICE_CENTERS.find((c) => c.name === r.branch)
    Object.assign(r.visitInfo, field ? { serviceType: 'VISIT', visitSlot: 'PM' } : { serviceType: 'CENTER', centerId: center?.id, centerName: center?.name ?? r.branch })
  }

  // 부품 사진 (데모 그림)
  const PART_IMAGES: Record<string, string> = { 'P-103': '/mock/motor.svg', 'P-221': '/mock/motor-joint.svg', 'P-310': '/mock/pcb.svg', 'P-115': '/mock/motor.svg', 'P-208': '/mock/product.svg' }
  const parts = structuredClone(PARTS).map((p) => ({ ...p, imageUrl: PART_IMAGES[p.id] }))
  return { repairs, diagnoses, photoRequests, orders, parts, notifications, warranty, reservations, stockHistory, fieldVisits, seq: 200 }
}

/* ---------------- 대시보드용: 승인된 고장 레코드 (사내 고장 DB) ---------------- */
export interface DefectRecord {
  /** 수리 건 DB ID (Repair.id) */
  repairId: number
  receiptNo: string
  model: string
  part: string
  cause: string
  branch: string
  factory: string
  month: string
  aiMatched: boolean
  approvedAt: string
}

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export function createDefectRecords(): DefectRecord[] {
  const rnd = seeded(42)
  const pick = <T,>(arr: [T, number][]): T => {
    const total = arr.reduce((a, [, w]) => a + w, 0)
    let x = rnd() * total
    for (const [v, w] of arr) {
      if ((x -= w) <= 0) return v
    }
    return arr[0][0]
  }
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const records: DefectRecord[] = []
  let n = 1
  months.forEach((month, mi) => {
    const count = 34 + mi * 6 + Math.round(rnd() * 8)
    for (let i = 0; i < count; i++) {
      const model = pick<string>([['RC-A100', 5], ['RC-S300', 3], ['RC-X700', 2]])
      // 최근 달일수록 모터 하우징 변형이 증가하는 패턴 (구미 제2공장 생산분 이슈)
      const part = pick<string>([
        ['모터 어셈블리', 3 + mi * 1.2],
        ['휠 회전 센서', 4],
        ['메인 PCB', 2],
        ['메인 브러시 모터', 2.5],
        ['배터리팩', 2],
        ['구동 휠 모듈', 1.2],
      ])
      const cause =
        part === '모터 어셈블리' ? pick([['모터 하우징 변형', 4], ['모터 베어링 마모', 1]]) :
        part === '휠 회전 센서' ? '휠 회전 센서 접촉 불량' :
        part === '메인 PCB' ? '메인 PCB 전원부 소손' :
        part === '메인 브러시 모터' ? '브러시 모터 과부하' :
        part === '배터리팩' ? '배터리 셀 열화' : '구동 휠 기어 파손'
      const factory = MODELS[model].factory
      const branch = pick<string>([['강남 서비스센터', 4], ['부산 서비스센터', 3], ['대구 서비스센터', 2], ['대전 서비스센터', 2], ['광주 서비스센터', 1.5]])
      const day = String(1 + Math.floor(rnd() * 27)).padStart(2, '0')
      records.push({
        repairId: 5000 + n,
        receiptNo: `SR-${month.replace('-', '')}-${String(n++).padStart(4, '0')}`,
        model,
        part,
        cause,
        branch,
        factory,
        month,
        aiMatched: rnd() < (part === '메인 PCB' ? 0.62 : 0.86),
        approvedAt: `${month}-${day}T10:00:00+09:00`,
      })
    }
  })
  return records
}
