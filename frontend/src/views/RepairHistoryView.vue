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
  <div class="page narrow">
    <div class="page-head">
      <div>
        <h1>수리 이력</h1>
        <p class="sub">시리얼 번호로 같은 제품의 과거 수리 기록을 찾습니다.</p>
      </div>
    </div>

    <form class="card card-pad stack" role="search" @submit.prevent="search">
      <label for="h-serial" class="label">시리얼 번호</label>
      <div class="row nowrap">
        <input id="h-serial" v-model="input" class="input mono" maxlength="12" autocomplete="off" placeholder="RC2026000187" :aria-invalid="!!error" />
        <button type="submit" class="btn btn-primary"><Search :size="18" /> 검색</button>
      </div>
      <p v-if="error" class="error-text" role="alert"><CircleAlert :size="16" /> {{ error }}</p>
    </form>

    <SameSerialHistory v-if="serial" :key="serial" :serial="serial" standalone />
  </div>
</template>

<style scoped>
.narrow {
  max-width: 900px;
}
.nowrap {
  flex-wrap: nowrap;
}
.nowrap .input {
  flex: 1;
  min-width: 0;
}
</style>
