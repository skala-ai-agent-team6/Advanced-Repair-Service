<script setup lang="ts">
/* 홈 — 로그인 후 처음 보는 역할별 업무 요약 (통계 분석 화면은 '품질 대시보드'로 따로)
 *  제목·부제는 constants/menus 의 HOME_HEADING (사이드바·상단바는 모두 '홈')
 *  출장기사(FIELD) '오늘의 출장': 오늘의 출장 · 부품 확인 필요 · AI 진단 확인 · 방문 완료 · 오늘 방문 일정 · 다음 방문 (+ 진행률 그래프)
 *  센터 수리자(CENTER) '오늘 처리할 수리': 추가 사진 필요 · 진단 확인 대기 · 리포트 작성 대기 · 수리 완료 (+ 진행률 그래프) · 지금 처리할 일
 *    숫자는 기존 수리 목록 API 결과(counts)를 그대로 사용 (카드를 누르면 같은 상태의 수리 접수 관리)
 *  본사 품질 담당자 '품질 업무 현황': [오늘 승인 처리 현황 | 부품별 고장 TOP 5] → [발주 승인 대기 · 재고 부족 부품] → 승인이 필요한 발주 요청
 *    품질 대시보드로 가는 길은 그래프의 '전체 보기' 하나 (사이드바 메뉴는 전역 이동이라 그대로) */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardCheck, Package, ArrowRight, Camera, UserCheck, FileCheck2, CircleCheck } from 'lucide-vue-next'
import StatCard from '@/components/common/StatCard.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import TechProgressCharts from '@/components/dashboard/TechProgressCharts.vue'
import FieldTripSection from '@/components/field/FieldTripSection.vue'
import ProgressDonut from '@/components/dashboard/ProgressDonut.vue'
import PartTopCard from '@/components/dashboard/PartTopCard.vue'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { approvalProgress, centerProgress, fieldProgress } from '@/utils/techStats'
import RecentWorkList from '@/components/repair/RecentWorkList.vue'
import { useAuthStore } from '@/stores/auth'
import { useRepairListStore } from '@/stores/repairs'
import { useOrderStore } from '@/stores/orders'
import { HOME_HEADING, menuRoleOf, PAGE_LABEL } from '@/constants/menus'
import { formatRelative, repairId } from '@/utils/format'
import type { RepairStatus } from '@/types'

const auth = useAuthStore()
const list = useRepairListStore()
const orders = useOrderStore()
const router = useRouter()

const isTech = computed(() => auth.role === 'TECHNICIAN')
const isQuality = computed(() => auth.role === 'QUALITY_MANAGER')
const isField = computed(() => isTech.value && auth.technicianType === 'FIELD')
const heading = computed(() => {
  const r = menuRoleOf(auth.role, auth.technicianType)
  return r ? HOME_HEADING[r] : { title: PAGE_LABEL.home, sub: '' }
})

onMounted(() => {
  if (isTech.value) {
    list.resetQuery()
    void list.fetch()
    list.startLive()
  }
  // 기사: 부품 대기 계산용 발주 목록 / 품질 담당자: 발주 승인 대기
  void orders.fetchAll()
})
onBeforeUnmount(() => list.stopLive())

