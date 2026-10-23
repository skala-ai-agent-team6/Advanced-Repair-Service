import type { Component } from 'vue'
import {
  FilePen,
  Inbox,
  ListOrdered,
  Loader,
  Camera,
  Sparkles,
  UserCheck,
  CircleCheck,
  CircleX,
  Hand,
  Archive,
} from 'lucide-vue-next'
import type { AiAcceptance, AnalysisStage, AnalysisToolKind, FaultArea, PhotoKind, RepairOutcome, RepairStatus, ReportStatus, Role, OrderStatus, DecisionState, StatusGroupKey, PhotoQualityIssue, PhotoQualityStatus } from '@/types'

/** 색상만으로 상태를 구분하지 않도록 label + icon + tone 을 함께 정의 */
export type Tone = 'neutral' | 'info' | 'ai' | 'warning' | 'success' | 'danger'

export interface StatusMeta {
  label: string
  description: string
  tone: Tone
  icon: Component
}

export const STATUS_META: Record<RepairStatus, StatusMeta> = {
  DRAFT: { label: '임시 저장', description: '접수 작성 중', tone: 'neutral', icon: FilePen },
  RECEIVED: { label: '접수 완료', description: '진단 대기열 등록 전', tone: 'info', icon: Inbox },
  QUEUED: { label: '분석 대기', description: 'AI 분석 순서를 기다리는 중', tone: 'info', icon: ListOrdered },
  ANALYZING: { label: 'AI 분석 중', description: '전문 Agent 가 분석 중', tone: 'ai', icon: Loader },
  ADDITIONAL_INFO_NEEDED: { label: '추가 사진 필요', description: 'AI 가 추가 사진을 요청함', tone: 'warning', icon: Camera },
  DIAGNOSIS_COMPLETED: { label: '진단 초안 도착', description: '기사 확인이 필요한 AI 초안', tone: 'ai', icon: Sparkles },
  TECHNICIAN_REVIEW: { label: '기사 수리·리포트 작성', description: '진단 확인 후 수리하고 리포트를 확정할 차례', tone: 'warning', icon: UserCheck },
  APPROVED: { label: '승인 완료', description: '고장 DB·품질 대시보드 반영됨', tone: 'success', icon: CircleCheck },
  REJECTED: { label: '반려', description: '반려되어 반영되지 않음', tone: 'danger', icon: CircleX },
  MANUAL_REVIEW: { label: '본사 수동 검토', description: '사람이 직접 진단하는 건', tone: 'danger', icon: Hand },
  CANCELLED: { label: '취소', description: '접수가 취소됨', tone: 'neutral', icon: CircleX },
  CLOSED: { label: '리포트 확정', description: '기사가 리포트를 확정해 고장 DB·품질 대시보드에 반영됨', tone: 'success', icon: Archive },
}

export const STATUS_ORDER: RepairStatus[] = [
  'DRAFT',
  'RECEIVED',
  'QUEUED',
  'ANALYZING',
  'ADDITIONAL_INFO_NEEDED',
  'DIAGNOSIS_COMPLETED',
  'TECHNICIAN_REVIEW',
  'APPROVED',
  'REJECTED',
  'MANUAL_REVIEW',
  'CLOSED',
  'CANCELLED',
]

/** 수리 목록 상태 필터의 그룹 (표시 순서용). 개별 상태는 모두 그대로 노출한다 */
export const STATUS_GROUPS: { key: StatusGroupKey; label: string; statuses: RepairStatus[] }[] = [
  { key: 'AI_ANALYSIS', label: 'AI 분석', statuses: ['RECEIVED', 'QUEUED', 'ANALYZING'] },
  { key: 'TECHNICIAN', label: '기사 처리', statuses: ['ADDITIONAL_INFO_NEEDED', 'DIAGNOSIS_COMPLETED', 'TECHNICIAN_REVIEW', 'REJECTED'] },
  { key: 'HQ', label: '본사 검토', statuses: ['MANUAL_REVIEW'] },
  { key: 'DONE', label: '완료', statuses: ['APPROVED', 'CLOSED', 'CANCELLED'] },
]

/** 진단 진행 화면에서 "분석 중" 으로 다루는 상태 */
export const IN_PROGRESS_STATUSES: RepairStatus[] = ['RECEIVED', 'QUEUED', 'ANALYZING', 'ADDITIONAL_INFO_NEEDED']

export const STAGE_META: Record<AnalysisStage, { label: string; agent: string; description: string }> = {
  QUEUED: { label: '접수·대기열', agent: 'System', description: '분석 요청을 대기열에 등록합니다' },
  ANALYSIS: { label: '분석 진행', agent: 'AI 분석', description: '필요한 분석 도구가 실행되는 대로 아래에 추가됩니다' },
  SYNTHESIS: { label: '결과 종합', agent: 'AI 종합', description: '분석 결과를 모아 원인 후보와 판단 점수를 정리합니다' },
}

export const STAGE_ORDER: AnalysisStage[] = ['QUEUED', 'ANALYSIS', 'SYNTHESIS']

