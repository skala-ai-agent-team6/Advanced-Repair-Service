<script setup lang="ts">
/* 고객 접수 완료 내용 — 팝업 · 접수 페이지 · 접수 완료 페이지 공통
 * 접수번호(크게 + 복사), 안내 문구, [접수 내역 조회](접수번호 자동 입력) / [홈으로] */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { CircleCheck, Copy, Check, Search, Home } from 'lucide-vue-next'

/** serviceType 이 있으면 수리 방법에 맞는 안내 (방문 수리: 기사 연락 / 센터 방문: 예약일에 센터로) */
const props = defineProps<{ receiptNo: string; serviceType?: 'VISIT' | 'CENTER'; centerName?: string }>()
const emit = defineEmits<{ navigate: [] }>()
const router = useRouter()
const copied = ref(false)
const copyError = ref(false)

async function copy() {
  copyError.value = false
  try {
    await navigator.clipboard.writeText(props.receiptNo)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    // 클립보드 권한이 없으면 직접 선택해 복사하도록 안내
    copyError.value = true
  }
}
function go(to: Parameters<typeof router.push>[0]) {
  emit('navigate')
  void router.push(to)
}
</script>

<template>
  <div class="done">
    <CircleCheck :size="52" class="ic" aria-hidden="true" />
    <h2>접수가 완료됐어요</h2>

    <div class="receipt">
      <span class="faint">접수번호</span>
      <strong class="mono rn">{{ receiptNo }}</strong>
      <button type="button" class="btn btn-sm" @click="copy">
        <component :is="copied ? Check : Copy" :size="16" /> {{ copied ? '복사했어요' : '복사' }}
      </button>
      <p v-if="copyError" class="faint">복사하지 못했어요. 접수번호를 길게 눌러 직접 복사해 주세요.</p>
    </div>

    <p v-if="serviceType === 'VISIT'" class="msg">기사님이 방문 전에 연락드릴 거예요.</p>
    <p v-else-if="serviceType === 'CENTER'" class="msg">예약하신 날짜에 {{ centerName ?? '선택하신 서비스센터' }}로 제품을 가져와 주세요.</p>
    <p v-else class="msg">사진을 AI가 먼저 확인한 뒤, 기사님이 연락드릴 거예요.</p>

    <div class="acts">
      <!-- 접수번호는 주소창이 아닌 history state 로 넘겨 자동 입력 -->
      <button type="button" class="btn btn-primary btn-lg btn-block" @click="go({ path: '/service/track', state: { receiptNo } })"><Search :size="20" /> 접수 내역 조회</button>
      <button type="button" class="btn btn-lg btn-block" @click="go('/service')"><Home :size="20" /> 홈으로</button>
    </div>
  </div>
</template>

<style scoped>
.done {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 12px;
}
.ic {
  color: var(--success);
}
h2 {
  font-size: var(--fs-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
  margin: 0;
}
.receipt {
  display: grid;
  justify-items: center;
  gap: 6px;
  width: 100%;
  padding: 18px;
  border-radius: var(--radius-lg);
  background: var(--blue-50);
}
.rn {
  font-size: var(--fs-xl);
  color: var(--primary);
  letter-spacing: 0.02em;
  user-select: all;
  word-break: break-all;
}
.msg {
  color: var(--text-2);
}
.acts {
  display: grid;
  gap: 8px;
  width: 100%;
}
</style>
