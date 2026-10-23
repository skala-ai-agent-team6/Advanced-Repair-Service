<script setup lang="ts">
/* 출장 일정 목록 한 줄: 방문 시간 · 고객 이름 · 주소(구·동) · 모델 · 증상 한 줄 · 상태 배지 · > (수리 작업 상세로) */
import { Check, ChevronRight, MapPin } from 'lucide-vue-next'
import RepairStatusBadge from '@/components/common/RepairStatusBadge.vue'
import type { FieldVisit } from '@/types'

defineProps<{ items: FieldVisit[] }>()
</script>

<template>
  <ol class="visits">
    <li v-for="v in items" :key="`${v.repairId}-${v.visitDate}-${v.visitTime}`">
      <RouterLink :to="`/repairs/${v.repairId}/diagnosis`" class="visit" :class="{ done: v.visitStatus === 'DONE' }">
        <span class="time">
          <b>{{ v.visitTime }}</b>
          <small v-if="v.visitStatus === 'DONE'"><Check :size="12" aria-hidden="true" /> 방문 완료</small>
        </span>
        <span class="main">
          <span class="line1">
            <strong>{{ v.customerName }}</strong>
            <span class="addr"><MapPin :size="14" aria-hidden="true" /> {{ v.district }} {{ v.neighborhood }}</span>
          </span>
          <span class="line2"><span class="model">{{ v.model }}</span> · <span class="sym">{{ v.symptom }}</span></span>
        </span>
        <RepairStatusBadge :status="v.status" class="st" />
        <ChevronRight :size="20" class="chev" aria-hidden="true" />
      </RouterLink>
    </li>
  </ol>
</template>

<style scoped>
.visits {
  list-style: none;
  margin: 0;
  padding: 4px 8px 8px;
  display: grid;
}
.visits li + li .visit {
  border-top: 1px solid var(--border);
}
.visit {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 68px;
  padding: 12px;
  border-radius: var(--radius);
  color: var(--text);
  text-decoration: none;
}
.visit:hover {
  background: var(--blue-50);
}
.time {
  flex: none;
  width: 64px;
  display: grid;
  gap: 2px;
}
.time b {
  font-size: var(--fs-lg);
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.done .time b {
  color: var(--text-3);
}
.time small {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--success);
  font-size: 11px;
  font-weight: 700;
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
  gap: 2px 10px;
}
.addr {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.line2 {
  color: var(--text-2);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model {
  font-weight: 600;
  color: var(--text);
}
.st {
  flex: none;
  font-size: var(--fs-xs);
}
.chev {
  flex: none;
  color: var(--text-3);
}
@media (max-width: 560px) {
  .visit {
    flex-wrap: wrap;
    gap: 6px 12px;
  }
  .time {
    width: auto;
  }
  .main {
    flex-basis: calc(100% - 100px);
  }
  .st {
    margin-left: 76px;
  }
  .chev {
    margin-left: auto;
  }
}
</style>
