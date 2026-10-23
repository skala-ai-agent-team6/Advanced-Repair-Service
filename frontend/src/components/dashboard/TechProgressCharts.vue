<script setup lang="ts">
/* =========================================================================
 * 기사 홈 그래프 2개 (ECharts)
 *  - 진행률 도넛 (ProgressDonut): 제목·계산은 기사 유형별로 부모가 넘겨줌 (출장: 오늘 출장 완료 / 센터: 오늘 수리 처리 현황)
 *  - 이번 주 처리 건수: 월~일 세로 막대(완료 건수). 오늘 막대만 주색, 나머지 연한 파랑.
 *    y축 숫자·격자선 없음, 막대 위에 값(0 제외), 마우스를 올리면 "목 · 4건"
 * 색: 주색 #2563eb (DefectStatisticsChart 와 같은 토큰) · 연한 파랑 #7fa8f5 (팔레트 검증 통과)
 * ========================================================================= */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'
import ProgressDonut from '@/components/dashboard/ProgressDonut.vue'
import { thisWeek, WEEK_LABELS, weeklyClosed } from '@/utils/techStats'
import { kstToday } from '@/utils/kst'
import type { Repair, User } from '@/types'

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ items: Repair[]; user: User | null; loading?: boolean; progress: { title: string; done: number; total: number } }>()

const PRIMARY = '#2563eb'
const LIGHT = '#7fa8f5'
const INK = '#0b1b3f'
const MUTED = '#64748b'
const FONT = 'Pretendard Variable, sans-serif'

const days = computed(() => thisWeek())
const todayIdx = computed(() => days.value.indexOf(kstToday()))
const weekly = computed(() => weeklyClosed(props.items, props.user, days.value))
const weekTotal = computed(() => weekly.value.reduce((a, n) => a + n, 0))

/* ---------- 주간 막대 ---------- */
function barOption(): EChartsCoreOption {
  const t = todayIdx.value
  return {
    textStyle: { fontFamily: FONT },
    animationDuration: 500,
    grid: { left: 4, right: 4, top: 22, bottom: 24 },
    tooltip: {
      trigger: 'item',
      formatter: (p: { dataIndex: number; value: number }) => `${WEEK_LABELS[p.dataIndex]} · ${p.value}건`,
      textStyle: { fontSize: 13, color: INK },
      padding: [6, 10],
    },
    xAxis: {
      type: 'category',
      data: WEEK_LABELS.map((l, i) => ({ value: l, textStyle: i === t ? { color: INK, fontWeight: 700 } : { color: MUTED } })),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e8edf4' } },
      axisLabel: { fontSize: 13 },
    },
    yAxis: { type: 'value', show: false, splitLine: { show: false }, minInterval: 1 },
    series: [
      {
        type: 'bar',
        barMaxWidth: 24,
        data: weekly.value.map((v, i) => ({
          value: v,
          itemStyle: { color: i === t ? PRIMARY : LIGHT, borderRadius: [4, 4, 0, 0] },
          // 값 라벨: 0 은 생략, 글자는 데이터 색이 아닌 글자색
          label: { show: v > 0, position: 'top', fontSize: 12, fontWeight: 600, color: i === t ? INK : MUTED },
        })),
        emphasis: { itemStyle: { opacity: 0.85 } },
      },
    ],
  }
}

/* ---------- ECharts 생명주기 ---------- */
const barEl = ref<HTMLDivElement | null>(null)
const bar = shallowRef<echarts.ECharts | null>(null)
let ro: ResizeObserver | null = null

onMounted(() => {
  if (!barEl.value) return
  bar.value = echarts.init(barEl.value)
  bar.value.setOption(barOption())
  ro = new ResizeObserver(() => bar.value?.resize())
  ro.observe(barEl.value)
})
watch(
  () => [props.items, props.user],
  () => bar.value?.setOption(barOption(), true),
  { deep: true },
)
onBeforeUnmount(() => {
  ro?.disconnect()
  bar.value?.dispose()
})
</script>

<template>
  <div class="charts">
    <ProgressDonut :title="progress.title" :done="progress.done" :total="progress.total" :loading="loading && !items.length" />

    <section class="card chart-card" aria-labelledby="h-week">
      <div class="row between">
        <h2 id="h-week" class="h">이번 주 처리 건수</h2>
        <span class="faint">합계 {{ weekTotal }}건</span>
      </div>
      <div ref="barEl" class="bars" aria-hidden="true" />
      <!-- 스크린리더용 표 (그래프와 같은 숫자) -->
      <table class="sr-only">
        <caption>이번 주 요일별 완료 건수</caption>
        <tr><th v-for="l in WEEK_LABELS" :key="l" scope="col">{{ l }}</th></tr>
        <tr><td v-for="(v, i) in weekly" :key="i">{{ v }}건</td></tr>
      </table>
    </section>
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
}
.chart-card {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 20px 22px;
}
.h {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-2);
  margin: 0;
}
.bars {
  height: 200px;
}
/* 좁은 화면: 위아래로 */
@media (max-width: 860px) {
  .charts {
    grid-template-columns: 1fr;
  }
}
</style>
