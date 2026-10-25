/* 사내 사례 동기화(US-08) · 자동 재처리 상태(US-10)
 *  실서버에 API 가 없다 → FEATURES.caseSync / FEATURES.retryStatus 가 false 면 화면이 카드를 숨기고 이 함수를 부르지 않는다.
 *  (혹시 불려도 요청을 보내지 않고 501 을 던진다. 백엔드 경로가 정해지면 여기만 채우면 된다) */
import { ApiError, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import type { CaseSync, RetryRecord } from '@/types'

const notSupported = (what: string) => new ApiError(501, `${what}은(는) 아직 백엔드에서 지원하지 않습니다.`, 'NOT_SUPPORTED')

/** 확정 리포트의 사내 사례 동기화 상태. 확정본이 없으면 null */
export async function getCaseSync(repairId: number): Promise<CaseSync | null> {
  if (USE_MOCK && FEATURES.caseSync) return mockDelay(() => mock.getCaseSync(repairId), 250)
  throw notSupported('사내 사례 동기화 조회')
}

/** 이 수리 건의 자동 재처리 기록 (없으면 빈 배열) */
export async function getRetryRecords(repairId: number): Promise<RetryRecord[]> {
  if (USE_MOCK && FEATURES.retryStatus) return mockDelay(() => mock.getRetryRecords(repairId), 250)
  throw notSupported('재처리 상태 조회')
}
