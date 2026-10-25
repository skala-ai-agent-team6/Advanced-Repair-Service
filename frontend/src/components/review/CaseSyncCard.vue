<script setup lang="ts">
/* 사내 사례 반영 상태 (US-08) — 확정 리포트가 '사내 확정 사례'(유사 사례 검색 대상)로 반영되는지
 * WAITING · SYNCING 동안 3초마다 다시 조회 (최대 120초). Mock 전용: FEATURES.caseSync 가 false 면 부모가 이 카드를 그리지 않는다 */
import { computed, watch } from 'vue'
import { DatabaseZap, Loader2, CircleAlert, RotateCw, CircleCheck } from 'lucide-vue-next'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { getCaseSync } from '@/api'
import { usePolling } from '@/composables/usePolling'
import { formatDateTime } from '@/utils/format'
import type { CaseSyncStatus } from '@/types'

/** revision: 다시 확정하면(r2…) 처음부터 다시 조회 */
const props = defineProps<{ repairId: number; revision: number }>()

const META: Record<CaseSyncStatus, { label: string; tone: string; hint: string }> = {
  WAITING: { label: '반영 대기', tone: 'neutral', hint: '반영 순서를 기다리고 있습니다.' },
  SYNCING: { label: '반영 중', tone: 'info', hint: '사내 확정 사례에 저장하고 있습니다.' },
  COMPLETED: { label: '반영 완료', tone: 'success', hint: '다음 진단부터 유사 사례로 검색됩니다.' },
  FAILED: { label: '반영 실패', tone: 'danger', hint: '' },
}

const { data, loading, error, forbidden, retrying, polling, timedOut, start } = usePolling(() => getCaseSync(props.repairId), {
  active: (v) => !!v && (v.status === 'WAITING' || v.status === 'SYNCING'),
})
watch(() => [props.repairId, props.revision], start, { immediate: true })
const meta = computed(() => (data.value ? META[data.value.status] : null))
</script>

<template>
  <section class="card" aria-labelledby="h-sync">
    <div class="card-head">
      <h3 id="h-sync"><DatabaseZap :size="20" /> 사내 사례 반영</h3>
      <span v-if="meta" class="badge" :class="`tone-${meta.tone}`">
        <Loader2 v-if="data?.status === 'SYNCING' || data?.status === 'WAITING'" :size="14" class="spin" />
        <CircleCheck v-else-if="data?.status === 'COMPLETED'" :size="14" />
        <CircleAlert v-else :size="14" />
        {{ meta.label }}
      </span>
    </div>
    <div class="card-body">
      <SkeletonBlock v-if="loading" :lines="3" :height="22" />
      <StateView v-else-if="forbidden" state="empty" compact title="반영 상태를 볼 권한이 없습니다" message="담당 기사와 본사 품질 담당자만 볼 수 있습니다." />
      <StateView v-else-if="error" state="error" compact title="반영 상태를 불러오지 못했습니다" :message="error" @retry="start" />
      <StateView v-else-if="!data" state="empty" compact title="반영할 확정 리포트가 없습니다" />
      <div v-else class="stack">
        <p v-if="retrying" class="callout tone-warning" role="status"><Loader2 :size="18" class="spin" /> 연결이 불안정해 다시 확인하고 있습니다…</p>
        <dl class="kv">
          <dt>리포트 ID</dt>
          <dd class="mono">{{ data.reportId }}</dd>
          <dt>버전</dt>
          <dd>r{{ data.reportRevision }}</dd>
          <dt>확정 시각</dt>
          <dd>{{ formatDateTime(data.confirmedAt) }}</dd>
          <dt>마지막 반영</dt>
          <dd>{{ data.lastSyncedAt ? formatDateTime(data.lastSyncedAt) : '-' }}</dd>
          <dt>반영 위치</dt>
          <dd><span class="badge tone-success">{{ data.source }}</span></dd>
        </dl>
        <p v-if="data.status === 'FAILED'" class="callout tone-danger" role="alert">
          <CircleAlert :size="18" />
          <span><strong>사내 사례에 반영하지 못했습니다.</strong> {{ data.failureMessage }} 리포트 확정과 품질 통계 반영은 그대로 유지됩니다.</span>
        </p>
        <p v-else-if="timedOut" class="callout tone-warning" role="status">
          <CircleAlert :size="18" />
          <span class="grow">2분 동안 반영이 끝나지 않았습니다. 잠시 뒤 다시 확인해 주세요.</span>
          <button type="button" class="btn btn-sm" @click="start"><RotateCw :size="16" /> 다시 확인</button>
        </p>
        <p v-else-if="meta?.hint" class="faint">{{ meta.hint }}<template v-if="polling"> 자동으로 확인 중입니다.</template></p>
      </div>
    </div>
  </section>
</template>
