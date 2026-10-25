import { ApiError, clearCsrf, http, mockDelay, refreshCsrf, USE_MOCK } from './http'
import { FEATURES } from './features'
import * as mock from '@/mocks/handlers'
import type { LoginRequest, MeResponse, SignupRequest } from '@/types/api'
import type { User } from '@/types'

/** GET /api/auth/me 응답 → 화면용 User */
function toUser(me: MeResponse): User {
  return {
    id: me.id,
    email: me.email,
    employeeId: me.email,
    name: me.name,
    role: me.role,
    centerId: me.centerId,
    branch: me.centerId ? `서비스센터 #${me.centerId}` : '본사',
    // 기사 유형은 로그인 응답(/auth/me) 값을 그대로 사용 (없으면 스토어에서 CENTER 로 취급)
    technicianType: me.technicianType,
  }
}

export const authApi = {
  /**
   * 로그인
   *  Mock: 사번·비밀번호 확인
   *  실서버: ① GET /auth/csrf → ② POST /auth/login (form-urlencoded, CSRF 헤더) → ③ CSRF 재조회 → ④ GET /auth/me
   */
  async login(req: LoginRequest): Promise<User> {
    if (USE_MOCK) return (await mockDelay(() => mock.login(req), 500)).user
    await refreshCsrf()
    await http.post('/auth/login', new URLSearchParams({ username: req.username.trim(), password: req.password }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      skipAuthExpired: true,
    })
    // 로그인하면 세션이 바뀌므로 CSRF 토큰도 새로 받는다
    await refreshCsrf()
    return this.me() as Promise<User>
  },

  /**
   * 회원가입 — 담당 역할(TECHNICIAN · QUALITY_MANAGER)을 함께 저장한다.
   *  실서버: 아직 API 없음 (경로는 백엔드 확정 후 맞출 것). 서버는 요청한 역할을 그대로 믿지 말고 검증·승인해야 한다.
   */
  async signup(req: SignupRequest): Promise<void> {
    if (USE_MOCK) return mockDelay(() => mock.signup(req), 600)
    if (!FEATURES.signup) throw new ApiError(501, '회원가입은 아직 지원하지 않습니다. 관리자에게 계정 발급을 요청해 주세요.', 'NOT_SUPPORTED')
    await refreshCsrf()
    await http.post('/auth/signup', { ...req, username: req.username.trim(), name: req.name.trim() }, { skipAuthExpired: true })
  },

  /** GET /api/auth/me — 세션이 없으면(401) null */
  async me(): Promise<User | null> {
    if (USE_MOCK) return null
    try {
      return toUser((await http.get<MeResponse>('/auth/me', { skipAuthExpired: true })).data)
    } catch (e) {
      if ((e as { status?: number }).status === 401) return null
      throw e
    }
  },

  /** Mock 모드에서 새로고침 후 세션 복원 (예전에 저장된 정보에 없는 필드는 계정 정보로 채움) */
  restore(user: User | null): User | null {
    if (!USE_MOCK) return user
    const fresh = user ? (mock.findMockUser(user.employeeId) ?? user) : null
    mock.setMockUser(fresh)
    return fresh
  },

  /** POST /api/auth/logout (CSRF 헤더 자동 첨부) */
  async logout() {
    if (USE_MOCK) return mock.setMockUser(null)
    await http.post('/auth/logout', null, { skipAuthExpired: true }).catch(() => undefined)
    clearCsrf()
  },
}
