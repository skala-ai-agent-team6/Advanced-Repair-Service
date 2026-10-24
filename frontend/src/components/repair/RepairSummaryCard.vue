<script setup lang="ts">
/* 수리 건 요약 — 수리 방법(고객이 고른 방문 수리 / 센터 방문)은 배지로 표시만, 기사는 [수리 방법 변경](사유 필수 · 이력 기록) */
import { computed, ref } from 'vue'
import { Building2, Home } from 'lucide-vue-next'
import RepairStatusBadge from '@/components/common/RepairStatusBadge.vue'
import ServiceTypeChangeModal from '@/components/repair/ServiceTypeChangeModal.vue'
import { repairApi, toErrorMessage, USE_MOCK } from '@/api'
import { FEATURES } from '@/api/features'
import { SERVICE_TYPE_LABEL, VISIT_SLOT_LABEL, type ServiceType } from '@/constants/serviceType'
import { useAuthStore } from '@/stores/auth'
import { useRepairDetailStore } from '@/stores/repairDetail'
import { useToastStore } from '@/stores/toast'
import { formatDateTime, repairId } from '@/utils/format'
import type { Repair } from '@/types'

const props = defineProps<{ repair: Repair; compact?: boolean }>()
const auth = useAuthStore()
const toast = useToastStore()
const detail = useRepairDetailStore()

/** 실서버는 수리 방법 필드가 생길 때까지(FEATURES.visitInfo) 표시하지 않음 */
const service = computed(() => ((USE_MOCK || FEATURES.visitInfo) ? props.repair.visitInfo : undefined))
const canChange = computed(() => auth.role === 'TECHNICIAN' && !!service.value?.serviceType)
const changeOpen = ref(false)
const changing = ref(false)
async function onChange(v: { serviceType: ServiceType; centerId?: string; reason: string }) {
  changing.value = true
  try {
    const r = await repairApi.changeServiceType(props.repair.id, { serviceType: v.serviceType, centerId: v.centerId, reason: v.reason })
    if (detail.repair?.id === r.id) detail.repair = r
    changeOpen.value = false
    toast.success(`수리 방법을 ${SERVICE_TYPE_LABEL[v.serviceType]}(으)로 바꿨습니다. 처리 이력에 기록됩니다.`)
  } catch (e) {
    toast.error(toErrorMessage(e))
  } finally {
    changing.value = false
  }
}
</script>

<template>
  <section class="card summary" aria-label="접수 정보 요약">
    <div class="top">
      <div>
        <div class="row">
          <span class="mono rno">수리 ID {{ repairId(repair.id) }}</span>
          <RepairStatusBadge :status="repair.status" :failed="!!repair.analysisError" />
        </div>
        <h2>{{ repair.product.modelName }}</h2>
      </div>
      <slot name="actions" />
    </div>
    <dl class="kv cols" :class="{ compact }">
      <div><dt>시리얼 번호</dt><dd class="mono">{{ repair.product.serialNumber }}</dd></div>
      <div><dt>에러 코드</dt><dd>{{ repair.errorCodes.length ? repair.errorCodes.join(', ') : '없음' }}</dd></div>
      <div><dt>접수번호</dt><dd class="mono">{{ repair.receiptNo }}</dd></div>
      <div><dt>접수일</dt><dd>{{ formatDateTime(repair.receivedAt) }}</dd></div>
      <div v-if="service?.serviceType">
        <dt>수리 방법</dt>
        <dd class="svc">
          <span class="badge" :class="service.serviceType === 'VISIT' ? 'tone-info' : 'tone-neutral'">
            <component :is="service.serviceType === 'VISIT' ? Home : Building2" :size="14" aria-hidden="true" /> {{ SERVICE_TYPE_LABEL[service.serviceType] }}
          </span>
          <span class="faint">{{ service.serviceType === 'CENTER' ? service.centerName : service.visitSlot ? VISIT_SLOT_LABEL[service.visitSlot] : '' }}</span>
          <button v-if="canChange" type="button" class="btn btn-sm btn-ghost svc-btn" aria-haspopup="dialog" @click="changeOpen = true">수리 방법 변경</button>
        </dd>
      </div>
      <div><dt>담당 기사</dt><dd>{{ repair.technician }} · {{ repair.branch }}<span v-if="repair.source === 'CUSTOMER'" class="badge tone-info" style="margin-left: 6px">고객 접수</span></dd></div>
      <div v-if="!compact"><dt>생산 공장</dt><dd>{{ repair.product.factory }}</dd></div>
      <div v-if="!compact"><dt>펌웨어</dt><dd>{{ repair.product.firmware }}</dd></div>
      <div class="wide"><dt>고장 증상</dt><dd>{{ repair.symptom }}</dd></div>
      <div v-if="repair.technicianNote" class="wide"><dt>기사 소견</dt><dd class="pre">{{ repair.technicianNote }}</dd></div>
    </dl>
    <ServiceTypeChangeModal
      v-if="service?.serviceType"
      :open="changeOpen"
      :current="service.serviceType"
      :current-center-id="service.centerId"
      :product-type="repair.product.productType"
      :busy="changing"
      @close="changeOpen = false"
      @submit="onChange"
    />
  </section>
</template>

<style scoped>
.summary {
  padding: 18px 22px;
  display: grid;
  gap: 14px;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.rno {
  font-weight: 700;
  color: var(--navy-700);
}
h2 {
  font-size: var(--fs-xl);
  margin-top: 6px;
}
.cols {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px 20px;
}
.cols > div {
  display: grid;
  gap: 2px;
}
.cols dt {
  font-size: var(--fs-sm);
}
.wide {
  grid-column: 1 / -1;
}
.pre {
  white-space: pre-wrap;
}
.svc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.svc-btn {
  min-height: 0;
  padding: 2px 8px;
  font-size: var(--fs-xs);
}
</style>
