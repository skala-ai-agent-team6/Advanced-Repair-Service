<script setup lang="ts">
/* 기사 작업 목록 한 줄: #ID · 모델 · 증상 한 줄, 오른쪽 > 아이콘. 누르면 수리 작업 상세(진단 리포트)로 */
import { ChevronRight } from 'lucide-vue-next'
import RepairStatusBadge from '@/components/common/RepairStatusBadge.vue'
import { repairId } from '@/utils/format'
import type { Repair } from '@/types'

defineProps<{ items: Repair[]; highlightId?: number | null }>()
</script>

<template>
  <ul class="works">
    <li v-for="r in items" :key="r.id">
      <RouterLink :to="`/repairs/${r.id}/diagnosis`" class="work" :class="{ hl: r.id === highlightId }">
        <span class="main">
          <span class="line1">
            <b class="mono rid">{{ repairId(r.id) }}</b>
            <span class="model">{{ r.product.model }}</span>
            <RepairStatusBadge :status="r.status" :failed="!!r.analysisError" class="st" />
          </span>
          <span class="sym">{{ r.symptom }}</span>
        </span>
        <ChevronRight :size="20" class="chev" aria-hidden="true" />
      </RouterLink>
    </li>
  </ul>
</template>

<style scoped>
.works {
  list-style: none;
  margin: 0;
  padding: 4px 8px 8px;
  display: grid;
}
.works li + li .work {
  border-top: 1px solid var(--border);
}
.work {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px;
  border-radius: var(--radius);
  color: var(--text);
  text-decoration: none;
}
.work:hover,
.work.hl {
  background: var(--blue-50);
}
.main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.line1 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
}
.rid {
  color: var(--primary);
}
.model {
  font-weight: 600;
}
.st {
  font-size: var(--fs-xs);
}
.sym {
  color: var(--text-2);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  flex: none;
  color: var(--text-3);
}
</style>
