/* 로그인 후 이동 경로 — 화면에서 역할을 고르지 않고, 로그인 응답(서버)의 사용자 역할로만 정한다.
 * Mock·실서버 모두 auth.login() 이 돌려준 user.role 로 이 함수를 거친다. */
import type { Router } from 'vue-router'
import type { Role } from '@/types'

/** 역할별 첫 화면. 기사·본사 품질 담당자는 같은 홈('/')에서 역할에 맞는 화면이 보인다 */
export function homePathFor(role: string | null | undefined): string {
  switch (role) {
    case 'TECHNICIAN':
      return '/'
    case 'QUALITY_MANAGER':
      return '/'
    case 'CUSTOMER':
      // 고객 역할을 쓰게 되면 고객 서비스 홈으로
      return '/service'
    default:
      return '/forbidden'
  }
}

/**
 * 로그인 전에 가려던 화면(redirect)이 있고, 그 역할이 볼 수 있는 화면이면 그곳으로.
 * 외부 주소·없는 화면·권한 없는 화면이면 역할별 첫 화면으로.
 */
export function postLoginPath(router: Router, role: string | null | undefined, redirect: unknown): string {
  const home = homePathFor(role)
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) return home
  const to = router.resolve(redirect)
  if (!to.matched.length || to.name === 'not-found' || to.name === 'forbidden' || to.meta.public) return home
  const roles = to.meta.roles as Role[] | undefined
  if (roles && !roles.includes(role as Role)) return home
  return to.fullPath
}
