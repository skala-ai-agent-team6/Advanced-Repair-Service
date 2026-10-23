<script setup lang="ts">
/* 부품 및 재고(품질 담당자) · 부품 관리(기사) — 본사 품질 담당자: 발주 승인·반려 / 기사: 내 발주 현황 + 재고 조회
 * pendingOnly: '발주 승인' 메뉴용 (승인 대기 목록만 표시). 화면 이름은 constants/menus */
import { computed, onMounted, ref } from 'vue'
import { Search, ClipboardCheck, List, Warehouse, RefreshCw } from 'lucide-vue-next'
import PurchaseApprovalCard from '@/components/parts/PurchaseApprovalCard.vue'
import PartInventoryCard from '@/components/parts/PartInventoryCard.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { useOrderStore } from '@/stores/orders'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { ORDER_STATUS_META } from '@/constants/status'
import { ApiError, toErrorMessage } from '@/api'
import { formatDateTime, repairId } from '@/utils/format'
import type { OrderStatus, PurchaseOrder } from '@/types'
import { PAGE_LABEL } from '@/constants/menus'

const props = defineProps<{ pendingOnly?: boolean }>()
const store = useOrderStore()
const auth = useAuthStore()
const toast = useToastStore()
const canApprove = computed(() => auth.role === 'QUALITY_MANAGER')
const tab = ref<'pending' | 'all' | 'stock'>(props.pendingOnly || canApprove.value ? 'pending' : 'all')
const q = ref('')
const statusFilter = ref<OrderStatus | 'ALL'>('ALL')

onMounted(() => store.fetchAll())

const filteredOrders = computed(() => store.orders.filter((o) => statusFilter.value === 'ALL' || o.status === statusFilter.value).filter((o) => o.status !== 'AI_DRAFT' || !canApprove.value))
const parts = computed(() => {
  const k = q.value.trim().toLowerCase()
  return store.parts.filter((p) => !k || [p.name, p.partNo, p.factory, ...p.compatibleModels].some((v) => v.toLowerCase().includes(k)))
})

