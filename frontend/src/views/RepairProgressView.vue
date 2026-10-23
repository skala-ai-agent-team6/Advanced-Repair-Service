<script setup lang="ts">
/* 진단 진행 화면 — SSE 로 단계·진행률이 실시간 변경 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Sparkles, Wifi, WifiOff, CircleX, RotateCw, Building2, ArrowRight, Activity, Images, Hand } from 'lucide-vue-next'
import RepairSummaryCard from '@/components/repair/RepairSummaryCard.vue'
import RepairFlowNav from '@/components/repair/RepairFlowNav.vue'
import RepairProgressTimeline from '@/components/repair/RepairProgressTimeline.vue'
import AdditionalPhotoRequestCard from '@/components/repair/AdditionalPhotoRequestCard.vue'
import RetryStatusCard from '@/components/repair/RetryStatusCard.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import { useRepairPage } from '@/composables/useRepairPage'
import { useReasonDialog } from '@/composables/useReasonDialog'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { PHOTO_KIND_LABEL, STAGE_META } from '@/constants/status'
import { toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import { formatDateTime } from '@/utils/format'
import type { UploadItem } from '@/types/upload'
import type { RepairImage } from '@/types'

const { store, repair, loading, error, sseState, eventLog, activePhotoRequest, submitting, reload } = useRepairPage({ live: true })
const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()
const dlg = useReasonDialog<'reanalyze' | 'hq'>()

// '현재 실행 중' = 실행 중인 도구(없으면 실행 중인 고정 단계)
const runningTool = computed(() => repair.value?.tools?.find((t) => t.state === 'RUNNING'))
const running = computed(() => repair.value?.stages.find((s) => s.state === 'RUNNING'))
const done = computed(() => !!repair.value && ['DIAGNOSIS_COMPLETED', 'TECHNICIAN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'].includes(repair.value.status))
const failed = computed(() => !!repair.value?.analysisError)
const isTech = computed(() => auth.role === 'TECHNICIAN')
/** 등록 사진을 입력 차수별로 (US-05: 기존 사진과 새 추가 사진 이력을 함께 보여 준다) */
const photoRounds = computed(() => {
  const m = new Map<number, RepairImage[]>()
  for (const img of repair.value?.images ?? []) {
    const round = img.round ?? (img.kind === 'ADDITIONAL' ? 1 : 0)
    m.set(round, [...(m.get(round) ?? []), img])
  }
  const rounds = [...m.keys()].sort((a, b) => a - b)
  return rounds.map((round) => ({ round, images: m.get(round)!, latest: round === rounds[rounds.length - 1] }))
})
const sse = computed(() => ({
  connecting: { label: '연결 중', tone: 'neutral', icon: Wifi },
  open: { label: '실시간 연결됨', tone: 'success', icon: Wifi },
  reconnecting: { label: '재연결 중', tone: 'warning', icon: WifiOff },
  closed: { label: '연결 종료', tone: 'neutral', icon: WifiOff },
  error: { label: '연결 실패 · 새로고침 필요', tone: 'danger', icon: WifiOff },
})[sseState.value])

async function addPhotos(p: { photos: UploadItem[]; note: string }) {
  try {
    await store.addPhotos({
      photos: p.photos.map((i) => ({ kind: 'ADDITIONAL', file: i.file, dataUrl: i.dataUrl, photoRequestId: activePhotoRequest.value?.id })),
      note: p.note,
      photoRequestId: activePhotoRequest.value?.id,
    })
    toast.success('추가 자료를 제출했습니다. 분석을 이어서 진행합니다.')
  } catch (e) {
    toast.error(toErrorMessage(e))
  }
}

async function confirmDialog() {
  if (!dlg.validate()) return
  try {
    if (dlg.state.kind === 'reanalyze') {
      await store.requestReanalysis({ reason: dlg.state.text.trim() })
      toast.info('재분석을 요청했습니다.')
    } else {
      await store.decide({ target: 'DIAGNOSIS', action: 'REQUEST_HQ_REVIEW', comment: dlg.state.text.trim() })
      toast.info('본사 수동 검토를 요청했습니다.')
    }
    dlg.close()
  } catch (e) {
    dlg.state.error = toErrorMessage(e)
  }
}
</script>

