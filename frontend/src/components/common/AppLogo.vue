<script setup lang="ts">
/* 앱 로고 — 그림(집 + 렌치). withName 이면 오른쪽에 '수리들어간다' 글씨(가로형)
 *  - 로그인 후 사이드바: 그림만 / 고객 화면 머리글: with-name
 * 기본 높이 36px · 너비는 비율 유지. 경로·대체 텍스트는 src/config/brand.ts.
 * 이미지를 못 불러오면 깨진 이미지 대신 같은 크기의 빈 자리(글씨는 텍스트로) */
import { ref } from 'vue'
import { BRAND_LOGO_ALT, BRAND_LOGO_SYMBOL_SRC, BRAND_LOGO_WORDMARK_SRC, BRAND_NAME } from '@/config/brand'

withDefaults(defineProps<{ height?: number; withName?: boolean }>(), { height: 36, withName: false })
const failed = ref(false)
const nameFailed = ref(false)
</script>

<template>
  <span class="app-logo" role="img" :aria-label="BRAND_LOGO_ALT">
    <img v-if="!failed" class="app-logo-img" :src="BRAND_LOGO_SYMBOL_SRC" alt="" :style="{ height: `${height}px` }" draggable="false" @error="failed = true" />
    <span v-else class="app-logo-empty" :style="{ height: `${height}px`, width: `${height}px` }" />
    <template v-if="withName">
      <!-- 글씨 높이는 그림의 약 55% — 그림 한가운데에 맞춤 -->
      <img v-if="!nameFailed" class="app-logo-name" :src="BRAND_LOGO_WORDMARK_SRC" alt="" :style="{ height: `${Math.round(height * 0.55)}px` }" draggable="false" @error="nameFailed = true" />
      <strong v-else class="app-logo-name-text">{{ BRAND_NAME }}</strong>
    </template>
  </span>
</template>

<style scoped>
.app-logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.app-logo-img,
.app-logo-name {
  display: block;
  width: auto;
  object-fit: contain;
}
.app-logo-empty {
  display: block;
}
.app-logo-name-text {
  color: var(--text);
  font-size: var(--fs-lg);
  font-weight: 800;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
</style>
