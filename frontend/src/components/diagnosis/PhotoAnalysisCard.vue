<script setup lang="ts">
/* 진단 노트 1쪽 하단: 사진 한 장 + 이상 영역 박스 + 해당 부위 판단 요약 · 근거 출처 배지 */
import { computed } from 'vue'
import AnnotatedImage from '@/components/diagnosis/AnnotatedImage.vue'
import { sourceOrigin } from '@/utils/sources'
import { PHOTO_QUALITY_META } from '@/constants/status'
import { formatDateTime } from '@/utils/format'
import type { AgentResult, DataSource, ImageAnnotation, RepairImage } from '@/types'

const props = defineProps<{ image: RepairImage; index: number; agent?: AgentResult; annotations: ImageAnnotation[]; sources: DataSource[] }>()

const KIND: Partial<Record<RepairImage['kind'], string>> = { PCB: 'PCB', MOTOR: '기계', ADDITIONAL: '추가 사진' }
const VERDICT = {
  ABNORMAL: { label: '이상', tone: 'danger' },
  SUSPICIOUS: { label: '의심', tone: 'warning' },
  NORMAL: { label: '정상', tone: 'success' },
  SKIPPED: { label: '제외', tone: 'neutral' },
} as const

/** 근거 출처 배지 (RAG · MCP) — 같은 종류는 하나로 묶고, 제목은 툴팁으로 */
const origins = computed(() => {
  const ids = props.agent?.sourceIds ?? []
  const map = new Map<string, string[]>()
  for (const s of props.sources.filter((x) => ids.includes(x.id))) {
    const o = sourceOrigin(s.type)
    if (o) map.set(o, [...(map.get(o) ?? []), s.title])
  }
  return [...map.entries()].map(([origin, titles]) => ({ origin, titles: titles.join('\n') }))
})
</script>

<template>
  <article class="photo">
    <header class="row between">
      <strong>{{ KIND[image.kind] ?? image.kind }} {{ index }}</strong>
      <span v-if="agent" class="badge" :class="`tone-${VERDICT[agent.verdict].tone}`">{{ VERDICT[agent.verdict].label }}</span>
    </header>
    <AnnotatedImage :image="image" :annotations="annotations" :title="`${KIND[image.kind] ?? image.kind} ${index} · 이상 영역`" />
    <div class="desc">
      <p v-if="image.note" class="faint">촬영 부위: {{ image.note }}</p>
      <p v-if="image.quality" class="faint qline">
        <span class="badge" :class="`tone-${PHOTO_QUALITY_META[image.quality.status].tone}`">사진 품질 {{ PHOTO_QUALITY_META[image.quality.status].label }}</span>
        <template v-if="image.quality.acknowledgedBy">현재 사진 사용 확인 · {{ image.quality.acknowledgedBy }} · {{ formatDateTime(image.quality.acknowledgedAt) }}</template>
        <template v-if="image.quality.history.length"> · 재촬영 {{ image.quality.history.length }}회</template>
      </p>
      <template v-if="agent">
        <p class="sum">{{ agent.summary }}</p>
        <ul v-if="agent.findings.length" class="findings">
          <li v-for="f in agent.findings" :key="f">{{ f }}</li>
        </ul>
      </template>
      <p v-else class="faint">이 사진에 대한 부위별 판단이 없습니다.</p>
      <div v-if="origins.length" class="row src">
        <span class="faint">근거</span>
        <span v-for="o in origins" :key="o.origin" class="badge tone-info" :title="o.titles">{{ o.origin }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.photo {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}
.desc {
  display: grid;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-strong);
}
.sum {
  font-weight: 700;
}
.findings {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 2px;
  font-size: var(--fs-sm);
  color: var(--text-2);
}
.src {
  gap: 6px;
  font-size: var(--fs-sm);
}
.qline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
</style>
