<script setup lang="ts">
/* AI 초안 / 기사 수정 / 사람 확정 구분 라벨 — 모든 AI 산출물에 반드시 표시
 *  ai: 보라 점선 · edit: 파란 실선(기사 수정) · human: 초록 실선(확인·확정) */
import { Sparkles, UserCheck, PencilLine } from 'lucide-vue-next'

withDefaults(defineProps<{ kind?: 'ai' | 'human' | 'edit'; label?: string; compact?: boolean }>(), { kind: 'ai' })
</script>

<template>
  <span v-if="kind === 'ai'" class="badge tone-ai ai-badge" role="note">
    <Sparkles :size="15" aria-hidden="true" />
    {{ label ?? (compact ? 'AI 초안' : 'AI 분석 결과 · 확인 필요') }}
  </span>
  <span v-else-if="kind === 'edit'" class="badge tone-info edit-badge" role="note">
    <PencilLine :size="15" aria-hidden="true" />
    {{ label ?? '기사 수정' }}
  </span>
  <span v-else class="badge tone-success" role="note">
    <UserCheck :size="15" aria-hidden="true" />
    {{ label ?? '관리자 확정' }}
  </span>
</template>

<style scoped>
.ai-badge {
  border-style: dashed;
}
.edit-badge {
  border: 1px solid var(--primary);
  color: var(--primary);
}
</style>