/** 분석 도구 표시 이름 (실서버 agentType 매핑: PCB → PCB 분석, MOTOR → 기계 분석, RAG → 매뉴얼·유사 사례 검색, 그 외 → 도구 이름) */
export const TOOL_KIND_LABEL: Record<Exclude<AnalysisToolKind, 'OTHER'>, string> = {
  PCB: 'PCB 분석',
  MOTOR: '기계 분석',
  RAG: '매뉴얼·유사 사례 검색',
}

/** 판단 점수 안내 — 확률이 아니라 후보끼리 비교한 점수 */
export const SCORE_HINT = '고장 확률이 아니라 AI가 후보를 비교한 점수입니다'

export const ROLE_LABEL: Record<Role, string> = {
  TECHNICIAN: '서비스센터 기사',
  QUALITY_MANAGER: '본사 품질 담당자',
}

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: Tone }> = {
  AI_DRAFT: { label: 'AI 발주안 (미요청)', tone: 'ai' },
  REQUESTED: { label: '발주 요청됨 · 승인 대기', tone: 'warning' },
  APPROVED: { label: '발주 승인', tone: 'success' },
  ORDERED: { label: '출고됨', tone: 'info' },
  RECEIVED: { label: '수령 완료', tone: 'success' },
  REJECTED: { label: '발주 반려', tone: 'danger' },
  CANCELLED: { label: '발주 취소', tone: 'neutral' },
}

export const DECISION_META: Record<DecisionState, { label: string; tone: Tone }> = {
  PENDING: { label: '관리자 확인 대기', tone: 'warning' },
  APPROVED: { label: '관리자 확인 완료', tone: 'success' },
  REJECTED: { label: '반려됨', tone: 'danger' },
  CHANGE_REQUESTED: { label: '수정 요청됨', tone: 'warning' },
  REANALYSIS_REQUESTED: { label: '재분석 요청됨', tone: 'info' },
}

/** 접수 사진 제한 (백엔드와 동일): 칸별 5장, 전체 10장 */
export const PHOTO_LIMIT = { perKind: 5, total: 10 }

/** 사진 품질 검사 문제 → 안내 문구 */
export const PHOTO_ISSUE_MESSAGE: Record<PhotoQualityIssue, string> = {
  BLUR: '사진이 흐려요. 초점을 맞춰 다시 찍어 주세요.',
  GLARE: '빛 반사가 있어요. 조명을 피해서 찍어 주세요.',
  TOO_FAR: '너무 멀리서 찍었어요. 부품이 화면에 가득 차게 찍어 주세요.',
  WRONG_PART: '요청한 부위가 아닌 것 같아요. 예시 사진을 참고해 주세요.',
  DARK: '사진이 어두워요. 밝은 곳에서 다시 찍어 주세요.',
  LOW_RES: '해상도가 낮아요. 카메라로 원본 크기로 찍어 주세요.',
}

/** 사진 품질 검사 상태 표시 */
export const PHOTO_QUALITY_META: Record<PhotoQualityStatus, { label: string; tone: Tone }> = {
  PENDING: { label: '검사 중', tone: 'neutral' },
  PASSED: { label: '통과', tone: 'success' },
  WARNING: { label: '확인 필요', tone: 'warning' },
  FAILED: { label: '불합격 · 재촬영', tone: 'danger' },
  ERROR: { label: '검사 실패', tone: 'danger' },
}

export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = {
  PCB: 'PCB',
  MOTOR: '기계·찌그러짐',
  ADDITIONAL: '추가',
  BEFORE: '수리 전',
  AFTER: '수리 후',
}

/* ---------------- 수리 리포트 ---------------- */
export const FAULT_AREA_LABEL: Record<FaultArea, string> = { PCB: 'PCB', MOTOR: '모터', SW: '소프트웨어', OTHER: '기타' }

export const OUTCOME_META: Record<RepairOutcome, { label: string; description: string; tone: Tone }> = {
  FIXED: { label: '수리 완료', description: '고장 부위를 수리·교체해 정상 동작', tone: 'success' },
  NOT_FIXED: { label: '수리 실패', description: '수리했으나 증상이 남음', tone: 'danger' },
  NO_FAULT_FOUND: { label: '고장 없음', description: '점검 결과 이상을 찾지 못함', tone: 'neutral' },
}

export const AI_ACCEPTANCE_META: Record<AiAcceptance, { label: string; description: string; tone: Tone }> = {
  ACCEPTED: { label: '맞음', description: 'AI 진단 원인과 실제 원인이 같음', tone: 'success' },
  PARTIAL: { label: '일부 맞음', description: '원인은 비슷하나 부품·범위가 다름', tone: 'warning' },
  REJECTED: { label: '틀림', description: '실제 원인이 다름', tone: 'danger' },
  NOT_AVAILABLE: { label: 'AI 진단 없음', description: 'AI 진단 없이 진행한 건', tone: 'neutral' },
}

export const REPORT_STATUS_META: Record<ReportStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: '초안', tone: 'warning' },
  CONFIRMED: { label: '확정', tone: 'success' },
}

export const MAX_PHOTO_REQUESTS = 3
