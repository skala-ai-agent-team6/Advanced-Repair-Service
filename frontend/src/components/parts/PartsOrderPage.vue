<script setup lang="ts">
/* =========================================================================
 * 진단 노트 2쪽: 부품 발주 (FEATURES.stockReservation 이면 '출장 준비 · 부품' — 맨 위에 출장 전 챙길 부품 · 재고 예약)
 *  위: 교체 부품 리스트 — AI 추천 부품마다 재고 분기 (창고 재고로 수리 가능 / 발주 필요)
 *  아래: 주문하기 — 사람이 부품·수량을 골라 최종 요청 (POST /repairs/{id}/orders)
 * AI 는 추천만 하며, 확인 모달을 거쳐 담당자가 요청해야 주문이 등록된다.
 * ========================================================================= */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { Factory, Warehouse, Send, Plus, CircleAlert, ShoppingCart, PackageCheck, Info } from 'lucide-vue-next'
import AiBadge from '@/components/common/AiBadge.vue'
import TripPartsSection from '@/components/parts/TripPartsSection.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import StateView from '@/components/common/StateView.vue'
import { useOrderStore } from '@/stores/orders'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import { ORDER_STATUS_META } from '@/constants/status'
import { formatDate, formatDateTime, formatNumber } from '@/utils/format'
import { isCompatible } from '@/utils/parts'
import type { Diagnosis, OrderStatus, Part, PurchaseOrder, Repair } from '@/types'

const props = defineProps<{
  repair: Repair
  diagnosis: Diagnosis
  /** 출장 전 리포트의 기사 수정 부품(저장본). 있으면 AI 추천 대신 이 부품·수량으로 줄을 만든다 */
  partsOverride?: { partId: string; quantity: number }[] | null
  /** 1쪽 '발주 신청'으로 들어온 부품 — 주문하기에서 체크하고 그 위치로 스크롤 */
  focusPartId?: string | null
}>()
const orders = useOrderStore()
const auth = useAuthStore()
const toast = useToastStore()
const isTech = computed(() => auth.role === 'TECHNICIAN')

onMounted(() => void orders.fetchForRepair(props.repair.id))
// 진단 확인 직후 Mock 은 발주안을 새로 만든다 → 다시 받기
watch(() => props.diagnosis.technicianDecision.state, () => void orders.fetchForRepair(props.repair.id))

