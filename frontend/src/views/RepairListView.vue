<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, X, Camera, UserCheck, FileCheck2, CircleCheck, RefreshCw, Plus, Filter } from 'lucide-vue-next'
import StatCard from '@/components/common/StatCard.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import RepairTable from '@/components/repair/RepairTable.vue'
import { useRepairListStore } from '@/stores/repairs'
import { useAuthStore } from '@/stores/auth'
import { STATUS_GROUPS, STATUS_META, STATUS_ORDER } from '@/constants/status'
import { MODELS } from '@/mocks/data'
import { formatRelative } from '@/utils/format'
import { isPreset, PRESET_LABEL } from '@/utils/repairPresets'
import type { RepairQuery, RepairStatus, StatusGroupKey } from '@/types'

const store = useRepairListStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const keyword = ref(store.query.keyword ?? '')

function syncFromRoute() {
  const s = route.query.status
  store.query.status = typeof s === 'string' && (STATUS_ORDER as string[]).includes(s) ? (s as RepairStatus) : 'ALL'
  const g = route.query.group
  // 개별 상태가 지정되면 그룹 필터는 무시
  store.query.group = store.query.status === 'ALL' ? STATUS_GROUPS.find((x) => x.key === g)?.key : undefined
  store.query.keyword = typeof route.query.q === 'string' ? route.query.q : ''
  keyword.value = store.query.keyword
  // 기사 홈 카드에서 넘어온 필터 (상태·그룹 필터와는 같이 쓰지 않음)
  const p = route.query.preset
  store.preset = isPreset(p) ? p : null
  if (store.preset) {
    store.query.status = 'ALL'
    store.query.group = undefined
  }
}
function clearPreset() {
  store.preset = null
  void router.replace({ query: { ...route.query, preset: undefined } })
  void store.fetch()
}

onMounted(() => {
  syncFromRoute()
  void store.fetch()
  store.startLive()
})
onBeforeUnmount(() => store.stopLive())

// 검색어 입력 디바운스
let t: number | undefined
watch(keyword, (v) => {
  window.clearTimeout(t)
  t = window.setTimeout(() => {
    store.query.keyword = v
    void router.replace({ query: { ...route.query, q: v || undefined } })
    void store.fetch()
  }, 300)
})

function setStatus(s: RepairQuery['status']) {
  store.query.status = s
  store.query.group = undefined
  store.preset = null
  void router.replace({ query: { ...route.query, status: s === 'ALL' ? undefined : s, group: undefined, preset: undefined } })
  void store.fetch()
}
/** 그룹 이름 클릭 → 그 그룹의 상태를 한 번에 필터링 */
function setGroup(g: StatusGroupKey) {
  store.query.status = 'ALL'
  store.query.group = g
  store.preset = null
  void router.replace({ query: { ...route.query, status: undefined, group: g, preset: undefined } })
  void store.fetch()
}
// 서버가 statusCounts 를 주지 않거나 비어 있으면 건수를 모르는 것으로 보고 숫자·흐림 표시를 하지 않는다
const hasCounts = computed(() => Object.keys(store.statusCounts).length > 0)
const countOf = (s: RepairStatus) => store.statusCounts[s] ?? 0
const allCount = computed(() => Object.values(store.statusCounts).reduce((a, n) => a + (n ?? 0), 0))
const groupCount = (g: (typeof STATUS_GROUPS)[number]) => g.statuses.reduce((a, s) => a + countOf(s), 0)

/* ---------- 업무 단계 탭 → 그 단계의 세부 상태 ----------
 * 활성 탭 = 그룹 필터, 또는 고른 세부 상태가 속한 그룹. '전체'면 세부 상태 줄을 숨긴다 */
