<script setup lang="ts">
import { Check } from 'lucide-vue-next'
defineProps<{ steps: string[]; current: number }>()
</script>

<template>
  <ol class="steps" aria-label="접수 단계">
    <li v-for="(s, i) in steps" :key="s" :class="{ done: i < current, now: i === current }" :aria-current="i === current ? 'step' : undefined">
      <span class="num"><Check v-if="i < current" :size="18" /><template v-else>{{ i + 1 }}</template></span>
      <span class="txt"><small>{{ i + 1 }}단계</small>{{ s }}</span>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr));
  grid-auto-flow: column;
  gap: 8px;
}
li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-weight: 700;
}
li.now {
  border: 2px solid var(--navy-700);
  color: var(--navy-900);
}
li.done {
  color: var(--success);
  border-color: var(--success-border);
  background: var(--success-bg);
}
.num {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--neutral-bg);
  flex: none;
}
.now .num {
  background: var(--navy-800);
  color: #fff;
}
.done .num {
  background: var(--success);
  color: #fff;
}
.txt {
  display: grid;
  line-height: 1.3;
}
.txt small {
  font-size: var(--fs-xs);
  font-weight: 600;
}
@media (max-width: 700px) {
  .txt small {
    display: none;
  }
}
@media (max-width: 900px) {
  li {
    gap: 8px;
    padding: 10px;
  }
}
/* 휴대폰: 번호만 보이고 단계 이름은 화면 낭독기용으로 (현재 단계 이름은 각 섹션 제목에 표시됨) */
@media (max-width: 600px) {
  .steps {
    gap: 6px;
  }
  li {
    justify-content: center;
    padding: 8px 4px;
  }
  .txt {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
}
</style>
