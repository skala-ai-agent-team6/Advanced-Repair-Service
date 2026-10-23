/* 출장 일정 (출장기사 FIELD)
 *  Mock: 로그인한 기사에게 배정된 오늘 이후 방문 일정
 *  실서버: 아직 출장기사 배정 API 가 없음 → FEATURES.fieldSchedule 이 false 면 네트워크 호출 없이 빈 목록
 *          (경로는 백엔드 확정 후 맞출 것) */
import { http, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import { kstToday } from '@/utils/kst'
import type { FieldVisit } from '@/types'
import { toRepairStatus } from './adapters/status'
import type { BeRepairStatus } from './adapters/types'

/** 내 방문 일정 (오늘 포함 이후, 방문 시간 순) */
export async function getMyFieldVisits(): Promise<FieldVisit[]> {
  if (USE_MOCK) return mockDelay(() => mock.getMyFieldVisits(kstToday()), 300)
  if (!FEATURES.fieldSchedule) return []
  const rows = (await http.get<(Omit<FieldVisit, 'status'> & { status: BeRepairStatus })[]>('/field/visits', { params: { from: kstToday() } })).data
  // [출장] 백엔드는 repair_case 상태를 그대로 준다 → 화면 상태로 변환
  return rows.map((v) => ({ ...v, status: toRepairStatus(v.status) }))
}
