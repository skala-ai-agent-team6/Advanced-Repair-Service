<script setup lang="ts">
/* 수리 방법 변경 모달 (기사) — 바꿀 방법(센터 방문이면 서비스센터) + 변경 사유(필수)
 *  고객이 고른 값을 이어받되, 현장 사정으로 바꿔야 할 때만 사용. 저장(이력 기록)은 부모가 한다 */
import { computed, reactive, ref, watch } from 'vue'
import { Building2, Home } from 'lucide-vue-next'
import BaseModal from '@/components/common/BaseModal.vue'
import { getServiceCenters } from '@/api'
import { SERVICE_TYPE_DESC, SERVICE_TYPE_LABEL, type ServiceCenter, type ServiceType } from '@/constants/serviceType'
import { canBringToCenter, type ProductType } from '@/constants/products'

const props = defineProps<{ open: boolean; current: ServiceType; currentCenterId?: string; productType?: ProductType | ''; busy?: boolean }>()
const emit = defineEmits<{ close: []; submit: [v: { serviceType: ServiceType; centerId?: string; centerName?: string; reason: string }] }>()

const centers = ref<ServiceCenter[]>([])
const f = reactive({ serviceType: props.current, centerId: props.currentCenterId ?? '', reason: '' })
const touched = ref(false)
watch(
  () => props.open,
  async (o) => {
    if (!o) return
    Object.assign(f, { serviceType: props.current === 'VISIT' ? 'CENTER' : 'VISIT', centerId: props.currentCenterId ?? '', reason: '' })
    touched.value = false
    if (!centers.value.length) centers.value = await getServiceCenters().catch(() => [])
  },
)
const centerAllowed = computed(() => canBringToCenter(props.productType ?? ''))
const errs = computed(() => ({
  center: f.serviceType === 'CENTER' && !f.centerId ? '서비스센터를 골라 주세요.' : null,
  reason: f.reason.trim().length < 2 ? '변경 사유를 입력해 주세요.' : null,
  same: f.serviceType === props.current && (f.serviceType === 'VISIT' || f.centerId === props.currentCenterId) ? '지금과 같은 수리 방법입니다.' : null,
}))
function save() {
  touched.value = true
  if (errs.value.center || errs.value.reason || errs.value.same) return
  emit('submit', {
    serviceType: f.serviceType,
    ...(f.serviceType === 'CENTER' ? { centerId: f.centerId, centerName: centers.value.find((c) => c.id === f.centerId)?.name } : {}),
    reason: f.reason.trim(),
  })
}
const ICON = { VISIT: Home, CENTER: Building2 } as const
</script>

<template>
  <BaseModal :open="open" title="수리 방법 변경" :width="520" @close="emit('close')">
    <div class="stack">
      <p class="faint">지금: <b>{{ SERVICE_TYPE_LABEL[current] }}</b> · 고객이 고른 방법을 바꿀 때만 사용하세요. 변경 내용과 사유는 처리 이력에 남습니다.</p>
      <div class="choice-group" role="radiogroup" aria-label="바꿀 수리 방법">
        <button
          v-for="t in (['VISIT', 'CENTER'] as const)"
          :key="t"
          type="button"
          class="choice"
          role="radio"
          :aria-checked="f.serviceType === t"
          :disabled="t === 'CENTER' && !centerAllowed"
          @click="f.serviceType = t"
        >
          <component :is="ICON[t]" :size="22" aria-hidden="true" />
          <span class="ct"><strong>{{ SERVICE_TYPE_LABEL[t] }}</strong><small>{{ t === 'CENTER' && !centerAllowed ? '이 제품은 방문 수리만 가능해요' : SERVICE_TYPE_DESC[t] }}</small></span>
        </button>
      </div>
      <div v-if="f.serviceType === 'CENTER'" class="field">
        <label for="stc-center" class="req">서비스센터</label>
        <select id="stc-center" v-model="f.centerId" class="select" :aria-invalid="touched && !!errs.center">
          <option value="">서비스센터 선택</option>
          <option v-for="c in centers" :key="c.id" :value="c.id">{{ c.name }} · {{ c.address }}</option>
        </select>
        <p v-if="touched && errs.center" class="error-text">{{ errs.center }}</p>
      </div>
      <div class="field">
        <label for="stc-reason" class="req">변경 사유</label>
        <textarea id="stc-reason" v-model="f.reason" class="textarea" maxlength="300" placeholder="예) 현장 수리 불가로 센터 입고" :aria-invalid="touched && !!errs.reason" />
        <p v-if="touched && errs.reason" class="error-text">{{ errs.reason }}</p>
      </div>
      <p v-if="touched && errs.same" class="error-text">{{ errs.same }}</p>
    </div>
    <template #footer>
      <button type="button" class="btn" :disabled="busy" @click="emit('close')">취소</button>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="save">{{ busy ? '변경 중…' : '변경' }}</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.choice {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}
.ct {
  display: grid;
}
.ct small {
  font-weight: 500;
  color: var(--text-3);
}
</style>
