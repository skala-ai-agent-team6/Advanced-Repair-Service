<script setup lang="ts">
/* 진행률 도넛 카드 (기사·품질 담당자 홈 공통)
 * 가운데 "완료/전체" 큰 숫자 + "n% 완료". 전체가 0이면 0% + "오늘 예정된 업무가 없어요" */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([PieChart, CanvasRenderer])

const props = defineProps<{ title: string; done: number; total: number; loading?: boolean }>()

const PRIMARY = '#2563eb'
const TRACK = '#eef2f8'

const pct = computed(() => (props.total ? Math.round((props.done / props.total) * 100) : 0))

function option(): EChartsCoreOption {
  const { done, total } = props
  return {
    animationDuration: 600,
    series: [
      {
        type: 'pie',
        radius: ['74%', '90%'],
        silent: true,
        startAngle: 90,
        label: { show: false },
        // 완료 · 남은 건 사이 2px 틈 (완료가 0 이거나 전부면 틈 없음)
        itemStyle: { borderColor: '#fff', borderWidth: done && done < total ? 2 : 0 },
        data: total
          ? [
              { value: done, itemStyle: { color: PRIMARY } },
              { value: total - done, itemStyle: { color: TRACK } },
            ]
          : [{ value: 1, itemStyle: { color: TRACK } }],
      },
    ],
  }
}

const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<echarts.ECharts | null>(null)
let ro: ResizeObserver | null = null
onMounted(() => {
  if (!el.value) return
  chart.value = echarts.init(el.value)
  chart.value.setOption(option())
  ro = new ResizeObserver(() => chart.value?.resize())
  ro.observe(el.value)
})
watch(() => [props.done, props.total], () => chart.value?.setOption(option(), true))
onBeforeUnmount(() => {
  ro?.disconnect()
  chart.value?.dispose()
})
</script>

<template>
  <section class="card donut-card" :aria-label="title">
    <h2 class="h">{{ title }}</h2>
    <div class="donut-wrap">
      <div ref="el" class="donut" aria-hidden="true" />
      <div class="center" role="img" :aria-label="total ? `${title}: ${total}건 중 ${done}건 완료, ${pct}%` : `${title}: 오늘 예정된 업무가 없어요, 0%`">
        <span class="num-xl">{{ loading ? '–' : `${done}/${total}` }}</span>
        <span class="pct">{{ pct }}% 완료</span>
      </div>
    </div>
    <p v-if="!loading && !total" class="empty">오늘 예정된 업무가 없어요</p>
  </section>
</template>

<style scoped>
.donut-card {
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
.donut-wrap {
  position: relative;
  height: 200px;
}
.donut {
  position: absolute;
  inset: 0;
}
.center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 2px;
  pointer-events: none;
}
.pct {
  color: var(--text-2);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.empty {
  text-align: center;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
</style>
