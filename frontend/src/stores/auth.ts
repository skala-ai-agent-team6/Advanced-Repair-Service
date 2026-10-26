/* 로그인 상태
 *  - 실서버: 세션 쿠키(HttpOnly)만 사용. 앱 시작 시 GET /api/auth/me 로 복원하고 브라우저 저장소에 아무것도 두지 않는다.
 *  - Mock: 서버가 없으므로 사용자 정보를 localStorage 에 두어 새로고침·새 탭에서도 유지 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { authApi } from '@/api'
import { clearCsrf, USE_MOCK } from '@/api/http'
import { ROLE_LABEL } from '@/constants/status'
import type { Role, TechnicianType, User } from '@/types'
import { setWorkScope } from '@/utils/workScope'

const MOCK_USER_KEY = 'robotcare-user'

function readMockUser(): User | null {
  if (!USE_MOCK) return null
  try {
    const u = JSON.parse(localStorage.getItem(MOCK_USER_KEY) ?? 'null') as User | null
    // 없어진 역할(QUALITY·PARTS)로 저장된 예전 로그인 정보는 무시
    return u && u.role in ROLE_LABEL ? u : null
  } catch {
    return null
  }
}
function writeMockUser(u: User | null) {
  if (!USE_MOCK) return
  try {
    if (u) localStorage.setItem(MOCK_USER_KEY, JSON.stringify(u))
    else localStorage.removeItem(MOCK_USER_KEY)
  } catch {
    /* 저장소 사용 불가 시 현재 탭에서만 유지 */
  }
}
// 예전 버전이 남긴 토큰·사용자 정보 정리 (토큰은 더 이상 브라우저에 저장하지 않음)
try {
  localStorage.removeItem('robotcare-token')
  if (!USE_MOCK) localStorage.removeItem(MOCK_USER_KEY)
} catch {
  /* noop */
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(authApi.restore(readMockUser()))
  writeMockUser(user.value)

  const isLoggedIn = computed(() => !!user.value)
  const role = computed<Role | null>(() => user.value?.role ?? null)
  /** 기사 유형 (기사가 아니면 null). 로그인 응답의 technicianType 사용, 값이 없으면 CENTER */
  const technicianType = computed<TechnicianType | null>(() => (role.value !== 'TECHNICIAN' ? null : (user.value?.technicianType ?? 'CENTER')))

  /** 앱 시작 시 한 번: 실서버면 /auth/me 로 세션 복원 (401 → 로그아웃 상태) */
  let initPromise: Promise<void> | null = null
  function init(): Promise<void> {
    initPromise ??= (async () => {
      if (USE_MOCK) return
      try {
        user.value = await authApi.me()
      } catch {
        // 서버 연결 실패 등: 로그인 화면에서 다시 시도하게 둔다
        user.value = null
      }
    })()
    return initPromise
  }

  async function login(username: string, password: string) {
    const u = await authApi.login({ username, password })
    user.value = u
    writeMockUser(u)
    return u
  }

  // 같은 브라우저의 다른 탭도 세션 쿠키를 공유한다. 화면의 계정과 달라지면
  // 다른 사용자의 화면으로 조용히 전환하지 않고 재로그인을 요구한다.
  let sessionCheck: Promise<void> | null = null
  function verifySession(): Promise<void> {
    if (USE_MOCK || !user.value) return Promise.resolve()
    const expected = user.value.employeeId
    sessionCheck ??= authApi.me().then((current) => {
      if (user.value?.employeeId !== expected) return
      if (!current || current.employeeId !== expected || current.role !== user.value.role || current.technicianType !== user.value.technicianType) {
        clearCsrf()
        window.dispatchEvent(new CustomEvent('auth:expired'))
      }
    }).catch(() => {
      // 일시적인 통신 장애만으로 로그인 상태를 삭제하지 않는다.
    }).finally(() => { sessionCheck = null })
    return sessionCheck
  }

  async function logout() {
    await authApi.logout()
    clear()
  }

  /** 서버 호출 없이 로컬 상태만 비움 (세션 만료 401 수신 시) */
  function clear() {
    user.value = null
    writeMockUser(null)
    authApi.restore(null)
  }

  const hasRole = (...roles: Role[]) => !!role.value && roles.includes(role.value)

  // 데이터 레이어가 쓰는 업무 범위 (담당 기사 ID · 기사 유형)
  watch(
    user,
    (u) => setWorkScope(u ? { role: u.role, employeeId: u.employeeId, id: u.id, technicianType: u.role === 'TECHNICIAN' ? (u.technicianType ?? 'CENTER') : null } : null),
    { immediate: true },
  )

  return { user, isLoggedIn, role, technicianType, init, login, logout, clear, hasRole, verifySession }
})
