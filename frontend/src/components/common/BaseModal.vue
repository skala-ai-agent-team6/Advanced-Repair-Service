<script setup lang="ts">
/* 공통 모달 — ESC·바깥 선택·닫기 버튼으로 닫힘
 *  열린 동안: 배경 스크롤 막기 · Tab 포커스를 모달 안에 가두기 · 닫히면 열기 전 요소로 포커스 복귀
 *  mobileFull: 767px 이하에서 전체 화면으로
 *  placement='right': 오른쪽에서 밀려 나오는 Drawer (767px 이하에서는 아래에서 올라오는 전체 너비 Bottom Sheet). 내용만 스크롤
 *  #head-extra 슬롯: 제목 옆 배지 등 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { X } from 'lucide-vue-next'

/** 열린 모달 순서 — 모달 위에 확인 모달이 겹치면 맨 위 것만 ESC·Tab 에 반응 */
const openStack: symbol[] = []

/** scrollBody: 머리글·하단 버튼은 고정하고 본문만 스크롤 (큰 모달) */
const props = defineProps<{ open: boolean; title: string; width?: number; mobileFull?: boolean; placement?: 'center' | 'right'; scrollBody?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
let returnTo: HTMLElement | null = null
const me = Symbol('modal')
const isTop = () => openStack[openStack.length - 1] === me
function leaveStack() {
  const i = openStack.indexOf(me)
  if (i >= 0) openStack.splice(i, 1)
}
let locked = false

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
function onKey(e: KeyboardEvent) {
  if (!isTop()) return
  if (e.key === 'Escape') return emit('close')
  if (e.key !== 'Tab' || !panel.value) return
  const els = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !panel.value.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !panel.value.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
/** 배경 스크롤 막기 (모달이 겹쳐도 마지막 하나가 닫힐 때 풀림) */
function lock(on: boolean) {
  if (on === locked) return
  locked = on
  const n = Number(document.body.dataset.modalLocks ?? 0) + (on ? 1 : -1)
  document.body.dataset.modalLocks = String(Math.max(0, n))
  document.body.style.overflow = n > 0 ? 'hidden' : ''
}
watch(
  () => props.open,
  async (v) => {
    if (v) {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      openStack.push(me)
      document.addEventListener('keydown', onKey)
      lock(true)
      await nextTick()
      // 본문의 입력칸을 먼저, 없으면 첫 버튼 (머리글의 닫기 버튼보다 입력칸 우선)
      const p = panel.value
      ;(p?.querySelector<HTMLElement>('.card-body :is(textarea, input:not([type=hidden]), select)') ?? p?.querySelector<HTMLElement>('button.btn'))?.focus()
    } else {
      document.removeEventListener('keydown', onKey)
      leaveStack()
      lock(false)
      // 닫으면 열기 전 요소(예: 주소 검색 버튼)로 포커스 복귀
      if (returnTo?.isConnected) returnTo.focus()
      returnTo = null
    }
  },
)
onBeforeUnmount(() => {
  leaveStack()
  document.removeEventListener('keydown', onKey)
  lock(false)
})
</script>

<template>
  <Teleport to="body">
    <Transition :name="placement === 'right' ? 'drawer' : 'fade'">
      <div v-if="open" class="backdrop" :class="{ 'is-drawer': placement === 'right' }" @mousedown.self="emit('close')">
        <div
          ref="panel"
          class="modal card"
          :class="{ 'mobile-full': mobileFull, drawer: placement === 'right', 'scroll-body': scrollBody }"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :style="{ maxWidth: `${width ?? (placement === 'right' ? 480 : 560)}px` }"
        >
          <div class="card-head">
            <h2 class="m-title">{{ title }} <slot name="head-extra" /></h2>
            <button class="btn btn-ghost btn-sm" type="button" aria-label="닫기" @click="emit('close')"><X :size="20" /></button>
          </div>
          <div class="card-body"><slot /></div>
          <div v-if="$slots.footer" class="foot"><slot name="footer" /></div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 29, 66, 0.45);
  display: grid;
  place-items: center;
  z-index: 90;
  padding: 16px;
}
.modal {
  width: 100%;
  box-shadow: var(--shadow-lg);
  max-height: calc(100vh - 32px);
  overflow: auto;
}
.m-title {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
/* ---------- 본문만 스크롤 ---------- */
.modal.scroll-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal.scroll-body .card-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.modal.scroll-body .foot {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
/* ---------- 오른쪽 Drawer ---------- */
.backdrop.is-drawer {
  place-items: stretch end;
  padding: 0;
}
.modal.drawer {
  height: 100%;
  max-height: none;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal.drawer .card-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: background-color 0.22s ease;
}
.drawer-enter-active .modal,
.drawer-leave-active .modal {
  transition: transform 0.22s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  background-color: transparent;
}
.drawer-enter-from .modal,
.drawer-leave-to .modal {
  transform: translateX(100%);
}
/* 휴대폰: 아래에서 올라오는 전체 너비 Bottom Sheet */
@media (max-width: 767px) {
  .backdrop.is-drawer {
    place-items: end stretch;
  }
  .modal.drawer {
    max-width: none !important;
    height: auto;
    max-height: 88vh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
  .drawer-enter-from .modal,
  .drawer-leave-to .modal {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active .modal,
  .drawer-leave-active .modal {
    transition: none;
  }
}
@media (max-width: 767px) {
  .backdrop:has(.mobile-full) {
    padding: 0;
  }
  .modal.mobile-full {
    max-width: none !important;
    height: 100%;
    max-height: none;
    border-radius: 0;
    display: flex;
    flex-direction: column;
  }
  .modal.mobile-full .card-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
  flex-wrap: wrap;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
