import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { errorMessage } from '@/constants/errors'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
/** 백엔드 origin. 개발 서버는 Vite 프록시(/api)를 쓰므로 기본값 '' (같은 origin) */
export const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
export const API_BASE = `${API_ORIGIN}/api`

/** 화면에서 일관되게 다루는 오류 형식 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/* =========================================================================
 * 인증: 세션 쿠키(JSESSIONID, HttpOnly) + CSRF 토큰. 브라우저 저장소에 토큰을 두지 않는다.
 * CSRF 토큰은 메모리에만 보관하고 POST/PUT/PATCH/DELETE 에 자동 첨부한다.
 * ========================================================================= */
export const http = axios.create({
  baseURL: API_BASE,
  timeout: 15_000,
  withCredentials: true,
})

interface Csrf {
  headerName: string
  token: string
}
let csrf: Csrf | null = null
let csrfLoading: Promise<Csrf> | null = null

/** GET /api/auth/csrf — 세션 쿠키와 함께 새 토큰을 받아 메모리에 보관 */
export function refreshCsrf(): Promise<Csrf> {
  csrfLoading ??= http
    .get<Csrf>('/auth/csrf', { skipAuthExpired: true })
    .then((res) => (csrf = res.data))
    .finally(() => (csrfLoading = null))
  return csrfLoading
}
export function clearCsrf() {
  csrf = null
}

const UNSAFE = ['post', 'put', 'patch', 'delete']

declare module 'axios' {
  interface AxiosRequestConfig {
    /** 401 이어도 전역 로그아웃(auth:expired)을 보내지 않음 (로그인·세션 확인용) */
    skipAuthExpired?: boolean
    /** CSRF 재조회 후 재시도한 요청 표시 (무한 재시도 방지) */
    _csrfRetried?: boolean
  }
}

http.interceptors.request.use(async (config) => {
  if (UNSAFE.includes((config.method ?? 'get').toLowerCase())) {
    const c = csrf ?? (await refreshCsrf())
    config.headers.set(c.headerName || 'X-CSRF-TOKEN', c.token)
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<{ code?: string; status?: number; message?: string }>) => {
    const status = err.response?.status ?? 0
    const code = err.response?.data?.code
    const config = err.config as InternalAxiosRequestConfig | undefined

    // CSRF 토큰 만료 가능성 → 한 번만 재조회 후 재시도
    if (status === 403 && code === 'FORBIDDEN_OR_CSRF' && config && !config._csrfRetried) {
      config._csrfRetried = true
      try {
        await refreshCsrf()
        return await http.request(config)
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
    }

    if (status === 403 && code === 'FORBIDDEN') window.dispatchEvent(new CustomEvent('auth:forbidden'))

    if (status === 401 && !config?.skipAuthExpired) window.dispatchEvent(new CustomEvent('auth:expired'))
    return Promise.reject(new ApiError(status, errorMessage(code, status), code))
  },
)

/** Mock 응답에 네트워크 지연을 흉내 냄 */
export async function mockDelay<T>(fn: () => T, ms = 350): Promise<T> {
  await new Promise((r) => setTimeout(r, ms + Math.random() * 250))
  const res = fn()
  // 실서버처럼 응답을 "복사본"으로 돌려줌 (Vue Proxy 도 안전하게 직렬화)
  return res === undefined ? res : (JSON.parse(JSON.stringify(res)) as T)
}

export function toErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return '알 수 없는 오류가 발생했습니다.'
}
