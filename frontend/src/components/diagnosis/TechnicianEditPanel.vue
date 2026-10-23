<script setup lang="ts">
/* 출장 전 진단 리포트 — 기사 수정 영역
 *  수정 중: 수정 가능한 항목만 입력칸 (예상 원인 의견 · 현장 점검 예정 · 권장 수리 방법 · 기사 메모). 각 칸 위에 AI 초안 원문(보라 점선)
 *  저장 후: 기사 수정 내용(파란 실선) + 수정자 · 수정 시각 · 버전. 기사 확인을 마치면 초록 실선 '기사 확인 완료'
 *  사진·이상 영역·판단 점수·판단 근거 등 AI 결과는 여기서 다루지 않는다 (읽기 전용 그대로) */
import { computed } from 'vue'
import AiBadge from '@/components/common/AiBadge.vue'
import { PRE_VISIT_TEXT_MAX } from '@/composables/usePreVisitEdit'
import { formatDateTime } from '@/utils/format'
import type { Diagnosis, PreVisitReview, TechnicianReportEdit } from '@/types'

const props = defineProps<{
  diagnosis: Diagnosis
  edit: TechnicianReportEdit | null
  editing: boolean
  form: { suspectedCauseComment: string; inspectionPlan: string; repairMethod: string; technicianMemo: string }
  errors: Partial<Record<'suspectedCauseComment' | 'inspectionPlan' | 'repairMethod' | 'technicianMemo', string | null>>
  showErrors: boolean
  review: PreVisitReview | null
  reviewedCurrent: boolean
}>()

const FIELDS = computed(() => [
  { key: 'suspectedCauseComment' as const, label: '예상 원인에 대한 기사 의견', ai: props.diagnosis.topCause, placeholder: '예) AI 1순위 원인과 같다고 봄 · 다만 커넥터 산화 가능성도 점검' },
  { key: 'inspectionPlan' as const, label: '현장 점검 예정 내용', ai: props.diagnosis.inspectionSteps.join('\n'), placeholder: '현장에서 점검할 순서를 적어 주세요.' },
  { key: 'repairMethod' as const, label: '권장 수리 방법', ai: props.diagnosis.repairMethod.join('\n'), placeholder: '수리 방법을 적어 주세요.' },
  { key: 'technicianMemo' as const, label: '기사 메모', ai: '', placeholder: '고객 요청 · 방문 시 참고 사항 (선택)' },
])
const shown = computed(() => FIELDS.value.filter((f) => props.edit?.[f.key]))
</script>

<template>
  <!-- 수정 중 -->
  <section v-if="editing" class="tech-zone panel" aria-labelledby="h-tech-edit">
    <header class="ph">
      <h2 id="h-tech-edit" class="h">기사 수정</h2>
      <AiBadge kind="edit" />
    </header>
    <p class="faint">AI 원본은 그대로 보존되고, 아래 수정 내용이 기사 수정안으로 따로 저장됩니다.</p>
    <div v-for="f in FIELDS" :key="f.key" class="field">
      <label :for="`pv-${f.key}`">{{ f.label }}</label>
      <div v-if="f.ai" class="ai-zone ai-ref">
        <AiBadge compact />
        <p class="pre">{{ f.ai }}</p>
      </div>
      <textarea
        :id="`pv-${f.key}`"
        v-model="form[f.key]"
        class="textarea"
        :maxlength="PRE_VISIT_TEXT_MAX"
        :placeholder="f.placeholder"
        :class="{ invalid: showErrors && errors[f.key] }"
        :aria-invalid="showErrors && !!errors[f.key]"
      />
      <p v-if="showErrors && errors[f.key]" class="error-text">{{ errors[f.key] }}</p>
    </div>
  </section>

  <!-- 저장된 기사 수정안 -->
  <section v-else-if="edit" class="panel" :class="reviewedCurrent ? 'human-zone' : 'tech-zone'" aria-labelledby="h-tech-saved">
    <header class="ph">
      <h2 id="h-tech-saved" class="h">기사 수정 내용</h2>
      <AiBadge kind="edit" />
      <AiBadge v-if="reviewedCurrent" kind="human" label="기사 확인 완료" />
    </header>
    <p class="meta">{{ edit.editedBy }} 기사 · {{ formatDateTime(edit.editedAt) }} 수정 <span class="faint">(수정 v{{ edit.version }})</span></p>
    <dl class="kv">
      <template v-for="f in shown" :key="f.key">
        <dt>{{ f.label }}</dt>
        <dd class="pre">{{ edit[f.key] }}</dd>
      </template>
    </dl>
    <p v-if="!shown.length" class="faint">글 항목은 바꾸지 않았습니다. (준비할 부품만 수정)</p>
    <p v-if="review && !reviewedCurrent" class="faint">수정 후 아직 리포트 확인 전입니다. (마지막 확인: {{ review.reviewedBy }} · {{ formatDateTime(review.reviewedAt) }})</p>
  </section>
</template>

<style scoped>
.panel {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
}
.ph {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ph .h {
  margin: 0;
}
.ai-ref {
  display: grid;
  gap: 4px;
  padding: 8px 12px;
  justify-items: start;
}
.ai-ref p {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-2);
}
.pre {
  white-space: pre-line;
}
.meta {
  margin: 0;
  font-weight: 600;
  color: var(--primary);
}
.human-zone .meta {
  color: var(--success);
}
.textarea {
  min-height: 84px;
}
</style>
