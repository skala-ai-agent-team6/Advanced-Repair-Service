<script setup lang="ts">
/* 출장 일정 목록 한 줄: 방문 시간 · 고객 이름 · 주소(구·동) · 모델 · 증상 · 상태 배지 · [출장 전 리포트]
 *  행(시간·고객·상태 영역)을 누르면 수리 작업 상세(진단 리포트 화면)로 이동
 *  [출장 전 리포트]는 행과 분리된 버튼 — stopPropagation 후 출장 전 진단 리포트 모달만 연다 (출장기사에게만 표시) */
import { computed } from 'vue'
import { Check, MapPin, FileText } from 'lucide-vue-next'
import RepairStatusBadge from '@/components/common/RepairStatusBadge.vue'
import { usePreVisitReportModal } from '@/composables/usePreVisitReportModal'
import { useAuthStore } from '@/stores/auth'
import type { FieldVisit } from '@/types'
import { kstDateLabel } from '@/utils/kst'

/** showDate: [출장] 다가오는 방문 목록처럼 여러 날짜가 섞일 때 시간 위에 날짜 표시 */
defineProps<{ items: FieldVisit[]; showDate?: boolean }>()
const auth = useAuthStore()
const isField = computed(() => auth.role === 'TECHNICIAN' && auth.technicianType === 'FIELD')
const report = usePreVisitReportModal()
</script>

<template>
  <ol class="visits">
    <li v-for="v in items" :key="v.visitId ?? `${v.repairId}-${v.visitTime}`" class="visit" :class="{ done: v.visitStatus === 'DONE' }">
      <RouterLink :to="`/repairs/${v.repairId}/diagnosis`" class="visit-link" :aria-label="`${v.visitTime} ${v.customerName} ${v.model} 수리 작업 상세로 이동`">
        <span class="time">
          <small v-if="showDate && v.visitDate">{{ kstDateLabel(v.visitDate) }}</small>
          <b>{{ v.visitTime }}</b>
          <small v-if="v.visitStatus === 'DONE'"><Check :size="12" aria-hidden="true" /> 방문 완료</small>
        </span>
        <span class="main">
          <span class="line1">
            <strong>{{ v.customerName }}</strong>
            <span class="addr"><MapPin :size="14" aria-hidden="true" /> {{ v.district }} {{ v.neighborhood }}</span>
          </span>
          <span class="line2" :title="`${v.model} · ${v.symptom}`"><span class="model">{{ v.model }}</span> · <span class="sym">{{ v.symptom }}</span></span>
        </span>
        <RepairStatusBadge :status="v.status" class="st" />
      </RouterLink>
      <button
        v-if="isField"
        type="button"
        class="btn btn-sm btn-outline-primary report-btn"
        aria-haspopup="dialog"
        :aria-label="`${v.visitTime} ${v.customerName} 출장 전 리포트`"
        @click.stop="report.open(v)"
      >
        <FileText :size="16" aria-hidden="true" /> 출장 전 리포트
      </button>
    </li>
  </ol>
</template>

<style scoped>
.visits {
  list-style: none;
  margin: 0;
  padding: 4px 8px 8px;
  display: grid;
}
.visits li + li {
  border-top: 1px solid var(--border);
}
.visit {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 0;
  border-radius: var(--radius);
}
.visit:hover {
  background: var(--blue-50);
}
.visit-link {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 68px;
  padding: 12px;
  color: var(--text);
  text-decoration: none;
  border-radius: var(--radius);
}
.visit-link:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: -3px;
}
.report-btn {
  flex: none;
  white-space: nowrap;
}
.time {
  flex: none;
  width: 64px;
  display: grid;
  gap: 2px;
}
.time b {
  font-size: var(--fs-lg);
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.done .time b {
  color: var(--text-3);
}
.time small {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--success);
  font-size: 11px;
  font-weight: 700;
}
.main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.line1 {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
}
.addr {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.line2 {
  color: var(--text-2);
  font-size: var(--fs-sm);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow-wrap: anywhere;
}
.model {
  font-weight: 600;
  color: var(--text);
}
.st {
  flex: none;
  font-size: var(--fs-xs);
}
/* 휴대폰: 행 내용은 줄바꿈, 버튼은 아래 전체 너비 */
@media (max-width: 560px) {
  .visit {
    flex-wrap: wrap;
    padding: 0 12px 12px;
  }
  .visit-link {
    flex-basis: 100%;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 12px 0 0;
  }
  .time {
    width: auto;
  }
  .main {
    flex-basis: calc(100% - 100px);
  }
  .report-btn {
    flex: 1 1 100%;
    justify-content: center;
    min-height: 44px;
  }
}
</style>
