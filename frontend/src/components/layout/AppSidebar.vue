<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { BarChart3, BookOpen, ClipboardCheck, ClipboardList, History, House, LayoutDashboard, List, Package, PlusCircle, Truck, Wrench } from 'lucide-vue-next'
import AppLogo from '@/components/common/AppLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useRepairListStore } from '@/stores/repairs'
import { useOrderStore } from '@/stores/orders'
import type { Role } from '@/types'

defineEmits<{ navigate: [] }>()
const auth = useAuthStore()
const route = useRoute()
const list = useRepairListStore()
const orders = useOrderStore()

onMounted(() => {
  if (auth.role === 'TECHNICIAN' && !list.loadedAt) void list.fetch()
  if (auth.role === 'QUALITY_MANAGER' && !orders.orders.length && !orders.loading) void orders.fetchAll()
})

const items = computed(() => {
  const all: { key: string; label: string; to: string; icon: unknown; roles: Role[]; count?: number }[] = [
    { key: 'home', label: '홈', to: '/', icon: House, roles: ['TECHNICIAN', 'QUALITY_MANAGER'] },
    { key: 'repair-new', label: '수리 접수', to: '/repairs/new', icon: PlusCircle, roles: ['TECHNICIAN'] },
    { key: 'repairs', label: '수리 목록', to: '/repairs', icon: List, roles: ['TECHNICIAN', 'QUALITY_MANAGER'], count: auth.role === 'TECHNICIAN' ? list.counts.needPhoto + list.counts.technicianReview + list.counts.reportPending : undefined },
    { key: 'order-approvals', label: '발주 승인 대기', to: '/order-approvals', icon: ClipboardCheck, roles: ['QUALITY_MANAGER'], count: orders.pendingApproval.length },
    { key: 'parts', label: '부품 및 발주', to: '/parts', icon: Package, roles: ['TECHNICIAN', 'QUALITY_MANAGER'] },
    { key: 'dashboard', label: '품질 대시보드', to: '/dashboard', icon: BarChart3, roles: ['QUALITY_MANAGER'] },
  ]
  return all.filter((i) => auth.hasRole(...i.roles))
})

/* ---------- 기사(출장·센터 동일): 아이콘 위 · 글자 아래 세로 메뉴 ---------- */
const isTech = computed(() => auth.role === 'TECHNICIAN')
const techItems = computed(() => [
  { key: 'home', label: '대시보드', to: '/', icon: LayoutDashboard },
  { key: 'field', label: '오늘의 출장', to: '/field/schedule', icon: Truck },
  { key: 'repairs', label: '수리 접수 관리', to: '/repairs', icon: ClipboardList, count: list.counts.needPhoto + list.counts.technicianReview + list.counts.reportPending },
  { key: 'work', label: '수리 작업 상세', to: '/work', icon: Wrench },
  { key: 'parts', label: '부품 관리', to: '/parts', icon: Package },
  { key: 'history', label: '수리 이력', to: '/history', icon: History },
  { key: 'docs', label: '기술 자료', to: '/docs', icon: BookOpen },
])
/** 수리 건 화면(진행·진단 리포트·리포트)은 '수리 작업 상세', 신규 접수는 '수리 접수 관리'로 표시 */
const WORK_ROUTES = ['work', 'repair-progress', 'repair-diagnosis', 'repair-review']
const techActive = computed(() => {
  const n = String(route.name)
  if (WORK_ROUTES.includes(n)) return 'work'
  if (n === 'repairs' || n === 'repair-new') return 'repairs'
  return route.meta.nav
})
</script>

