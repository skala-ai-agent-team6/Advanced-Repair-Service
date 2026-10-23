<script setup lang="ts">
/* 직원 화면 공통 레이아웃 (기사 · 본사 품질 담당자 동일 규격)
 *  flex: [사이드바 88px ↔ 228px] [상단바 60px + 본문]. 사이드바가 펼쳐지면 상단바·본문도 같은 기준으로 밀린다.
 *  메뉴 버튼(1199px 이하 · 터치 기기): 768px 이상은 사이드바를 제자리에서 펼침, 767px 이하는 오버레이.
 *  화면 이동 · 바깥 선택 · Esc 로 닫힘 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import PreVisitDiagnosisReportModal from '@/components/field/PreVisitDiagnosisReportModal.vue'
import { usePreVisitReportModal } from '@/composables/usePreVisitReportModal'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { useNotificationStore } from '@/stores/notifications'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const navOpen = ref(false)
const notifications = useNotificationStore()
const auth = useAuthStore()
/** 출장 전 진단 리포트 모달: 출장기사 화면 어디서든 같은 모달 하나 (목록 · 다음 방문 카드) */
const report = usePreVisitReportModal()
const field = useFieldVisits()

watch(() => route.fullPath, () => {
  navOpen.value = false
  report.close()
})
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') navOpen.value = false
}
onMounted(() => {
  notifications.startPolling()
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  notifications.stopPolling()
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="app-shell" :class="{ 'nav-open': navOpen }">
    <a href="#main" class="skip">본문으로 건너뛰기</a>
    <AppSidebar class="app-side" :open="navOpen" @navigate="navOpen = false" />
    <div class="scrim" aria-hidden="true" @click="navOpen = false" />
    <PreVisitDiagnosisReportModal
      v-if="auth.technicianType === 'FIELD'"
      :open="report.state.open"
      :repair-id="report.state.repairId"
      :visit-id="report.state.visitId"
      :readonly="report.state.readonly"
      @close="report.close()"
      @confirmed="field.load()"
      @order-requested="field.load()"
    />
    <div class="app-main">
      <AppTopbar :nav-open="navOpen" @toggle-nav="navOpen = !navOpen" />
      <main id="main" tabindex="-1">
        <RouterView v-slot="{ Component, route: r }">
          <component :is="Component" :key="r.path" />
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
}
/* 768px 이상: 흐름 안에 고정(sticky) — 펼치면 상단바·본문이 함께 밀림. 767px 이하는 AppSidebar 가 오버레이로 */
@media (min-width: 768px) {
  .app-side {
    position: sticky;
    top: 0;
    flex: none;
    z-index: 45;
  }
}
.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
main {
  flex: 1;
  outline: none;
}
/* 본문 제목·카드의 왼쪽 시작 = 상단바 제목의 왼쪽 시작 (가운데 정렬로 어긋나지 않게) */
main :deep(> .page) {
  margin-left: 0;
  margin-right: 0;
}
.skip {
  position: absolute;
  left: -999px;
  top: 8px;
  z-index: 200;
  background: var(--navy-800);
  color: #fff;
  padding: 10px 16px;
  border-radius: var(--radius);
}
.skip:focus {
  left: 8px;
}
.scrim {
  display: none;
}
/* 768~1199px: 메뉴 버튼으로 펼쳤을 때 바깥(본문)을 누르면 닫힘 — 투명 */
@media (max-width: 1199px) {
  .nav-open .scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 44;
  }
}
/* 767px 이하: 사이드바는 화면 밖(AppSidebar) → 오버레이 + 어두운 바깥 */
@media (max-width: 767px) {
  .nav-open .scrim {
    z-index: 70;
    background: rgba(15, 29, 66, 0.35);
  }
}
</style>
