<script setup lang="ts">
/* 접이식(아코디언) 섹션 — 헤더 전체가 버튼, 접혔을 때 오른쪽에 요약 문구
 * 펼침 상태는 화면(scope)별로 sessionStorage 에 기억하고, 부모의 "모두 펼치기/접기" 를 따른다 */
import { ref, useId, watch, type Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { readOpen, useCollapsibleGroup, writeOpen } from '@/composables/useCollapsibleGroup'

const props = defineProps<{
  /** 화면 안에서 섹션을 구분하는 키 (저장용) */
  id: string
  title: string
  /** 접혔을 때 오른쪽에 보이는 요약 문구 */
  summary?: string
  icon?: Component
  defaultOpen?: boolean
}>()

const group = useCollapsibleGroup()
const scope = group?.scope ?? 'default'
const open = ref(readOpen(scope, props.id) ?? !!props.defaultOpen)
// 처음 펼칠 때 내용을 그리고, 이후에는 접어도 유지 (사진·차트 재생성 방지)
const rendered = ref(open.value)

const uid = useId()
const btnId = `${uid}-btn`
const panelId = `${uid}-panel`

function set(v: boolean) {
  open.value = v
  if (v) rendered.value = true
  writeOpen(scope, props.id, v)
}
if (group) watch(() => group.command.value.n, () => set(group.command.value.open))
</script>

<template>
  <section class="card coll" :class="{ open }">
    <h3 class="hd">
      <button :id="btnId" type="button" class="toggle" :aria-expanded="open" :aria-controls="panelId" @click="set(!open)">
        <component :is="icon" v-if="icon" :size="20" aria-hidden="true" class="ic" />
        <span class="title">{{ title }}</span>
        <span v-if="summary" class="summary">{{ summary }}</span>
        <ChevronDown :size="20" aria-hidden="true" class="chev" />
      </button>
    </h3>
    <div v-if="rendered" v-show="open" :id="panelId" role="region" :aria-labelledby="btnId" class="panel">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.hd {
  margin: 0;
  font-size: inherit;
}
.toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 12px 20px;
  border: 0;
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-lg);
}
.toggle:hover {
  background: var(--navy-50);
}
.toggle:focus-visible {
  outline: 3px solid var(--navy-600);
  outline-offset: -3px;
}
.ic {
  color: var(--navy-700);
  flex: none;
}
.title {
  font-size: var(--fs-lg);
  font-weight: 700;
}
.summary {
  margin-left: auto;
  color: var(--text-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}
/* 좁은 화면: 요약을 자르지 않고 줄바꿈 */
@media (max-width: 560px) {
  .summary {
    white-space: normal;
    max-width: 60%;
  }
}
.chev {
  flex: none;
  color: var(--text-3);
  transition: transform 0.2s;
}
.summary + .chev {
  margin-left: 4px;
}
.title + .chev {
  margin-left: auto;
}
.open .chev {
  transform: rotate(180deg);
}
.open .toggle {
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-bottom: 1px solid var(--border);
}
.panel {
  padding: 16px 20px 20px;
}
@media (max-width: 640px) {
  .toggle {
    flex-wrap: wrap;
  }
  .summary {
    order: 3;
    flex-basis: 100%;
    max-width: none;
    margin-left: 30px;
    text-align: left;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
