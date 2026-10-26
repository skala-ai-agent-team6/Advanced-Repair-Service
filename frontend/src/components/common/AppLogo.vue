<script setup lang="ts">
/* 앱 로고 (로그인 후 사이드바 · 고객 화면 머리글) — 그림(집 + 렌치)만, 글자 없음
 * 기본 높이 36px · 너비는 비율 유지. 경로·대체 텍스트는 src/config/brand.ts.
 * 이미지를 못 불러오면 깨진 이미지 대신 같은 크기의 빈 자리 */
import { ref } from 'vue'
import { BRAND_LOGO_ALT, BRAND_LOGO_SYMBOL_SRC } from '@/config/brand'

withDefaults(defineProps<{ height?: number }>(), { height: 36 })
const failed = ref(false)
</script>

<template>
  <img v-if="!failed" class="app-logo-img" :src="BRAND_LOGO_SYMBOL_SRC" :alt="BRAND_LOGO_ALT" :style="{ height: `${height}px` }" draggable="false" @error="failed = true" />
  <span v-else class="app-logo-empty" role="img" :aria-label="BRAND_LOGO_ALT" :style="{ height: `${height}px`, width: `${height}px` }" />
</template>

<style scoped>
.app-logo-img {
  display: block;
  width: auto;
  object-fit: contain;
}
.app-logo-empty {
  display: block;
}
</style>