/** 출장 준비에서 재고 부족 → 주문하기로 이동 (해당 부품 체크) */
function goOrder(partId: string) {
  if (sel[partId]) sel[partId].checked = true
  document.getElementById('order-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ---------- 부품 줄 ---------- */
interface Line {
  partId: string
  partName: string
  partNo: string
  quantity: number
  reason: string
  ai: boolean
}
const manual = ref<Line[]>([])
const lines = computed<Line[]>(() => {
  const ai = props.diagnosis.parts
  const rec = props.partsOverride
    ? props.partsOverride.map((o) => {
        const r = ai.find((p) => p.partId === o.partId)
        const part = orders.partById(o.partId)
        return { partId: o.partId, partName: r?.partName ?? part?.name ?? o.partId, partNo: r?.partNo ?? part?.partNo ?? '', quantity: o.quantity, reason: r?.reason ?? '기사가 출장 전 리포트에서 추가', ai: !!r }
      })
    : ai.map((p) => ({ ...p, ai: true }))
  // 진단 추천에 없는데 이미 요청된 발주 (예: 예전에 직접 추가한 부품)
  const fromOrders = orders.repairOrders
    .filter((o) => o.status !== 'AI_DRAFT' && !rec.some((r) => r.partId === o.partId))
    .map((o) => ({ partId: o.partId, partName: o.partName, partNo: o.partNo, quantity: o.quantity, reason: o.aiReason, ai: false }))
  const seen = new Set<string>()
  return [...rec, ...fromOrders, ...manual.value].filter((l) => !seen.has(l.partId) && !!seen.add(l.partId))
})

const ACTIVE: OrderStatus[] = ['REQUESTED', 'APPROVED', 'ORDERED', 'RECEIVED']
/** 진행 중인 요청 (가장 최근 것) — 있으면 다시 주문하지 않는다 */
const activeOrder = (partId: string) => [...orders.repairOrders].reverse().find((o) => o.partId === partId && ACTIVE.includes(o.status))
const lastRejected = (partId: string) => [...orders.repairOrders].reverse().find((o) => o.partId === partId && o.status === 'REJECTED')
const draftOf = (partId: string) => orders.repairOrders.find((o) => o.partId === partId && (o.status === 'AI_DRAFT' || o.status === 'REJECTED'))

const totalStock = (p?: Part) => p?.stocks.reduce((a, s) => a + s.quantity, 0) ?? 0
/** 한 창고에서 필요 수량을 모두 꺼낼 수 있으면 그 창고 (재고 많은 순) */
const pickStock = (p: Part | undefined, qty: number) => p?.stocks.filter((s) => s.quantity >= qty).sort((a, b) => b.quantity - a.quantity)[0]
const eta = (p: Part) => formatDate(new Date(Date.now() + p.leadTimeDays * 86_400_000).toISOString())

interface Source {
  kind: 'WAREHOUSE' | 'FACTORY'
  label: string
  fromWarehouse: string
}
function sourceFor(partId: string, qty: number): Source {
  const p = orders.partById(partId)
  const s = pickStock(p, qty)
  if (s) return { kind: 'WAREHOUSE', label: `창고 · ${s.warehouse}`, fromWarehouse: s.warehouse }
  // 공장 발주: 출고 창고는 재고가 가장 많은 곳 (입고 후 그 창고에서 출고)
  const best = [...(p?.stocks ?? [])].sort((a, b) => b.quantity - a.quantity)[0]
  return { kind: 'FACTORY', label: `공장 · ${p?.factory ?? '-'}`, fromWarehouse: best?.warehouse ?? '' }
}

/* ---------- 주문하기 (체크 · 수량) ---------- */
const sel = reactive<Record<string, { checked: boolean; qty: number }>>({})
watch(
  [lines, () => orders.parts.length],
  () => {
    for (const l of lines.value) {
      // 처음 보는 줄: 재고가 부족한 부품만 미리 체크
      sel[l.partId] ??= { checked: !activeOrder(l.partId) && !pickStock(orders.partById(l.partId), l.quantity) && !!orders.partById(l.partId), qty: l.quantity }
    }
  },
  { immediate: true },
)
const orderable = computed(() => lines.value.filter((l) => !activeOrder(l.partId)))
/** 1쪽 '발주 신청' → 해당 부품을 체크하고 주문하기로 (줄·체크 상태가 준비된 뒤 한 번) */
let focused = ''
watch(
  [() => props.focusPartId, () => !!sel[props.focusPartId ?? '']],
  async ([id, ready]) => {
    if (!id || !ready || focused === id) return
    focused = id
    await nextTick()
    // 라우터가 이동 직후 맨 위로 스크롤한 뒤에 옮겨야 한다
    window.setTimeout(() => goOrder(id), 200)
  },
  { immediate: true },
)
const selected = computed(() => orderable.value.filter((l) => sel[l.partId]?.checked && sel[l.partId].qty >= 1))

/* ---------- 확인 모달 ---------- */
interface Item {
  line: Line
  qty: number
  source: Source
  price: number
}
const dlg = reactive({ open: false, items: [] as Item[], busy: false, error: '' })
const dlgTotal = computed(() => dlg.items.reduce((a, x) => a + x.price, 0))
const toItem = (line: Line, qty: number, source = sourceFor(line.partId, qty)): Item => ({ line, qty, source, price: (orders.partById(line.partId)?.unitPrice ?? 0) * qty })

function openOrder() {
  if (!selected.value.length) return
  Object.assign(dlg, { open: true, busy: false, error: '', items: selected.value.map((l) => toItem(l, sel[l.partId].qty)) })
}
/** 창고에서 가져가기 = 해당 창고 출고 요청 (필요 수량 그대로) */
function openPickup(line: Line) {
  Object.assign(dlg, { open: true, busy: false, error: '', items: [toItem(line, line.quantity)] })
}

async function confirmOrder() {
  dlg.busy = true
  dlg.error = ''
  const failed: string[] = []
  for (const x of dlg.items) {
    try {
      await orders.request(props.repair.id, { draftOrderId: draftOf(x.line.partId)?.id, partId: x.line.partId, quantity: x.qty, fromWarehouse: x.source.fromWarehouse })
      if (sel[x.line.partId]) sel[x.line.partId].checked = false
    } catch (e) {
      failed.push(`${x.line.partName}: ${toErrorMessage(e)}`)
    }
  }
  dlg.busy = false
  if (failed.length) {
    dlg.error = failed.join('\n')
    dlg.items = dlg.items.filter((x) => failed.some((f) => f.startsWith(`${x.line.partName}:`)))
    return
  }
  dlg.open = false
  toast.success('주문 요청을 등록했습니다. 본사 품질 담당자 승인을 기다립니다.')
}

/* ---------- 직접 추가 ---------- */
const extraPart = ref('')
const addable = computed(() => orders.parts.filter((p) => isCompatible(p, props.repair.product.model) && !lines.value.some((l) => l.partId === p.id)))
function addManual() {
  const p = orders.partById(extraPart.value)
  if (!p) return
  manual.value.push({ partId: p.id, partName: p.name, partNo: p.partNo, quantity: 1, reason: '기사가 직접 추가한 부품 (AI 추천 아님)', ai: false })
  sel[p.id] = { checked: true, qty: 1 }
  extraPart.value = ''
}

/* ---------- 요청 상태 단계 ---------- */
const STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'REQUESTED', label: '승인 대기' },
  { status: 'APPROVED', label: '승인' },
  { status: 'ORDERED', label: '출고' },
  { status: 'RECEIVED', label: '수령' },
]
const stepIdx = (o: PurchaseOrder) => STEPS.findIndex((s) => s.status === o.status)
</script>

