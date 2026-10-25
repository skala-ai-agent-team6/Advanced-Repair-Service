<script setup lang="ts">
/* =========================================================================
 * 직원 공통 사이드바 (기사 · 본사 품질 담당자 같은 컴포넌트, 역할별 메뉴 데이터만 다름)
 *  - 기본: 아이콘만 (88px) · Hover / 키보드 포커스 / 메뉴 버튼(open) 이면 펼침 (228px)
 *  - 펼친 상태: 로고 전체 · "고장 진단 지원 시스템" · 메뉴명 · 건수 · 하단 저작권 표기
 *  - 활성 메뉴는 라우터 경로로만 판단 (Hover 로 바뀌지 않음)
 *  펼침 상태는 CSS 변수 --open(0 접힘 · 1 펼침) 하나로 정하고, 폭·글자·배지·로고가 그 값을 따른다
 *    · 1200px 이상 + 마우스: Hover 로 펼침
 *    · 768px 이상: 키보드 포커스(:focus-within) · 메뉴 버튼(open) 으로 펼침
 *    · 767px 이하: 화면 밖에 숨겼다가 메뉴 버튼으로 오버레이 (AppLayout 이 바깥 어둡게 · 닫기 처리)
 * ========================================================================= */
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppLogo from '@/components/common/AppLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useRepairListStore } from '@/stores/repairs'
import { useOrderStore } from '@/stores/orders'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { menuRoleOf, menuByRole, PAGE_LABEL } from '@/constants/menus'

defineProps<{ open?: boolean }>()
const emit = defineEmits<{ navigate: [] }>()
const auth = useAuthStore()
const route = useRoute()
const list = useRepairListStore()
const orders = useOrderStore()

const field = useFieldVisits()
onMounted(() => {
  if (auth.role === 'TECHNICIAN' && !list.loadedAt) void list.fetch()
  // 오늘의 출장 건수 (출장기사만 불러옴 · 센터 수리자는 0건)
  if (auth.role === 'TECHNICIAN' && !field.visits.value.length) void field.load()
  if (auth.role === 'QUALITY_MANAGER' && !orders.orders.length && !orders.loading) void orders.fetchAll()
})

/** 역할별 메뉴는 constants/menus 하나에서 관리 — 여기서는 처리 건수 배지만 붙인다 (0 이면 숨김) */
const menuRole = computed(() => menuRoleOf(auth.role, auth.technicianType))
const BADGE: Record<string, () => number> = {
  'order-approvals': () => orders.pendingApproval.length,
  // 오늘 남은 방문 (방문 완료 제외) — 센터 수리자는 출장 배정이 없어 0 → 배지 숨김
  field: () => (auth.role === 'TECHNICIAN' ? field.todayVisits.value.filter((v) => v.visitStatus !== 'DONE').length : 0),
  repairs: () => (auth.role === 'TECHNICIAN' ? list.counts.needPhoto + list.counts.technicianReview + list.counts.reportPending : 0),
}
const items = computed(() => (menuRole.value ? menuByRole[menuRole.value] : []).map((i) => ({ ...i, badge: BADGE[i.key]?.() ?? 0 })))

/** 기사: 수리 건 화면(진행·진단 리포트·리포트)은 '수리 작업', 신규 접수는 '수리 접수 관리' */
const WORK_ROUTES = ['work', 'repair-progress', 'repair-diagnosis', 'repair-review']
const activeKey = computed(() => {
  const n = String(route.name)
  if (auth.role === 'TECHNICIAN') {
    if (WORK_ROUTES.includes(n)) return 'work'
    if (n === 'repairs' || n === 'repair-new') return 'repairs'
  }
  return route.meta.nav
})

/** 마우스로 누른 뒤에는 포커스를 풀어 :focus-within 때문에 펼친 채 남지 않게 (키보드 Enter 는 유지) */
function onNavigate(e: MouseEvent) {
  if (e.detail > 0) (e.currentTarget as HTMLElement).blur()
  emit('navigate')
}
</script>

<template>
  <aside class="app-sidebar" :class="{ 'is-open': open }" aria-label="주 메뉴">
    <RouterLink to="/" class="sb-brand" :aria-label="`${PAGE_LABEL.home}으로 이동`" @click="onNavigate">
      <AppLogo class="sb-logo" :height="28" />
      <small class="sidebar-label sb-sub">고장 진단 지원 시스템</small>
    </RouterLink>

    <nav class="sb-nav">
      <RouterLink
        v-for="i in items"
        :key="i.key"
        :to="i.to"
        class="sb-item"
        :class="{ active: activeKey === i.key }"
        :aria-current="activeKey === i.key ? 'page' : undefined"
        :aria-label="i.badge ? `${i.label}, 처리 필요 ${i.badge}건` : i.label"
        @click="onNavigate"
      >
        <span class="sb-ic">
          <component :is="i.icon" :size="22" aria-hidden="true" />
          <span v-if="i.badge" class="sb-dot" aria-hidden="true">{{ i.badge }}</span>
        </span>
        <span class="sidebar-label sb-text" aria-hidden="true">{{ i.label }}</span>
        <span v-if="i.badge" class="sidebar-label sb-count" aria-hidden="true">{{ i.badge }}</span>
      </RouterLink>
    </nav>

    <p class="sidebar-label sb-foot">© 2026 ROVIA<br />All rights reserved.</p>
  </aside>
