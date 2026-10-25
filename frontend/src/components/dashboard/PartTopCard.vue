<script setup lang="ts">
/* 홈(본사 품질 담당자) — 부품별 고장 TOP 5 · 최근 30일 미리보기
 *  확정된 수리 리포트만 집계 (AI 진단 초안 제외) — 품질 대시보드와 같은 API(groupBy=PART)를 기간만 바꿔 사용
 *  막대를 누르면 품질 대시보드로 이동하며 해당 부품 필터(?part=부품명)를 적용
 *  로딩: 카드 크기 유지 Skeleton / 빈 결과 / 오류 + 다시 시도 */
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { dashboardApi } from '@/api'
import type { CountItem } from '@/types'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const DAYS = 30
const router = useRouter()
const items = ref<CountItem[]>([])
const loading = ref(true)
const error = ref(false)

async function load() {
  loading.value = true
  error.value = false
  try {
    items.value = await dashboardApi.partTop(DAYS, 5)
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}
onMounted(load)

/** 기존 대시보드 필터(부품 드릴다운)와 같은 값: 부품 이름 */
function openPart(label: string) {
  void router.push({ path: '/dashboard', query: { part: label } })
}

/* ---------- 차트 ---------- */
const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<echarts.ECharts | null>(null)
let ro: ResizeObserver | null = null
const BLUE = '#2563eb'

function option(): EChartsCoreOption {
  const narrow = (el.value?.clientWidth ?? 600) < 420
  return {
    animationDuration: 400,
    animationEasing: 'cubicOut',
    textStyle: { fontFamily: 'Pretendard Variable, Pretendard, sans-serif' },
    grid: { left: 4, right: 44, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'item',
      confine: true, // 툴팁이 화면(차트) 밖으로 나가지 않게
      formatter: (p: { name: string; value: number }) => `${p.name}<br/><b>${p.value}건</b>`,
      textStyle: { fontSize: 13 },
    },
    xAxis: { type: 'value', show: false, minInterval: 1 },
    yAxis: {
      type: 'category',
      inverse: true, // 많은 순서대로 위에서부터
      data: items.value.map((x) => x.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#334155', fontSize: 13, width: narrow ? 84 : 132, overflow: 'truncate', margin: 12 },
    },
    series: [
      {
        type: 'bar',
        data: items.value.map((x) => x.count),
        barMaxWidth: 18,
        itemStyle: { color: BLUE, borderRadius: [0, 4, 4, 0] },
        emphasis: { itemStyle: { color: '#1d4ed8' } },
        label: { show: true, position: 'right', formatter: '{c}건', color: '#0f172a', fontSize: 13, fontWeight: 600 },
        cursor: 'pointer',
      },
    ],
  }
}
function mount() {
  if (!el.value || chart.value) return
  chart.value = echarts.init(el.value)
  chart.value.setOption(option())
  chart.value.on('click', (p) => openPart(String(p.name)))
  ro = new ResizeObserver(() => {
    chart.value?.resize()
    chart.value?.setOption(option())
  })
  ro.observe(el.value)
}
function unmount() {
  ro?.disconnect()
  ro = null
  chart.value?.dispose()
  chart.value = null
}
// 데이터가 생기면 그리고, 빈 결과·오류로 바뀌면 정리
watch([loading, error, items], async () => {
  if (loading.value || error.value || !items.value.length) return unmount()
  await nextTick()
  if (chart.value) chart.value.setOption(option(), true)
  else mount()
})
onBeforeUnmount(unmount)
</script>

<template>
  <section class="card part-top" aria-labelledby="h-part-top">
    <header class="pt-head">
      <div>
        <h2 id="h-part-top">부품별 고장 TOP 5</h2>
        <span class="faint">최근 {{ DAYS }}일 · 확정된 수리 결과 기준</span>
      </div>
      <RouterLink to="/dashboard" class="btn btn-ghost btn-sm all">전체 보기 <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
    </header>

    <div class="pt-body">
      <SkeletonBlock v-if="loading" :lines="5" :height="22" />
      <StateView v-else-if="error" state="error" compact title="품질 데이터를 불러오지 못했습니다." @retry="load" />
      <StateView v-else-if="!items.length" state="empty" compact :title="`최근 ${DAYS}일 동안 확정된 고장 데이터가 없습니다.`" />
      <template v-else>
        <div ref="el" class="chart" role="img" :aria-label="`부품별 고장 TOP ${items.length}: ${items.map((x) => `${x.label} ${x.count}건`).join(', ')}`" />
        <!-- 키보드·화면 읽기용: 막대와 같은 이동 (평소 숨김, Tab 으로 들어오면 차트 위에 표시) -->
        <ul class="kbd-links" aria-label="부품별 품질 대시보드 바로가기">
          <li v-for="x in items" :key="x.key">
            <RouterLink :to="{ path: '/dashboard', query: { part: x.label } }">{{ x.label }} {{ x.count }}건 — 품질 대시보드에서 보기</RouterLink>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.part-top {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 20px 22px;
  gap: 8px;
}
.pt-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.pt-head h2 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-2);
}
.pt-head .faint {
  font-size: var(--fs-sm);
}
.all {
  flex: none;
  margin: -6px -8px 0 0;
}
.pt-body {
  min-height: 0;
  display: grid;
}
.chart {
  width: 100%;
  height: 100%;
  min-height: 180px;
}
.pt-body {
  position: relative;
}
.kbd-links {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  margin: 0;
  padding: 0;
  list-style: none;
}
.kbd-links:focus-within {
  inset: 0;
  width: auto;
  height: auto;
  clip: auto;
  overflow: auto;
  z-index: 2;
  display: grid;
  align-content: start;
  gap: 2px;
  padding: 8px;
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}
.kbd-links a {
  display: block;
  padding: 6px 10px;
  border-radius: 8px;
  color: var(--ink);
}
.kbd-links a:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: -3px;
}
</style>
