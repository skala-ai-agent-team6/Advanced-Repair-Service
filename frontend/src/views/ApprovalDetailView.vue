<script setup lang="ts">
/* 본사 수동 검토 — AI 판독 불가·기사 요청 건을 품질 담당자가 직접 진단해 기사에게 회신
 * (수리 결과 본사 승인은 폐지: 기사가 리포트를 확정하면 바로 고장 DB 에 반영된다) */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Send, History, Images, Hand, ArrowLeft } from 'lucide-vue-next'
import RepairSummaryCard from '@/components/repair/RepairSummaryCard.vue'
import HumanApprovalCard from '@/components/diagnosis/HumanApprovalCard.vue'
import ApprovalHistoryTimeline from '@/components/review/ApprovalHistoryTimeline.vue'
import RetryStatusCard from '@/components/repair/RetryStatusCard.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import { useRepairPage } from '@/composables/useRepairPage'
import { useToastStore } from '@/stores/toast'
import { toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import { PHOTO_KIND_LABEL } from '@/constants/status'
import type { ApprovalAction } from '@/types/approval'

const { store, repair, diagnosis, loading, error, submitting, photoRequests, reload } = useRepairPage({ diagnosis: true })
const toast = useToastStore()
const router = useRouter()

const isManual = computed(() => repair.value?.status === 'MANUAL_REVIEW')

const MANUAL_ACTIONS: ApprovalAction[] = [
  { key: 'return', label: '수동 진단 회신 (기사에게)', variant: 'primary', icon: Send, requiresComment: true },
  // [통합] '재분석 요청' 버튼 삭제 (재진단 API 없음)
]

const suggestion = computed(() =>
  diagnosis.value
    ? `AI 초안: ${diagnosis.value.topCause} (판단 점수 ${diagnosis.value.confidence}점) — 기사가 본사 검토 요청`
    : 'AI 판독 불가 — 사진 추가 요청 한도 초과 또는 분석 실패',
)
const evidence = computed(() => {
  const req = [...(repair.value?.history ?? [])].reverse().find((h) => h.action === 'HQ_REVIEW_REQUESTED' || h.target === 'PHOTO')
  return [req?.comment ?? '검토 요청 사유 없음', `추가 사진 요청 ${repair.value?.photoRequestCount ?? 0}회`, ...(diagnosis.value?.candidates[0]?.evidence ?? [])]
})

async function onAction(key: string, comment: string) {
  try {
    if (key === 'return') {
      await store.decide({ target: 'MANUAL_REVIEW', action: 'RETURN_TO_TECHNICIAN', comment })
      toast.success('기사에게 수동 진단 결과를 회신했습니다.')
    } else {
      await store.requestReanalysis({ reason: comment })
      toast.info('AI 재분석을 요청했습니다.')
    }
    void router.push('/repairs')
  } catch (e) {
    toast.error(toErrorMessage(e))
  }
}
</script>

<template>
  <div class="page">
    <RouterLink to="/repairs" class="btn btn-ghost back"><ArrowLeft :size="18" /> 수리 목록</RouterLink>
    <div v-if="loading && !repair" class="stack"><SkeletonBlock :lines="2" :height="60" /><SkeletonBlock :lines="8" :height="36" /></div>
    <StateView v-else-if="error && !repair" state="error" :message="error" @retry="reload" />

    <template v-else-if="repair">
      <RepairSummaryCard :repair="repair" />

      <div v-if="isManual" class="callout tone-danger">
        <Hand :size="22" />
        <div><strong>수동 검토 요청 건입니다.</strong> AI 결과만으로 판단하기 어려워 품질 담당자의 직접 진단이 필요합니다. 사진과 이력을 확인한 뒤 기사에게 진단 내용을 회신해 주세요.</div>
      </div>

      <!-- 사진 -->
      <section class="card">
        <div class="card-head"><h3><Images :size="20" /> 사진</h3></div>
        <div class="card-body photos">
          <figure v-for="img in repair.images" :key="img.id">
            <img :src="img.url" :alt="img.kind" loading="lazy" />
            <figcaption class="faint">{{ PHOTO_KIND_LABEL[img.kind] }}{{ img.kind === 'ADDITIONAL' && img.note ? ` · ${img.note}` : '' }}</figcaption>
          </figure>
        </div>
        <div v-if="isManual && photoRequests.length" class="card-body">
          <p class="lbl">AI 추가 사진 요청 이력</p>
          <ul>
            <li v-for="p in photoRequests" :key="p.id">{{ p.requestNo }}회차 · {{ p.target }} — {{ p.reason }} <span class="faint">({{ p.resolved ? '등록됨' : '미등록' }})</span></li>
          </ul>
        </div>
      </section>

      <HumanApprovalCard
        title="수동 검토 처리"
        :suggestion="suggestion"
        :evidence="evidence"
        :confidence="diagnosis?.confidence"
        :sources="diagnosis?.sources ?? []"
        :decision="{ state: 'PENDING' }"
        :actions="MANUAL_ACTIONS"
        :can-decide="isManual && FEATURES.diagnosisDecision"
        :disabled-reason="FEATURES.diagnosisDecision ? '수동 검토 상태가 아니거나 이미 회신한 건입니다.' : '수동 진단 회신은 아직 백엔드에서 지원하지 않습니다.'"
        :busy="submitting"
        comment-label="수동 진단 내용 (기사에게 전달)"
        comment-placeholder="예) 모터 하단 연결부 균열 확인됨. 모터 어셈블리(RM-MT-103) 교체 후 리포트 작성 바랍니다."
        @action="onAction"
      />

      <RetryStatusCard v-if="FEATURES.retryStatus" :repair-id="repair.id" detailed />

      <section class="card">
        <div class="card-head"><h3><History :size="20" /> 처리 이력</h3></div>
        <div class="card-body"><ApprovalHistoryTimeline :records="repair.history" /></div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.back {
  justify-self: start;
}
.photos {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.photos figure {
  margin: 0;
}
.photos img {
  width: 100%;
  aspect-ratio: 4/3;
  object-fit: cover;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.lbl {
  font-weight: 700;
  color: var(--text-2);
  font-size: var(--fs-sm);
  margin-bottom: 6px;
}
</style>
