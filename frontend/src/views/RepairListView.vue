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
  // 기사 대시보드 카드에서 넘어온 필터 (상태·그룹 필터와는 같이 쓰지 않음)
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
      <Filter :size="16" aria-hidden="true" /> 대시보드 필터: <b>{{ PRESET_LABEL[store.preset] }}</b>
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
      <div class="filters">
        <div class="search">
          <Search :size="20" class="si" aria-hidden="true" />
          <label for="kw" class="sr-only">검색</label>
          <input id="kw" v-model="keyword" class="input" type="search" placeholder="수리 ID(#101) · 시리얼 · 모델 · 증상 · 에러코드 · 기사 이름" />
        </div>
        <div class="field inline">
          <label for="model">모델</label>
          <select id="model" v-model="store.query.model" class="select" @change="store.fetch()">
            <option :value="undefined">전체</option>
            <option v-for="m in Object.keys(MODELS)" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <div class="field inline">
          <label for="sort">정렬</label>
          <select id="sort" v-model="store.query.sort" class="select" @change="onSort">
            <option value="receivedAt_desc">최근 접수순</option>
            <option value="receivedAt_asc">오래된 접수순</option>
          </select>
        </div>
        <button v-if="filtered" type="button" class="btn btn-ghost" @click="clearAll"><X :size="18" /> 필터 초기화</button>
      </div>
      <div class="chips" aria-label="진단 상태 필터" role="group">
        <div class="chip-row">
          <span class="group-label" aria-hidden="true" />
          <div class="chip-list">
            <button type="button" class="chip" :aria-pressed="store.query.status === 'ALL' && !store.query.group" @click="setStatus('ALL')">
              전체 <span v-if="hasCounts" class="n">{{ allCount }}</span>
            </button>
          </div>
        </div>
        <div v-for="g in STATUS_GROUPS" :key="g.key" class="chip-row">
          <button
            type="button"
            class="group-label"
            :aria-pressed="store.query.group === g.key"
            :title="`${g.label} 단계 상태 모두 보기`"
            @click="setGroup(g.key)"
          >
            {{ g.label }}
          </button>
          <div class="chip-list">
            <button
              v-for="s in g.statuses"
              :key="s"
              type="button"
              class="chip"
              :class="{ zero: hasCounts && !countOf(s), 'in-group': store.query.group === g.key }"
              :aria-pressed="store.query.status === s"
              :aria-label="hasCounts ? `${STATUS_META[s].label} ${countOf(s)}건` : STATUS_META[s].label"
              @click="setStatus(s)"
            >
              <component :is="STATUS_META[s].icon" :size="15" aria-hidden="true" /> {{ STATUS_META[s].label }} <span v-if="hasCounts" class="n">{{ countOf(s) }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="store.loading && !store.items.length" class="card-body"><SkeletonBlock :lines="6" :height="44" /></div>
      <StateView v-else-if="store.error" state="error" :message="store.error" @retry="store.fetch()" />
      <!-- 필터 초기화는 위 필터 줄의 버튼 하나만 -->
      <StateView
        v-else-if="!store.items.length"
        state="empty"
        :title="filtered ? '조건에 맞는 수리 건이 없습니다' : isTech ? '현재 배정된 센터 수리 건이 없어요.' : '접수된 수리 건이 없습니다'"
        :message="filtered ? '검색어나 상태 필터를 바꿔 보세요. (위의 필터 초기화)' : undefined"
      />
      <template v-else>
        <p class="faint count" aria-live="polite">{{ store.items.length }}건</p>
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
.filters {
  display: flex;
  gap: 12px;
  padding: 16px 20px 8px;
  flex-wrap: wrap;
  align-items: flex-end;
}
.search {
  position: relative;
  flex: 1 1 320px;
}
.search .input {
  padding-left: 44px;
}
.si {
  position: absolute;
  left: 14px;
  top: 14px;
  color: var(--text-3);
}
.field.inline {
  grid-template-columns: auto 160px;
  align-items: center;
}
.field.inline label {
  font-size: var(--fs-sm);
  color: var(--text-2);
}
.chips {
  display: grid;
  gap: 8px;
  padding: 8px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.chip-row {
  display: grid;
  grid-template-columns: 84px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.group-label {
  justify-self: start;
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--text-3);
  font-size: var(--fs-xs);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
span.group-label {
  cursor: default;
}
button.group-label:hover {
  color: var(--text-2);
  text-decoration: underline;
}
.group-label[aria-pressed='true'] {
  color: var(--navy-800);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.n {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--text-2);
}
.chip.zero {
  opacity: 0.55;
}
/* 그룹 필터 중에는 해당 그룹의 칩에 테두리만 강조 (선택된 칩 배경은 개별 상태 선택에만 사용) */
.chip.in-group {
  border-color: var(--navy-800);
}
@media (max-width: 860px) {
  .chip-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  span.group-label {
    display: none;
  }
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
.count {
  padding: 10px 20px 0;
}
.dim {
  opacity: 0.6;
  transition: opacity 0.2s;
}
</style>
