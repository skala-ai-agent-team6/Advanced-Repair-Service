<script setup lang="ts">
/* 보증 판정 카드 (진단 리포트 1쪽 · 결론 요약 아래)
 *  AI 초안: 보라 점선 + "AI 초안" — 무상 수리 가능성(높음/낮음/판단 어려움) + 근거 3줄
 *  기사 확정: [무상 확정] [유상 확정] → 사유 모달 (AI 제안과 다르면 사유 필수) → 초록 실선 + "기사 확정 · 무상/유상" */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { CircleCheck, Phone, ShieldCheck, ShieldX } from 'lucide-vue-next'
import AiBadge from '@/components/common/AiBadge.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { decideWarranty, getWarranty, toErrorMessage } from '@/api'
import { useToastStore } from '@/stores/toast'
import { formatDateTime } from '@/utils/format'
import type { Warranty } from '@/types'

const props = defineProps<{ repairId: number; canDecide: boolean }>()
const toast = useToastStore()

const w = ref<Warranty | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    w.value = await getWarranty(props.repairId)
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => props.repairId, load)

const LEVEL = {
  FREE: { label: '높음', tone: 'success' },
  PAID: { label: '낮음', tone: 'warning' },
  UNKNOWN: { label: '판단 어려움', tone: 'neutral' },
} as const
const RESULT_LABEL = { FREE: '무상', PAID: '유상' } as const
const decided = computed(() => w.value?.decision)

/* ---------- 확정 모달 ---------- */
const dlg = reactive({ open: false, result: 'FREE' as 'FREE' | 'PAID', reason: '', error: '', busy: false })
/** AI 제안과 다르게 확정하면(판단 어려움 포함) 사유 필수 */
const reasonRequired = computed(() => !!w.value && dlg.result !== w.value.suggestion)
function open(result: 'FREE' | 'PAID') {
  Object.assign(dlg, { open: true, result, reason: '', error: '', busy: false })
}
async function confirm() {
  const reason = dlg.reason.trim()
  if (reasonRequired.value && reason.length < 2) {
    dlg.error = 'AI 제안과 다르게 확정하려면 사유를 입력해 주세요.'
    return
  }
  dlg.busy = true
  try {
    w.value = await decideWarranty(props.repairId, dlg.result, reason || undefined)
    dlg.open = false
    toast.success(`보증 판정을 ${RESULT_LABEL[dlg.result]}으로 확정했습니다.`)
  } catch (e) {
    dlg.error = toErrorMessage(e)
  } finally {
    dlg.busy = false
  }
}
</script>

<template>
  <section class="warranty" :class="decided ? 'human-zone' : 'ai-zone'" aria-labelledby="h-warranty">
    <div v-if="loading && !w" class="pad"><SkeletonBlock :lines="3" :height="20" /></div>
    <p v-else-if="error && !w" class="error-text pad" role="alert">{{ error }}</p>

    <template v-else-if="w">
      <div class="head">
        <h3 id="h-warranty" class="title">
          <template v-if="decided">
            <component :is="decided.result === 'FREE' ? ShieldCheck : ShieldX" :size="20" aria-hidden="true" />
            보증 판정: {{ RESULT_LABEL[decided.result] }} 수리
          </template>
          <template v-else>
            무상 수리 가능성:
            <span class="badge" :class="`tone-${LEVEL[w.suggestion].tone}`">{{ LEVEL[w.suggestion].label }}</span>
          </template>
        </h3>
        <AiBadge v-if="decided" kind="human" :label="`기사 확정 · ${RESULT_LABEL[decided.result]}`" />
        <AiBadge v-else compact />
      </div>

      <ul class="reasons">
        <li v-for="r in w.reasons" :key="r">{{ r }}</li>
      </ul>

      <!-- 확정 결과 -->
      <div v-if="decided" class="who">
        <CircleCheck :size="16" aria-hidden="true" />
        <span>
          {{ decided.decidedBy }} · {{ formatDateTime(decided.decidedAt) }} 확정
          <span class="faint">(AI 제안: 무상 가능성 {{ LEVEL[w.suggestion].label }})</span>
        </span>
        <p v-if="decided.reason" class="why">사유: {{ decided.reason }}</p>
      </div>

      <template v-else>
        <p v-if="w.suggestion === 'UNKNOWN' && !w.purchaseDate" class="callout tone-info ask">
          <Phone :size="18" />
          <span><strong>고객에게 구매일 확인</strong> 영수증이나 앱 구매 내역으로 구매일을 확인한 뒤 확정해 주세요.</span>
        </p>
        <div v-if="canDecide" class="row acts">
          <button type="button" class="btn btn-success" @click="open('FREE')"><ShieldCheck :size="18" /> 무상 확정</button>
          <button type="button" class="btn" @click="open('PAID')"><ShieldX :size="18" /> 유상 확정</button>
        </div>
        <p v-else class="faint">보증 판정은 담당 서비스센터 기사가 확정합니다.</p>
      </template>
    </template>

    <BaseModal :open="dlg.open" :title="`${RESULT_LABEL[dlg.result]} 확정`" :width="520" @close="!dlg.busy && (dlg.open = false)">
      <div class="stack">
        <p v-if="w" class="muted">
          AI 제안: 무상 수리 가능성 <b>{{ LEVEL[w.suggestion].label }}</b>.
          <template v-if="reasonRequired"> AI 제안과 다르게 확정하므로 사유가 필요합니다.</template>
        </p>
        <div class="field">
          <label for="w-reason" :class="{ req: reasonRequired }">확정 사유{{ reasonRequired ? '' : ' (선택)' }}</label>
          <textarea
            id="w-reason"
            v-model="dlg.reason"
            class="textarea"
            :class="{ invalid: dlg.error }"
            maxlength="500"
            :placeholder="dlg.result === 'FREE' ? '예) 영수증으로 구매일 확인, 제품 결함으로 판단' : '예) 하단 침수 흔적 확인, 사용자 과실로 판단'"
            :aria-invalid="!!dlg.error"
            @input="dlg.error = ''"
          />
          <p v-if="dlg.error" class="error-text" role="alert">{{ dlg.error }}</p>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn" :disabled="dlg.busy" @click="dlg.open = false">취소</button>
        <button type="button" class="btn" :class="dlg.result === 'FREE' ? 'btn-success' : 'btn-primary'" :disabled="dlg.busy" @click="confirm">
          {{ dlg.busy ? '확정 중…' : `${RESULT_LABEL[dlg.result]} 확정` }}
        </button>
      </template>
    </BaseModal>
  </section>
</template>

<style scoped>
.warranty {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
}
.pad {
  padding: 4px 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--fs-lg);
}
.human-zone .title {
  color: var(--success);
}
.reasons {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 4px;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  padding-top: 8px;
  border-top: 1px solid var(--success-border);
  color: var(--success);
  font-weight: 600;
  font-size: var(--fs-sm);
}
.why {
  flex-basis: 100%;
  color: var(--text);
  font-weight: 500;
}
.ask {
  font-size: var(--fs-sm);
}
.ask strong {
  display: inline;
  margin-right: 4px;
}
.acts .btn {
  flex: 1 1 140px;
}
</style>
