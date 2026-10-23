<script setup lang="ts">
/* 촬영 가이드 그림 — 프레임 안에 부위를 정면으로 가득 채우는 방법 + 체크 포인트 */
import { computed } from 'vue'
import { Sun, Ruler, Focus, Maximize, ZoomIn } from 'lucide-vue-next'

/** PRODUCT: 고객 접수 — 제품 종류와 상관없는 일반 가전 그림 · LABEL: 제품 라벨(시리얼) 촬영 */
const props = defineProps<{ kind: 'PCB' | 'MOTOR' | 'PRODUCT' | 'LABEL' }>()

const PART_TIPS = [
  { icon: Maximize, text: '정면에서 부위가 화면을 가득 채우게' },
  { icon: Ruler, text: '20~30cm 거리' },
  { icon: Sun, text: '밝은 곳 · 그림자·반사 없이' },
  { icon: Focus, text: '초점을 맞추고 흔들리지 않게' },
]
/** 고객용: 제품 종류와 상관없는 안내 */
const PRODUCT_TIPS = [
  { icon: Maximize, text: '제품 전체가 보이도록 촬영해 주세요.' },
  { icon: ZoomIn, text: '고장 난 부분은 가까이 한 장 더' },
  { icon: Sun, text: '밝은 곳 · 그림자·반사 없이' },
  { icon: Focus, text: '초점을 맞추고 흔들리지 않게' },
]
/** 제품 라벨(시리얼 번호) */
const LABEL_TIPS = [
  { icon: Maximize, text: '제품 바닥면 · 배터리 커버 안쪽 라벨' },
  { icon: ZoomIn, text: '라벨 전체가 화면에 들어오게' },
  { icon: Sun, text: '빛 반사 없이 정면에서' },
  { icon: Focus, text: '숫자가 선명하게 초점 맞추기' },
]
const TIPS = computed(() => (props.kind === 'PRODUCT' ? PRODUCT_TIPS : props.kind === 'LABEL' ? LABEL_TIPS : PART_TIPS))
const LABEL = { PCB: 'PCB 촬영 가이드 그림', MOTOR: '기계부 촬영 가이드 그림', PRODUCT: '제품 촬영 가이드 그림', LABEL: '제품 라벨 촬영 가이드 그림' } as const
</script>

<template>
  <figure class="guide">
    <svg viewBox="0 0 240 150" role="img" :aria-label="LABEL[kind]">
      <!-- 화면 프레임 -->
      <rect x="20" y="10" width="200" height="130" rx="14" fill="#f8fafd" stroke="#d6dde8" />
      <!-- 모서리 가이드 -->
      <g stroke="#2563eb" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M44 30 v-8 h12" />
        <path d="M196 30 v-8 h-12" />
        <path d="M44 120 v8 h12" />
        <path d="M196 120 v8 h-12" />
      </g>
      <!-- 피사체 -->
      <template v-if="kind === 'PCB'">
        <rect x="58" y="34" width="124" height="82" rx="6" fill="#3d8a5f" />
        <rect x="74" y="48" width="30" height="24" rx="2" fill="#1e293b" />
        <rect x="114" y="50" width="18" height="18" rx="2" fill="#1e293b" />
        <rect x="140" y="48" width="28" height="10" rx="2" fill="#cbd5e1" />
        <circle cx="152" cy="94" r="9" fill="#94a3b8" />
        <path d="M74 98 h52 M74 106 h40" stroke="#a7d7b8" stroke-width="2" />
      </template>
      <!-- 제품 바닥면 + 시리얼 라벨 -->
      <template v-else-if="kind === 'LABEL'">
        <circle cx="120" cy="75" r="52" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2" />
        <rect x="82" y="52" width="76" height="44" rx="4" fill="#fff" stroke="#64748b" stroke-width="1.5" />
        <path d="M90 62 h40 M90 70 h52" stroke="#94a3b8" stroke-width="3" />
        <path d="M90 82 v8 M93 82 v8 M97 82 v8 M99 82 v8 M103 82 v8 M107 82 v8 M110 82 v8 M114 82 v8 M117 82 v8 M121 82 v8" stroke="#334155" stroke-width="1.5" />
        <text x="128" y="90" font-size="7" fill="#2563eb" font-family="monospace">RC…</text>
      </template>
      <!-- 일반 가전: 본체 + 조작부 + 문 -->
      <template v-else-if="kind === 'PRODUCT'">
        <rect x="78" y="30" width="84" height="92" rx="10" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2" />
        <rect x="88" y="38" width="64" height="12" rx="3" fill="#cbd5e1" />
        <circle cx="140" cy="44" r="3" fill="#2563eb" />
        <circle cx="120" cy="86" r="22" fill="#f8fafd" stroke="#94a3b8" stroke-width="3" />
        <circle cx="120" cy="86" r="12" fill="#dbe7fe" />
      </template>
      <template v-else>
        <rect x="62" y="44" width="94" height="62" rx="10" fill="#94a3b8" />
        <rect x="156" y="66" width="30" height="18" rx="3" fill="#64748b" />
        <path d="M72 54 h74 M72 96 h74" stroke="#cbd5e1" stroke-width="3" />
        <circle cx="96" cy="112" r="5" fill="none" stroke="#c42b2b" stroke-width="2" stroke-dasharray="3 2" />
      </template>
      <!-- 초점 표시 -->
      <circle cx="120" cy="75" r="4" fill="none" stroke="#2563eb" stroke-width="2" />
    </svg>
    <figcaption>
      <ul class="tips">
        <li v-for="t in TIPS" :key="t.text"><component :is="t.icon" :size="15" aria-hidden="true" /> {{ t.text }}</li>
      </ul>
    </figcaption>
  </figure>
</template>

<style scoped>
.guide {
  margin: 0;
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--blue-50);
}
svg {
  width: 100%;
  height: auto;
}
.tips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
  font-size: var(--fs-sm);
  color: var(--text-2);
}
.tips li {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tips svg {
  width: auto;
  flex: none;
  color: var(--primary);
}
@media (max-width: 520px) {
  .guide {
    grid-template-columns: 1fr;
  }
}
</style>
