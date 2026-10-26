import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/types'
import { homePathFor } from '@/utils/roleHome'
import { rememberRepair } from '@/utils/lastRepair'
import { menuRoleOf, PAGE_LABEL, pageTitleFor } from '@/constants/menus'
import AppLayout from '@/components/layout/AppLayout.vue'
import CustomerLayout from '@/components/layout/CustomerLayout.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    roles?: Role[]
    public?: boolean
    /** 고객(비회원) 공개 화면 — 직원 레이아웃·로그인 검사 없이 CustomerLayout 으로만 표시 */
    customer?: boolean
    nav?: string
  }
}

const ALL: Role[] = ['TECHNICIAN', 'QUALITY_MANAGER']

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: '로그인' } },
  { path: '/signup', name: 'signup', component: () => import('@/views/SignupView.vue'), meta: { public: true, title: '회원가입' } },
  // ===== 고객(비회원) 공개 화면 — 직원용 AppLayout 과 분리된 CustomerLayout =====
  {
    path: '/service',
    component: CustomerLayout,
    meta: { public: true, customer: true },
    children: [
      { path: '', name: 'service-home', component: () => import('@/views/service/ServiceHomeView.vue'), meta: { public: true, customer: true, title: '고객 서비스' } },
      { path: 'request', name: 'service-request', component: () => import('@/views/service/ServiceRequestView.vue'), meta: { public: true, customer: true, title: '고장 접수' } },
      { path: 'request/complete', name: 'service-request-complete', component: () => import('@/views/service/ServiceRequestCompleteView.vue'), meta: { public: true, customer: true, title: '접수 완료' } },
      { path: 'track', name: 'service-track', component: () => import('@/views/service/ServiceTrackView.vue'), meta: { public: true, customer: true, title: '접수 내역 조회' } },
      { path: 'track/:token', name: 'service-track-token', component: () => import('@/views/service/ServiceTrackView.vue'), meta: { public: true, customer: true, title: '접수 내역 조회' } },
    ],
  },
  // 예전 조회 주소 호환
  { path: '/track', redirect: '/service/track' },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { title: PAGE_LABEL.home, roles: ALL, nav: 'home' } },
      { path: 'repairs', name: 'repairs', component: () => import('@/views/RepairListView.vue'), meta: { title: PAGE_LABEL.repairList, roles: ['TECHNICIAN', 'QUALITY_MANAGER'], nav: 'repairs' } },
      { path: 'repairs/new', name: 'repair-new', component: () => import('@/views/RepairCreateView.vue'), meta: { title: '신규 수리 접수', roles: ['TECHNICIAN'], nav: 'repair-new' } },
      { path: 'repairs/:id(\\d+)', redirect: (to) => `/repairs/${to.params.id}/diagnosis` },
      { path: 'repairs/:id(\\d+)/progress', name: 'repair-progress', component: () => import('@/views/RepairProgressView.vue'), meta: { title: '진단 진행', roles: ALL, nav: 'repairs' } },
      { path: 'repairs/:id(\\d+)/diagnosis', name: 'repair-diagnosis', component: () => import('@/views/DiagnosisResultView.vue'), meta: { title: 'AI 진단 결과', roles: ALL, nav: 'repairs' } },
      // 부품·발주는 진단 노트 2쪽으로 합쳐짐 (기존 링크 호환용 리다이렉트)
      { path: 'repairs/:id(\\d+)/parts', name: 'repair-parts', redirect: (to) => ({ path: `/repairs/${to.params.id}/diagnosis`, query: { page: '2' } }) },
      { path: 'repairs/:id(\\d+)/review', name: 'repair-review', component: () => import('@/views/TechnicianReviewView.vue'), meta: { title: '수리 리포트', roles: ALL, nav: 'repairs' } },
      { path: 'approvals/:id(\\d+)', name: 'approval-detail', component: () => import('@/views/ApprovalDetailView.vue'), meta: { title: '본사 수동 검토', roles: ['QUALITY_MANAGER'], nav: 'repairs' } },
      { path: 'parts', name: 'parts', component: () => import('@/views/PartsOrderView.vue'), meta: { title: PAGE_LABEL.qmParts, roles: ['TECHNICIAN', 'QUALITY_MANAGER'], nav: 'parts' } },
      { path: 'order-approvals', name: 'order-approvals', component: () => import('@/views/PartsOrderView.vue'), props: { pendingOnly: true }, meta: { title: PAGE_LABEL.orderApprovals, roles: ['QUALITY_MANAGER'], nav: 'order-approvals' } },
      // 기사 화면: 오늘의 출장 · 수리 작업(작업 고르기) · 수리 이력 · 기술 자료(메뉴에는 없음, 경로 유지) — 메뉴 구성은 constants/menus
      { path: 'field/schedule', name: 'field-schedule', component: () => import('@/views/FieldScheduleView.vue'), meta: { title: PAGE_LABEL.field, roles: ['TECHNICIAN'], nav: 'field' } },
      { path: 'work', name: 'work', component: () => import('@/views/WorkPickerView.vue'), meta: { title: PAGE_LABEL.work, roles: ['TECHNICIAN'], nav: 'work' } },
      { path: 'history', name: 'repair-history', component: () => import('@/views/RepairHistoryView.vue'), meta: { title: PAGE_LABEL.history, roles: ['TECHNICIAN'], nav: 'history' } },
      { path: 'docs', name: 'tech-docs', component: () => import('@/views/TechDocsView.vue'), meta: { title: '기술 자료', roles: ['TECHNICIAN'], nav: 'docs' } },
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: PAGE_LABEL.qualityDashboard, roles: ['QUALITY_MANAGER'], nav: 'dashboard' } },
      { path: 'forbidden', name: 'forbidden', component: () => import('@/views/ErrorView.vue'), props: { code: 403 }, meta: { title: '권한 없음', roles: ALL } },
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/views/ErrorView.vue'), props: { code: 404 }, meta: { title: '페이지 없음', roles: ALL } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  // 고객 공개 화면: 로그인·직원 역할 검사 없이 바로 (세션 확인 호출도 하지 않아 로그인 상태를 건드리지 않음)
  if (to.meta.customer) return true
  const auth = useAuthStore()
  // 실서버: 첫 이동 전에 GET /api/auth/me 로 세션 복원 (Mock 은 즉시 완료)
  await auth.init()
  // 로그인한 사용자가 로그인·회원가입 화면에 오면 역할별 첫 화면으로
  if (to.meta.public) return auth.isLoggedIn && (to.name === 'login' || to.name === 'signup') ? homePathFor(auth.role) : true
  if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.roles && !auth.hasRole(...to.meta.roles)) return { name: 'forbidden' }
  return true
})

router.afterEach((to) => {
  // 수리 건 화면을 열면 기억 (기사 메뉴 '수리 작업'의 이어서 보기)
  if (typeof to.params.id === 'string' && String(to.name).startsWith('repair-')) rememberRepair(Number(to.params.id))
  const auth = useAuthStore()
  document.title = `${pageTitleFor(to.name, to.meta.title, to.meta.customer ? null : menuRoleOf(auth.role, auth.technicianType))} · 수리들어간다`
})

// 세션 만료(401): 서버 로그아웃 호출 없이 로컬 상태만 비우고 로그인 화면으로
window.addEventListener('auth:expired', () => {
  useAuthStore().clear()
  const cur = router.currentRoute.value
  // 공개 화면(로그인·고객 화면)에서는 로그인 화면으로 보내지 않음
  if (cur.meta.public) return
  void router.push({ name: 'login', query: { redirect: cur.fullPath } })
})

// 다른 탭 로그인·로그아웃 후 돌아왔거나 권한 오류를 받으면 서버 세션과 대조한다.
window.addEventListener('focus', () => { void useAuthStore().verifySession() })
window.addEventListener('auth:forbidden', () => { void useAuthStore().verifySession() })

export default router
