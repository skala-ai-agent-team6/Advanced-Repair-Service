<script setup lang="ts">
/* 앱 로고 (ROVIA, 기본 높이 28px · 너비는 비율 유지 · 원본보다 크게 늘리지 않음). 경로·대체 텍스트는 src/config/brand.ts 하나로 관리
 * (로그인·회원가입의 큰 로고 영역은 BrandLogo.vue 가 같은 경로를 씀).
 * 경로가 비었거나 이미지를 못 불러오면 임시 자리(점선 상자)를 보여 준다 */
import { ref } from 'vue'
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC } from '@/config/brand'

withDefaults(defineProps<{ label?: string; height?: number }>(), { label: BRAND_LOGO_ALT, height: 28 })
const failed = ref(false)
</script>

<template>
  <img v-if="BRAND_LOGO_SRC && !failed" class="app-logo-img" :src="BRAND_LOGO_SRC" :alt="label" :style="{ maxHeight: `${height}px` }" draggable="false" @error="failed = true" />
  <span v-else class="app-logo" role="img" :aria-label="label">LOGO</span>
</template>

<style scoped>
.app-logo-img {
  display: block;
  /* 높이는 max-height(기본 28px)로만 제한 → 원본이 더 작으면 원본 크기 그대로 (확대·흐려짐 방지) */
  height: auto;
  width: auto;
  max-width: none;
  flex: none;
}
.app-logo {
  display: inline-grid;
  place-items: center;
  width: 120px;
  height: 32px;
  flex: none;
  border: 1.5px dashed #b6c0cf;
  border-radius: 8px;
  color: #9aa5b5;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.2em;
  user-select: none;
}
</style>
