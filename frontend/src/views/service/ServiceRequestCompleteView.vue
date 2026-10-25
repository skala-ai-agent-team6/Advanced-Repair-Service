<script setup lang="ts">
/* 고객 접수 완료 (/service/request/complete) — 접수 페이지의 완료 팝업과 같은 내용 (ReceiptDone)
 * 접수번호는 주소창이 아닌 history state 로 받는다 */
import { Search } from 'lucide-vue-next'
import ReceiptDone from '@/components/service/ReceiptDone.vue'

const st = window.history.state as { receiptNo?: unknown } | null
const receiptNo = typeof st?.receiptNo === 'string' ? st.receiptNo : ''
</script>

<template>
  <section v-if="receiptNo" class="card page">
    <ReceiptDone :receipt-no="receiptNo" />
  </section>
  <section v-else class="card page empty">
    <h1>접수 정보를 찾을 수 없어요</h1>
    <p class="muted">이미 접수하셨다면 접수번호로 조회해 주세요.</p>
    <RouterLink to="/service/track" class="btn btn-primary btn-lg btn-block"><Search :size="20" /> 접수 내역 조회</RouterLink>
    <RouterLink to="/service/request" class="btn btn-lg btn-block">고장 접수하기</RouterLink>
  </section>
</template>

<style scoped>
.page {
  padding: 28px 20px;
}
.empty {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 12px;
}
.empty h1 {
  font-size: var(--fs-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
}
</style>