async function decide(o: PurchaseOrder, p: { action: 'APPROVE' | 'REJECT'; comment: string }) {
  try {
    await store.decide(o.id, p)
    toast.success(`${o.partName} 발주를 ${p.action === 'APPROVE' ? '승인' : '반려'}했습니다.`)
  } catch (e) {
    // 409: 다른 담당자가 먼저 처리함 → 최신 상태로 다시 불러온다
    if (e instanceof ApiError && e.status === 409) {
      toast.error('이미 처리된 발주입니다. 최신 상태로 새로고침했습니다.')
      await store.fetchAll()
    } else toast.error(toErrorMessage(e))
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ pendingOnly ? PAGE_LABEL.orderApprovals : canApprove ? PAGE_LABEL.qmParts : PAGE_LABEL.techParts }}</h1>
        <p class="sub">{{ canApprove ? '기사가 확인·요청한 발주를 검토하고 승인합니다.' : '발주 요청 현황과 부품 재고를 확인합니다.' }}</p>
      </div>
      <button class="btn" type="button" :disabled="store.loading" @click="store.fetchAll()"><RefreshCw :size="18" :class="{ spin: store.loading }" /> 새로고침</button>
    </div>

    <div v-if="!pendingOnly" class="tabs" role="tablist">
      <button v-if="canApprove" type="button" role="tab" class="tab" :aria-selected="tab === 'pending'" @click="tab = 'pending'">
        <ClipboardCheck :size="20" /> 승인 대기 <span class="badge tone-warning">{{ store.pendingApproval.length }}</span>
      </button>
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'all'" @click="tab = 'all'"><List :size="20" /> {{ canApprove ? '전체 발주' : '발주 현황' }}</button>
      <button type="button" role="tab" class="tab" :aria-selected="tab === 'stock'" @click="tab = 'stock'"><Warehouse :size="20" /> 재고 현황</button>
    </div>

    <div v-if="store.loading && !store.parts.length" class="card card-pad"><SkeletonBlock :lines="6" :height="36" /></div>
    <StateView v-else-if="store.error" state="error" :message="store.error" @retry="store.fetchAll()" />

    <!-- 승인 대기 -->
    <template v-else-if="tab === 'pending'">
      <StateView v-if="!store.pendingApproval.length" state="empty" title="승인이 필요한 발주 요청이 없습니다" message="기사가 발주를 요청하면 알림으로 알려 드립니다." class="card" />
      <div class="stack">
        <div v-for="o in store.pendingApproval" :key="o.id" class="stack pair">
          <PurchaseApprovalCard :order="o" :part="store.partById(o.partId)" :role="auth.role" :busy="store.submittingId === o.id" @decide="decide(o, $event)" />
          <PartInventoryCard v-if="store.partById(o.partId)" :part="store.partById(o.partId)!" :highlight-warehouse="o.fromWarehouse" />
        </div>
      </div>
    </template>

    <!-- 전체 -->
    <section v-else-if="tab === 'all'" class="card">
      <div class="card-head">
        <h2>발주 목록</h2>
        <div class="field inline">
          <label for="osf" class="sr-only">상태</label>
          <select id="osf" v-model="statusFilter" class="select">
            <option value="ALL">전체 상태</option>
            <option v-for="(m, k) in ORDER_STATUS_META" :key="k" :value="k">{{ m.label }}</option>
          </select>
        </div>
      </div>
      <StateView v-if="!filteredOrders.length" state="empty" title="발주 내역이 없습니다" compact />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>부품</th><th>수량</th><th>출고 창고</th><th>수리 ID</th><th>요청</th><th>상태</th><th>처리</th></tr>
          </thead>
          <tbody>
            <tr v-for="o in filteredOrders" :key="o.id">
              <td><strong>{{ o.partName }}</strong><div class="mono faint">{{ o.partNo }}</div></td>
              <td>{{ o.quantity }}개</td>
              <td>{{ o.fromWarehouse }}</td>
              <td><RouterLink :to="`/repairs/${o.repairId}/diagnosis?page=2`" class="mono">{{ repairId(o.repairId) }}</RouterLink></td>
              <td>{{ o.requestedBy ?? '-' }}<div class="faint">{{ formatDateTime(o.requestedAt) }}</div></td>
              <td><span class="badge" :class="`tone-${ORDER_STATUS_META[o.status].tone}`">{{ ORDER_STATUS_META[o.status].label }}</span></td>
              <td>
                <template v-if="o.decision.decidedBy">{{ o.decision.decidedBy }}<div class="faint">{{ formatDateTime(o.decision.decidedAt) }}</div></template>
                <button v-else-if="canApprove && o.status === 'REQUESTED'" type="button" class="btn btn-sm btn-primary" @click="tab = 'pending'">검토하기</button>
                <span v-else class="faint">-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 재고 -->
    <template v-else>
      <div class="search card card-pad">
        <Search :size="20" class="si" aria-hidden="true" />
        <label for="pq" class="sr-only">부품 검색</label>
        <input id="pq" v-model="q" class="input" placeholder="부품명 · 품번 · 공장 · 호환 모델 검색" />
      </div>
      <StateView v-if="!parts.length" state="empty" title="검색 결과가 없습니다" message="다른 검색어로 찾아보세요." class="card" />
      <div class="grid-2">
        <PartInventoryCard v-for="p in parts" :key="p.id" :part="p" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 6px;
  border-bottom: 2px solid var(--border);
  flex-wrap: wrap;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 18px;
  border: 0;
  background: transparent;
  font-weight: 700;
  color: var(--text-2);
  cursor: pointer;
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
}
.tab[aria-selected='true'] {
  color: var(--navy-900);
  border-bottom-color: var(--navy-800);
}
.pair {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.search {
  position: relative;
}
.search .input {
  padding-left: 44px;
}
.si {
  position: absolute;
  left: 36px;
  top: 34px;
  color: var(--text-3);
}
@media (max-width: 1180px) {
  .pair {
    /* minmax(0, …): 카드 내용 최소 폭 때문에 화면보다 넓어지지 않게 */
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
