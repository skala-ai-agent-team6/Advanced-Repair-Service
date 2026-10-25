<script setup lang="ts">
/* 수리 건 상단의 업무 흐름 내비게이션: 접수 → AI 분석 → 진단 확인 → 부품·발주 → 수리 리포트 → 리포트 확정 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Check } from 'lucide-vue-next'
import { FLOW_STEPS, currentFlowStep } from '@/utils/repairFlow'
import type { Repair } from '@/types'

const props = defineProps<{ repair: Repair }>()
const route = useRoute()
const curIdx = computed(() => FLOW_STEPS.findIndex((s) => s.key === currentFlowStep(props.repair.status)))
const viewing = computed(() => {
  const n = route.name
  return n === 'repair-progress' ? 1 : n === 'repair-diagnosis' ? (route.query.page === '2' ? 3 : 2) : n === 'repair-parts' ? 3 : n === 'repair-review' ? 4 : -1
})
// 아직 도달하지 않은 단계로는 이동 불가 (단, 부품 조회는 진단 확인 이후 가능)
const reachable = (i: number) => i <= Math.max(curIdx.value, props.repair.status === 'TECHNICIAN_REVIEW' ? 4 : curIdx.value)
</script>

<template>
  <nav class="flow card" aria-label="수리 처리 단계">
    <template v-for="(s, i) in FLOW_STEPS" :key="s.key">
      <RouterLink
        v-if="reachable(i) && i > 0 && i !== 5"
        :to="s.route(repair.id)"
        class="step"
        :class="{ done: i < curIdx, cur: i === curIdx, viewing: i === viewing }"
        :aria-current="i === viewing ? 'page' : undefined"
      >
        <span class="dot"><Check v-if="i < curIdx" :size="14" /><template v-else>{{ i + 1 }}</template></span>{{ s.label }}
      </RouterLink>
      <span v-else class="step" :class="{ done: i < curIdx, cur: i === curIdx, off: !reachable(i) }">
        <span class="dot"><Check v-if="i < curIdx" :size="14" /><template v-else>{{ i + 1 }}</template></span>{{ s.label }}
      </span>
      <span v-if="i < FLOW_STEPS.length - 1" class="sep" aria-hidden="true" />
    </template>
  </nav>
</template>

<style scoped>
.flow {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  overflow-x: auto;
}
.step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-pill);
  text-decoration: none;
  color: var(--text-2);
  font-weight: 600;
  white-space: nowrap;
  min-height: 44px;
}
a.step:hover {
  background: var(--navy-50);
}
.step.off {
  color: var(--text-3);
  opacity: 0.6;
}
.step.done {
  color: var(--success);
}
.step.cur {
  color: var(--navy-900);
  font-weight: 800;
}
.step.viewing {
  background: var(--navy-50);
  box-shadow: inset 0 -3px 0 var(--navy-700);
}
.dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: var(--fs-xs);
  background: var(--neutral-bg);
  color: var(--text-2);
}
.done .dot {
  background: var(--success);
  color: #fff;
}
.cur .dot {
  background: var(--navy-800);
  color: #fff;
}
.sep {
  flex: 1;
  min-width: 12px;
  height: 2px;
  background: var(--border);
}
</style>
