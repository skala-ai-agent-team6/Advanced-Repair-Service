<script setup lang="ts">
/* [출장] 출장 준비 공구 — 업무 MCP 방문 준비 리포트(박진영)의 추천 공구·주의사항.
 *  Mock 모드나 연결 실패 시 카드를 숨긴다 */
import { ref, watch } from 'vue'
import { Wrench } from 'lucide-vue-next'
import { getPreparationReport, type PreparationReport } from '@/api/stock'

const props = defineProps<{ repairId: number }>()
const report = ref<PreparationReport | null>(null)
watch(() => props.repairId, async (id) => {
  report.value = null
  try { report.value = id ? await getPreparationReport(id) : null } catch { report.value = null }
}, { immediate: true })
</script>

<template>
  <div v-if="report && report.report_status !== 'UNAVAILABLE'" class="prep-tools" aria-label="출장 준비 공구">
    <h4><Wrench :size="16" aria-hidden="true" /> 준비 공구</h4>
    <ul v-if="report.recommended_tools?.length">
      <!-- [출장] 준비 공구는 앞 4개만 (대장 지시) -->
      <li v-for="t in report.recommended_tools.slice(0, 4)" :key="t.name"><strong>{{ t.name }}</strong> — {{ t.purpose }}</li>
    </ul>
    <p v-else class="faint">진단 근거에서 특정 공구를 확인하지 못했습니다. 방문 전 확인이 필요합니다.</p>
    <ul v-if="report.warnings?.length" class="faint warn">
      <li v-for="w in report.warnings" :key="w">{{ w }}</li>
    </ul>
  </div>
</template>

<style scoped>
.prep-tools { margin-top: 12px; padding: 12px; border: 1px solid var(--border, #e5e7eb); border-radius: 8px; }
.prep-tools h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: 14px; }
.prep-tools ul { margin: 0; padding-left: 18px; }
.prep-tools li { margin: 2px 0; font-size: 13px; }
.warn { margin-top: 8px !important; }
</style>
