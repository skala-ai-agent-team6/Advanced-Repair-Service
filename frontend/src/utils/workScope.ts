/* 기사 업무 범위 (출장기사 FIELD / 센터 수리자 CENTER) — 목록·상세·홈이 같은 기준을 쓴다.
 *  - 품질 담당자: 전체
 *  - 기사: 자신에게 배정된 건만 (담당 기사 ID = 사번 또는 사용자 id)
 *  - 센터 수리 목록(수리 접수 관리와 그 숫자를 쓰는 홈·이력 검색): CENTER 만. FIELD 는 0건
 *  - 출장 일정(오늘의 출장): FIELD 만 (useFieldVisits · 출장 API). CENTER 는 0건
 * Mock 데이터 출처(handlers)와 실서버 API 레이어(repairs.ts)에서 이 함수로 거른다. */
import type { Role, TechnicianType } from '@/types'

export interface WorkScope {
  role: Role
  employeeId: string
  id?: string
  technicianType?: TechnicianType | null
}

/** 로그인 사용자 범위 — 실서버 API 레이어용 (auth 스토어가 로그인·복원·로그아웃 때 설정) */
let current: WorkScope | null = null
export const setWorkScope = (s: WorkScope | null) => (current = s)
export const getWorkScope = () => current

const typeOf = (s: WorkScope) => s.technicianType ?? 'CENTER'

/** 이 기사에게 배정된 건인지 */
export function isAssigned(technicianId: string | number | undefined, s: WorkScope): boolean {
  if (technicianId === undefined || technicianId === '') return false
  return [s.employeeId, s.id].filter(Boolean).includes(String(technicianId))
}

/** 상세 화면에서 볼 수 있는지 (기사는 자기 담당 건만) */
export function canViewRepair(r: { technicianId?: string | number }, s: WorkScope | null): boolean {
  if (!s || s.role !== 'TECHNICIAN') return true
  return isAssigned(r.technicianId, s)
}

/** 목록 범위: center = 센터 수리 목록(수리 접수 관리), assigned = 배정된 모든 건(수리 작업 · 수리 이력) */
export function inListScope(r: { technicianId?: string | number }, s: WorkScope | null, scope: 'center' | 'assigned' = 'center'): boolean {
  return scope === 'assigned' ? canViewRepair(r, s) : inCenterList(r, s)
}

/** 센터 수리 목록에 들어가는지 (FIELD 는 항상 아니오) */
export function inCenterList(r: { technicianId?: string | number }, s: WorkScope | null): boolean {
  if (!s || s.role !== 'TECHNICIAN') return true
  return typeOf(s) === 'CENTER' && isAssigned(r.technicianId, s)
}
