/* 역할별 메뉴 · 화면 이름 — 사이드바 메뉴명, 상단 페이지명, 브라우저 제목, 홈 제목을 이 파일 하나에서 관리한다
 *  · 홈: 로그인 후 처음 보는 역할별 업무 요약 (사이드바 첫 메뉴는 모든 역할 '홈')
 *  · 대시보드: 차트·추이·통계 분석 화면에만 쓴다 (품질 대시보드)
 * 경로는 기존 라우터 그대로. 기사(출장기사 FIELD · 센터 수리자 CENTER)는 같은 메뉴 하나를 쓴다 —
 * 메뉴는 숨기지 않고, 각 화면이 역할에 맞는 데이터만 보여 준다 (FIELD 의 수리 접수 관리 · CENTER 의 오늘의 출장은 0건) */
import type { Component } from 'vue'
import { BarChart3, ClipboardCheck, ClipboardList, History, House, List, Package, Truck, Wrench } from 'lucide-vue-next'
import type { Role, TechnicianType } from '@/types'

/** 메뉴 구분: 기사는 FIELD / CENTER, 그 외는 역할 그대로 */
export type MenuRole = TechnicianType | Exclude<Role, 'TECHNICIAN'>

export const menuRoleOf = (role: Role | null | undefined, technicianType?: TechnicianType | null): MenuRole | null =>
  !role ? null : role === 'TECHNICIAN' ? (technicianType ?? 'CENTER') : role

export interface MenuItem {
  /** 활성 판단 키 (라우트 meta.nav 와 같은 값) */
  key: string
  label: string
  to: string
  icon: Component
}

/** 화면 이름 (메뉴 · 상단 페이지명 · 브라우저 제목 공통) */
export const PAGE_LABEL = {
  home: '홈',
  field: '오늘의 출장',
  repairIntake: '수리 접수 관리',
  work: '수리 작업',
  techParts: '부품 관리',
  history: '수리 이력',
  repairList: '수리 목록',
  orderApprovals: '발주 승인',
  qmParts: '부품 및 재고',
  qualityDashboard: '품질 대시보드',
} as const

const HOME: MenuItem = { key: 'home', label: PAGE_LABEL.home, to: '/', icon: House }

/** 기사 공통 메뉴 (출장기사 · 센터 수리자 동일 — 이름 · 순서 · 아이콘 모두 같다) */
const TECHNICIAN_MENU: MenuItem[] = [
  HOME,
  { key: 'field', label: PAGE_LABEL.field, to: '/field/schedule', icon: Truck },
  { key: 'repairs', label: PAGE_LABEL.repairIntake, to: '/repairs', icon: ClipboardList },
  { key: 'work', label: PAGE_LABEL.work, to: '/work', icon: Wrench },
  { key: 'parts', label: PAGE_LABEL.techParts, to: '/parts', icon: Package },
  { key: 'history', label: PAGE_LABEL.history, to: '/history', icon: History },
]

export const menuByRole: Record<MenuRole, MenuItem[]> = {
  FIELD: TECHNICIAN_MENU,
  CENTER: TECHNICIAN_MENU,
  QUALITY_MANAGER: [
    HOME,
    { key: 'repairs', label: PAGE_LABEL.repairList, to: '/repairs', icon: List },
    { key: 'order-approvals', label: PAGE_LABEL.orderApprovals, to: '/order-approvals', icon: ClipboardCheck },
    { key: 'parts', label: PAGE_LABEL.qmParts, to: '/parts', icon: Package },
    { key: 'dashboard', label: PAGE_LABEL.qualityDashboard, to: '/dashboard', icon: BarChart3 },
  ],
}

/** 역할마다 이름이 다른 화면 (경로는 같음): 라우트 이름 → 역할별 이름. 없으면 라우트 meta.title */
export const TITLE_BY_ROLE: Record<string, Partial<Record<MenuRole, string>>> = {
  repairs: { FIELD: PAGE_LABEL.repairIntake, CENTER: PAGE_LABEL.repairIntake, QUALITY_MANAGER: PAGE_LABEL.repairList },
  parts: { FIELD: PAGE_LABEL.techParts, CENTER: PAGE_LABEL.techParts, QUALITY_MANAGER: PAGE_LABEL.qmParts },
}

/** 홈 화면 본문 제목·부제 (사이드바·상단바는 '홈', 본문은 역할의 주요 업무) */
export const HOME_HEADING: Record<MenuRole, { title: string; sub: string }> = {
  FIELD: { title: '오늘의 출장', sub: '방문 전 AI 진단과 필요한 부품을 확인하세요.' },
  CENTER: { title: '오늘 처리할 수리', sub: '진단 결과를 확인하고 수리 작업을 진행하세요.' },
  QUALITY_MANAGER: { title: '품질 업무 현황', sub: '발주 승인과 주요 고장 현황을 확인하세요.' },
}

/** 현재 화면 이름 (상단 페이지명 · 브라우저 제목) */
export function pageTitleFor(routeName: unknown, metaTitle: string | undefined, role: MenuRole | null): string {
  return (role && TITLE_BY_ROLE[String(routeName)]?.[role]) || metaTitle || ''
}
