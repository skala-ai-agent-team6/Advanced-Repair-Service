<script setup lang="ts">
/* 고객(비회원) 공개 화면 레이아웃 — /service 아래 모든 화면.
 * 직원용 사이드바·상단 메뉴·알림·직원 정보·로그아웃을 쓰지 않는다 (로그인한 직원이 들어와도 이 레이아웃)
 * 헤더: 로고(누르면 /login) + 고객센터 전화(tel:). 홈은 넓게(2열), 나머지는 좁은 폭 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Phone } from 'lucide-vue-next'
import AppLogo from '@/components/common/AppLogo.vue'

const route = useRoute()
const isHome = computed(() => route.name === 'service-home')
const onRequest = computed(() => route.name === 'service-request')
/** 고객센터 대표번호 */
const CS_PHONE = '1588-0000'
/** 고장 접수: 데스크톱에서 2열 폼 (회원가입과 같은 폼 너비) */
const isForm = computed(() => onRequest.value)
</script>

<template>
  <div class="customer">
    <header class="c-top">
      <div class="c-top-in" :class="{ wide: isHome, form: isForm }">
        <RouterLink to="/login" class="c-logo" aria-label="로그인 화면으로 이동"><AppLogo :height="36" /></RouterLink>
        <a :href="`tel:${CS_PHONE}`" class="c-cs" :aria-label="`고객센터 ${CS_PHONE} 전화 걸기`">
          <Phone :size="16" aria-hidden="true" />
          <span class="c-cs-label">고객센터</span>
          <strong class="c-cs-num">{{ CS_PHONE }}</strong>
        </a>
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
  flex: none;
  min-height: 44px;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
/* 고객센터 전화 — 헤더 높이 그대로, 한 줄 유지 */
.c-cs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 4px;
  white-space: nowrap;
  color: var(--text-2);
  font-size: var(--fs-sm);
  text-decoration: none;
  border-radius: var(--radius-sm);
}
.c-cs svg {
  color: var(--primary);
}
.c-cs-num {
  color: var(--primary);
  font-size: var(--fs-md);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.c-cs:hover .c-cs-num {
  text-decoration: underline;
}
/* 좁은 화면: 아이콘 + 번호만 */
@media (max-width: 400px) {
  .c-cs-label {
    display: none;
  }
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