<template>
  <div class="stack page2">
    <!-- 출장 전 챙길 부품 · 재고 예약 (실서버 API 없으면 숨김) -->
    <TripPartsSection v-if="FEATURES.stockReservation" :repair-id="repair.id" :can-act="isTech" @changed="orders.fetchForRepair(repair.id)" @go-order="goOrder" />

    <div v-if="orders.loading && !orders.parts.length" class="card-pad"><SkeletonBlock :lines="4" :height="56" /></div>

    <template v-else>
      <!-- 교체 부품 리스트 -->
      <section class="stack">
        <h3 class="h">교체 부품</h3>
        <StateView v-if="!lines.length" state="empty" title="AI 가 추천한 교체 부품이 없습니다" message="필요한 부품이 있으면 아래 주문하기에서 직접 추가하세요." compact />
        <article v-for="l in lines" :key="l.partId" class="line" :class="{ ok: !!pickStock(orders.partById(l.partId), l.quantity) }">
          <div class="line-head">
            <div class="name">
              <strong>{{ l.partName }}</strong> <span class="mono faint">{{ l.partNo }}</span>
              <span class="badge tone-neutral">필요 {{ l.quantity }}개</span>
            </div>
            <span v-if="activeOrder(l.partId)" class="badge" :class="`tone-${ORDER_STATUS_META[activeOrder(l.partId)!.status].tone}`">{{ ORDER_STATUS_META[activeOrder(l.partId)!.status].label }}</span>
          </div>

          <p class="reason">
            <span v-if="l.ai" class="badge tone-ai">MCP 추천</span>
            <span v-else class="badge tone-neutral">직접 추가</span>
            {{ l.reason || '추천 이유 없음' }}
          </p>

          <template v-if="orders.partById(l.partId)">
            <!-- 재고 있음 -->
            <div v-if="pickStock(orders.partById(l.partId), l.quantity)" class="callout tone-success stock">
              <Warehouse :size="20" />
              <div class="grow">
                <strong>창고 재고로 수리 가능</strong>
                <ul class="locs">
                  <li v-for="s in orders.partById(l.partId)!.stocks.filter((s) => s.quantity > 0)" :key="s.warehouse">
                    {{ s.warehouse }} · <span class="mono">{{ s.location }}</span> · <b>{{ s.quantity }}개</b>
                  </li>
                </ul>
              </div>
              <button v-if="isTech && !activeOrder(l.partId)" type="button" class="btn btn-success" :disabled="!!orders.submittingId" @click="openPickup(l)">
                <PackageCheck :size="18" /> 창고에서 가져가기
              </button>
            </div>
            <!-- 재고 부족 -->
            <div v-else class="callout tone-warning stock">
              <Factory :size="20" />
              <div class="grow">
                <strong>발주 필요</strong> 전체 창고 재고 {{ totalStock(orders.partById(l.partId)) }}개 / 필요 {{ l.quantity }}개
                <dl class="kv mini">
                  <dt>생산 공장</dt>
                  <dd>{{ orders.partById(l.partId)!.factory }}</dd>
                  <dt>연락처</dt>
                  <dd>
                    <template v-if="orders.partById(l.partId)!.factoryContact.manager">{{ orders.partById(l.partId)!.factoryContact.manager }} · </template>
                    <a v-if="orders.partById(l.partId)!.factoryContact.phone" :href="`tel:${orders.partById(l.partId)!.factoryContact.phone}`">{{ orders.partById(l.partId)!.factoryContact.phone }}</a>
                    <template v-else>-</template>
                  </dd>
                  <dt>예상 입고일</dt>
                  <dd>{{ eta(orders.partById(l.partId)!) }} (생산 약 {{ orders.partById(l.partId)!.leadTimeDays }}일)</dd>
                </dl>
              </div>
            </div>
          </template>
          <p v-else class="faint">부품 재고 정보를 찾을 수 없습니다.</p>

          <!-- 요청 후 상태 -->
          <div v-if="activeOrder(l.partId)" class="track">
            <AiBadge kind="human" />
            <ol class="steps" aria-label="주문 진행 상태">
              <li v-for="(s, i) in STEPS" :key="s.status" :class="{ done: i < stepIdx(activeOrder(l.partId)!), cur: i === stepIdx(activeOrder(l.partId)!) }">{{ s.label }}</li>
            </ol>
            <span class="faint">{{ activeOrder(l.partId)!.quantity }}개 · {{ activeOrder(l.partId)!.fromWarehouse }} · {{ activeOrder(l.partId)!.requestedBy }} {{ formatDateTime(activeOrder(l.partId)!.requestedAt) }}</span>
          </div>
          <p v-else-if="lastRejected(l.partId)" class="callout tone-danger">
            <CircleAlert :size="18" /> 이전 요청이 반려되었습니다{{ lastRejected(l.partId)!.decision.comment ? `: ${lastRejected(l.partId)!.decision.comment}` : '' }}. 다시 주문할 수 있습니다.
          </p>
        </article>
      </section>

      <!-- 주문하기 (사람이 최종 주문) -->
      <section id="order-section" class="order">
        <h3 class="h"><ShoppingCart :size="20" /> 주문하기</h3>
        <p v-if="!isTech" class="callout tone-info"><Info :size="18" /> 주문 요청은 담당 서비스센터 기사만 할 수 있습니다. (조회 전용)</p>
        <template v-else>
          <p v-if="!orderable.length" class="faint">주문할 부품이 없습니다. 모든 부품이 이미 요청되었습니다.</p>
          <div v-else class="table-wrap"><table class="table">
            <caption class="sr-only">주문할 부품 선택</caption>
            <thead>
              <tr><th scope="col">선택</th><th scope="col">부품</th><th scope="col">수량</th><th scope="col">출처</th><th scope="col">예상 금액</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in orderable" :key="l.partId">
                <td><input :id="`ck-${l.partId}`" v-model="sel[l.partId].checked" type="checkbox" class="ck" :disabled="!orders.partById(l.partId)" /></td>
                <td><label :for="`ck-${l.partId}`"><strong>{{ l.partName }}</strong> <span class="mono faint">{{ l.partNo }}</span></label></td>
                <td><input v-model.number="sel[l.partId].qty" type="number" min="1" max="99" class="input qty" inputmode="numeric" :aria-label="`${l.partName} 수량`" /></td>
                <td>
                  <span class="badge" :class="sourceFor(l.partId, sel[l.partId].qty).kind === 'WAREHOUSE' ? 'tone-success' : 'tone-warning'">{{ sourceFor(l.partId, sel[l.partId].qty).label }}</span>
                </td>
                <td>{{ orders.partById(l.partId)?.unitPrice ? `${formatNumber(orders.partById(l.partId)!.unitPrice * sel[l.partId].qty)}원` : '-' }}</td>
              </tr>
            </tbody>
          </table></div>
          <div class="row add">
            <label for="extra" class="label">다른 부품 직접 추가</label>
            <select id="extra" v-model="extraPart" class="select">
              <option value="">호환 부품 선택</option>
              <option v-for="p in addable" :key="p.id" :value="p.id">{{ p.name }} ({{ p.partNo }})</option>
            </select>
            <button type="button" class="btn" :disabled="!extraPart" @click="addManual"><Plus :size="18" /> 추가</button>
          </div>
          <div class="row submit">
            <span class="faint">AI 추천은 참고용이며 주문은 담당자가 확정합니다.</span>
            <button type="button" class="btn btn-primary btn-lg" :disabled="!selected.length || !!orders.submittingId" @click="openOrder">
              <Send :size="20" /> 선택한 부품 주문 요청 ({{ selected.length }})
            </button>
          </div>
        </template>
      </section>
    </template>

    <BaseModal :open="dlg.open" title="주문 요청 확인" :width="640" @close="!dlg.busy && (dlg.open = false)">
      <div class="stack">
        <table class="table">
          <thead><tr><th scope="col">부품</th><th scope="col">수량</th><th scope="col">출처</th><th scope="col">예상 금액</th></tr></thead>
          <tbody>
            <tr v-for="x in dlg.items" :key="x.line.partId">
              <td>{{ x.line.partName }} <span class="mono faint">{{ x.line.partNo }}</span></td>
              <td>{{ x.qty }}개</td>
              <td>{{ x.source.label }}</td>
              <td>{{ x.price ? `${formatNumber(x.price)}원` : '-' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr><th scope="row" colspan="3">합계</th><td><strong>{{ formatNumber(dlgTotal) }}원</strong></td></tr>
          </tfoot>
        </table>
        <p class="callout tone-ai"><Info :size="18" /> AI 추천은 참고용이며 주문은 담당자가 확정합니다. 요청 후 본사 품질 담당자가 승인해야 출고됩니다.</p>
        <p v-if="dlg.error" class="error-text pre" role="alert">{{ dlg.error }}</p>
      </div>
      <template #footer>
        <button class="btn" type="button" :disabled="dlg.busy" @click="dlg.open = false">취소</button>
        <button class="btn btn-primary" type="button" :disabled="dlg.busy || !dlg.items.length" @click="confirmOrder">
          <Send :size="18" /> {{ dlg.busy ? '요청 중…' : '주문 요청 확정' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.page2 {
  gap: 22px;
}
.h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--fs-lg);
}
.line {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-left: 4px solid var(--warning-border);
  border-radius: var(--radius);
}
.line.ok {
  border-left-color: var(--success-border);
}
.line-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.reason {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
}
.stock {
  align-items: flex-start;
  flex-wrap: wrap;
}
.grow {
  flex: 1 1 260px;
}
.locs {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: var(--fs-sm);
}
.mini {
  margin-top: 6px;
  font-size: var(--fs-sm);
}
.track {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.steps {
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: 4px;
}
.steps li {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.steps li.done {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success);
}
.steps li.cur {
  background: var(--navy-800);
  border-color: var(--navy-800);
  color: #fff;
}
.order {
  scroll-margin-top: calc(var(--topbar-h) + 16px);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 16px;
  border: 2px solid var(--navy-100);
  border-radius: var(--radius-lg);
  background: var(--navy-50);
}
.ck {
  width: 22px;
  height: 22px;
  accent-color: var(--navy-800);
}
.qty {
  width: 80px;
}
.add {
  flex-wrap: wrap;
}
.add .select {
  flex: 1 1 240px;
  width: auto;
  min-width: 0;
  max-width: 100%;
}
.submit {
  justify-content: flex-end;
  flex-wrap: wrap;
}
.pre {
  white-space: pre-line;
}
.order :deep(.table) {
  background: var(--surface);
}
</style>