const activeGroup = computed(() => store.query.group ?? STATUS_GROUPS.find((g) => (g.statuses as string[]).includes(store.query.status ?? 'ALL'))?.key)
const activeGroupDef = computed(() => STATUS_GROUPS.find((g) => g.key === activeGroup.value))
function pickTab(g: StatusGroupKey | 'ALL') {
  // 다른 단계를 고르면 이전 세부 상태는 지운다 (같은 탭을 다시 눌러도 단계 전체로)
  if (g === 'ALL') setStatus('ALL')
  else setGroup(g)
}
/** 세부 상태: 다시 누르면 해제 → 단계 전체 */
function pickStatus(s: RepairStatus) {
  if (store.query.status === s && activeGroup.value) setGroup(activeGroup.value)
  else setStatus(s)
}
function onSort() {
  void store.fetch()
}
function clearAll() {
  keyword.value = ''
  store.resetQuery()
  void router.replace({ query: {} })
  void store.fetch()
}
const filtered = computed(() => store.query.status !== 'ALL' || !!store.query.group || !!store.query.keyword || !!store.query.model || !!store.preset)
const isTech = computed(() => auth.role === 'TECHNICIAN')
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>{{ isTech ? '수리 접수 관리' : '수리 목록' }}</h1>
        <p class="sub">
          {{ isTech ? '내게 배정된 센터 수리 건' : '전체 서비스센터 접수 건' }}
          <span v-if="store.loadedAt" class="faint"> · {{ formatRelative(store.loadedAt) }} 갱신 · 실시간 반영 중</span>
        </p>
      </div>
      <div class="row">
        <button class="btn" type="button" :disabled="store.loading" @click="store.fetch()"><RefreshCw :size="18" :class="{ spin: store.loading }" /> 새로고침</button>
        <!-- 기사 메뉴에 '수리 접수'가 없어 신규 접수는 여기서 -->
        <RouterLink v-if="isTech" to="/repairs/new" class="btn btn-primary"><Plus :size="18" /> 새 접수</RouterLink>
      </div>
    </div>

    <p v-if="store.preset" class="preset-chip">
      <Filter :size="16" aria-hidden="true" /> 홈 필터: <b>{{ PRESET_LABEL[store.preset] }}</b>
      <button type="button" class="btn btn-sm btn-ghost" @click="clearPreset"><X :size="16" /> 해제</button>
    </p>

    <div class="grid-4">
      <!-- 통계 정보 카드 (필터는 아래 상태 칩 하나로 — 같은 필터 버튼을 두 곳에 두지 않음) -->
      <StatCard info label="추가 사진 필요" :value="store.counts.needPhoto" :icon="Camera" tone="warning" />
      <StatCard info label="진단 확인 대기" :value="store.counts.technicianReview" :icon="UserCheck" tone="ai" />
      <StatCard info label="리포트 확정 대기" :value="store.counts.reportPending" :icon="FileCheck2" tone="warning" />
      <StatCard info label="수리 완료" :value="store.counts.completed" :icon="CircleCheck" tone="success" />
    </div>

    <section class="card">
      <div class="filter-area">
        <!-- ① 검색 · 모델 · 정렬 · 초기화 -->
        <div class="repair-filter-toolbar">
          <div class="search">
            <Search :size="20" class="si" aria-hidden="true" />
            <label for="kw" class="sr-only">검색</label>
            <input id="kw" v-model="keyword" class="input" type="search" placeholder="수리 ID(#101) · 시리얼 · 모델 · 증상 · 에러코드 · 기사 이름 검색" />
          </div>
          <label for="model" class="sr-only">모델</label>
          <select id="model" v-model="store.query.model" class="select" @change="store.fetch()">
            <option :value="undefined">모델: 전체</option>
            <option v-for="m in Object.keys(MODELS)" :key="m" :value="m">{{ m }}</option>
          </select>
          <label for="sort" class="sr-only">정렬</label>
          <select id="sort" v-model="store.query.sort" class="select" @change="onSort">
            <option value="receivedAt_desc">최근 접수순</option>
            <option value="receivedAt_asc">오래된 접수순</option>
          </select>
          <button type="button" class="btn reset" :disabled="!filtered" @click="clearAll"><X :size="18" /> 초기화</button>
        </div>

        <!-- ② 업무 단계 탭 -->
        <div class="stage-tabs" role="group" aria-label="업무 단계">
          <button type="button" class="stage-tab" :aria-pressed="!activeGroup" @click="pickTab('ALL')">
            전체 <span v-if="hasCounts" class="n">{{ allCount }}</span>
          </button>
          <button
            v-for="g in STATUS_GROUPS"
            :key="g.key"
            type="button"
            class="stage-tab"
            :aria-pressed="activeGroup === g.key"
            :aria-label="hasCounts ? `${g.label} ${groupCount(g)}건` : g.label"
            @click="pickTab(g.key)"
          >
            {{ g.label }} <span v-if="hasCounts" class="n">{{ groupCount(g) }}</span>
          </button>
        </div>

        <!-- ③ 선택한 단계의 세부 상태 ('전체'면 숨김) -->
        <div v-if="activeGroupDef" class="chip-list" role="group" :aria-label="`${activeGroupDef.label} 세부 상태`">
          <button
            v-for="s in activeGroupDef.statuses"
            :key="s"
            type="button"
            class="chip"
            :class="{ zero: hasCounts && !countOf(s) }"
            :aria-pressed="store.query.status === s"
            :aria-label="hasCounts ? `${STATUS_META[s].label} ${countOf(s)}건` : STATUS_META[s].label"
            @click="pickStatus(s)"
          >
            <component :is="STATUS_META[s].icon" :size="15" aria-hidden="true" /> {{ STATUS_META[s].label }} <span v-if="hasCounts" class="n">{{ countOf(s) }}</span>
          </button>
        </div>
      </div>

      <!-- 목록 헤더: 건수 -->
      <div v-if="!store.error" class="list-head">
        <h2>수리 목록</h2>
        <span class="list-count" aria-live="polite">
          <template v-if="store.loading && !store.items.length">불러오는 중…</template>
          <template v-else>{{ filtered ? '검색 결과' : '총' }} <b>{{ store.items.length }}</b>건</template>
        </span>
      </div>

      <div v-if="store.loading && !store.items.length" class="card-body"><SkeletonBlock :lines="6" :height="44" /></div>
      <StateView v-else-if="store.error" state="error" :message="store.error" @retry="store.fetch()" />
      <!-- 필터 초기화는 위 필터 줄의 버튼 하나만 -->
      <StateView
        v-else-if="!store.items.length"
        state="empty"
        :title="filtered ? '조건에 맞는 수리 건이 없습니다' : isTech ? (auth.technicianType === 'FIELD' ? '처리할 센터 수리 접수가 없어요' : '현재 배정된 센터 수리 건이 없어요.') : '접수된 수리 건이 없습니다'"
        :message="filtered ? '검색어나 상태 필터를 바꿔 보세요. (위의 초기화)' : undefined"
      />
      <template v-else>
        <RepairTable :items="store.items" :role="auth.role" :class="{ dim: store.loading }" />
      </template>
    </section>
  </div>
