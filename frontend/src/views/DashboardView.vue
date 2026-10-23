<script setup lang="ts">
/* 품질 대시보드 — 사람이 승인한 고장 데이터만 집계. 그래프를 누르면 관련 수리 목록을 조회 */
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ClipboardList, CircleCheck, Sparkles, Target, TrendingUp, TrendingDown, Minus, X, ShieldCheck, MousePointerClick } from 'lucide-vue-next'
import DefectStatisticsChart from '@/components/dashboard/DefectStatisticsChart.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { useDashboardStore } from '@/stores/dashboard'
import type { DrillDim } from '@/api/dashboard'
import { FEATURES } from '@/api/features'
import { formatDate, formatNumber, repairId } from '@/utils/format'

const store = useDashboardStore()
const route = useRoute()
const drillEl = ref<HTMLElement | null>(null)
onMounted(async () => {
  store.clearDrill()
  await store.fetch()
  // 홈 '부품별 고장 TOP 5' 막대에서 넘어오면 그 부품 필터(기존 부품 드릴다운)를 바로 적용
  const part = route.query.part
  if (typeof part === 'string' && part) await drill('part', part)
})

const d = computed(() => store.data)
const DIM_LABEL: Record<DrillDim, string> = { part: '부품', model: '제품 모델', branch: '서비스센터', factory: '생산 공장', month: '기간', cause: '고장 유형' }
/** 실서버에는 모델별·AI 일치율·드릴다운 API 가 없어 해당 항목은 '준비 중' */
const extras = FEATURES.dashboardExtras
const rate = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '준비 중')
async function drill(dim: DrillDim, value: string) {
  if (!extras) return
  await store.drillDown(dim, value, `${DIM_LABEL[dim]}: ${value}`)
  await nextTick()
  drillEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const sel = (dim: DrillDim) => (store.drill?.dim === dim ? store.drill.value : null)
const kpis = computed(() =>
  d.value
    ? [
        { label: '전체 접수 건수', value: formatNumber(d.value.totalReceived), unit: '건', icon: ClipboardList, tone: 'info', hint: d.value.periodLabel },
        { label: '수리 완료 건수', value: formatNumber(d.value.completed), unit: '건', icon: CircleCheck, tone: 'success', hint: '리포트 확정 기준' },
        { label: 'AI 진단 성공률', value: rate(d.value.aiSuccessRate), unit: Number.isFinite(d.value.aiSuccessRate) ? '%' : '', icon: Sparkles, tone: 'ai', hint: '분석 실패·판독 불가 제외 비율' },
        { label: 'AI 진단 ↔ 실제 원인 일치율', value: rate(d.value.aiMatchRate), unit: Number.isFinite(d.value.aiMatchRate) ? '%' : '', icon: Target, tone: !Number.isFinite(d.value.aiMatchRate) ? 'neutral' : d.value.aiMatchRate >= 80 ? 'success' : 'warning', hint: '기사가 확정한 리포트 기준' },
      ]
    : [],
)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>품질 대시보드</h1>
        <p class="sub"><ShieldCheck :size="16" /> 확정된 수리 데이터를 기준으로 제품과 부품의 품질 현황을 분석합니다. (AI 초안 제외)<template v-if="extras"> 그래프 항목을 누르면 관련 수리 목록을 볼 수 있습니다.</template></p>
      </div>
      <div class="row">
        <label for="period" class="label">기간</label>
        <select id="period" v-model.number="store.months" class="select" style="width: 160px" @change="store.fetch()">
          <option :value="3">최근 3개월</option>
          <option :value="6">최근 6개월</option>
        </select>
      </div>
    </div>

    <div v-if="store.loading && !d" class="grid-4"><div v-for="i in 4" :key="i" class="card card-pad"><SkeletonBlock :lines="2" :height="28" /></div></div>
    <StateView v-else-if="store.error && !d" state="error" :message="store.error" class="card" @retry="store.fetch()" />
    <StateView v-else-if="d && !d.approvedCount" state="empty" title="확정된 고장 데이터가 없습니다" message="기사가 수리 리포트를 확정하면 통계가 표시됩니다." class="card" />

    <template v-else-if="d">
      <div class="grid-4">
        <div v-for="k in kpis" :key="k.label" class="card kpi" :class="`tone-${k.tone}`">
          <span class="ic"><component :is="k.icon" :size="22" /></span>
          <span class="lbl">{{ k.label }}</span>
          <span class="val">{{ k.value }}<small>{{ k.unit }}</small></span>
          <span class="faint">{{ k.hint }}</span>
        </div>
      </div>

      <p v-if="extras" class="hint faint"><MousePointerClick :size="16" /> 막대·점·조각을 누르면 아래에 관련 수리 목록이 표시됩니다.</p>

      <section class="card">
        <div class="card-head"><h2>기간별 고장 추이</h2><span class="faint">{{ d.periodLabel }}</span></div>
        <div class="card-body">
          <DefectStatisticsChart
            type="line"
            :labels="d.trend.map((t) => t.month)"
            :series="
              extras
                ? [
                    { name: '접수', data: d.trend.map((t) => t.received), color: '#a5b4fc' },
                    { name: '승인된 고장', data: d.trend.map((t) => t.defects), color: '#2563eb' },
                  ]
                : [{ name: '확정된 고장', data: d.trend.map((t) => t.defects), color: '#2563eb' }]
            "
            chart-label="월별 접수 및 승인 고장 건수 추이"
            :height="280"
            @select="drill('month', $event)"
          />
        </div>
      </section>

      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h2>부품별 고장 빈도</h2></div>
          <div class="card-body">
            <DefectStatisticsChart type="hbar" :labels="d.byPart.map((x) => x.label)" :series="[{ name: '고장', data: d.byPart.map((x) => x.count) }]" :selected="sel('part')" chart-label="부품별 고장 빈도" @select="drill('part', $event)" />
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>제품 모델별 고장 빈도</h2></div>
          <div v-if="!extras" class="card-body"><p class="soon">준비 중 · 백엔드 모델별 집계(groupBy) 지원 후 표시됩니다.</p></div>
          <div v-else class="card-body">
            <DefectStatisticsChart type="bar" :labels="d.byModel.map((x) => x.label)" :series="[{ name: '고장', data: d.byModel.map((x) => x.count) }]" :selected="sel('model')" chart-label="모델별 고장 빈도" @select="drill('model', $event)" />
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>서비스센터 지점별 접수 건수</h2></div>
          <div class="card-body">
            <DefectStatisticsChart type="hbar" :labels="d.byBranch.map((x) => x.label)" :series="[{ name: '접수', data: d.byBranch.map((x) => x.count), color: '#60a5fa' }]" :selected="sel('branch')" chart-label="지점별 접수 건수" @select="drill('branch', $event)" />
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>생산 공장별 고장 빈도</h2></div>
          <div class="card-body">
            <DefectStatisticsChart type="pie" :labels="d.byFactory.map((x) => x.label)" :series="[{ name: '고장', data: d.byFactory.map((x) => x.count) }]" :selected="sel('factory')" chart-label="생산 공장별 고장 비율" @select="drill('factory', $event)" />
          </div>
        </section>
      </div>

      <!-- 실서버: 반복 고장 추세 대신 고장 부위(AREA)별 건수 -->
      <section v-if="!extras" class="card">
        <div class="card-head"><h2>고장 부위별 건수</h2><span class="faint">PCB · 모터 · 소프트웨어 · 기타</span></div>
        <div class="card-body">
          <DefectStatisticsChart v-if="d.byArea?.length" type="hbar" :labels="d.byArea.map((x) => x.label)" :series="[{ name: '고장', data: d.byArea.map((x) => x.count) }]" chart-label="고장 부위별 건수" />
          <p v-else class="soon">해당 기간에 확정된 고장 부위 데이터가 없습니다.</p>
          <p class="soon">반복 고장 유형의 추세(증가·감소)는 준비 중입니다.</p>
        </div>
      </section>
      <section v-else class="card">
        <div class="card-head"><h2>반복적으로 발생하는 고장 유형</h2><span class="faint">최근 2개월 vs 이전 평균</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>순위</th><th>고장 유형</th><th>건수</th><th>발생 모델</th><th>추세</th><th /></tr></thead>
            <tbody>
              <tr v-for="(r, i) in d.recurring" :key="r.type" class="clickable" tabindex="0" @click="drill('cause', r.type)" @keydown.enter="drill('cause', r.type)">
                <td><strong>{{ i + 1 }}</strong></td>
                <td><strong>{{ r.type }}</strong></td>
                <td>{{ r.count }}건</td>
                <td><span v-for="m in r.models" :key="m" class="badge tone-neutral" style="margin-right: 4px">{{ m }}</span></td>
                <td>
                  <span v-if="r.trend === 'UP'" class="badge tone-danger"><TrendingUp :size="15" /> 증가</span>
                  <span v-else-if="r.trend === 'DOWN'" class="badge tone-success"><TrendingDown :size="15" /> 감소</span>
                  <span v-else class="badge tone-neutral"><Minus :size="15" /> 유지</span>
                </td>
                <td><span class="btn btn-sm">목록 보기</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 드릴다운 -->
      <section v-if="store.drill" ref="drillEl" class="card drill">
        <div class="card-head">
          <h2>관련 수리 목록 · {{ store.drill.label }} <span class="badge tone-info">{{ store.records.length }}건</span></h2>
          <button type="button" class="btn btn-sm" @click="store.clearDrill()"><X :size="16" /> 닫기</button>
        </div>
        <div v-if="store.recordsLoading" class="card-body"><SkeletonBlock :lines="5" :height="36" /></div>
        <StateView v-else-if="!store.records.length" state="empty" title="해당 조건의 수리 건이 없습니다" compact />
        <div v-else class="table-wrap scroll">
          <table class="table">
            <thead><tr><th>수리 ID</th><th>모델</th><th>교체 부품</th><th>실제 원인 (확정)</th><th>지점</th><th>생산 공장</th><th>AI 일치</th><th>확정일</th></tr></thead>
            <tbody>
              <tr v-for="r in store.records.slice(0, 100)" :key="r.repairId">
                <td class="mono">{{ repairId(r.repairId) }}</td>
                <td>{{ r.model }}</td>
                <td>{{ r.part }}</td>
                <td><strong>{{ r.cause }}</strong></td>
                <td>{{ r.branch }}</td>
                <td>{{ r.factory }}</td>
                <td>
                  <span class="badge" :class="r.aiMatched ? 'tone-success' : 'tone-danger'">
                    <component :is="r.aiMatched ? CircleCheck : X" :size="14" /> {{ r.aiMatched ? '일치' : '불일치' }}
                  </span>
                </td>
                <td>{{ formatDate(r.approvedAt) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="store.records.length > 100" class="faint" style="padding: 12px 20px">상위 100건만 표시합니다.</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.soon {
  color: var(--text-3);
  padding: 12px 0;
}
.sub {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.kpi {
  padding: 22px 24px;
  display: grid;
  gap: 6px;
}
.kpi .ic {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--neutral-bg);
  color: var(--text-2);
}
.kpi.tone-info .ic { color: var(--primary); background: var(--blue-50); }
.kpi.tone-warning .ic { color: var(--warning); background: var(--warning-bg); }
.kpi.tone-ai .ic { background: var(--ai-bg); }
.kpi.tone-success .ic { background: var(--success-bg); }
.kpi.tone-ai .ic { color: var(--ai); }
.kpi.tone-success .ic { color: var(--success); }
.lbl {
  font-weight: 700;
  color: var(--text-2);
}
.val {
  font-size: var(--fs-num);
  font-weight: var(--fw-num);
  line-height: 1.05;
  letter-spacing: -0.03em;
  color: var(--ink);
}
.val small {
  font-size: var(--fs-md);
  margin-left: 3px;
  color: var(--text-2);
}
.kpi.tone-success,
.kpi.tone-ai,
.kpi.tone-warning,
.kpi.tone-info {
  background: var(--surface);
  color: var(--text);
  border-color: var(--card-border);
}
.hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.drill {
  box-shadow: inset 0 0 0 2px var(--primary), var(--shadow);
  scroll-margin-top: calc(var(--topbar-h) + 16px);
}
.scroll {
  max-height: 520px;
  overflow: auto;
}
</style>
