<script setup lang="ts">
/* 기업 로고 영역 (로그인·회원가입). 경로는 src/config/brand.ts 의 BRAND_LOGO_SRC 하나로 관리.
 *  - 로고가 있으면: 가운데 정렬, 비율 유지(object-fit: contain), 최대 너비 maxWidth
 *  - 로고가 없거나 불러오지 못하면: 글자·깨진 이미지 없이 높이만 유지(기본) 또는 hideWhenEmpty 로 영역 숨김 */
import { computed, ref } from 'vue'
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC } from '@/config/brand'

const props = withDefaults(defineProps<{ maxWidth?: number; height?: number; hideWhenEmpty?: boolean }>(), {
  maxWidth: 420,
  height: 96,
  hideWhenEmpty: false,
})
const failed = ref(false)
const src = computed(() => (failed.value ? '' : BRAND_LOGO_SRC))
const style = computed(() => ({ maxWidth: `${props.maxWidth}px`, height: `${props.height}px`, '--logo-h': `${props.height}px` }))
</script>

<template>
  <div v-if="src || !hideWhenEmpty" class="brand-logo" :class="{ empty: !src }" :style="style">
    <img v-if="src" :src="src" :alt="BRAND_LOGO_ALT" draggable="false" @error="failed = true" />
  </div>
</template>

<style scoped>
.brand-logo {
  width: 100%;
  margin-inline: auto;
  display: grid;
  place-items: center;
}
.brand-logo img {
  max-width: 100%;
  /* 그리드 안에서 % 높이가 적용되지 않을 수 있어 영역 높이를 직접 지정 */
  max-height: var(--logo-h);
  width: auto;
  height: auto;
  object-fit: contain;
}
</style>
