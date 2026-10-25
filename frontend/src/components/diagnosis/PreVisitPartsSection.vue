<script setup lang="ts">
/* 출장 전 준비 부품 — 진단 리포트 1쪽 · 출장 전 진단 리포트 모달 공통
 *  부품 사진 · 이름 · 코드 · 필요 수량 · 창고(재고가 가장 많은 곳)와 위치 · 현재 재고
 *  재고 충분: 초록 '준비 가능' + [부품 보기](창고별 재고 펼침) / 부족: 빨간 '발주 필요' + [발주 신청](order 이벤트 — 화면이 처리)
 *  이 수리 건에 진행 중인 발주가 있으면 '발주 신청 완료'
 *  기사 수정 중이면 수량 변경 · 빼기 · 부품 추가 (AI 초안 부품 목록은 그대로 보존) */
import { computed, onMounted, ref, watch } from 'vue'
import { PackageCheck, Trash2, Plus, CircleAlert, ShoppingCart, CircleCheck, Warehouse, Package, ChevronDown, Loader2 } from 'lucide-vue-next'
import AiBadge from '@/components/common/AiBadge.vue'
import PreparationToolsCard from './PreparationToolsCard.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { useOrderStore } from '@/stores/orders'
import { isCompatible } from '@/utils/parts'
import type { Diagnosis } from '@/types'

type PartLine = { partId: string; quantity: number }
const props = defineProps<{
  /** 발주 신청 완료 여부를 이 수리 건의 발주 목록으로 판단 */
  repairId: number
  diagnosis: Diagnosis
  parts: PartLine[]
  /** 저장된 기사 수정안의 부품인지 (배지) */
  edited: boolean
  editing: boolean
  model?: string
  /** 발주 신청 가능 여부 · 불가 사유 (진단 확인 전에는 2쪽 주문이 잠김) */
  canOrder: boolean
  orderHint?: string
  showErrors?: boolean
  error?: string | null
  /** 발주 요청 중인 부품 (버튼 로딩) */
  orderingId?: string | null
}>()
const emit = defineEmits<{ 'update:parts': [PartLine[]]; order: [partId: string] }>()

const orders = useOrderStore()
onMounted(() => {
  if (!orders.parts.length) void orders.fetchParts()
})
// 발주 신청 완료 표시용: 이 수리 건의 발주 목록
watch(() => props.repairId, (id) => id && void orders.fetchForRepair(id), { immediate: true })
const ACTIVE = ['REQUESTED', 'APPROVED', 'ORDERED', 'RECEIVED']
const ordered = (partId: string) => orders.repairOrders.some((o) => o.repairId === props.repairId && o.partId === partId && ACTIVE.includes(o.status))
/** [부품 보기]로 창고별 재고를 펼친 부품 */
const openPart = ref<string | null>(null)
const imgFailed = ref<Record<string, boolean>>({})

const rec = (id: string) => props.diagnosis.parts.find((p) => p.partId === id)
const stockOf = (id: string) => orders.partById(id)?.stocks.reduce((a, s) => a + s.quantity, 0) ?? 0
const rows = computed(() =>
  props.parts.map((l) => {
    const p = orders.partById(l.partId)
    const r = rec(l.partId)
    const stock = stockOf(l.partId)
    // 대표 창고 = 재고가 가장 많은 곳
    const best = [...(p?.stocks ?? [])].sort((a, b) => b.quantity - a.quantity)[0]
    return {
      ...l,
      name: p?.name ?? r?.partName ?? l.partId,
      partNo: p?.partNo ?? r?.partNo ?? '',
      imageUrl: p?.imageUrl,
      reason: r?.reason,
      ai: !!r,
      stock,
      enough: !!p && stock >= l.quantity,
      known: !!p,
      warehouse: best ? `${best.warehouse}${best.location ? ` · ${best.location}` : ''}` : '-',
      stocks: p?.stocks ?? [],
    }
  }),
)

/* ---------- 수정 중: 수량 · 빼기 · 추가 ---------- */
function setQty(i: number, v: string) {
  const next = props.parts.map((p, j) => (j === i ? { ...p, quantity: Number(v) } : p))
  emit('update:parts', next)
}
function remove(i: number) {
  emit('update:parts', props.parts.filter((_, j) => j !== i))
}
const addId = ref('')
const addable = computed(() => orders.parts.filter((p) => isCompatible(p, props.model) && !props.parts.some((l) => l.partId === p.id)))
function add() {
  if (!addId.value) return
  emit('update:parts', [...props.parts, { partId: addId.value, quantity: 1 }])
  addId.value = ''
}
</script>

