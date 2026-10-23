<script setup lang="ts">
/* 고객(비회원) 공개 화면 레이아웃 — /service 아래 모든 화면.
 * 직원용 사이드바·상단 메뉴·알림·직원 정보·로그아웃을 쓰지 않는다 (로그인한 직원이 들어와도 이 레이아웃)
 * 헤더: 로고 + [AS 접수하기] 하나 (접수 화면에서는 숨김). 홈은 넓게(2열), 나머지는 좁은 폭 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ClipboardList } from 'lucide-vue-next'
import AppLogo from '@/components/common/AppLogo.vue'

const route = useRoute()
const isHome = computed(() => route.name === 'service-home')
const onRequest = computed(() => route.name === 'service-request')
/** 고장 접수: 데스크톱에서 2열 폼 (회원가입과 같은 폼 너비) */
const isForm = computed(() => onRequest.value)
</script>

<template>
  <div class="customer">
    <header class="c-top">
      <div class="c-top-in" :class="{ wide: isHome, form: isForm }">
        <RouterLink to="/service" class="c-logo" aria-label="서비스 홈으로"><AppLogo :height="28" /></RouterLink>
        <RouterLink v-if="!onRequest" to="/service/request" class="btn btn-primary btn-sm"><ClipboardList :size="16" /> AS 접수하기</RouterLink>
      </div>
    </header>
    <main id="main" class="c-main" :class="{ wide: isHome, form: isForm }" tabindex="-1">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.customer {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: var(--bg);
}
.c-top {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.c-top-in {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 60px;
  max-width: 560px;
  margin: 0 auto;
  padding: 0 16px;
}
.c-logo {
  display: flex;
  align-items: center;
  min-height: 44px;
}
.c-main {
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  outline: none;
}
/* 고장 접수: 폼 공통 너비 */
.c-top-in.form,
.c-main.form {
  max-width: var(--form-max-w);
}
/* 홈: 데스크톱에서 2열 */
.c-top-in.wide,
.c-main.wide {
  max-width: 1120px;
}
</style>
