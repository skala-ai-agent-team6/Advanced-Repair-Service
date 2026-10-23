<script setup lang="ts">
/* 홈
 *  기사: 대시보드 — 숫자 카드(오늘 접수·수리 중·부품 대기·완료, 출장 기사는 맨 앞에 오늘의 출장) + 최근 작업
 *        숫자는 기존 수리 목록·발주 목록 API 결과를 프론트에서 세어 계산 (카드를 누르면 같은 필터의 수리 접수 관리)
 *  본사 품질 담당자: 발주 승인 · 고장 통계 (기존 그대로) */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ClipboardCheck, Package, BarChart3, ArrowRight } from 'lucide-vue-next'
import StatCard from '@/components/common/StatCard.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import MetricCard from '@/components/common/MetricCard.vue'
import TechProgressCharts from '@/components/dashboard/TechProgressCharts.vue'
import FieldTripSection from '@/components/field/FieldTripSection.vue'
import ProgressDonut from '@/components/dashboard/ProgressDonut.vue'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { approvalProgress, centerProgress, fieldProgress } from '@/utils/techStats'
import RecentWorkList from '@/components/repair/RecentWorkList.vue'
import { useAuthStore } from '@/stores/auth'
import { useRepairListStore } from '@/stores/repairs'
import { useOrderStore } from '@/stores/orders'
import { ROLE_LABEL } from '@/constants/status'
import { formatRelative, repairId } from '@/utils/format'
import { matchPreset, partsWaitingIds, type RepairPreset } from '@/utils/repairPresets'

const auth = useAuthStore()
const list = useRepairListStore()
const orders = useOrderStore()
const router = useRouter()

const isTech = computed(() => auth.role === 'TECHNICIAN')
const isQuality = computed(() => auth.role === 'QUALITY_MANAGER')

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

/* ---------- 기사 대시보드 ---------- */
const waiting = computed(() => partsWaitingIds(orders.orders))
const countOf = (p: RepairPreset) => list.items.filter((r) => matchPreset(r, p, waiting.value)).length
/** 센터 수리 업무 숫자 카드 (출장 관련 숫자는 위의 오늘의 출장 영역) */
const cards: { preset: RepairPreset; label: string }[] = [
  { preset: 'TODAY', label: '오늘 접수' },
  { preset: 'IN_REPAIR', label: '수리 중' },
  { preset: 'PARTS_WAITING', label: '부품 대기' },
  { preset: 'DONE', label: '완료' },
]
function goPreset(p: RepairPreset) {
  void router.push({ path: '/repairs', query: { preset: p } })
}
/* ---------- 진행률 (역할별 제목·계산, 한국 시간 기준) ---------- */
const field = useFieldVisits()
const progress = computed(() => {
  if (auth.technicianType === 'FIELD') return { title: '오늘 출장 완료', ...fieldProgress(field.todayVisits.value, list.items) }
  return { title: '오늘 수리 처리 현황', ...centerProgress(list.items, auth.user) }
})
/** 품질 담당자: 오늘 승인 처리 현황 */
const approval = computed(() => ({ title: '오늘 승인 처리 현황', ...approvalProgress(orders.orders) }))

/** 최근 작업: 최근에 바뀐 순 */
const recentWork = computed(() => [...list.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6))
const lowStock = computed(() => orders.parts.filter((p) => p.stocks.reduce((a, s) => a + s.quantity, 0) < 3))
const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 12 ? '좋은 아침입니다' : h < 18 ? '안녕하세요' : '수고 많으셨습니다'
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ greeting }}, {{ auth.user?.name }}님</h1>
        <p class="sub">{{ auth.user?.branch }} · {{ auth.role ? ROLE_LABEL[auth.role] : '' }}</p>
      </div>
      <RouterLink v-if="isQuality" to="/dashboard" class="btn btn-lg"><BarChart3 :size="22" /> 품질 대시보드</RouterLink>
    </div>

    <!-- ===== 기사 대시보드 ===== -->
    <template v-if="isTech">
      <!-- 오늘의 출장 (출장기사·센터 수리자 같은 구조, 센터는 0건) -->
      <FieldTripSection />

      <!-- 그래프 2개 (오늘 진행률 · 이번 주 처리 건수) — 숫자 카드 위 -->
      <TechProgressCharts :items="list.items" :user="auth.user" :loading="list.loading || field.loading.value" :progress="progress" />

      <div class="metrics">
        <MetricCard
          v-for="c in cards"
          :key="c.preset"
          :label="c.label"
          :value="list.loading && !list.items.length ? '–' : countOf(c.preset)"
          @select="goPreset(c.preset)"
        />
      </div>

      <section class="card">
        <div class="card-head">
          <h2>최근 작업</h2>
          <RouterLink to="/repairs" class="btn btn-sm">전체 보기 <ArrowRight :size="16" /></RouterLink>
        </div>
        <div v-if="list.loading && !list.items.length" class="card-body"><SkeletonBlock :lines="4" :height="44" /></div>
        <StateView v-else-if="list.error" state="error" :message="list.error" compact @retry="list.fetch()" />
        <StateView v-else-if="!recentWork.length" state="empty" title="최근 작업이 없습니다" compact />
        <RecentWorkList v-else :items="recentWork" />
      </section>
    </template>

    <!-- ===== 본사 품질 담당자: 발주 승인 · 고장 통계 ===== -->
    <template v-else-if="isQuality">
      <!-- 오늘 승인 처리 현황 (승인 대기 + 오늘 처리한 발주 중 처리한 비율) -->
      <ProgressDonut class="qm-progress" :title="approval.title" :done="approval.done" :total="approval.total" :loading="orders.loading && !orders.orders.length" />
      <div class="grid-3">
        <StatCard label="발주 승인 대기" :value="orders.pendingApproval.length" :icon="ClipboardCheck" tone="warning" hint="기사가 요청한 발주" @select="router.push('/order-approvals')" />
        <StatCard label="재고 부족 부품" :value="lowStock.length" :icon="Package" tone="danger" hint="전체 창고 합계 3개 미만" @select="router.push('/parts')" />
        <RouterLink to="/dashboard" class="card dash-link">
          <span class="dash-ic"><BarChart3 :size="24" aria-hidden="true" /></span>
          <span class="t-main">
            <strong>품질 대시보드</strong>
            <span class="faint">승인된 고장 데이터를 부품·모델·지점·공장별로 확인</span>
          </span>
          <ArrowRight :size="20" aria-hidden="true" />
        </RouterLink>
      </div>
      <section class="card">
        <div class="card-head">
          <h2>승인이 필요한 발주 요청</h2>
          <RouterLink to="/order-approvals" class="btn btn-sm">발주 승인 대기로 이동 <ArrowRight :size="16" /></RouterLink>
        </div>
        <div v-if="orders.loading" class="card-body"><SkeletonBlock :lines="3" :height="44" /></div>
        <StateView v-else-if="!orders.pendingApproval.length" state="empty" title="승인 대기 중인 발주가 없습니다" compact />
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
.qm-progress {
  max-width: 520px;
}
/* 기사 숫자 카드: 2열 (휴대폰에서도 2열) */
.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
}
@media (max-width: 480px) {
  .metrics {
    gap: 12px;
  }
}
.dash-link {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  text-decoration: none;
  color: var(--text);
}
.dash-link:hover {
  background: var(--navy-50);
}
.dash-ic {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--blue-50);
  color: var(--primary);
  flex: none;
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
