<script setup lang="ts">
/* =========================================================================
 * 진단 노트 2쪽 맨 위: 출장 전 챙길 부품 (AI 초안) + 재고 예약
 *  - 고객 사진으로 예측한 필요 부품 · 예측 근거 · 창고별 "가용 n · 예약 n"
 *  - [예약하기] → 예약됨(남은 시간) → [출고 처리] / [예약 취소]  ·  만료 24시간
 *  - 409 STOCK_CONFLICT: 다른 기사가 먼저 예약 → 안내 토스트 + 최신 재고로 다시 불러오기
 *  - 부품별 재고 변경 이력 (접이식)
 * ========================================================================= */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Camera, ChevronDown, History, Loader2, PackageCheck, PackageX, ShoppingCart, Warehouse, BookmarkPlus } from 'lucide-vue-next'
import AiBadge from '@/components/common/AiBadge.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import StateView from '@/components/common/StateView.vue'
import { cancelReservation, getStockHistory, getTripParts, isStockConflict, releaseStock, reserveStock, toErrorMessage } from '@/api'
import { useToastStore } from '@/stores/toast'
import { formatDateTime, repairId as fmtRepairId } from '@/utils/format'
import type { ReservationStatus, StockChange, StockHistoryEntry, TripPart } from '@/types'

const props = defineProps<{ repairId: number; canAct: boolean }>()
const emit = defineEmits<{ changed: []; 'go-order': [partId: string] }>()
const toast = useToastStore()