/* ---------- 센터 수리자 홈: 처리 단계별 건수 (수리 목록 API 의 counts) ---------- */
const centerCards = computed(() => [
  { key: 'needPhoto', label: '추가 사진 필요', value: list.counts.needPhoto, icon: Camera, tone: 'warning' as const, query: { status: 'ADDITIONAL_INFO_NEEDED' } },
  { key: 'review', label: '진단 확인 대기', value: list.counts.technicianReview, icon: UserCheck, tone: 'ai' as const, query: { status: 'DIAGNOSIS_COMPLETED' } },
  { key: 'report', label: '리포트 작성 대기', value: list.counts.reportPending, icon: FileCheck2, tone: 'warning' as const, query: { status: 'TECHNICIAN_REVIEW' } },
  { key: 'done', label: '수리 완료', value: list.counts.completed, icon: CircleCheck, tone: 'success' as const, query: { group: 'DONE' } },
])
/** 지금 처리할 일: 기사가 손대야 하는 상태만, 최근에 바뀐 순 */
const ACTION_STATUSES: RepairStatus[] = ['ADDITIONAL_INFO_NEEDED', 'DIAGNOSIS_COMPLETED', 'TECHNICIAN_REVIEW']
const todo = computed(() => list.items.filter((r) => ACTION_STATUSES.includes(r.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6))
/* ---------- 진행률 (역할별 제목·계산, 한국 시간 기준) ---------- */
const field = useFieldVisits()
const progress = computed(() => {
  if (auth.technicianType === 'FIELD') return { title: '오늘 출장 완료', ...fieldProgress(field.todayVisits.value, list.items) }
  return { title: '오늘 수리 처리 현황', ...centerProgress(list.items, auth.user) }
})
/** 품질 담당자: 오늘 승인 처리 현황 */
const approval = computed(() => ({ title: '오늘 승인 처리 현황', ...approvalProgress(orders.orders) }))

const lowStock = computed(() => orders.parts.filter((p) => p.stocks.reduce((a, s) => a + s.quantity, 0) < 3))
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ heading.title }}</h1>
        <p class="sub">{{ heading.sub }}</p>
      </div>
    </div>

    <!-- ===== 출장기사 홈: 오늘의 출장 ===== -->
    <template v-if="isField">
      <FieldTripSection />
      <TechProgressCharts :items="list.items" :user="auth.user" :loading="list.loading || field.loading.value" :progress="progress" />
    </template>

    <!-- ===== 센터 수리자 홈: 오늘 처리할 수리 ===== -->
    <template v-else-if="isTech">
      <div class="grid-4">
        <StatCard
          v-for="c in centerCards"
          :key="c.key"
          :label="c.label"
          :value="list.loading && !list.items.length ? '–' : c.value"
          :icon="c.icon"
          :tone="c.tone"
          @select="router.push({ path: '/repairs', query: c.query })"
        />
      </div>
      <TechProgressCharts :items="list.items" :user="auth.user" :loading="list.loading" :progress="progress" />
      <section class="card">
        <div class="card-head">
          <h2>지금 처리할 일</h2>
          <RouterLink to="/repairs" class="btn btn-sm">{{ PAGE_LABEL.repairIntake }}로 이동 <ArrowRight :size="16" /></RouterLink>
        </div>
        <div v-if="list.loading && !list.items.length" class="card-body"><SkeletonBlock :lines="4" :height="44" /></div>
        <StateView v-else-if="list.error" state="error" :message="list.error" compact @retry="list.fetch()" />
        <StateView v-else-if="!todo.length" state="empty" title="지금 처리할 수리가 없습니다" compact />
        <RecentWorkList v-else :items="todo" />
      </section>
    </template>

    <!-- ===== 본사 품질 담당자 홈: 품질 업무 현황 ===== -->
    <template v-else-if="isQuality">
      <!-- 오늘 승인 처리 현황 (승인 대기 + 오늘 처리한 발주 중 처리한 비율) -->
      <div class="quality-summary-grid">
        <ProgressDonut :title="approval.title" :done="approval.done" :total="approval.total" :loading="orders.loading && !orders.orders.length" />
        <PartTopCard />
      </div>
      <div class="quality-action-grid">
        <StatCard label="발주 승인 대기" :value="orders.pendingApproval.length" :icon="ClipboardCheck" tone="warning" @select="router.push('/order-approvals')" />
        <StatCard label="재고 부족 부품" :value="lowStock.length" :icon="Package" tone="danger" @select="router.push('/parts')" />
      </div>
      <section class="card">
        <div class="card-head">
          <h2>승인이 필요한 발주 요청</h2>
          <RouterLink to="/order-approvals" class="btn btn-sm">{{ PAGE_LABEL.orderApprovals }}으로 이동 <ArrowRight :size="16" /></RouterLink>
        </div>
        <div v-if="orders.loading" class="card-body"><SkeletonBlock :lines="3" :height="44" /></div>
        <StateView v-else-if="!orders.pendingApproval.length" state="empty" title="승인이 필요한 발주 요청이 없습니다" compact />
        <ul v-else class="todo">
          <li v-for="o in orders.pendingApproval" :key="o.id">
            <RouterLink to="/order-approvals" class="todo-item">
              <span class="badge tone-warning">승인 대기</span>
              <span class="t-main">
                <strong>{{ o.partName }} ({{ o.partNo }}) · {{ o.quantity }}개</strong>
                <span class="faint">수리 {{ repairId(o.repairId) }} · {{ o.fromWarehouse }} · 요청 {{ o.requestedBy }}</span>
              </span>
              <span class="faint t-time">{{ formatRelative(o.requestedAt) }}</span>
              <ArrowRight :size="20" />
            </RouterLink>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* ---------- 본사 품질 담당자 ---------- */
/* 승인 처리 현황 : 부품별 고장 그래프 = 4 : 8, 두 카드 높이 같게 */
.quality-summary-grid {
  display: grid;
  grid-template-columns: minmax(320px, 4fr) minmax(560px, 8fr);
  gap: var(--gap);
  align-items: stretch;
}
.quality-summary-grid > .card,
.quality-summary-grid > :deep(.card) {
  height: 270px;
  min-width: 0;
}
/* 도넛은 카드 높이 안에서 남는 공간을 채움 (기사 화면의 도넛 카드는 그대로) */
.quality-summary-grid > :deep(.donut-card) {
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.quality-summary-grid :deep(.donut-wrap) {
  height: auto;
  min-height: 0;
}
/* 요약 카드 3개: 같은 너비 · 높이 · 안쪽 여백 */
.quality-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
}
.quality-action-grid > * {
  min-height: 112px;
}
@media (max-width: 1199px) {
  .quality-summary-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .quality-action-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
}
@media (max-width: 767px) {
  .quality-summary-grid > .card,
  .quality-summary-grid > :deep(.card) {
    height: 240px;
  }
  .quality-action-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.todo {
  list-style: none;
  margin: 0;
  padding: 6px 10px 10px;
  display: grid;
}
.todo-item {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 16px;
  padding: 14px 12px;
  border-radius: var(--radius);
  text-decoration: none;
  color: var(--text);
  min-height: 64px;
}
.todo-item:hover {
  background: var(--navy-50);
}
.todo li + li .todo-item {
  border-top: 1px solid var(--border);
}
.t-main {
  display: grid;
  min-width: 0;
}
.t-main .faint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-time {
  white-space: nowrap;
}
@media (max-width: 700px) {
  .todo-item {
    grid-template-columns: 1fr auto;
  }
  .todo-item > .badge,
  .t-time {
    display: none;
  }
}
</style>
