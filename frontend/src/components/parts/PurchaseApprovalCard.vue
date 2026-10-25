<script setup lang="ts">
/* =========================================================================
 * 발주 카드
 *  - 기사(TECHNICIAN): AI 발주안(AI_DRAFT)을 검토·수량 조정 후 "발주 요청 등록" (사람 확인)
 *  - 본사 품질 담당자(QUALITY_MANAGER): 요청(REQUESTED)을 승인·반려
 * AI 는 제안만 하며, 어떤 경우에도 자동으로 발주되지 않는다.
 * 기사 화면에서는 전체 창고 재고로 분기: 부족하면 생산 공장·연락처·예상 입고일을 함께 보여 준다.
 * ========================================================================= */
import { computed, ref, watch } from 'vue'
import { CircleCheck, CircleX, Send, Package, CircleAlert, Factory, Warehouse } from 'lucide-vue-next'
import AiBadge from '@/components/common/AiBadge.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import ConfidenceBar from '@/components/common/ConfidenceBar.vue'
import { ORDER_STATUS_META, ROLE_LABEL } from '@/constants/status'
import type { Part, PurchaseOrder, Role } from '@/types'
import { formatDate, formatDateTime, formatNumber, repairId } from '@/utils/format'

const props = defineProps<{ order: PurchaseOrder; part?: Part; role: Role | null; busy?: boolean }>()
const emit = defineEmits<{
  request: [payload: { quantity: number; fromWarehouse: string; comment: string }]
  decide: [payload: { action: 'APPROVE' | 'REJECT'; comment: string }]
}>()

const qty = ref(props.order.quantity)
const wh = ref(props.order.fromWarehouse)
const comment = ref('')
const confirmChecked = ref(false)
const err = ref<string | null>(null)
watch(() => props.order, (o) => {
  qty.value = o.quantity
  wh.value = o.fromWarehouse
})

const stockAt = computed(() => props.part?.stocks.find((s) => s.warehouse === wh.value)?.quantity ?? 0)
const shortage = computed(() => qty.value > stockAt.value)
const meta = computed(() => ORDER_STATUS_META[props.order.status])
const canRequest = computed(() => props.role === 'TECHNICIAN' && (props.order.status === 'AI_DRAFT' || props.order.status === 'REJECTED'))
/** 전체 창고 재고 · 발주 필요 여부 · 예상 입고일 (오늘 + 생산 리드타임) */
const totalStock = computed(() => props.part?.stocks.reduce((a, s) => a + s.quantity, 0) ?? 0)
const needOrder = computed(() => totalStock.value < qty.value)
const eta = computed(() => (props.part ? formatDate(new Date(Date.now() + props.part.leadTimeDays * 86_400_000).toISOString()) : '-'))
const canDecide = computed(() => props.role === 'QUALITY_MANAGER' && props.order.status === 'REQUESTED')

function submitRequest() {
  if (!confirmChecked.value) {
    err.value = '내용을 확인했다는 항목에 체크해 주세요.'
    return
  }
  if (qty.value < 1) {
    err.value = '발주 수량은 1개 이상이어야 합니다.'
    return
  }
  err.value = null
  emit('request', { quantity: qty.value, fromWarehouse: wh.value, comment: comment.value.trim() })
}
function decide(action: 'APPROVE' | 'REJECT') {
  if (action === 'REJECT' && !comment.value.trim()) {
    err.value = '반려 사유를 입력해 주세요.'
    return
  }
  err.value = null
  pending.value = action
}
/** 승인·반려 전 확인 모달 (US-06) — 확인을 눌러야 요청이 나간다 */
const pending = ref<'APPROVE' | 'REJECT' | null>(null)
function confirmDecide() {
  if (!pending.value || props.busy) return
  emit('decide', { action: pending.value, comment: comment.value.trim() })
  pending.value = null
}
</script>

