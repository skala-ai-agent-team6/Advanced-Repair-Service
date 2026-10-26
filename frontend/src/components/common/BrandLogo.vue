<script setup lang="ts">
/* 전체 로고 (그림 위 · 글씨 아래) — 로그인 전 화면(로그인 · 회원가입 · 고객 홈)
 *  가운데 정렬(align="start" 면 왼쪽 정렬) · 너비 최대 240px(휴대폰 180px) · 비율 유지. tagline 이면 로고 아래 서비스 소개 한 줄
 *  이미지를 못 불러오면 깨진 이미지 없이 이름만 글자로 */
import { ref } from 'vue'
import { BRAND_LOGO_ALT, BRAND_LOGO_FULL_SRC, BRAND_NAME, BRAND_TAGLINE } from '@/config/brand'

defineProps<{ tagline?: boolean; align?: 'center' | 'start' }>()
const failed = ref(false)
</script>

<template>
  <div class="brand-logo" :class="{ start: align === 'start' }">
    <img v-if="!failed" :src="BRAND_LOGO_FULL_SRC" :alt="BRAND_LOGO_ALT" draggable="false" @error="failed = true" />
    <strong v-else class="brand-name">{{ BRAND_NAME }}</strong>
    <p v-if="tagline" class="tagline">{{ BRAND_TAGLINE }}</p>
  </div>
</template>

<style scoped>
.brand-logo {
  display: grid;
  justify-items: center;
  text-align: center;
}
.brand-logo.start {
  justify-items: start;
  text-align: left;
}
.brand-logo img {
  width: 100%;
  max-width: 240px;
  height: auto;
  object-fit: contain;
}
.brand-name {
  font-size: var(--fs-2xl);
}
/* 로고 바로 아래 한 줄: 본문 기본 글자색 · 20px · 굵게(700) · 간격 12px (휴대폰 18px) */
.tagline {
  margin: 12px 0 0;
  color: var(--text);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
@media (max-width: 767px) {
  .brand-logo img {
    max-width: 180px;
  }
  .tagline {
    font-size: 18px;
  }
}
</style>