<template>
  <aside v-if="isTech" class="rail" aria-label="주 메뉴">
    <!-- 로고: 사이드바 맨 위 (누르면 대시보드) -->
    <RouterLink to="/" class="rail-logo" aria-label="대시보드로" @click="$emit('navigate')"><AppLogo :height="40" /></RouterLink>
    <nav>
      <RouterLink
        v-for="i in techItems"
        :key="i.key"
        :to="i.to"
        class="rail-item"
        :class="{ active: techActive === i.key }"
        :aria-current="techActive === i.key ? 'page' : undefined"
        @click="$emit('navigate')"
      >
        <span class="rail-ic">
          <component :is="i.icon" :size="24" aria-hidden="true" />
          <span v-if="i.count" class="rail-count" :aria-label="`처리 필요 ${i.count}건`">{{ i.count }}</span>
        </span>
        <span class="rail-label">{{ i.label }}</span>
      </RouterLink>
    </nav>
  </aside>

  <aside v-else class="sidebar" aria-label="주 메뉴">
    <RouterLink to="/" class="brand" @click="$emit('navigate')">
      <AppLogo />
      <small>고장 진단 지원 시스템</small>
    </RouterLink>
    <nav>
      <RouterLink
        v-for="i in items"
        :key="i.key"
        :to="i.to"
        class="nav-item"
        :class="{ active: route.meta.nav === i.key }"
        :aria-current="route.meta.nav === i.key ? 'page' : undefined"
        @click="$emit('navigate')"
      >
        <component :is="i.icon" :size="22" aria-hidden="true" />
        <span>{{ i.label }}</span>
        <span v-if="i.count" class="count" :aria-label="`처리 필요 ${i.count}건`">{{ i.count }}</span>
      </RouterLink>
    </nav>
    <div class="foot">
      <p>AI 결과는 초안입니다.<br />기사가 확정한 리포트만 반영됩니다.</p>
    </div>
  </aside>
</template>

<style scoped>
/* ---------- 기사용 세로 메뉴 (아이콘 위 · 글자 아래) ---------- */
.rail {
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 0 8px 14px;
  overflow-y: auto;
}
/* 로고: 너비 최대 80px(높이는 비율), 위·아래 20px 여백 + 옅은 구분선.
 * 높이를 상단바와 맞춰 구분선이 상단바 아래 선과 이어지게 */
.rail-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--topbar-h);
  padding: 20px 0;
  margin: 0 -8px 14px;
  border-bottom: 1px solid var(--border);
}
.rail-logo :deep(img) {
  max-width: 80px;
}
.rail-logo:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: -3px;
}
.rail nav {
  display: grid;
  gap: 6px;
}
.rail-item {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 12px 4px 10px;
  border-radius: 14px;
  color: var(--text-2);
  text-decoration: none;
  text-align: center;
}
.rail-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.rail-item.active {
  background: var(--blue-50);
  color: var(--primary);
}
.rail-ic {
  position: relative;
  display: grid;
  place-items: center;
}
.rail-count {
  position: absolute;
  top: -8px;
  right: -14px;
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
}
.rail-label {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  word-break: keep-all;
}

.sidebar {
  background: var(--surface);
  color: var(--text-2);
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  gap: 18px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
}
.brand {
  display: grid;
  justify-items: start;
  gap: 8px;
  text-decoration: none;
  padding: 4px 10px 16px;
  border-bottom: 1px solid var(--border);
}
.brand small {
  color: var(--text-3);
  font-size: var(--fs-xs);
}
nav {
  display: grid;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 16px;
  border-radius: var(--radius-pill);
  color: var(--text-2);
  text-decoration: none;
  font-weight: 600;
  font-size: var(--fs-md);
}
.nav-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.nav-item.active {
  background: var(--blue-50);
  color: var(--primary);
}
.count {
  margin-left: auto;
  min-width: 26px;
  height: 26px;
  padding: 0 7px;
  border-radius: 999px;
  background: #f0a33a;
  color: #2a1700;
  font-size: var(--fs-xs);
  font-weight: 800;
  display: grid;
  place-items: center;
}
.foot {
  margin-top: auto;
  font-size: var(--fs-xs);
  color: var(--text-3);
  padding: 12px 10px 4px;
  border-top: 1px solid var(--border);
  line-height: 1.6;
}
</style>
