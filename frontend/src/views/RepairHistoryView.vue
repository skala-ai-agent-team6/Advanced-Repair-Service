<script setup lang="ts">
/* 수리 이력 (기사 메뉴) — 시리얼 번호로 같은 제품의 과거 수리 검색 (SameSerialHistory 재사용) */
import { ref } from 'vue'
import { Search, CircleAlert } from 'lucide-vue-next'
import SameSerialHistory from '@/components/repair/SameSerialHistory.vue'

const input = ref('')
const serial = ref('')
const error = ref<string | null>(null)

function search() {
  const s = input.value.trim().toUpperCase()
  error.value = /^RC\d{10}$/.test(s) ? null : '시리얼 번호는 RC 로 시작하는 12자리입니다. (예: RC2026000187)'
  if (!error.value) serial.value = s
}
</script>

<template>
  <!-- 사이드바를 뺀 메인 영역 기준 가운데 (max-width + margin auto, 고정 left 없음) -->
  <div class="repair-history-page">
    <div class="repair-history-container">
      <header class="repair-history-header page-head">
        <div>
          <h1>수리 이력</h1>
          <p class="sub">시리얼 번호로 같은 제품의 과거 수리 기록을 찾습니다.</p>
        </div>
      </header>

      <section class="repair-history-search" aria-label="시리얼 번호 검색">
        <form class="card card-pad stack" role="search" @submit.prevent="search">
          <label for="h-serial" class="label">시리얼 번호</label>
          <div class="repair-history-form">
            <input id="h-serial" v-model="input" class="input mono" maxlength="12" autocomplete="off" placeholder="RC2026000187" :aria-invalid="!!error" />
            <button type="submit" class="btn btn-primary"><Search :size="18" /> 검색</button>
          </div>
          <p v-if="error" class="error-text" role="alert"><CircleAlert :size="16" /> {{ error }}</p>
        </form>
      </section>

      <section class="repair-history-results" aria-live="polite">
        <!-- 불러오는 중 · 결과 없음 · 결과 목록은 SameSerialHistory(standalone)가 표시 -->
        <SameSerialHistory v-if="serial" :key="serial" :serial="serial" standalone />
        <p v-else class="repair-history-hint">시리얼 번호를 입력하면 과거 수리 이력을 확인할 수 있습니다.</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.repair-history-page {
  width: 100%;
  padding: 28px 32px 48px;
}
.repair-history-container {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gap);
}
.repair-history-search,
.repair-history-results {
  width: 100%;
  min-width: 0;
}
/* 입력창은 남는 폭, 버튼은 필요한 만큼 · 같은 높이 */
.repair-history-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}
.repair-history-form .input,
.repair-history-form .btn {
  height: 48px;
  min-height: 48px;
}
.repair-history-hint {
  margin: 8px 0 0;
  text-align: center;
  color: var(--text-3);
}
@media (max-width: 1023px) {
  .repair-history-page {
    padding: 24px 24px 44px;
  }
}
@media (max-width: 767px) {
  .repair-history-page {
    padding: 20px 16px 40px;
  }
  .repair-history-form {
    grid-template-columns: 1fr;
  }
  .repair-history-form button {
    width: 100%;
  }
}
</style>
