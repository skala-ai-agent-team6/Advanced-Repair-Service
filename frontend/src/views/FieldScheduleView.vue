<script setup lang="ts">
/* 오늘의 출장 목록 (/field/schedule) — 방문 시간 오름차순, 누르면 수리 작업 상세(진단 리포트)
 * 센터 수리자는 출장 데이터를 조회하지 않아 빈 상태. 빈 상태에서도 화면 구조와 오늘 날짜는 유지 */
import { onMounted } from 'vue'
import { CalendarDays } from 'lucide-vue-next'
import FieldVisitList from '@/components/field/FieldVisitList.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import StateView from '@/components/common/StateView.vue'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { kstDateLabel } from '@/utils/kst'

const { loading, error, today, todayVisits, counts, load } = useFieldVisits()
onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>오늘의 출장</h1>
        <p class="sub date"><CalendarDays :size="16" aria-hidden="true" /> {{ kstDateLabel(today) }} · 한국 시간 기준</p>
      </div>
    </div>

    <section class="card" aria-labelledby="h-list">
      <div class="card-head">
        <h2 id="h-list">방문 일정</h2>
        <span class="faint">{{ counts.today }}건 · 방문 완료 {{ counts.done }}건</span>
      </div>
      <div v-if="loading" class="card-body"><SkeletonBlock :lines="3" :height="48" /></div>
      <StateView v-else-if="error" state="error" :message="error" compact @retry="load" />
      <StateView v-else-if="!todayVisits.length" state="empty" title="오늘 예정된 출장이 없어요." compact />
      <FieldVisitList v-else :items="todayVisits" />
    </section>
  </div>
</template>

<style scoped>
.date {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