</template>

<style scoped>
.app-sidebar {
  --open: 0;
  --pad: 12px;
  /* 아이콘 칸 = 접힌 폭 - 좌우 여백 → 접힘·펼침 때 아이콘이 움직이지 않음 */
  --ic-w: calc(var(--sidebar-collapsed-w) - var(--pad) * 2);
  width: calc(var(--sidebar-collapsed-w) + (var(--sidebar-w) - var(--sidebar-collapsed-w)) * var(--open));
  transition: width var(--sidebar-dur) ease;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 0 var(--pad) 14px;
}

/* 로고: 상단바와 같은 높이 → 아래 구분선이 상단바 아래 선과 이어짐 */
.sb-brand {
  position: relative;
  display: grid;
  align-content: center;
  height: var(--topbar-h);
  margin: 0 calc(var(--pad) * -1) 12px;
  padding: 0 var(--pad);
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  flex: none;
}
.sb-logo {
  /* 접힘: 아이콘 칸 폭에 맞춤 / 펼침: 원래 크기 */
  justify-self: start;
  max-width: calc(var(--ic-w) + (150px - var(--ic-w)) * var(--open));
  transition: max-width var(--sidebar-dur) ease;
}
.sb-logo :deep(img) {
  max-width: 100%;
  height: auto;
}
.sb-sub {
  font-size: 11px;
  color: var(--text-3);
  margin-top: calc(3px * var(--open));
  max-height: calc(16px * var(--open));
  overflow: hidden;
}
.sb-brand:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: -3px;
}

.sb-nav {
  display: grid;
  gap: 6px;
}
.sb-item {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 52px;
  border-radius: 14px;
  color: var(--text-2);
  text-decoration: none;
  font-weight: 600;
  font-size: var(--fs-md);
}
.sb-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.sb-item.active {
  background: var(--blue-50);
  color: var(--primary);
}
.sb-item:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: -3px;
}
.sb-ic {
  position: relative;
  flex: none;
  width: var(--ic-w);
  display: grid;
  place-items: center;
}
/* 접힘: 아이콘 오른쪽 위 숫자 */
.sb-dot {
  position: absolute;
  top: -9px;
  left: calc(50% + 4px);
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: #f0a33a;
  color: #2a1700;
  font-size: 11px;
  font-weight: 800;
  display: grid;
  place-items: center;
  opacity: calc(1 - var(--open));
  transition: opacity 120ms ease;
}
.sb-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
/* 펼침: 오른쪽 끝 숫자 */
.sb-count {
  margin-left: auto;
  margin-right: 12px;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: 999px;
  background: #f0a33a;
  color: #2a1700;
  font-size: var(--fs-xs);
  font-weight: 800;
  display: grid;
  place-items: center;
  flex: none;
}
/* 저작권 표기: 하단 고정 · 왼쪽 정렬 · 메뉴보다 약하게 (펼쳤을 때만 보임 — .sidebar-label) */
.sb-foot {
  margin: auto 0 0;
  padding: 12px 6px 4px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
  text-align: left;
  white-space: nowrap;
}

/* ---------- 접힘 ↔ 펼침 (글자는 opacity 로 부드럽게) ---------- */
.sidebar-label {
  opacity: var(--open);
  white-space: nowrap;
  transition: opacity 120ms ease;
}
.app-sidebar.is-open {
  --open: 1;
}
@media (min-width: 768px) {
  .app-sidebar:focus-within {
    --open: 1;
  }
}
/* 마우스가 있는 넓은 화면만 Hover 로 펼침 (768~1199px · 터치 기기는 메뉴 버튼 · 포커스) */
@media (min-width: 1200px) and (hover: hover) {
  .app-sidebar:hover {
    --open: 1;
  }
}
/* 휴대폰: 화면 밖 → 메뉴 버튼으로 펼친 상태 그대로 밀려 나옴 */
@media (max-width: 767px) {
  .app-sidebar {
    --open: 1;
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 80;
    transform: translateX(-100%);
    transition: transform var(--sidebar-dur) ease;
    box-shadow: var(--shadow-lg);
  }
  .app-sidebar.is-open {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-sidebar,
  .sidebar-label,
  .sb-dot,
  .sb-logo,
  .sb-sub {
    transition: none;
  }
}
</style>
