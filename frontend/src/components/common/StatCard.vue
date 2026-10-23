<script setup lang="ts">
import type { Component } from 'vue'
import type { Tone } from '@/constants/status'

/** info: 누를 수 없는 정보 카드 (같은 필터 버튼이 따로 있을 때 중복을 피하려고) */
defineProps<{ label: string; value: number | string; icon: Component; tone?: Tone; hint?: string; active?: boolean; info?: boolean }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <div v-if="info" class="stat card info" :class="`tone-${tone ?? 'neutral'}`">
    <span class="ic"><component :is="icon" :size="24" aria-hidden="true" /></span>
    <span class="txt">
      <span class="lbl">{{ label }}</span>
      <span class="val">{{ value }}<small>건</small></span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </span>
  </div>
  <button v-else type="button" class="stat card" :class="[`tone-${tone ?? 'neutral'}`, { active }]" :aria-pressed="active" @click="$emit('select')">
    <span class="ic"><component :is="icon" :size="24" aria-hidden="true" /></span>
    <span class="txt">
      <span class="lbl">{{ label }}</span>
      <span class="val">{{ value }}<small>건</small></span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </span>
  </button>
</template>

<style scoped>
.stat {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 22px;
  text-align: left;
  cursor: pointer;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--card-border);
  min-height: 112px;
  transition: box-shadow 0.15s;
}
.stat.info {
  cursor: default;
}
.stat:not(.info):hover {
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 28px rgba(15, 23, 42, 0.1);
}
.stat.active {
  box-shadow: inset 0 0 0 2px var(--primary), var(--shadow);
}
.ic {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 0;
  flex: none;
}
.tone-neutral .ic { color: var(--neutral); background: var(--neutral-bg); border-color: var(--neutral-border); }
.tone-info .ic { color: var(--info); background: var(--info-bg); border-color: var(--info-border); }
.tone-ai .ic { color: var(--ai); background: var(--ai-bg); border-color: var(--ai-border); }
.tone-warning .ic { color: var(--warning); background: var(--warning-bg); border-color: var(--warning-border); }
.tone-success .ic { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
.tone-danger .ic { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
.txt {
  display: grid;
}
.lbl {
  color: var(--text-2);
  font-weight: 600;
}
.val {
  font-size: var(--fs-num);
  font-weight: var(--fw-num);
  line-height: 1.05;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.val small {
  font-size: var(--fs-sm);
  font-weight: 600;
  margin-left: 3px;
  color: var(--text-2);
}
.hint {
  font-size: var(--fs-xs);
  color: var(--text-3);
}
</style>
