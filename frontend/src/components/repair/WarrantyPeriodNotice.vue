<script setup lang="ts">
/* 보증 기간 안내 박스 (접수 화면) — 보증 상태와 만료 월만 안내한다.
 * "무상입니다" 같은 확정 표현은 쓰지 않는다 (무상/유상은 기사 진단 후 확정). UNKNOWN 이면 숨김 */
import { CircleCheck, Info } from 'lucide-vue-next'
import type { WarrantyPeriod } from '@/types'

defineProps<{ period: WarrantyPeriod | null }>()

const yearMonth = (d?: string) => (d ? `${Number(d.slice(0, 4))}년 ${Number(d.slice(5, 7))}월` : '')
</script>

<template>
  <div v-if="period && period.status === 'IN_WARRANTY'" class="callout tone-success wp" role="status">
    <CircleCheck :size="20" />
    <div>
      <strong>
        보증 기간 안이에요<template v-if="period.until"> ({{ yearMonth(period.until) }}까지)</template>
        <span v-if="period.basis === 'MANUFACTURE_DATE_ESTIMATE'" class="est">· 추정</span>
      </strong>
      <span class="line2">제품 결함으로 확인되면 무상으로 수리해 드려요. 최종 결과는 기사님 확인 후 안내해 드려요.</span>
    </div>
  </div>
  <div v-else-if="period && period.status === 'EXPIRED'" class="callout tone-info wp" role="status">
    <Info :size="20" />
    <div><strong>보증 기간이 지났어요. 수리비는 진단 후 안내해 드려요.</strong></div>
  </div>
</template>

<style scoped>
.wp {
  font-size: var(--fs-sm);
}
.est {
  margin-left: 4px;
  color: var(--text-3);
  font-weight: 500;
}
.line2 {
  color: var(--text-2);
}
</style>