<template>
  <div class="page">
    <div v-if="loading && !repair" class="stack"><SkeletonBlock :lines="2" :height="60" /><SkeletonBlock :lines="6" :height="40" /></div>
    <StateView v-else-if="error && !repair" state="error" :message="error" @retry="reload" />

    <template v-else-if="repair">
      <RepairFlowNav :repair="repair" />
      <RepairSummaryCard :repair="repair" compact />

      <!-- 전체 진행률 -->
      <section class="card card-pad prog" :class="{ failed, done }" aria-live="polite">
        <div class="row between">
          <h2 class="ph">
            <Sparkles :size="22" />
            {{ done ? 'AI 분석 완료' : failed ? 'AI 분석 실패' : repair.status === 'ADDITIONAL_INFO_NEEDED' ? '추가 정보 대기 중' : 'AI 가 분석하고 있습니다' }}
          </h2>
          <span class="badge" :class="`tone-${sse.tone}`"><component :is="sse.icon" :size="15" /> {{ sse.label }}</span>
        </div>
        <div class="bar" role="progressbar" :aria-valuenow="repair.progress" aria-valuemin="0" aria-valuemax="100" :aria-label="`전체 진행률 ${repair.progress}%`">
          <span :style="{ width: `${repair.progress}%` }" />
        </div>
        <div class="row between">
          <p class="msg">{{ repair.progressMessage ?? (done ? 'AI 분석이 끝났습니다.' : '분석을 준비하고 있습니다.') }}</p>
          <strong class="pct">{{ repair.progress }}%</strong>
        </div>
        <p v-if="runningTool || running" class="now">
          <span class="pulse" aria-hidden="true" /> 현재 실행 중:
          <b>{{ runningTool ? runningTool.label : STAGE_META[running!.stage].label }}</b>
        </p>
      </section>

      <!-- 완료 -->
      <div v-if="done" class="callout tone-ai big-callout">
        <Sparkles :size="24" />
        <div class="grow">
          <strong>AI 진단 초안이 준비되었습니다.</strong>
          AI 결과는 자동으로 확정되지 않습니다. 원인 · 근거 · AI 판단 점수를 확인하고 처리해 주세요.
        </div>
        <button class="btn btn-primary btn-lg" type="button" @click="router.push(`/repairs/${repair.id}/diagnosis`)">진단 결과 확인 <ArrowRight :size="20" /></button>
      </div>

      <!-- 수동 검토 전환 -->
      <div v-if="repair.status === 'MANUAL_REVIEW'" class="callout tone-danger">
        <Hand :size="22" />
        <div><strong>본사 수동 검토로 전환되었습니다.</strong> 품질 담당자가 직접 진단한 뒤 회신하면 알림으로 알려 드립니다.</div>
      </div>

      <!-- 실패 -->
      <div v-if="failed && !done" class="callout tone-danger big-callout" role="alert">
        <CircleX :size="24" />
        <div class="grow">
          <strong>분석에 실패했습니다.</strong>
          {{ repair.analysisError }}
        </div>
        <!-- 실서버: 재분석·본사 검토 요청 API 가 아직 없어 버튼을 숨긴다 -->
        <template v-if="isTech && FEATURES.reanalysis">
          <button class="btn btn-ai" type="button" @click="dlg.open('reanalyze', '재분석 요청', '재분석 요청 사유', '예) PCB 사진을 다시 찍어 올렸습니다.')"><RotateCw :size="18" /> 재분석 요청</button>
          <button class="btn btn-danger" type="button" @click="dlg.open('hq', '본사 수동 검토 요청', '요청 사유', '예) 사진 재촬영으로도 판독이 어렵습니다.')"><Building2 :size="18" /> 본사 검토 요청</button>
        </template>
      </div>

      <!-- 추가 사진 요청 -->
      <AdditionalPhotoRequestCard v-if="repair.status === 'ADDITIONAL_INFO_NEEDED' && activePhotoRequest" :request="activePhotoRequest" :busy="submitting" :readonly="!isTech" @submit="addPhotos" />

      <div class="cols">
        <section class="card">
          <div class="card-head"><h3><Activity :size="20" /> 단계별 진행</h3></div>
          <div class="card-body"><RepairProgressTimeline :stages="repair.stages" :tools="repair.tools" /></div>
        </section>
        <div class="stack">
          <section class="card">
            <div class="card-head">
              <h3><Images :size="20" /> 등록 사진 ({{ repair.images.length }})</h3>
              <span v-if="repair.inputRevision" class="badge tone-info">현재 입력 r{{ repair.inputRevision }}</span>
            </div>
            <div class="card-body rounds">
              <section v-for="g in photoRounds" :key="g.round">
                <h4 class="round-h">
                  {{ g.round === 0 ? '접수 사진' : `${g.round}차 추가 사진` }}
                  <span v-if="g.latest && photoRounds.length > 1" class="badge tone-success">최신</span>
                  <span class="faint">{{ g.images.length }}장 · {{ formatDateTime(g.images[0].uploadedAt) }}</span>
                </h4>
                <div class="thumbs">
                  <figure v-for="img in g.images" :key="img.id">
                    <img :src="img.url" :alt="PHOTO_KIND_LABEL[img.kind]" loading="lazy" />
                    <figcaption class="faint">{{ PHOTO_KIND_LABEL[img.kind] }}<template v-if="img.note"> · {{ img.note }}</template></figcaption>
                  </figure>
                </div>
              </section>
            </div>
          </section>
          <RetryStatusCard v-if="FEATURES.retryStatus" :repair-id="repair.id" :detailed="auth.role === 'QUALITY_MANAGER'" />
          <section class="card">
            <div class="card-head"><h3>실시간 이벤트</h3><span class="faint">SSE</span></div>
            <ul class="log">
              <li v-for="(e, i) in eventLog" :key="i">
                <span class="faint mono">{{ formatDateTime(e.at) }}</span>
                <span>{{ e.message }}</span>
              </li>
              <li v-if="!eventLog.length" class="faint">{{ done ? '분석이 끝난 건입니다.' : '새 이벤트를 기다리는 중…' }}</li>
            </ul>
          </section>
        </div>
      </div>
    </template>

    <BaseModal :open="dlg.state.open" :title="dlg.state.title" @close="dlg.close()">
      <div class="field">
        <label for="reason" class="req">{{ dlg.state.label }}</label>
        <textarea id="reason" v-model="dlg.state.text" class="textarea" :class="{ invalid: dlg.state.error }" :placeholder="dlg.state.placeholder" />
        <p v-if="dlg.state.error" class="error-text">{{ dlg.state.error }}</p>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="dlg.close()">취소</button>
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="confirmDialog">요청하기</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.prog {
  display: grid;
  gap: 12px;
  border: 2px solid var(--ai-border);
}
.prog.failed {
  border-color: var(--danger-border);
}
.prog.done {
  border-color: var(--success-border);
}
.ph {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-xl);
  color: var(--ai);
}
.failed .ph {
  color: var(--danger);
}
.done .ph {
  color: var(--success);
}
.bar {
  height: 18px;
  border-radius: 999px;
  background: var(--ai-bg);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: repeating-linear-gradient(45deg, var(--ai), var(--ai) 12px, #6d52e0 12px, #6d52e0 24px);
  border-radius: 999px;
  transition: width 0.6s ease;
}
.done .bar span {
  background: var(--success);
}
.failed .bar span {
  background: var(--danger);
}
.msg {
  font-size: var(--fs-lg);
  font-weight: 600;
}
.pct {
  font-size: var(--fs-2xl);
}
.now {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ai);
}
.pulse {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ai);
  animation: pulse 1.2s infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
    transform: scale(0.8);
  }
}
.big-callout {
  align-items: center;
  flex-wrap: wrap;
}
.grow {
  flex: 1 1 300px;
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.rounds {
  display: grid;
  gap: 14px;
}
.round-h {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  font-size: var(--fs-sm);
  font-weight: 700;
}
.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.thumbs figure {
  margin: 0;
}
.thumbs img {
  aspect-ratio: 4 / 3;
  object-fit: cover;
  width: 100%;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.log {
  list-style: none;
  margin: 0;
  padding: 10px 22px 16px;
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
}
.log li {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
}
@media (max-width: 1000px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