const parts = ref<TripPart[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
/** 요청 중인 부품 id (연속 클릭 방지) */
const busy = ref<string | null>(null)
/** 남은 시간 계산 기준 시각 */
const now = ref(Date.now())

async function load() {
  loading.value = true
  error.value = null
  try {
    parts.value = await getTripParts(props.repairId)
    now.value = Date.now()
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}

/* ---------- 남은 시간 (1분마다 갱신, 만료되면 다시 불러오기) ---------- */
let timer: number | undefined
onMounted(() => {
  void load()
  timer = window.setInterval(() => {
    now.value = Date.now()
    if (parts.value.some((p) => p.reservation?.status === 'RESERVED' && new Date(p.reservation.expiresAt).getTime() <= now.value)) void refresh()
  }, 60_000)
})
onBeforeUnmount(() => window.clearInterval(timer))

function remaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - now.value
  if (ms <= 0) return '곧 만료'
  const h = Math.floor(ms / 3_600_000)
  return h >= 1 ? `${h}시간 남음` : `${Math.max(1, Math.ceil(ms / 60_000))}분 남음`
}

const STATUS: Record<ReservationStatus, { label: string; tone: string }> = {
  RESERVED: { label: '예약됨', tone: 'info' },
  RELEASED: { label: '출고됨', tone: 'success' },
  CANCELLED: { label: '취소됨', tone: 'neutral' },
  EXPIRED: { label: '만료됨', tone: 'warning' },
}
const canReserve = (p: TripPart) => p.stocks.some((s) => s.available >= p.quantity)
const reservable = (p: TripPart) => !p.reservation || p.reservation.status === 'CANCELLED' || p.reservation.status === 'EXPIRED'
const shown = (p: TripPart) => p.stocks.filter((s) => s.available > 0 || s.reserved > 0)

/* ---------- 예약 · 취소 · 출고 ---------- */
async function run(p: TripPart, action: () => Promise<unknown>, done: string) {
  if (busy.value) return
  busy.value = p.partId
  try {
    await action()
    toast.success(done)
  } catch (e) {
    if (isStockConflict(e)) toast.warning('다른 기사가 먼저 예약해서 재고가 바뀌었어요. 최신 재고로 다시 불러왔어요.')
    else toast.error(toErrorMessage(e))
  } finally {
    // 성공·충돌·오류 모두 최신 재고로 다시 불러온다
    await refresh()
    busy.value = null
  }
}
const reserve = (p: TripPart) => run(p, () => reserveStock(p.partId, p.quantity, props.repairId), `${p.partName} ${p.quantity}개를 예약했어요. 24시간 안에 출고 처리해 주세요.`)
const cancel = (p: TripPart) => run(p, () => cancelReservation(p.reservation!.id), `${p.partName} 예약을 취소했어요.`)
const release = (p: TripPart) => run(p, () => releaseStock(p.reservation!.id), `${p.partName} 출고 처리했어요.`)

async function refresh() {
  await load()
  await Promise.all(Object.keys(history).filter((id) => openHistory[id]).map(loadHistory))
  emit('changed')
}

/* ---------- 재고 변경 이력 ---------- */
const openHistory = reactive<Record<string, boolean>>({})
const history = reactive<Record<string, StockHistoryEntry[] | 'loading' | 'error'>>({})
async function loadHistory(partId: string) {
  if (!Array.isArray(history[partId])) history[partId] = 'loading'
  try {
    history[partId] = await getStockHistory(partId)
  } catch {
    history[partId] = 'error'
  }
}
function toggleHistory(partId: string) {
  openHistory[partId] = !openHistory[partId]
  if (openHistory[partId] && !Array.isArray(history[partId])) void loadHistory(partId)
}
const CHANGE: Record<StockChange, { label: (n: number) => string; tone: string }> = {
  RESERVE: { label: (n) => `예약 -${n}`, tone: 'info' },
  CANCEL: { label: (n) => `취소 +${n}`, tone: 'neutral' },
  EXPIRE: { label: (n) => `만료 +${n}`, tone: 'warning' },
  RELEASE: { label: (n) => `출고 ${n}개`, tone: 'success' },
}

const summary = computed(() => {
  const r = parts.value.filter((p) => p.reservation?.status === 'RESERVED').length
  const out = parts.value.filter((p) => p.reservation?.status === 'RELEASED').length
  return `${parts.value.length}종 · 예약 ${r} · 출고 ${out}`
})
</script>

<template>
  <section class="trip ai-zone" aria-labelledby="h-trip">
    <div class="head">
      <div>
        <h3 id="h-trip" class="h"><PackageCheck :size="20" /> 출장 전 챙길 부품</h3>
        <p class="faint">고객 사진으로 예측한 필요 부품입니다. 예약하면 24시간 동안 다른 기사가 가져갈 수 없어요.</p>
      </div>
      <div class="row">
        <span v-if="parts.length" class="faint">{{ summary }}</span>
        <AiBadge compact />
      </div>
    </div>

    <div v-if="loading && !parts.length" class="cards"><SkeletonBlock v-for="i in 2" :key="i" :lines="4" :height="22" /></div>
    <p v-else-if="error && !parts.length" class="error-text" role="alert">{{ error }}</p>
    <StateView v-else-if="!parts.length" state="empty" title="예측된 필요 부품이 없습니다" message="필요한 부품은 아래 주문하기에서 직접 추가할 수 있어요." compact />

    <div v-else class="cards">
      <article v-for="p in parts" :key="p.partId" class="tp" :aria-busy="busy === p.partId">
        <header class="tp-head">
          <div class="name">
            <strong>{{ p.partName }}</strong>
            <span class="mono faint">{{ p.partNo }}</span>
          </div>
          <span class="badge tone-neutral">필요 {{ p.quantity }}개</span>
        </header>

        <p class="reason"><Camera :size="16" aria-hidden="true" /> {{ p.reason }}</p>

        <ul class="stocks" aria-label="창고별 재고">
          <li v-for="s in shown(p)" :key="s.warehouse">
            <span class="wh"><Warehouse :size="15" aria-hidden="true" /> {{ s.warehouse }} <span class="mono faint">{{ s.location }}</span></span>
            <span class="qty"><b :class="{ zero: !s.available }">가용 {{ s.available }}</b> · 예약 {{ s.reserved }}</span>
          </li>
          <li v-if="!shown(p).length" class="faint">모든 창고에 재고가 없어요.</li>
        </ul>

        <!-- 예약 상태 -->
        <div v-if="p.reservation" class="state">
          <span class="badge" :class="`tone-${STATUS[p.reservation.status].tone}`">
            {{ STATUS[p.reservation.status].label }}<template v-if="p.reservation.status === 'RESERVED'"> · {{ remaining(p.reservation.expiresAt) }}</template>
          </span>
          <span class="faint">
            {{ p.reservation.warehouse }} {{ p.reservation.quantity }}개 · {{ p.reservation.reservedBy }}
            <template v-if="p.reservation.closedAt"> · {{ formatDateTime(p.reservation.closedAt) }}</template>
            <template v-else> · {{ formatDateTime(p.reservation.reservedAt) }} 예약</template>
          </span>
        </div>

        <!-- 버튼 -->
        <div v-if="canAct" class="acts">
          <template v-if="p.reservation?.status === 'RESERVED'">
            <button type="button" class="btn btn-success" :disabled="!!busy" @click="release(p)">
              <Loader2 v-if="busy === p.partId" :size="18" class="spin" /><PackageCheck v-else :size="18" /> 출고 처리
            </button>
            <button type="button" class="btn" :disabled="!!busy" @click="cancel(p)"><PackageX :size="18" /> 예약 취소</button>
          </template>
          <template v-else-if="reservable(p)">
            <button type="button" class="btn btn-primary" :disabled="!!busy || !canReserve(p)" @click="reserve(p)">
              <Loader2 v-if="busy === p.partId" :size="18" class="spin" /><BookmarkPlus v-else :size="18" />
              {{ p.reservation ? '다시 예약하기' : '예약하기' }}
            </button>
            <template v-if="!canReserve(p)">
              <span class="short">재고 부족 · 예약할 수 없어요</span>
              <button type="button" class="btn" @click="emit('go-order', p.partId)"><ShoppingCart :size="18" /> 주문 요청으로</button>
            </template>
          </template>
        </div>

        <!-- 재고 변경 이력 -->
        <div class="hist">
          <button type="button" class="hist-toggle" :aria-expanded="!!openHistory[p.partId]" :aria-controls="`hist-${p.partId}`" @click="toggleHistory(p.partId)">
            <History :size="16" aria-hidden="true" /> 이력 보기
            <ChevronDown :size="16" class="chev" :class="{ open: openHistory[p.partId] }" aria-hidden="true" />
          </button>
          <div v-if="openHistory[p.partId]" :id="`hist-${p.partId}`" class="hist-body">
            <p v-if="history[p.partId] === 'loading'" class="faint"><Loader2 :size="14" class="spin" /> 불러오는 중…</p>
            <p v-else-if="history[p.partId] === 'error'" class="error-text">이력을 불러오지 못했어요.</p>
            <p v-else-if="!(history[p.partId] as StockHistoryEntry[] | undefined)?.length" class="faint">변경 이력이 없어요.</p>
            <ol v-else class="hist-list">
              <li v-for="h in history[p.partId] as StockHistoryEntry[]" :key="h.id" :class="{ mine: h.repairId === repairId }">
                <span class="t faint">{{ formatDateTime(h.at) }}</span>
                <span class="badge" :class="`tone-${CHANGE[h.change].tone}`">{{ CHANGE[h.change].label(h.quantity) }}</span>
                <span class="who">{{ h.actor }}</span>
                <span class="rid mono">{{ fmtRepairId(h.repairId) }}</span>
              </li>
            </ol>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.trip {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  padding: 16px 18px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 16px;
}
.h {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 2px;
  font-size: var(--fs-lg);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 14px;
}
.tp {
  display: grid;
  gap: 10px;
  align-content: start;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
.tp[aria-busy='true'] {
  opacity: 0.85;
}
.tp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.reason {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.reason svg {
  flex: none;
  margin-top: 3px;
  color: var(--ai);
}
.stocks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: var(--fs-sm);
}
.stocks li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 2px 10px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.wh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qty b {
  color: var(--success);
}
.qty b.zero {
  color: var(--danger);
}
.state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  font-size: var(--fs-sm);
}
.acts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.acts .btn {
  flex: 1 1 140px;
}
.short {
  flex-basis: 100%;
  order: -1;
  color: var(--danger);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.hist {
  border-top: 1px solid var(--border);
  padding-top: 6px;
}
.hist-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--text-2);
  font-weight: 600;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.hist-toggle:hover {
  color: var(--primary);
}
.chev {
  transition: transform 0.2s;
}
.chev.open {
  transform: rotate(180deg);
}
.hist-body .faint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.hist-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  gap: 2px;
  font-size: var(--fs-sm);
}
.hist-list li {
  display: grid;
  grid-template-columns: 9.5em auto 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
}
.hist-list li.mine {
  background: var(--blue-50);
}
.hist-list .badge {
  font-size: var(--fs-xs);
  justify-self: start;
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 휴대폰: 이력 한 줄을 두 줄로 (시간 / 변경 · 담당자 · 수리 ID) */
@media (max-width: 480px) {
  .trip {
    padding: 14px 12px;
  }
  .hist-list li {
    grid-template-columns: auto 1fr auto;
  }
  .hist-list .t {
    grid-column: 1 / -1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
