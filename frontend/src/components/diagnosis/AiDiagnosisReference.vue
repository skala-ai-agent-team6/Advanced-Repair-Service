<script setup lang="ts">
/* 참고용 AI 진단 (조회 전용) — 수리 리포트의 [AI 진단 참고하기] Drawer 안에 표시
 *  AI 원문만 보여 주고 입력 폼에는 아무것도 넣지 않는다 (불러오기는 폼의 [AI … 불러오기] 버튼으로만) */
import { computed } from 'vue'
import AiBadge from '@/components/common/AiBadge.vue'
import ConfidenceBar from '@/components/common/ConfidenceBar.vue'
import DataSourceList from '@/components/common/DataSourceList.vue'
import StateView from '@/components/common/StateView.vue'
import { formatDateTime } from '@/utils/format'
import type { Diagnosis } from '@/types'

const props = defineProps<{ diagnosis: Diagnosis | null | undefined; repairId: number }>()
const evidence = computed(() => props.diagnosis?.candidates.flatMap((c) => c.evidence.map((e) => ({ rank: c.rank, text: e }))) ?? [])
</script>

<template>
  <StateView v-if="!diagnosis" state="empty" compact title="참고할 AI 진단 결과가 없습니다" message="AI 진단 없이 진행한 건이거나 아직 분석이 끝나지 않았습니다." />
  <div v-else class="ref ai-zone">
    <div class="row between">
      <AiBadge compact />
      <span class="faint">v{{ diagnosis.version }} · {{ formatDateTime(diagnosis.generatedAt) }} 분석</span>
    </div>

    <section>
      <h3 class="lbl">예상 원인</h3>
      <p class="cause">{{ diagnosis.topCause }}</p>
      <ConfidenceBar :value="diagnosis.confidence" size="sm" />
      <p class="faint note">판단 점수는 확률이 아니라 후보끼리 비교한 점수입니다.</p>
    </section>

    <section v-if="diagnosis.candidates.length">
      <h3 class="lbl">원인 후보</h3>
      <ol class="list">
        <li v-for="c in diagnosis.candidates" :key="c.rank">{{ c.cause }} <span class="faint">{{ c.confidence }}점</span></li>
      </ol>
    </section>

    <section>
      <h3 class="lbl">추천 부품 · 수량</h3>
      <ul v-if="diagnosis.parts.length" class="list">
        <li v-for="p in diagnosis.parts" :key="p.partId">{{ p.partName }} <span class="mono faint">{{ p.partNo }}</span> × {{ p.quantity }}</li>
      </ul>
      <p v-else class="faint">AI 가 추천한 교체 부품이 없습니다.</p>
    </section>

    <section>
      <h3 class="lbl">권장 조치</h3>
      <ol v-if="diagnosis.repairMethod.length" class="list">
        <li v-for="m in diagnosis.repairMethod" :key="m">{{ m }}</li>
      </ol>
      <p v-else class="faint">권장 조치가 없습니다.</p>
    </section>

    <section>
      <h3 class="lbl">분석 근거</h3>
      <ul v-if="evidence.length" class="list">
        <li v-for="(e, i) in evidence" :key="i"><span class="faint">{{ e.rank }}순위 ·</span> {{ e.text }}</li>
      </ul>
      <p v-else class="faint">표시할 분석 근거가 없습니다.</p>
      <DataSourceList v-if="diagnosis.sources.length" :sources="diagnosis.sources" />
    </section>

    <RouterLink :to="`/repairs/${repairId}/diagnosis`" class="btn btn-sm btn-ai detail">진단 리포트 전체 보기</RouterLink>
  </div>
</template>

<style scoped>
.ref {
  display: grid;
  gap: 16px;
  padding: 16px;
}
section {
  display: grid;
  gap: 6px;
}
.lbl {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--text-2);
}
.cause {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--ink);
}
.note {
  margin: 0;
  font-size: var(--fs-xs);
}
.list {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 4px;
}
.detail {
  justify-self: start;
}
</style>
