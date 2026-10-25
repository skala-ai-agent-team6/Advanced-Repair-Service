<script setup lang="ts">
/* 자동 재처리 상태 (US-10)
 *  FAILED · RETRY_SCHEDULED · RETRYING · RECOVERED · FINAL_FAILED
 *  detailed(본사 품질 담당자): 오류 코드 · executionId · 시도 이력까지 / 기사: 단계·횟수·다음 시도 시각만 간단히
 *  진행 중(FAILED·RETRY_SCHEDULED·RETRYING)이면 3초마다 다시 조회 (최대 120초)
 *  Mock 전용: FEATURES.retryStatus 가 false 면 부모가 이 카드를 그리지 않는다 */
import { watch } from 'vue'
import { RefreshCcw, Loader2, CircleCheck, CircleAlert, Clock, RotateCw } from 'lucide-vue-next'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { getRetryRecords } from '@/api'
import { usePolling } from '@/composables/usePolling'
import { formatDateTime } from '@/utils/format'
import type { RetryRecord, RetryStatus } from '@/types'

const props = defineProps<{ repairId: number; detailed?: boolean }>()

const META: Record<RetryStatus, { label: string; tone: string }> = {
  FAILED: { label: '실패', tone: 'danger' },
  RETRY_SCHEDULED: { label: '재시도 예정', tone: 'warning' },
  RETRYING: { label: '재시도 중', tone: 'info' },
  RECOVERED: { label: '복구됨', tone: 'success' },
  FINAL_FAILED: { label: '최종 실패', tone: 'danger' },
}
const ACTIVE: RetryStatus[] = ['FAILED', 'RETRY_SCHEDULED', 'RETRYING']

/** 기사용 한 줄 안내 */
function simple(r: RetryRecord): string {
  switch (r.status) {
    case 'RETRY_SCHEDULED':
      return `${r.stage}에 실패해 ${r.nextRetryAt ? formatDateTime(r.nextRetryAt) : '잠시 뒤'}에 자동으로 다시 시도합니다.`
    case 'RETRYING':
      return `${r.stage}을(를) 자동으로 다시 시도하고 있습니다.`
    case 'RECOVERED':
      return `${r.stage}을(를) 다시 시도해 정상 처리되었습니다.`
    case 'FINAL_FAILED':
      return `${r.stage} 자동 재처리에 모두 실패했습니다. 본사 품질 담당자가 확인합니다.`
    default:
      return `${r.stage}에 실패했습니다. 자동 재처리를 준비하고 있습니다.`
  }
}

const { data, loading, error, forbidden, retrying, polling, timedOut, start } = usePolling(() => getRetryRecords(props.repairId), {
  active: (list) => list.some((r) => ACTIVE.includes(r.status)),
})
watch(() => props.repairId, start, { immediate: true })
</script>

<template>
  <section class="card" aria-labelledby="h-retry">
    <div class="card-head">
      <h3 id="h-retry"><RefreshCcw :size="20" /> 자동 재처리</h3>
      <span v-if="polling" class="faint live"><Loader2 :size="14" class="spin" /> 자동 확인 중</span>
    </div>
    <div class="card-body">
      <SkeletonBlock v-if="loading" :lines="2" :height="22" />
      <StateView v-else-if="forbidden" state="empty" compact title="재처리 상태를 볼 권한이 없습니다" />
      <StateView v-else-if="error" state="error" compact title="재처리 상태를 불러오지 못했습니다" :message="error" @retry="start" />
      <p v-else-if="!data?.length" class="faint">재처리 이력이 없습니다</p>
      <div v-else class="stack">
        <p v-if="retrying" class="callout tone-warning" role="status"><Loader2 :size="18" class="spin" /> 연결이 불안정해 다시 확인하고 있습니다…</p>
        <article v-for="r in data" :key="r.id" class="rec" :class="`s-${r.status}`">
          <header class="row between">
            <strong>{{ r.stage }}</strong>
            <span class="badge" :class="`tone-${META[r.status].tone}`">
              <Loader2 v-if="r.status === 'RETRYING'" :size="14" class="spin" />
              <CircleCheck v-else-if="r.status === 'RECOVERED'" :size="14" />
              <Clock v-else-if="r.status === 'RETRY_SCHEDULED'" :size="14" />
              <CircleAlert v-else :size="14" />
              {{ META[r.status].label }}
            </span>
          </header>

          <p v-if="!detailed" class="muted">{{ simple(r) }}</p>
          <dl class="kv">
            <dt>시도</dt>
            <dd>{{ r.attempt }} / {{ r.maxAttempts }}회</dd>
            <template v-if="r.nextRetryAt && !r.final">
              <dt>다음 재시도</dt>
              <dd>{{ formatDateTime(r.nextRetryAt) }}</dd>
            </template>
            <template v-if="detailed">
              <dt>실패 단계</dt>
              <dd>{{ r.stage }}</dd>
              <dt>오류 코드</dt>
              <dd class="mono">{{ r.errorCode ?? '-' }}</dd>
              <dt>최초 실패</dt>
              <dd>{{ formatDateTime(r.failedAt) }}</dd>
              <dt>최종 여부</dt>
              <dd>{{ r.final ? (r.status === 'RECOVERED' ? '종료 (복구)' : '최종 · 더 이상 자동 재처리 안 함') : '자동 재처리 계속' }}</dd>
              <dt>executionId</dt>
              <dd class="mono">{{ r.executionId ?? '-' }}</dd>
            </template>
          </dl>

          <div v-if="detailed && r.attempts?.length" class="table-wrap">
            <table class="table">
              <thead><tr><th>시도</th><th>시각</th><th>결과</th><th>오류</th></tr></thead>
              <tbody>
                <tr v-for="a in r.attempts" :key="a.attempt">
                  <td>{{ a.attempt }}</td>
                  <td>{{ formatDateTime(a.at) }}</td>
                  <td><span class="badge" :class="a.result === 'SUCCEEDED' ? 'tone-success' : 'tone-danger'">{{ a.result === 'SUCCEEDED' ? '성공' : '실패' }}</span></td>
                  <td><span v-if="a.errorCode" class="mono">{{ a.errorCode }}</span><span v-if="a.message" class="faint"> {{ a.message }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
        <p v-if="timedOut" class="callout tone-warning" role="status">
          <CircleAlert :size="18" />
          <span class="grow">2분 동안 재처리가 끝나지 않았습니다.</span>
          <button type="button" class="btn btn-sm" @click="start"><RotateCw :size="16" /> 다시 확인</button>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.rec {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.rec.s-FINAL_FAILED,
.rec.s-FAILED {
  border-color: var(--danger-border);
  background: var(--danger-bg);
}
.rec.s-RETRY_SCHEDULED {
  border-color: var(--warning-border);
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-sm);
}
</style>