<template>
  <section class="pv-parts" :class="editing || edited ? 'tech-zone' : 'ai-zone'" aria-labelledby="h-pv-parts">
    <header class="ph">
      <h2 id="h-pv-parts" class="h"><PackageCheck :size="20" aria-hidden="true" /> 출장 전 준비 부품</h2>
      <AiBadge v-if="editing || edited" kind="edit" />
      <AiBadge v-else compact />
    </header>

    <SkeletonBlock v-if="!orders.parts.length && orders.loading" :lines="2" :height="40" />
    <p v-else-if="!rows.length" class="faint">준비할 부품이 없습니다.</p>
    <ul v-else class="rows">
      <li v-for="(r, i) in rows" :key="r.partId" class="row-item">
        <div class="thumb" aria-hidden="true">
          <img v-if="r.imageUrl && !imgFailed[r.partId]" :src="r.imageUrl" alt="" @error="imgFailed[r.partId] = true" />
          <Package v-else :size="26" />
        </div>
        <div class="name">
          <strong>{{ r.name }}</strong> <span class="mono faint">{{ r.partNo }}</span>
          <span v-if="!r.ai" class="badge tone-info">기사 추가</span>
          <p v-if="r.known" class="wh faint"><Warehouse :size="14" aria-hidden="true" /> {{ r.warehouse }} · 현재 재고 <b>{{ r.stock }}개</b></p>
          <p v-if="r.reason && !editing" class="faint reason">{{ r.reason }}</p>
        </div>
        <div class="qty">
          <template v-if="editing">
            <label :for="`pv-qty-${r.partId}`" class="sr-only">{{ r.name }} 수량</label>
            <input
              :id="`pv-qty-${r.partId}`"
              :value="r.quantity"
              class="input qty-input"
              type="number"
              min="1"
              max="99"
              inputmode="numeric"
              :aria-invalid="showErrors && (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 99)"
              @input="setQty(i, ($event.target as HTMLInputElement).value)"
            />
            <span>개</span>
          </template>
          <span v-else>필요 {{ r.quantity }}개</span>
        </div>
        <div class="stock">
          <template v-if="r.enough">
            <span class="badge tone-success"><CircleCheck :size="14" aria-hidden="true" /> 준비 가능</span>
            <button v-if="!editing" type="button" class="btn btn-sm" :aria-expanded="openPart === r.partId" @click="openPart = openPart === r.partId ? null : r.partId">
              부품 보기 <ChevronDown :size="16" aria-hidden="true" :class="{ flip: openPart === r.partId }" />
            </button>
          </template>
          <template v-else-if="r.known">
            <span class="badge tone-danger need"><CircleAlert :size="14" aria-hidden="true" /> 발주 필요</span>
            <template v-if="!editing">
              <button v-if="ordered(r.partId)" type="button" class="btn btn-sm" disabled><CircleCheck :size="16" aria-hidden="true" /> 발주 신청 완료</button>
              <button
                v-else
                type="button"
                class="btn btn-sm btn-danger"
                :disabled="!canOrder || orderingId === r.partId"
                :aria-describedby="!canOrder ? 'pv-order-hint' : undefined"
                @click="emit('order', r.partId)"
              >
                <Loader2 v-if="orderingId === r.partId" :size="16" class="spin" aria-hidden="true" /><ShoppingCart v-else :size="16" aria-hidden="true" /> 발주 신청
              </button>
            </template>
          </template>
          <span v-else class="faint">재고 확인 중</span>
        </div>
        <button v-if="editing" type="button" class="btn btn-sm btn-ghost" :aria-label="`${r.name} 빼기`" @click="remove(i)"><Trash2 :size="16" aria-hidden="true" /></button>
        <!-- [부품 보기]: 창고별 재고 -->
        <table v-if="openPart === r.partId && !editing" class="table wh-table">
          <thead><tr><th>창고</th><th>위치</th><th>재고</th></tr></thead>
          <tbody>
            <tr v-for="st in r.stocks" :key="st.warehouse"><td>{{ st.warehouse }}</td><td>{{ st.location || '-' }}</td><td>{{ st.quantity }}개</td></tr>
          </tbody>
        </table>
      </li>
    </ul>

    <div v-if="editing" class="add">
      <label for="pv-add" class="sr-only">추가할 부품</label>
      <select id="pv-add" v-model="addId" class="select">
        <option value="">부품 추가…</option>
        <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.name }} ({{ p.partNo }})</option>
      </select>
      <button type="button" class="btn" :disabled="!addId" @click="add"><Plus :size="16" aria-hidden="true" /> 추가</button>
    </div>
    <p v-if="showErrors && error" class="error-text" role="alert">{{ error }}</p>
    <p v-if="!editing && !canOrder && orderHint && rows.some((r) => r.known && !r.enough)" id="pv-order-hint" class="faint">{{ orderHint }}</p>
    <PreparationToolsCard :repair-id="repairId" />
  </section>
</template>

<style scoped>
.pv-parts {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
}
.ph {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ph .h {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.row-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
}
.name {
  flex: 1 1 220px;
  min-width: 0;
}
.thumb {
  flex: none;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-3);
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.wh {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 2px 0 0;
  font-size: var(--fs-sm);
}
.wh b {
  color: var(--ink);
}
.wh-table {
  flex-basis: 100%;
  font-size: var(--fs-sm);
}
.flip {
  transform: rotate(180deg);
}
.reason {
  margin: 2px 0 0;
  font-size: var(--fs-sm);
}
.qty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  white-space: nowrap;
}
.qty-input {
  width: 76px;
}
.stock {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.need {
  font-weight: 700;
}
.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
@media (max-width: 700px) {
  .stock {
    flex-basis: 100%;
    justify-content: flex-start;
  }
}
</style>
