/* 실서버(백엔드 API v2)에 아직 없는 기능 목록. Mock 모드에서는 모두 켜져 있다.
 * 화면은 이 값으로 버튼·카드를 숨기거나 "준비 중" 을 표시한다. 백엔드가 지원하면 여기만 바꾸면 된다. */
import { USE_MOCK } from './http'

export const FEATURES = {
  /** 기사의 진단 확인·반려·본사 검토 요청, 본사 수동 진단 회신 (진단 결정 API 없음) */
  // [통합] 백엔드에 POST /repairs/{id}/approval 을 추가해서 켬 (없으면 진단 완료에서 리포트로 못 넘어감)
  diagnosisDecision: true,
  /** 추가 분석(재진단) 요청 — 백엔드: "종료 후 재진단 API는 아직 제공하지 않는다" */
  reanalysis: USE_MOCK,
  /** 수리 전·후 사진 업로드 (첨부 API 는 추가 사진 요청(requestId) 전용) */
  reportPhotos: USE_MOCK,
  /** 추가 자료를 설명만으로 제출 (실서버는 사진 1장 이상 필요) */
  additionalNoteOnly: USE_MOCK,
  /** 대시보드: 모델별 · AI 진단 성공률/일치율 · 드릴다운 · 반복 고장 추세 */
  dashboardExtras: USE_MOCK,
  /** 알림 API */
  notifications: USE_MOCK,
  /** 접수 시 출장 방문 정보·개인정보 동의를 실서버로 전송 (백엔드 필드가 생기면 true 로만 바꾸면 됨).
   *  Mock 은 이 값과 관계없이 저장한다. 어떤 경우에도 userInput(AI 입력)에는 넣지 않는다 */
  visitInfo: false,
  /** 접수 사진 품질 검사 API (실서버는 아직 없음 → false 면 검사 없이 업로드만). Mock 은 파일 이름으로 흉내 */
  photoQualityCheck: USE_MOCK,
  /** 보증 판정(무상/유상) 카드 — 실서버 API 없음 → false 면 진단 리포트에서 카드를 숨김 */
  warranty: USE_MOCK,
  /** 출장 준비 · 재고 예약(예약/취소/출고/이력) — 실서버 API 없음 → false 면 예약 UI 를 숨기고 기존 부품 발주 화면만 */
  stockReservation: USE_MOCK,
  /** 소비자용 수리 진행 조회 (/track) — 실서버 API 없음 → false 면 조회 화면에 준비 중 안내, 접수 완료 화면의 링크 숨김 */
  customerReport: USE_MOCK,
  /** 고객(비회원) 고장 접수 /service/request — 실서버 API 없음 → false 면 안내만 보이고 접수 버튼 비활성 */
  customerIntake: USE_MOCK,
  /** 회원가입 (실서버 API 없음 → false 면 회원가입 화면에 안내만, 가입 버튼 비활성) */
  signup: USE_MOCK,
  /** 출장 일정(오늘의 출장) API — 실서버에 아직 없음 → false 면 출장 API 를 호출하지 않고 0건으로 표시 */
  fieldSchedule: USE_MOCK,
  /** 확정 리포트의 사내 사례 동기화 상태 (US-08) — 실서버 API 없음 → false 면 리포트 화면에서 동기화 카드를 숨기고 호출하지 않음 */
  caseSync: USE_MOCK,
  /** 자동 재처리(재시도) 상태 (US-10) — 실서버 API 없음 → false 면 재처리 카드를 숨기고 호출하지 않음 */
  retryStatus: USE_MOCK,
  /** 출장 전 진단 리포트 기사 수정안 · 기사 확인(TECHNICIAN_REVIEWED) — 실서버 API 없음 → false 면 [수정] 버튼을 숨기고 호출하지 않음
   *  ([리포트 확인 완료]는 기존 진단 확인 API 로 동작) */
  preVisitReportEdit: USE_MOCK,
  /** 제품 라벨 사진에서 시리얼 번호 인식 — 실서버 API 없음 → false 면 사진은 보면서 직접 입력용(참고)으로만 */
  labelOcr: USE_MOCK,
} as const
