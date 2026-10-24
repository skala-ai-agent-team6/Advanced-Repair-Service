<script setup lang="ts">
/* 주소 검색 모달 — 결과를 고르면 select 로 돌려주고 닫는다
 *  Mock: 자체 검색창 + 결과 목록 (검색 전 · 검색 중 · 결과 없음 · 오류/다시 시도)
 *  실서버: Daum 우편번호 화면을 모달 안에 띄움 (스크립트 로딩 · 로드 오류/다시 시도)
 *  브라우저 뒤로가기(popstate) 때는 모달을 닫아 상태가 남지 않게 한다 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, Loader2, CircleAlert, RotateCw, MapPin } from 'lucide-vue-next'
import BaseModal from '@/components/common/BaseModal.vue'
import { fromDaum, loadDaumPostcode, useAddressSearch } from '@/composables/useAddressSearch'
import type { AddressSearchResult } from '@/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; select: [result: AddressSearchResult] }>()

const { provider, keyword, results, status, search, retry, reset } = useAddressSearch()

/* ---------- 실서버: Daum 우편번호 ---------- */
const daumEl = ref<HTMLDivElement | null>(null)
const daumState = ref<'loading' | 'ready' | 'error'>('loading')
async function mountDaum() {
  daumState.value = 'loading'
  try {
    await loadDaumPostcode()
    await nextTick()
    if (!daumEl.value || !window.daum) throw new Error('postcode')
    daumEl.value.innerHTML = ''
    new window.daum.Postcode({ oncomplete: (d) => pick(fromDaum(d)), width: '100%', height: '100%' }).embed(daumEl.value, { autoClose: false })
    daumState.value = 'ready'
  } catch {
    daumState.value = 'error'
  }
}

watch(
  () => props.open,
  (v) => {
    if (!v) return
    reset()
    if (provider === 'daum') void mountDaum()
  },
)

function pick(r: AddressSearchResult) {
  emit('select', r)
}

/* 결과 목록 키보드: ↑↓ 로 이동, Enter 로 선택 (버튼이라 Tab·Enter 도 됨) */
const listEl = ref<HTMLUListElement | null>(null)
function move(e: KeyboardEvent, i: number) {
  const items = listEl.value?.querySelectorAll<HTMLButtonElement>('button.addr-item')
  if (!items?.length) return
  const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)
  items[next]?.focus()
}

/* 뒤로가기: 모달만 닫는다 */
function onPop() {
  if (props.open) emit('close')
}
onMounted(() => window.addEventListener('popstate', onPop))
onBeforeUnmount(() => window.removeEventListener('popstate', onPop))
</script>

<template>
  <BaseModal :open="open" title="주소 검색" :width="600" mobile-full @close="emit('close')">
    <!-- ===== Mock: 자체 검색 ===== -->
    <div v-if="provider === 'mock'" class="addr-modal">
      <form class="addr-search" role="search" @submit.prevent="search()">
        <label for="addr-q" class="sr-only">주소 검색어</label>
        <input id="addr-q" v-model="keyword" class="input" type="search" autocomplete="off" placeholder="도로명, 건물명 또는 지번을 입력해 주세요." />
        <button type="submit" class="btn btn-primary" :disabled="status === 'loading'"><Search :size="18" aria-hidden="true" /> 검색</button>
      </form>

      <div class="addr-body" aria-live="polite">
        <div v-if="status === 'idle'" class="addr-hint">
          <MapPin :size="22" aria-hidden="true" />
          <p>도로명 + 건물번호, 건물명, 지번으로 검색해 주세요.</p>
          <p class="faint">예) 테헤란로 123 · ROVIA 타워 · 역삼동 123-4</p>
        </div>
        <p v-else-if="status === 'loading'" class="addr-state" role="status"><Loader2 :size="20" class="spin" aria-hidden="true" /> 주소를 찾고 있어요…</p>
        <p v-else-if="status === 'empty'" class="addr-state">검색 결과가 없습니다. 도로명이나 건물명을 다시 확인해 주세요.</p>
        <div v-else-if="status === 'error'" class="addr-state err" role="alert">
          <CircleAlert :size="20" aria-hidden="true" /> 주소 검색 중 오류가 발생했습니다.
          <button type="button" class="btn btn-sm" @click="retry"><RotateCw :size="16" aria-hidden="true" /> 다시 시도</button>
        </div>
        <ul v-else ref="listEl" class="addr-list" aria-label="주소 검색 결과">
          <li v-for="(r, i) in results" :key="`${r.postalCode}-${r.roadAddress}`">
            <button type="button" class="addr-item" @click="pick(r)" @keydown.down.prevent="move($event, i)" @keydown.up.prevent="move($event, i)">
              <span class="zip mono">{{ r.postalCode }}</span>
              <span class="line"><span class="badge tone-info">도로명</span><span>{{ r.roadAddress }}<template v-if="r.buildingName"> ({{ r.buildingName }})</template></span></span>
              <span v-if="r.jibunAddress" class="line faint"><span class="badge tone-neutral">지번</span><span>{{ r.jibunAddress }}</span></span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <!-- ===== 실서버: Daum 우편번호 ===== -->
    <div v-else class="addr-modal">
      <p v-if="daumState === 'loading'" class="addr-state" role="status"><Loader2 :size="20" class="spin" aria-hidden="true" /> 주소 검색을 준비하고 있어요…</p>
      <div v-else-if="daumState === 'error'" class="addr-state err" role="alert">
        <CircleAlert :size="20" aria-hidden="true" /> 주소 검색 중 오류가 발생했습니다.
        <button type="button" class="btn btn-sm" @click="mountDaum"><RotateCw :size="16" aria-hidden="true" /> 다시 시도</button>
      </div>
      <div v-show="daumState === 'ready'" ref="daumEl" class="daum-frame" />
    </div>
  </BaseModal>
</template>

<style scoped>
.addr-modal {
  display: grid;
  gap: 12px;
  min-height: 360px;
  align-content: start;
}
.addr-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.addr-search .input,
.addr-search .btn {
  height: 48px;
  min-height: 48px;
}
.addr-body {
  min-height: 280px;
}
.addr-hint {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 40px 12px;
  text-align: center;
  color: var(--text-2);
}
.addr-hint p {
  margin: 0;
}
.addr-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 12px;
  margin: 0;
  text-align: center;
  color: var(--text-2);
}
.addr-state.err {
  color: var(--danger);
}
.addr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
  max-height: 420px;
  overflow: auto;
}
.addr-item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font: inherit;
}
.addr-item:hover {
  background: var(--blue-50);
  border-color: var(--primary);
}
.addr-item:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 1px;
}
.zip {
  font-weight: 700;
  color: var(--primary);
}
/* 주소는 여러 줄로 (가로 스크롤 없이) */
.line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.line .badge {
  font-size: var(--fs-xs);
}
.daum-frame {
  width: 100%;
  height: 460px;
}
@media (max-width: 767px) {
  .addr-list {
    max-height: none;
  }
  .daum-frame {
    height: calc(100vh - 120px);
  }
}
</style>
