<script setup lang="ts">
/* ECharts 래퍼 — 막대/가로막대/선/파이. 항목 클릭 시 select 이벤트로 드릴다운 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const props = withDefaults(
  defineProps<{
    type: 'bar' | 'hbar' | 'line' | 'pie'
    labels: string[]
    series: { name: string; data: number[]; color?: string }[]
    height?: number
    selected?: string | null
    chartLabel: string
  }>(),
  { height: 300, selected: null },
)
const emit = defineEmits<{ select: [label: string] }>()

const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<echarts.ECharts | null>(null)
let ro: ResizeObserver | null = null

const NAVY = '#2563eb'
const PALETTE = ['#2563eb', '#60a5fa', '#a5b4fc', '#0b1b3f', '#c27a1a', '#3d8a5f']

function option(): EChartsCoreOption {
  const base = {
    textStyle: { fontFamily: 'Pretendard Variable, sans-serif', fontSize: 14 },
    tooltip: { trigger: props.type === 'pie' ? 'item' : 'axis', textStyle: { fontSize: 14 } },
    animationDuration: 500,
  }
  const hl = (i: number, c?: string) => (props.selected && props.labels[i] !== props.selected ? '#c8cfdc' : (c ?? NAVY))
  if (props.type === 'pie') {
    return {
      ...base,
      legend: { bottom: 0, textStyle: { fontSize: 13 } },
      series: [
        {
          type: 'pie',
          radius: ['45%', '72%'],
          center: ['50%', '45%'],
          label: { formatter: '{b}\n{d}%', fontSize: 13 },
          data: props.labels.map((l, i) => ({ name: l, value: props.series[0].data[i], itemStyle: { color: props.selected && props.selected !== l ? '#d5dae4' : PALETTE[i % PALETTE.length] } })),
        },
      ],
    }
  }
  if (props.type === 'line') {
    return {
      ...base,
      legend: { top: 0, textStyle: { fontSize: 13 } },
      grid: { left: 44, right: 16, top: 36, bottom: 30 },
      xAxis: { type: 'category', data: props.labels, axisLabel: { fontSize: 13 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 13 } },
      series: props.series.map((s, i) => ({ name: s.name, type: 'line', smooth: true, symbolSize: 9, data: s.data, lineStyle: { width: 3 }, itemStyle: { color: s.color ?? PALETTE[i] } })),
    }
  }
  const horizontal = props.type === 'hbar'
  const cat = { type: 'category', data: props.labels, axisLabel: { fontSize: 13, width: 120, overflow: 'truncate' }, inverse: horizontal }
  const val = { type: 'value', axisLabel: { fontSize: 13 } }
  return {
    ...base,
    grid: { left: horizontal ? 130 : 44, right: 30, top: 16, bottom: 30 },
    xAxis: horizontal ? val : cat,
    yAxis: horizontal ? cat : val,
    series: props.series.map((s) => ({
      name: s.name,
      type: 'bar',
      barMaxWidth: 34,
      data: s.data.map((v, i) => ({ value: v, itemStyle: { color: hl(i, s.color), borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } })),
      label: { show: true, position: horizontal ? 'right' : 'top', fontSize: 13, fontWeight: 600 },
    })),
  }
}

onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  chart.value.setOption(option())
  chart.value.on('click', (p) => {
    if (typeof p.name === 'string') emit('select', p.name)
  })
  ro = new ResizeObserver(() => chart.value?.resize())
  ro.observe(el.value)
})
watch(() => [props.labels, props.series, props.selected], () => chart.value?.setOption(option(), true), { deep: true })
onBeforeUnmount(() => {
  ro?.disconnect()
  chart.value?.dispose()
})
</script>

<template>
  <div>
    <div ref="el" class="chart" role="img" :aria-label="chartLabel" :style="{ height: `${height}px` }" />
    <!-- 스크린리더·키보드 사용자를 위한 대체 선택 수단 -->
    <div class="sr-only">
      <button v-for="l in labels" :key="l" type="button" @click="emit('select', l)">{{ l }} 관련 수리 목록 보기</button>
    </div>
  </div>
</template>

<style scoped>
.chart {
  width: 100%;
  cursor: pointer;
}
</style>