</template>

<style scoped>
.preset-chip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  justify-self: start;
  padding: 4px 6px 4px 14px;
  border-radius: var(--radius-pill);
  background: var(--blue-50);
  color: var(--primary);
  font-size: var(--fs-sm);
}
.filter-area {
  display: grid;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
/* ① 검색창이 남는 폭을 모두, 나머지는 필요한 만큼 */
.repair-filter-toolbar {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) 180px 180px auto;
  gap: 12px;
  align-items: center;
}
.repair-filter-toolbar .input,
.repair-filter-toolbar .select,
.repair-filter-toolbar .reset {
  height: 48px;
  min-height: 48px;
}
.search {
  position: relative;
  min-width: 0;
}
.search .input {
  width: 100%;
  padding-left: 44px;
}
.si {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
}
.reset {
  white-space: nowrap;
}

/* ② 업무 단계 탭 — 내용 폭만큼 (억지로 같은 폭으로 늘리지 않음) */
.stage-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stage-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--navy-800);
  font-weight: 700;
  font-size: var(--fs-md);
  cursor: pointer;
  white-space: nowrap;
}
.stage-tab:hover {
  background: var(--surface-2);
}
.stage-tab[aria-pressed='true'] {
  background: var(--navy-800);
  border-color: var(--navy-800);
  color: #fff;
}
.stage-tab .n {
  color: var(--text-2);
}
.stage-tab[aria-pressed='true'] .n {
  color: #fff;
}

/* ③ 세부 상태 */
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  font-weight: 600;
  font-size: var(--fs-sm);
  cursor: pointer;
}
.chip[aria-pressed='true'] {
  background: var(--navy-800);
  border-color: var(--navy-800);
  color: #fff;
}
.chip[aria-pressed='true'] .n {
  color: #fff;
}
.chip.zero {
  opacity: 0.55;
}
.n {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text-2);
}

/* 목록 헤더 */
.list-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 20px 4px;
}
.list-head h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--ink);
}
.list-count {
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.list-count b {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

/* 한 줄(검색 최소 320 + 모델 180 + 정렬 180 + 초기화)이 들어가지 않는 폭: 검색은 위 한 줄, 아래에 모델·정렬·초기화 */
@media (max-width: 1100px) {
  .repair-filter-toolbar {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  }
  .search {
    grid-column: 1 / -1;
  }
}
@media (max-width: 480px) {
  .repair-filter-toolbar {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .reset {
    grid-column: 1 / -1;
  }
}
@media (max-width: 860px) {
  .filter-area {
    padding: 14px 16px;
  }
}
.dim {
  opacity: 0.6;
  transition: opacity 0.2s;
}
</style>
