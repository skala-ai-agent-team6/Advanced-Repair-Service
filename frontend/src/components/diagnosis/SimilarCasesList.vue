<script setup lang="ts">
/* RAG 유사 사례 목록 (최대 3건 + 외 N건) — 센터 진단 결과 · 출장 전 진단 리포트가 같이 쓴다 */
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { formatDate } from '@/utils/format'
import type { Diagnosis } from '@/types'

const props = defineProps<{ diagnosis: Diagnosis | null; missing?: string | null }>()
const cases = computed(() => props.diagnosis?.similarCases.slice(0, 3) ?? [])
const moreCases = computed(() => Math.max(0, (props.diagnosis?.similarCaseCount || 0) - cases.value.length))
const CASE_ORIGIN = { INTERNAL: { label: '사내 사례', tone: 'success' }, EXTERNAL: { label: '공개 사례', tone: 'neutral' } } as const
const CIRCLED = ['①', '②', '③']
</script>

<template>
  <ul v-if="cases.length" class="cases">
    <li v-for="(c, i) in cases" :key="c.receiptNo">
      <Check :size="18" class="ck" aria-hidden="true" />
      <span class="circ" aria-hidden="true">{{ CIRCLED[i] }}</span>
      <div class="grow">
        <div class="row between">
          <strong>{{ c.cause }}</strong>
          <span class="row tight">
            <span v-if="c.origin" class="badge" :class="`tone-${CASE_ORIGIN[c.origin].tone}`">{{ CASE_ORIGIN[c.origin].label }}</span>
            <span class="badge tone-ai">유사도 {{ c.similarity }}%</span>
          </span>
        </div>
        <p v-if="c.resolution" class="muted">→ {{ c.resolution }}</p>
        <p class="faint">{{ c.receiptNo }} · {{ c.model }}<template v-if="c.closedAt"> · {{ formatDate(c.closedAt) }}</template></p>
      </div>
    </li>
  </ul>
  <p v-else-if="missing" class="unknown"><span class="badge tone-warning">미확인</span> {{ missing }} 결과를 받지 못해 유사 사례를 확인하지 못했습니다.</p>
  <p v-else class="faint">찾은 유사 사례가 없습니다.</p>
  <p v-if="moreCases" class="faint">외 {{ moreCases }}건</p>
</template>

<style scoped>
.cases {
  list-style: none;
  margin: 0;
  padding: 0;
}
.cases li {
  display: flex;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.cases li:last-child {
  border-bottom: 0;
}
.ck {
  flex: none;
  margin-top: 3px;
  color: var(--success);
}
.circ {
  flex: none;
  font-weight: 800;
  color: var(--navy-700);
}
.grow {
  flex: 1 1 0;
  min-width: 0;
}
.row.tight {
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.unknown {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
</style>
