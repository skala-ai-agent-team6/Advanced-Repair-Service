<script setup lang="ts">
/* =========================================================================
 * 출장기사 홈: 오늘의 출장 (출장기사·센터 수리자 같은 구조)
 *  숫자 카드 4개(오늘의 출장 · 부품 확인 필요 · AI 진단 확인 · 방문 완료) + 오늘 방문 일정 + 다음 방문(AI 진단 초안)
 *  센터 수리자: 출장 데이터를 조회하지 않고 모두 0건 · 빈 안내
 * ========================================================================= */
import { onMounted, ref, watch } from 'vue'
import { ArrowRight, CalendarDays, MapPin, FileText } from 'lucide-vue-next'
import MetricCard from '@/components/common/MetricCard.vue'
import AiBadge from '@/components/common/AiBadge.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import FieldVisitList from '@/components/field/FieldVisitList.vue'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { usePreVisitReportModal } from '@/composables/usePreVisitReportModal'
import { repairApi } from '@/api'
import { kstDateLabel } from '@/utils/kst'
import type { Diagnosis } from '@/types'

const { loading, error, today, todayVisits, nextVisit, counts, load, isField } = useFieldVisits()
/** '다음 방문' 카드의 [출장 전 리포트] — 목록과 같은 모달 */
const report = usePreVisitReportModal()
onMounted(load)

/* 다음 방문의 AI 진단 초안 */
const nextDiag = ref<Diagnosis | null>(null)
watch(
  () => nextVisit.value?.repairId,
  async (id) => {
    nextDiag.value = null
    if (!id) return
    try {
      nextDiag.value = (await repairApi.diagnosis(id)).current
    } catch {
      /* 보조 정보라 실패해도 표시하지 않음 */
    }
  },
  // 출장 일정은 공유 상태라 화면에 다시 들어왔을 때 이미 값이 있을 수 있음 → 처음에도 한 번 실행
  { immediate: true },
)

const CARDS = [
  { key: 'today', label: '오늘의 출장' },
  { key: 'partsCheck', label: '부품 확인 필요' },
  { key: 'aiCheck', label: 'AI 진단 확인' },
  { key: 'done', label: '방문 완료' },
] as const
</script>

<template>
  <section class="trip" aria-labelledby="h-trip">
    <div class="row between head">
      <h2 id="h-trip" class="h">출장 현황</h2>
      <span class="faint date"><CalendarDays :size="16" aria-hidden="true" /> {{ kstDateLabel(today) }}</span>
    </div>

    <div class="cards">
      <!-- 정보 카드 (목록 이동은 '전체 보기' 하나로) -->
      <MetricCard v-for="c in CARDS" :key="c.key" info :label="c.label" :value="loading ? '–' : counts[c.key]" :highlight="c.key === 'today'" />
    </div>

    <div class="schedule-grid">
      <!-- 오늘 방문 일정 -->
      <section class="card" aria-labelledby="h-today-visits">
        <div class="card-head">
          <h3 id="h-today-visits">오늘 방문 일정</h3>
          <RouterLink to="/field/schedule" class="btn btn-sm">전체 보기 <ArrowRight :size="16" /></RouterLink>
        </div>
        <div v-if="loading && !todayVisits.length" class="card-body"><SkeletonBlock :lines="3" :height="40" /></div>
        <p v-else-if="error" class="card-body error-text" role="alert">{{ error }}</p>
        <p v-else-if="!todayVisits.length" class="card-body empty">오늘 예정된 출장이 없어요</p>
        <FieldVisitList v-else :items="todayVisits.slice(0, 3)" />
      </section>

      <!-- 다음 방문 -->
      <section class="card" aria-labelledby="h-next">
        <div class="card-head"><h3 id="h-next">다음 방문</h3></div>
        <div v-if="loading" class="card-body"><SkeletonBlock :lines="3" :height="28" /></div>
        <p v-else-if="!nextVisit" class="card-body empty">예정된 다음 방문이 없습니다</p>
        <div v-else class="card-body next">
          <p class="when">
            <b>{{ nextVisit.visitTime }}</b>
            <span class="faint">{{ nextVisit.visitDate === today ? '오늘' : kstDateLabel(nextVisit.visitDate) }}</span>
          </p>
          <p>
            <strong>{{ nextVisit.customerName }}</strong>
            <span class="addr"><MapPin :size="14" aria-hidden="true" /> {{ nextVisit.district }} {{ nextVisit.neighborhood }}</span>
          </p>
          <p class="faint">{{ nextVisit.model }} · {{ nextVisit.symptom }}</p>

          <div v-if="nextDiag" class="ai-zone draft">
            <AiBadge compact />
            <p class="cause">{{ nextDiag.topCause }} <span class="faint">판단 점수 {{ nextDiag.confidence }}점</span></p>
            <p v-if="nextDiag.repairMethod[0]" class="faint">→ {{ nextDiag.repairMethod[0] }}</p>
          </div>
          <button v-if="isField" type="button" class="btn btn-primary" aria-haspopup="dialog" @click="report.open(nextVisit)"><FileText :size="18" aria-hidden="true" /> 출장 전 리포트</button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.trip {
  display: grid;
  gap: 14px;
}
.head {
  align-items: baseline;
}
.h {
  font-size: var(--fs-lg);
  font-weight: 700;
  margin: 0;
}
.date {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gap);
}
/* 오늘 방문 일정 | 다음 방문 — 같은 행·같은 너비, 높이는 더 긴 카드에 맞춤 (고정 높이 없음) */
.schedule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
  align-items: stretch;
}
.schedule-grid > .card {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
/* 본문이 남는 높이를 채우되, 내용은 위쪽부터 */
.schedule-grid > .card > .card-body {
  flex: 1;
}
.card-head h3 {
  margin: 0;
}
.empty {
  color: var(--text-2);
  text-align: center;
  padding: 28px 20px;
}
.next {
  display: grid;
  gap: 8px;
  justify-items: start;
  /* 카드가 늘어나도 줄 간격이 벌어지지 않게 위쪽 정렬 */
  align-content: start;
}
.when {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.when b {
  font-size: var(--fs-xl);
  color: var(--primary);
}
.addr {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.draft {
  width: 100%;
  display: grid;
  gap: 4px;
  padding: 12px 14px;
}
.draft :deep(.badge) {
  justify-self: start;
}
.cause {
  font-weight: 700;
}
@media (max-width: 1180px) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
/* 태블릿·모바일: 세로 배치, 각자 내용 높이 */
@media (max-width: 1024px) {
  .schedule-grid {
    grid-template-columns: 1fr;
  }
  .schedule-grid > .card {
    height: auto;
  }
}
@media (max-width: 480px) {
  .cards {
    gap: 12px;
  }
}
</style>
