<script setup lang="ts">
/* 숫자 카드 — 제목과 숫자만 (설명 글씨 없음). 누르면 select
 * info: 누를 수 없는 정보 카드 (같은 곳으로 가는 버튼이 따로 있을 때 중복을 피하려고) */
defineProps<{ label: string; value: number | string; highlight?: boolean; info?: boolean }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <div v-if="info" class="metric card info" :class="{ hl: highlight }">
    <span class="lbl">{{ label }}</span>
    <span class="num-xl">{{ value }}</span>
  </div>
  <button v-else type="button" class="metric card" :class="{ hl: highlight }" @click="$emit('select')">
    <span class="lbl">{{ label }}</span>
    <span class="num-xl">{{ value }}</span>
  </button>
</template>

<style scoped>
.metric {
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 120px;
  padding: 20px 22px;
  text-align: left;
  color: var(--text);
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.metric.info {
  cursor: default;
}
.metric:not(.info):hover {
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 28px rgba(15, 23, 42, 0.1);
}
.metric:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}
.hl {
  background: var(--blue-50);
}
.hl .num-xl {
  color: var(--primary);
}
.lbl {
  color: var(--text-2);
  font-weight: 600;
}
</style>
