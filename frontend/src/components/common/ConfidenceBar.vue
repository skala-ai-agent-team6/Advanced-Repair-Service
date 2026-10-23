<script setup lang="ts">
/* AI 판단 점수 막대 — 고장 확률이 아니라 원인 후보끼리 비교한 점수(0~100)
 * 높음·보통·낮음 같은 등급이나 기준선은 두지 않고, 후보 간 순위 비교로만 쓴다. */
import { computed, useId } from 'vue'
import { Info } from 'lucide-vue-next'
import { SCORE_HINT } from '@/constants/status'

const props = withDefaults(
  defineProps<{
    value: number
    label?: string
    size?: 'sm' | 'md' | 'lg'
    /** 안내 문구 표시 방식: line(막대 아래 한 줄) · icon(ⓘ 툴팁) · none. 기본: sm 은 icon, 나머지는 line */
    hint?: 'line' | 'icon' | 'none'
  }>(),
  { label: 'AI 판단 점수', size: 'md', hint: undefined },
)
const hintMode = computed(() => props.hint ?? (props.size === 'sm' ? 'icon' : 'line'))
const score = computed(() => Math.round(Math.max(0, Math.min(100, props.value))))
const hintId = `${useId()}-hint`
</script>

<template>
  <div class="conf" :class="size">
    <div class="top">
      <span class="lbl">
        {{ label }}
        <span v-if="hintMode === 'icon'" class="info" :title="SCORE_HINT" tabindex="0" :aria-label="SCORE_HINT"><Info :size="13" aria-hidden="true" /></span>
      </span>
      <span class="val"><strong>{{ score }}</strong><small>점</small></span>
    </div>
    <div
      class="track"
      role="meter"
      :aria-valuenow="score"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="`${label} ${score}점`"
      :aria-describedby="hintMode === 'line' ? hintId : undefined"
    >
      <div class="fill" :style="{ width: `${Math.max(2, score)}%` }" />
    </div>
    <p v-if="hintMode === 'line'" :id="hintId" class="hint">{{ SCORE_HINT }}</p>
  </div>
</template>

<style scoped>
.conf {
  display: grid;
  gap: 6px;
  min-width: 140px;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.lbl {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}
.info {
  display: inline-flex;
  color: var(--text-3);
  cursor: help;
  border-radius: 50%;
}
.info:focus-visible {
  outline: 2px solid var(--navy-600);
  outline-offset: 2px;
}
.val {
  display: inline-flex;
  gap: 2px;
  align-items: baseline;
}
.val strong {
  font-size: 1.05em;
}
.val small {
  color: var(--text-2);
  font-weight: 600;
}
.lg .val strong {
  font-size: var(--fs-num);
  font-weight: var(--fw-num);
  letter-spacing: -0.03em;
  line-height: 1;
}
.track {
  position: relative;
  height: 10px;
  background: var(--neutral-bg);
  border-radius: 999px;
  overflow: hidden;
}
.sm .track {
  height: 6px;
}
.lg .track {
  height: 14px;
}
/* 등급 색 없이 AI 색 하나로만 (점수 높낮이로 좋고 나쁨을 암시하지 않음) */
.fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ai);
  transition: width 0.6s ease;
}
.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-3);
}
@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>