<template>
  <article class="card po" :class="`s-${order.status}`">
    <header class="card-head">
      <h3><Package :size="20" /> {{ order.partName }} <span class="mono faint">{{ order.partNo }}</span></h3>
      <span class="badge" :class="`tone-${meta.tone}`">{{ meta.label }}</span>
    </header>
    <div class="card-body grid">
      <!-- AI 추천 -->
      <div class="ai-zone rec">
        <AiBadge compact label="AI 발주 제안" />
        <p class="faint">수리 ID <RouterLink :to="`/repairs/${order.repairId}/diagnosis`" class="mono">{{ repairId(order.repairId) }}</RouterLink></p>
        <p><strong>AI 추천 이유</strong><br />{{ order.aiReason }}</p>
        <ConfidenceBar v-if="order.aiConfidence" :value="order.aiConfidence" size="sm" />
        <p class="faint">AI 는 발주안을 제안만 합니다. 담당자가 확인·승인해야 발주가 등록됩니다.</p>
      </div>

      <!-- 사람 입력 / 결정 -->
      <div class="stack">
        <template v-if="canRequest">
          <div v-if="part && needOrder" class="callout tone-warning stock-state">
            <Factory :size="20" />
            <div>
              <strong>재고 부족 · 발주 필요</strong>
              전체 창고 재고 {{ totalStock }}개 / 필요 {{ qty }}개
              <dl class="kv mini">
                <dt>생산 공장</dt>
                <dd>{{ part.factory }}</dd>
                <dt>담당 · 연락처</dt>
                <dd>
                  <template v-if="part.factoryContact.manager">{{ part.factoryContact.manager }} · </template>
                  <a v-if="part.factoryContact.phone" :href="`tel:${part.factoryContact.phone}`">{{ part.factoryContact.phone }}</a>
                  <template v-if="part.factoryContact.email"> · <a :href="`mailto:${part.factoryContact.email}`">{{ part.factoryContact.email }}</a></template>
                  <template v-if="!part.factoryContact.phone && !part.factoryContact.email">-</template>
                </dd>
                <dt>예상 입고일</dt>
                <dd>{{ eta }} (생산 약 {{ part.leadTimeDays }}일)</dd>
              </dl>
            </div>
          </div>
          <div v-else-if="part" class="callout tone-success stock-state">
            <Warehouse :size="20" />
            <div><strong>창고 재고가 있습니다</strong> (전체 {{ totalStock }}개) 재고로 수리할 수 없을 때만 발주를 요청하세요.</div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label :for="`qty-${order.id}`" class="req">발주 수량</label>
              <input :id="`qty-${order.id}`" v-model.number="qty" type="number" min="1" max="99" class="input" inputmode="numeric" />
            </div>
            <div class="field">
              <label :for="`wh-${order.id}`" class="req">출고 창고</label>
              <select :id="`wh-${order.id}`" v-model="wh" class="select">
                <option v-for="s in part?.stocks ?? []" :key="s.warehouse" :value="s.warehouse">{{ s.warehouse }} (재고 {{ s.quantity }})</option>
              </select>
            </div>
          </div>
          <p v-if="shortage" class="callout tone-warning">
            <CircleAlert :size="18" />
            <span>선택한 창고 재고({{ stockAt }}개)보다 많습니다. 부족분은 {{ part?.factory }}에서 생산 후 약 {{ part?.leadTimeDays }}일 뒤 입고됩니다.</span>
          </p>
          <div class="field">
            <label :for="`cm-${order.id}`">요청 메모</label>
            <textarea :id="`cm-${order.id}`" v-model="comment" class="textarea" style="min-height: 80px" placeholder="본사 품질 담당자에게 전달할 내용 (선택)" />
          </div>
          <label class="check">
            <input v-model="confirmChecked" type="checkbox" />
            <span>AI 발주안의 부품·수량·창고를 직접 확인했습니다.</span>
          </label>
          <p v-if="err" class="error-text" role="alert"><CircleAlert :size="16" /> {{ err }}</p>
          <button type="button" class="btn btn-primary btn-lg" :disabled="busy" @click="submitRequest">
            <Send :size="20" /> {{ busy ? '등록 중…' : order.status === 'REJECTED' ? '발주 다시 요청' : '발주 요청 등록' }}
          </button>
          <p v-if="part?.unitPrice" class="faint">예상 금액 {{ formatNumber(part.unitPrice * qty) }}원</p>
        </template>

        <template v-else>
          <dl class="kv">
            <dt>수량</dt>
            <dd>{{ order.quantity }}개</dd>
            <dt>출고 창고</dt>
            <dd>{{ order.fromWarehouse }}</dd>
            <template v-if="order.requestedBy">
              <dt>요청자</dt>
              <dd>{{ order.requestedBy }} · {{ formatDateTime(order.requestedAt) }}</dd>
            </template>
            <template v-if="order.requestComment">
              <dt>요청 메모</dt>
              <dd>{{ order.requestComment }}</dd>
            </template>
          </dl>

          <div v-if="order.decision.state !== 'PENDING'" class="decided" :class="order.decision.state === 'APPROVED' ? 'human-zone' : 'neg'">
            <AiBadge v-if="order.decision.state === 'APPROVED'" kind="human" label="본사 품질 담당자 승인" />
            <dl class="kv">
              <dt>{{ order.decision.state === 'APPROVED' ? '승인자' : '반려자' }}</dt>
              <dd>{{ order.decision.decidedBy }} · {{ order.decision.decidedByRole ? ROLE_LABEL[order.decision.decidedByRole] : '' }}</dd>
              <dt>처리 시각</dt>
              <dd>{{ formatDateTime(order.decision.decidedAt) }}</dd>
              <template v-if="order.decision.comment">
                <dt>의견</dt>
                <dd>{{ order.decision.comment }}</dd>
              </template>
            </dl>
          </div>

          <template v-if="canDecide">
            <p v-if="shortage" class="callout tone-warning"><CircleAlert :size="18" /> {{ order.fromWarehouse }} 재고({{ stockAt }}개)가 요청 수량보다 적습니다.</p>
            <div class="field">
              <label :for="`dc-${order.id}`">승인 의견 · 반려 사유</label>
              <textarea :id="`dc-${order.id}`" v-model="comment" class="textarea" style="min-height: 80px" placeholder="반려 시 사유는 필수입니다." />
            </div>
            <p v-if="err" class="error-text" role="alert"><CircleAlert :size="16" /> {{ err }}</p>
            <div class="row">
              <button type="button" class="btn btn-success btn-lg" :disabled="busy" @click="decide('APPROVE')"><CircleCheck :size="20" /> 발주 승인</button>
              <button type="button" class="btn btn-danger btn-lg" :disabled="busy" @click="decide('REJECT')"><CircleX :size="20" /> 반려</button>
            </div>
          </template>
          <p v-else-if="order.status === 'REQUESTED'" class="callout tone-warning"><CircleAlert :size="18" /> 본사 품질 담당자 승인을 기다리고 있습니다.</p>
        </template>
      </div>
    </div>

    <BaseModal :open="!!pending" :title="pending === 'APPROVE' ? '발주를 승인하시겠습니까?' : '발주를 반려하시겠습니까?'" :width="460" @close="pending = null">
      <dl class="kv">
        <dt>부품</dt>
        <dd>{{ order.partName }} · {{ order.quantity }}개</dd>
        <dt>출고 창고</dt>
        <dd>{{ order.fromWarehouse }}</dd>
        <template v-if="comment.trim()">
          <dt>{{ pending === 'APPROVE' ? '승인 의견' : '반려 사유' }}</dt>
          <dd>{{ comment.trim() }}</dd>
        </template>
      </dl>
      <p class="faint">{{ pending === 'APPROVE' ? '승인하면 발주가 등록되고 출고 창고 재고가 차감됩니다.' : '반려하면 기사에게 사유가 전달되고, 기사가 다시 요청할 수 있습니다.' }}</p>
      <template #footer>
        <button type="button" class="btn" @click="pending = null">취소</button>
        <button type="button" class="btn btn-lg" :class="pending === 'APPROVE' ? 'btn-success' : 'btn-danger'" :disabled="busy" @click="confirmDecide">
          {{ pending === 'APPROVE' ? '승인' : '반려' }}
        </button>
      </template>
    </BaseModal>
  </article>
</template>

<style scoped>
.po.s-REQUESTED {
  border: 2px solid var(--warning-border);
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 18px;
}
.rec {
  padding: 14px 16px;
  display: grid;
  gap: 10px;
  align-content: start;
}
.check {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 600;
  min-height: 44px;
  cursor: pointer;
}
.check input {
  width: 24px;
  height: 24px;
  accent-color: var(--navy-800);
}
.decided {
  padding: 12px 16px;
  display: grid;
  gap: 8px;
}
.decided.neg {
  border: 2px solid var(--danger-border);
  background: var(--danger-bg);
  border-radius: var(--radius-lg);
}
@media (max-width: 1000px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
.stock-state {
  align-items: flex-start;
}
.stock-state .mini {
  margin-top: 6px;
  font-size: var(--fs-sm);
}
</style>
