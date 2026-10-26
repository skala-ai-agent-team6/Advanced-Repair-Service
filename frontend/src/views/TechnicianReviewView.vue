<script setup lang="ts">
/* 수리 리포트 — 기사가 초안을 저장하고 확정한다. 확정본만 고장 DB·품질 대시보드에 반영된다.
 *  확정 후에도 수정 가능: 수정 저장 시 새 초안(revision+1), 다시 확정하면 반영 내용이 새 확정본으로 교체된다.
 *  본사 품질 담당자는 읽기 전용으로 조회만 한다.
 *  AI 진단은 상단 [AI 진단 참고하기] Drawer 에서 조회만 (폼에는 [AI … 불러오기]를 눌렀을 때만 복사) */
import { computed, reactive, ref, watch } from 'vue'
import {
  CircleCheck, CircleAlert, CircleX, Plus, Trash2, Save, Sparkles, History, Building2, Package, PencilLine, FileCheck2, RefreshCw, X,
} from 'lucide-vue-next'
import RepairFlowNav from '@/components/repair/RepairFlowNav.vue'
import RepairSummaryCard from '@/components/repair/RepairSummaryCard.vue'
import ImageUploader from '@/components/repair/ImageUploader.vue'
import TechnicianCommentForm from '@/components/review/TechnicianCommentForm.vue'
import ApprovalHistoryTimeline from '@/components/review/ApprovalHistoryTimeline.vue'
import AiBadge from '@/components/common/AiBadge.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import CaseSyncCard from '@/components/review/CaseSyncCard.vue'
import AiDiagnosisReference from '@/components/diagnosis/AiDiagnosisReference.vue'
import { useRepairPage } from '@/composables/useRepairPage'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'
import { AI_ACCEPTANCE_META, FAULT_AREA_LABEL, OUTCOME_META, REPORT_STATUS_META } from '@/constants/status'
import { ApiError, toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import { useOrderStore } from '@/stores/orders'
import { isCompatible } from '@/utils/parts'
import { formatDateTime } from '@/utils/format'
import type { AiAcceptance, FaultArea, Part, RepairOutcome, ReportContent } from '@/types'
import type { UploadItem } from '@/types/upload'

const { store, repair, diagnosis, loading, diagLoading, error, submitting, reload } = useRepairPage({ diagnosis: true })
const auth = useAuthStore()
const toast = useToastStore()

const report = computed(() => repair.value?.report)
const hasDiagnosis = computed(() => !!diagnosis.value)
const aiRejected = computed(() => diagnosis.value?.technicianDecision.state === 'REJECTED')
const manualReply = computed(() => [...(repair.value?.history ?? [])].reverse().find((h) => h.actorRole === 'QUALITY_MANAGER' && h.action === 'CHANGE_REQUESTED' && h.target === 'DIAGNOSIS'))

/* ---------- 권한 · 모드 ---------- */
const canWrite = computed(() => auth.role === 'TECHNICIAN' && (repair.value?.status === 'TECHNICIAN_REVIEW' || repair.value?.status === 'CLOSED'))
const editRequested = ref(false)
// 확정 전이거나 초안이 있으면 바로 편집, 확정본은 [리포트 수정] 을 눌러야 편집
const editing = computed(() => canWrite.value && (repair.value?.status === 'TECHNICIAN_REVIEW' || report.value?.status === 'DRAFT' || editRequested.value))
/** 확정본이 있는 상태에서 새 revision 을 작성 중 (대시보드에는 이전 확정본이 반영되어 있음) */
const revising = computed(() => !!report.value?.confirmations.length && report.value.status === 'DRAFT')
const lastConfirmed = computed(() => report.value?.confirmations[report.value.confirmations.length - 1])

/* ---------- 폼 (ReportContent) ---------- */
const form = reactive({
  aiAcceptance: '' as AiAcceptance | '',
  outcome: '' as RepairOutcome | '',
  causeMode: 'candidate' as 'candidate' | 'custom',
  causeCandidate: '',
  causeCustom: '',
  faults: [] as { area: FaultArea | ''; partId: string }[],
  actualAction: '',
  technicianOpinion: '',
})
const before = ref<UploadItem[]>([])
const after = ref<UploadItem[]>([])
const touched = ref<'draft' | 'confirm' | null>(null)
const confirmOpen = ref(false)
/** 참고용 AI 진단 Drawer (조회 전용) */
const aiOpen = ref(false)
const actionFromAi = ref(false)
const conflict = ref(false)
let filled = false

function fillFrom(c?: ReportContent) {
  if (c) {
    form.aiAcceptance = c.aiAcceptance
    form.outcome = c.outcome
    const isCand = !!diagnosis.value?.candidates.some((x) => x.cause === c.actualCause)
    form.causeMode = isCand ? 'candidate' : 'custom'
    form.causeCandidate = isCand ? c.actualCause : ''
    form.causeCustom = isCand ? '' : c.actualCause
    form.faults = c.faults.map((f) => ({ area: f.area, partId: f.partId ?? '' }))
    form.actualAction = c.actualAction
    form.technicianOpinion = c.technicianOpinion
  } else {
    Object.assign(form, { aiAcceptance: '', outcome: '', causeMode: 'candidate', causeCandidate: '', causeCustom: '', faults: [], actualAction: '', technicianOpinion: '' })
    if (aiRejected.value) {
      form.aiAcceptance = 'REJECTED'
      form.causeMode = 'custom'
    }
  }
  if (!diagnosis.value) {
    form.aiAcceptance = 'NOT_AVAILABLE'
    form.causeMode = 'custom'
  }
}
// 수리 건과 AI 진단을 모두 받은 뒤 서버 리포트로 한 번만 채움 (이후 저장 응답으로 폼을 덮어쓰지 않음)
// 상세는 진단보다 먼저 도착하므로, 진단 조회가 끝나는 시점(diagLoading true → false)에 채운다
watch(diagLoading, (now, before) => {
  if (filled || now || !before || !repair.value) return
  fillFrom(report.value?.content)
  filled = true
})
watch(() => form.outcome, (v) => v === 'NO_FAULT_FOUND' && (form.faults = []))

const actualCause = computed(() => (form.causeMode === 'candidate' && diagnosis.value ? form.causeCandidate : form.causeCustom).trim())
function buildContent(): ReportContent {
  const outcome = form.outcome as RepairOutcome
  return {
    actualCause: actualCause.value,
    actualAction: form.actualAction.trim(),
    technicianOpinion: form.technicianOpinion.trim(),
    faults: outcome === 'NO_FAULT_FOUND' ? [] : form.faults.filter((f) => f.area).map((f) => ({ area: f.area as FaultArea, ...(f.partId ? { partId: f.partId } : {}) })),
    // 수리 성공 여부는 처리 결과에서 파생 (FIXED 만 성공)
    repairSuccessful: outcome === 'FIXED',
    outcome,
    aiAcceptance: hasDiagnosis.value ? (form.aiAcceptance as AiAcceptance) : 'NOT_AVAILABLE',
  }
}
const pendingPhotos = computed(() => before.value.length + after.value.length)
const dirty = computed(() => !report.value || JSON.stringify(buildContent()) !== JSON.stringify(report.value.content) || pendingPhotos.value > 0)
const savedAfterPhotos = computed(() => repair.value?.images.filter((i) => i.kind === 'AFTER') ?? [])
const savedBeforePhotos = computed(() => repair.value?.images.filter((i) => i.kind === 'BEFORE') ?? [])

/* ---------- 검증: 초안은 최소 항목, 확정은 전체 ---------- */
const draftErrs = computed(() => ({
  outcome: !form.outcome ? '처리 결과를 선택해 주세요.' : null,
  aiAcceptance: hasDiagnosis.value && !form.aiAcceptance ? 'AI 진단이 맞았는지 선택해 주세요.' : null,
}))
const confirmErrs = computed(() => ({
  ...draftErrs.value,
  cause: !actualCause.value ? '실제 원인을 선택하거나 입력해 주세요.' : null,
  faults: form.outcome && form.outcome !== 'NO_FAULT_FOUND' && !form.faults.some((f) => f.area) ? '고장 부위를 1개 이상 추가하거나 처리 결과를 "고장 없음"으로 선택해 주세요.' : null,
  action: form.actualAction.trim().length < 5 ? '실제 조치 내용을 5자 이상 입력해 주세요.' : null,
  opinion: (form.aiAcceptance === 'PARTIAL' || form.aiAcceptance === 'REJECTED') && form.technicianOpinion.trim().length < 5 ? 'AI 진단과 다른 경우, 다른 점을 기사 의견에 적어 주세요.' : null,
  // 실서버는 수리 전·후 사진 업로드 API 가 없어 사진 없이 확정한다
  after: FEATURES.reportPhotos && form.outcome !== 'NO_FAULT_FOUND' && !after.value.length && !savedAfterPhotos.value.length ? '수리 후 사진을 1장 이상 등록해 주세요.' : null,
}))
type ErrKey = keyof typeof confirmErrs.value
const errOf = (k: ErrKey) => (touched.value === 'confirm' ? confirmErrs.value[k] : touched.value === 'draft' ? (draftErrs.value as Record<string, string | null>)[k] ?? null : null)
const isValid = (errs: Record<string, string | null>) => Object.values(errs).every((v) => !v)

function focusFirstError() {
  toast.warning('빠진 항목을 확인해 주세요.')
  setTimeout(() => document.querySelector<HTMLElement>('.error-text')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
}

/* ---------- 고장 부위 ---------- */
// 부품 목록은 Mock·실서버 공통으로 부품 API 에서 받는다 (고장 부품 partId 는 서버 부품 id)
const orders = useOrderStore()
void orders.fetchParts()
const partOptions = computed(() => orders.parts.filter((p) => isCompatible(p, repair.value?.product.model)))
/** 부품 → 고장 부위. 실서버는 부품 category(PCB/MOTOR/OTHER), Mock 은 품번 접두어로 판단 */
const partArea = (p?: Pick<Part, 'partNo' | 'category'>): FaultArea =>
  p?.category ?? (p?.partNo.startsWith('RM-PC') ? 'PCB' : 'MOTOR')
const partName = (id?: string) => orders.partById(id ?? '')?.name
function addFault() {
  form.faults.push({ area: '', partId: '' })
}
function onFaultPart(i: number) {
  const f = form.faults[i]
  const p = orders.partById(f.partId)
  if (p && !f.area) f.area = partArea(p)
}
function loadAiFaults() {
  if (!diagnosis.value) return
  form.faults = diagnosis.value.parts.map((p) => ({ area: partArea(orders.partById(p.partId) ?? p), partId: p.partId }))
}
function loadAiAction() {
  if (!diagnosis.value) return
  form.actualAction = diagnosis.value.repairMethod.join('\n')
  actionFromAi.value = true
}

/* ---------- 저장 · 확정 ---------- */
async function handleError(e: unknown) {
  if (e instanceof ApiError && e.code === 'REPORT_VERSION') {
    conflict.value = true
    toast.error(e.message)
    await reload() // 최신 version 을 받아 둠. 입력 중인 내용은 폼에 그대로 남김
    return
  }
  toast.error(toErrorMessage(e))
}

/** 사진 업로드 + 초안 저장. 성공하면 true */
async function persistDraft(): Promise<boolean> {
  const photos = [
    ...before.value.map((i) => ({ kind: 'BEFORE' as const, file: i.file, dataUrl: i.dataUrl })),
    ...after.value.map((i) => ({ kind: 'AFTER' as const, file: i.file, dataUrl: i.dataUrl })),
  ]
  if (photos.length) {
    await store.uploadReportPhotos(photos)
    before.value = []
    after.value = []
  }
  await store.saveReportDraft({ version: report.value?.version ?? null, content: buildContent() })
  conflict.value = false
  return true
}

async function saveDraft() {
  touched.value = 'draft'
  if (!isValid(draftErrs.value)) return focusFirstError()
  try {
    await persistDraft()
    toast.success(`리포트 초안 r${report.value?.revision}을 저장했습니다.`)
  } catch (e) {
    await handleError(e)
  }
}

function openConfirm() {
  touched.value = 'confirm'
  if (!isValid(confirmErrs.value)) return focusFirstError()
  confirmOpen.value = true
}

async function confirm() {
  try {
    // 저장 안 된 변경이 있으면 먼저 초안으로 저장한 뒤 그 version 으로 확정
    if (dirty.value || report.value?.status !== 'DRAFT') await persistDraft()
    await store.confirmReport(report.value!.version)
    confirmOpen.value = false
    editRequested.value = false
    touched.value = null
    toast.success(`리포트 r${report.value?.revision}을 확정했습니다. 사내 사례와 품질 통계에 반영됩니다.`)
  } catch (e) {
    confirmOpen.value = false
    await handleError(e)
  }
}

function startEdit() {
  fillFrom(report.value?.content)
  editRequested.value = true
}
function cancelEdit() {
  fillFrom(report.value?.content)
  before.value = []
  after.value = []
  touched.value = null
  editRequested.value = false
}
function discardMine() {
  fillFrom(report.value?.content)
  conflict.value = false
}

const OUTCOMES: RepairOutcome[] = ['FIXED', 'NOT_FIXED', 'NO_FAULT_FOUND']
const ACCEPTANCES = [
  { v: 'ACCEPTED', icon: CircleCheck },
  { v: 'PARTIAL', icon: CircleAlert },
  { v: 'REJECTED', icon: CircleX },
] as const
const faultText = (c: ReportContent) =>
  c.faults.length ? c.faults.map((f) => `${FAULT_AREA_LABEL[f.area]}${f.partId ? ` · ${partName(f.partId) ?? f.partId}` : ''}`).join(', ') : '없음'
</script>

<template>
  <div class="page">
    <div v-if="loading && !repair" class="stack"><SkeletonBlock :lines="2" :height="60" /><SkeletonBlock :lines="8" :height="36" /></div>
    <StateView v-else-if="error && !repair" state="error" :message="error" @retry="reload" />

    <template v-else-if="repair">
      <RepairFlowNav :repair="repair" />
      <div class="page-head">
        <div>
          <h1>{{ editing ? '수리 리포트 작성' : '수리 리포트' }}</h1>
          <p class="sub">기사가 확정한 결과만 고장 DB와 품질 대시보드에 반영됩니다.</p>
        </div>
        <button type="button" class="btn btn-ai" aria-haspopup="dialog" @click="aiOpen = true"><Sparkles :size="18" aria-hidden="true" /> AI 진단 참고하기</button>
      </div>
      <RepairSummaryCard :repair="repair" compact />

      <!-- 안내 -->
      <div v-if="conflict" class="callout tone-danger" role="alert">
        <RefreshCw :size="22" />
        <div class="grow">
          <strong>다른 곳에서 리포트가 먼저 저장되었습니다.</strong>
          최신 버전(r{{ report?.revision }} · {{ report?.updatedBy }} · {{ formatDateTime(report?.updatedAt) }})을 받아 왔습니다. 입력하던 내용은 화면에 남아 있으니 확인 후 다시 저장하거나, 최신 내용으로 되돌리세요.
        </div>
        <button type="button" class="btn btn-sm" @click="discardMine">최신 내용으로 되돌리기</button>
      </div>
      <div v-if="manualReply && editing && !report" class="callout tone-info">
        <Building2 :size="22" />
        <div><strong>본사 수동 진단 회신 · {{ manualReply.actor }}</strong>{{ manualReply.comment }}</div>
      </div>
      <div v-if="aiRejected && editing && !report" class="callout tone-danger">
        <CircleX :size="22" />
        <div><strong>AI 진단을 반려한 건입니다.</strong> 직접 점검한 실제 결과를 입력해 주세요. (반려 사유: {{ diagnosis?.technicianDecision.comment }})</div>
      </div>
      <div v-if="revising" class="callout tone-warning">
        <PencilLine :size="22" />
        <div>
          <strong>확정된 리포트를 수정 중입니다 (초안 r{{ report?.revision }}).</strong>
          고장 DB·품질 대시보드에는 아직 r{{ lastConfirmed?.revision }} 확정본이 반영되어 있습니다. 다시 확정하면 새 확정본으로 교체됩니다.
        </div>
      </div>

      <!-- ===== 작성 · 수정 (기사) ===== -->
      <div v-if="editing" class="layout">
        <form class="stack report-form" novalidate @submit.prevent="openConfirm">
          <section class="card card-pad stack human-edge">
            <div class="row between">
              <h2 class="section-title">1. 처리 결과</h2>
              <AiBadge kind="human" label="기사 입력" />
            </div>
            <div class="choice-group" role="radiogroup" aria-label="처리 결과">
              <button v-for="o in OUTCOMES" :key="o" type="button" class="choice opt" :class="`o-${o}`" role="radio" :aria-checked="form.outcome === o" @click="form.outcome = o">
                <span><strong>{{ OUTCOME_META[o].label }}</strong><small>{{ OUTCOME_META[o].description }}</small></span>
              </button>
            </div>
            <p v-if="errOf('outcome')" class="error-text"><CircleAlert :size="16" /> {{ errOf('outcome') }}</p>
          </section>

          <section v-if="hasDiagnosis" class="card card-pad stack human-edge">
            <h2 class="section-title">2. AI 진단이 맞았나요?</h2>
            <div class="choice-group" role="radiogroup" aria-label="AI 진단 수용 여부">
              <button v-for="m in ACCEPTANCES" :key="m.v" type="button" class="choice opt" :class="`m-${m.v}`" role="radio" :aria-checked="form.aiAcceptance === m.v" @click="form.aiAcceptance = m.v">
                <component :is="m.icon" :size="24" />
                <span><strong>{{ AI_ACCEPTANCE_META[m.v].label }}</strong><small>{{ AI_ACCEPTANCE_META[m.v].description }}</small></span>
              </button>
            </div>
            <p v-if="errOf('aiAcceptance')" class="error-text"><CircleAlert :size="16" /> {{ errOf('aiAcceptance') }}</p>
          </section>
          <section v-else class="card card-pad human-edge faint">2. AI 진단 없이 진행한 건이라 AI 진단 수용 여부는 'AI 진단 없음'으로 기록됩니다.</section>

          <section class="card card-pad stack human-edge">
            <h2 class="section-title">3. 실제 원인</h2>
            <div v-if="hasDiagnosis" class="choice-group" role="radiogroup" aria-label="원인 입력 방식">
              <button type="button" class="choice" role="radio" :aria-checked="form.causeMode === 'candidate'" @click="form.causeMode = 'candidate'">AI 후보 중에서 선택</button>
              <button type="button" class="choice" role="radio" :aria-checked="form.causeMode === 'custom'" @click="form.causeMode = 'custom'"><PencilLine :size="18" /> 직접 입력</button>
            </div>
            <div v-if="form.causeMode === 'candidate' && diagnosis" class="field">
              <label for="cause-sel" class="req">원인 선택</label>
              <select id="cause-sel" v-model="form.causeCandidate" class="select" :class="{ invalid: errOf('cause') }">
                <option value="" disabled>원인을 선택하세요</option>
                <option v-for="c in diagnosis.candidates" :key="c.rank" :value="c.cause">{{ c.rank }}순위 · {{ c.cause }} (AI 판단 점수 {{ c.confidence }}점)</option>
              </select>
            </div>
            <div v-else class="field">
              <label for="cause-in" class="req">원인 입력</label>
              <input id="cause-in" v-model="form.causeCustom" class="input" :class="{ invalid: errOf('cause') }" placeholder="예) 배터리 커넥터 산화로 인한 순간 전원 차단" />
            </div>
            <p v-if="errOf('cause')" class="error-text"><CircleAlert :size="16" /> {{ errOf('cause') }}</p>
          </section>

          <section class="card card-pad stack human-edge">
            <div class="row between">
              <h2 class="section-title">4. 고장 부위</h2>
              <button v-if="diagnosis?.parts.length && form.outcome !== 'NO_FAULT_FOUND'" type="button" class="btn btn-sm btn-ai" @click="loadAiFaults"><Sparkles :size="16" /> AI 추천 부품 불러오기</button>
            </div>
            <p v-if="form.outcome === 'NO_FAULT_FOUND'" class="faint">처리 결과가 '고장 없음'이라 고장 부위를 기록하지 않습니다.</p>
            <template v-else>
              <div v-if="!form.faults.length" class="empty-faults">
                <span>등록된 고장 부위가 없습니다</span>
                <span class="faint">아래 [고장 부위 추가]로 직접 넣거나, 위의 [AI 추천 부품 불러오기]로 AI 추천을 복사해 고칠 수 있어요.</span>
              </div>
              <div v-for="(f, i) in form.faults" :key="i" class="fault-row">
                <div class="field">
                  <label :for="`fa-${i}`" class="sr-only">고장 부위</label>
                  <select :id="`fa-${i}`" v-model="f.area" class="select">
                    <option value="" disabled>부위 선택</option>
                    <option v-for="(l, k) in FAULT_AREA_LABEL" :key="k" :value="k">{{ l }}</option>
                  </select>
                </div>
                <div class="field">
                  <label :for="`fp-${i}`" class="sr-only">교체 부품 (선택)</label>
                  <select :id="`fp-${i}`" v-model="f.partId" class="select" @change="onFaultPart(i)">
                    <option value="">교체 부품 없음</option>
                    <option v-for="o in partOptions" :key="o.id" :value="o.id">{{ o.name }} ({{ o.partNo }})</option>
                  </select>
                </div>
                <button type="button" class="btn btn-danger" :aria-label="`${i + 1}번째 고장 부위 삭제`" @click="form.faults.splice(i, 1)"><Trash2 :size="18" /></button>
              </div>
              <div class="row">
                <button type="button" class="btn" @click="addFault"><Plus :size="18" /> 고장 부위 추가</button>
                <RouterLink :to="`/repairs/${repair.id}/diagnosis?page=2`" class="faint link"><Package :size="14" /> 재고·발주 확인하기</RouterLink>
              </div>
            </template>
            <p v-if="errOf('faults')" class="error-text"><CircleAlert :size="16" /> {{ errOf('faults') }}</p>
          </section>

          <section class="card card-pad stack human-edge">
            <div class="row between">
              <h2 class="section-title">5. 실제 조치</h2>
              <button v-if="diagnosis" type="button" class="btn btn-sm btn-ai" @click="loadAiAction"><Sparkles :size="16" /> AI 권장 방법 불러오기</button>
            </div>
            <div class="field">
              <label for="action" class="req">조치 내용</label>
              <textarea id="action" v-model="form.actualAction" class="textarea" :class="{ invalid: errOf('action') }" placeholder="실제로 수행한 작업을 순서대로 적어 주세요." @input="actionFromAi = false" />
              <p v-if="actionFromAi" class="help"><Sparkles :size="13" /> AI 권장 내용을 불러왔습니다. 실제 수행한 내용과 다르면 반드시 고쳐 주세요.</p>
              <p v-if="errOf('action')" class="error-text"><CircleAlert :size="16" /> {{ errOf('action') }}</p>
            </div>
          </section>

          <section class="card card-pad stack human-edge">
            <h2 class="section-title">6. 기사 의견</h2>
            <TechnicianCommentForm v-model="form.technicianOpinion" label="기사 의견" :required="form.aiAcceptance === 'PARTIAL' || form.aiAcceptance === 'REJECTED'" :invalid="!!errOf('opinion')" />
            <p v-if="errOf('opinion')" class="error-text"><CircleAlert :size="16" /> {{ errOf('opinion') }}</p>
          </section>

          <section v-if="FEATURES.reportPhotos" class="card card-pad stack human-edge">
            <h2 class="section-title">7. 수리 전 · 후 사진</h2>
            <p v-if="savedBeforePhotos.length || savedAfterPhotos.length" class="faint">저장된 사진: 수리 전 {{ savedBeforePhotos.length }}장 · 수리 후 {{ savedAfterPhotos.length }}장 (아래에서 추가할 수 있습니다)</p>
            <div class="grid-2">
              <ImageUploader v-model="before" label="수리 전 사진" description="고장 부위가 보이게 (선택)" :max="3" />
              <ImageUploader
                v-model="after"
                label="수리 후 사진"
                description="교체·수리한 부위가 보이게"
                :required="!savedAfterPhotos.length && form.outcome !== 'NO_FAULT_FOUND'"
                :max="3"
                :invalid="!!errOf('after')"
                example-src="/mock/repair-after.svg"
              />
            </div>
            <p v-if="errOf('after')" class="error-text"><CircleAlert :size="16" /> {{ errOf('after') }}</p>
          </section>

          <div class="submit card">
            <p class="faint">
              <template v-if="report">r{{ report.revision }} {{ REPORT_STATUS_META[report.status].label }} · {{ report.updatedBy }} · {{ formatDateTime(report.updatedAt) }}<template v-if="dirty"> · 저장 안 된 변경 있음</template></template>
              <template v-else>아직 저장되지 않았습니다.</template>
              <br />확정하면 고장 DB와 품질 대시보드에 반영됩니다.
            </p>
            <div class="row">
              <button v-if="editRequested && report?.status === 'CONFIRMED'" type="button" class="btn btn-ghost" :disabled="submitting" @click="cancelEdit"><X :size="18" /> 수정 취소</button>
              <button type="button" class="btn btn-lg" :disabled="submitting || !dirty" @click="saveDraft"><Save :size="20" /> 초안 저장</button>
              <button type="submit" class="btn btn-primary btn-lg" :disabled="submitting || (report?.status === 'CONFIRMED' && !dirty)"><FileCheck2 :size="20" /> 리포트 확정</button>
            </div>
          </div>
        </form>

      </div>

      <!-- ===== 읽기 전용 (확정본 조회 · 본사 품질 담당자) ===== -->
      <template v-else>
        <section v-if="report" class="card">
          <div class="card-head">
            <h2>수리 리포트 r{{ report.revision }}</h2>
            <div class="row">
              <span class="badge" :class="`tone-${REPORT_STATUS_META[report.status].tone}`">{{ REPORT_STATUS_META[report.status].label }}</span>
              <button v-if="canWrite && report.status === 'CONFIRMED'" type="button" class="btn btn-sm" @click="startEdit"><PencilLine :size="16" /> 리포트 수정</button>
            </div>
          </div>
          <div class="card-body ro">
            <dl class="kv">
              <dt>리포트 ID</dt>
              <dd class="mono">{{ report.id ?? '-' }}</dd>
              <dt>버전</dt>
              <dd>r{{ report.revision }} <span class="faint">(저장 v{{ report.version }})</span></dd>
              <dt>처리 결과</dt>
              <dd><span class="badge" :class="`tone-${OUTCOME_META[report.content.outcome].tone}`">{{ OUTCOME_META[report.content.outcome].label }}</span> <span class="faint">수리 {{ report.content.repairSuccessful ? '성공' : '미완료' }}</span></dd>
              <dt>AI 진단</dt>
              <dd>{{ AI_ACCEPTANCE_META[report.content.aiAcceptance].label }}</dd>
              <dt>실제 원인</dt>
              <dd>{{ report.content.actualCause || '-' }}</dd>
              <dt>고장 부위</dt>
              <dd>{{ faultText(report.content) }}</dd>
              <dt>실제 조치</dt>
              <dd class="pre">{{ report.content.actualAction || '-' }}</dd>
              <dt>기사 의견</dt>
              <dd class="pre">{{ report.content.technicianOpinion || '-' }}</dd>
              <dt>작성</dt>
              <dd>{{ report.createdBy }} · 최종 수정 {{ report.updatedBy }} · {{ formatDateTime(report.updatedAt) }}</dd>
              <dt>확정</dt>
              <dd>{{ report.confirmedAt ? `${report.confirmedBy} · ${formatDateTime(report.confirmedAt)}` : '아직 확정되지 않음' }}</dd>
            </dl>
            <div class="photos">
              <figure v-for="img in [...savedBeforePhotos, ...savedAfterPhotos]" :key="img.id">
                <img :src="img.url" :alt="img.kind === 'BEFORE' ? '수리 전' : '수리 후'" />
                <figcaption class="faint">{{ img.kind === 'BEFORE' ? '수리 전' : '수리 후' }}</figcaption>
              </figure>
            </div>
          </div>
          <div v-if="report.status === 'CONFIRMED'" class="card-body">
            <div class="decided human-zone">
              <AiBadge kind="human" :label="`기사 확정 · 고장 DB 반영됨 (r${report.revision})`" />
            </div>
          </div>
        </section>
        <section v-else class="card">
          <StateView state="empty" title="아직 작성된 수리 리포트가 없습니다" :message="auth.role === 'TECHNICIAN' ? '진단을 확인한 뒤 리포트를 작성할 수 있습니다.' : '담당 기사가 리포트를 확정하면 표시됩니다.'">
            <RouterLink :to="`/repairs/${repair.id}/diagnosis`" class="btn">진단 결과 보기</RouterLink>
          </StateView>
        </section>
      </template>

      <!-- 사내 사례 반영 (US-08 · Mock 전용) -->
      <CaseSyncCard v-if="FEATURES.caseSync && lastConfirmed" :repair-id="repair.id" :revision="lastConfirmed.revision" />

      <!-- 확정 이력 -->
      <section v-if="report?.confirmations.length" class="card">
        <div class="card-head"><h3><FileCheck2 :size="20" /> 확정 이력</h3></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>개정</th><th>확정자</th><th>확정 시각</th><th>고장 DB</th></tr></thead>
            <tbody>
              <tr v-for="c in [...report.confirmations].reverse()" :key="c.revision">
                <td class="mono"><strong>r{{ c.revision }}</strong></td>
                <td>{{ c.confirmedBy }}</td>
                <td>{{ formatDateTime(c.confirmedAt) }}</td>
                <td>
                  <span v-if="c.revision === lastConfirmed?.revision" class="badge tone-success"><CircleCheck :size="14" /> 현재 반영본</span>
                  <span v-else class="faint">교체됨</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3><History :size="20" /> 처리 이력</h3></div>
        <div class="card-body"><ApprovalHistoryTimeline :records="repair.history" /></div>
      </section>
    </template>

    <!-- 참고용 AI 진단 (오른쪽 Drawer · 휴대폰은 아래에서 올라오는 시트, 조회 전용) -->
    <BaseModal :open="aiOpen" title="참고용 AI 진단" placement="right" @close="aiOpen = false">
      <template #head-extra><span class="badge tone-ai ai-dash">확정된 결과가 아닙니다</span></template>
      <AiDiagnosisReference v-if="repair" :diagnosis="diagnosis" :repair-id="repair.id" />
    </BaseModal>

    <BaseModal :open="confirmOpen" title="수리 결과 확정" :width="620" @close="confirmOpen = false">
      <dl class="kv">
        <dt>처리 결과</dt>
        <dd>{{ form.outcome ? OUTCOME_META[form.outcome].label : '-' }}</dd>
        <dt>AI 진단</dt>
        <dd>{{ AI_ACCEPTANCE_META[hasDiagnosis ? (form.aiAcceptance || 'NOT_AVAILABLE') : 'NOT_AVAILABLE'].label }}</dd>
        <dt>실제 원인</dt>
        <dd>{{ actualCause }}</dd>
        <dt>고장 부위</dt>
        <dd>{{ faultText(buildContent()) }}</dd>
        <dt>사진</dt>
        <dd>수리 전 {{ savedBeforePhotos.length + before.length }}장 · 수리 후 {{ savedAfterPhotos.length + after.length }}장</dd>
      </dl>
      <div class="callout tone-info" style="margin-top: 16px">
        <FileCheck2 :size="20" />
        <div>
          <strong>수리 결과를 확정하시겠습니까?</strong><br />
          확정된 결과는 사내 사례와 품질 통계에 반영됩니다.
          <template v-if="lastConfirmed"> 이전 확정본(r{{ lastConfirmed.revision }})의 반영 내용은 이 확정본으로 교체됩니다.</template>
          <template v-if="form.outcome === 'NO_FAULT_FOUND'"> 단, '고장 없음'은 고장 건수에 포함되지 않습니다.</template>
          확정 후에도 [리포트 수정]으로 고칠 수 있습니다.
        </div>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="confirmOpen = false">다시 확인</button>
        <button class="btn btn-primary" type="button" :disabled="submitting" @click="confirm"><FileCheck2 :size="18" /> {{ submitting ? '확정 중…' : '리포트 확정' }}</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gap);
}
/* 하단 고정 버튼이 입력 내용을 가리지 않게: 마지막 카드 아래 여백 + 포커스 이동 시 버튼 높이만큼 비켜서 */
.report-form {
  padding-bottom: 24px;
}
.report-form :is(section, .field) {
  scroll-margin-bottom: 120px;
}
.empty-faults {
  display: grid;
  gap: 2px;
  padding: 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-weight: 600;
  color: var(--text-2);
  text-align: center;
}
.empty-faults .faint {
  font-weight: 400;
  font-size: var(--fs-sm);
}
.ai-dash {
  border-style: dashed;
  font-size: var(--fs-xs);
}
.human-edge {
  border-left: 4px solid var(--success);
}
.opt {
  min-height: 72px;
}
.opt span {
  display: grid;
}
.opt small {
  font-weight: 500;
  color: var(--text-3);
}
.m-ACCEPTED[aria-checked='true'],
.o-FIXED[aria-checked='true'] { border-color: var(--success); background: var(--success-bg); color: var(--success); }
.m-PARTIAL[aria-checked='true'] { border-color: #e08a00; background: var(--warning-bg); color: var(--warning); }
.m-REJECTED[aria-checked='true'],
.o-NOT_FIXED[aria-checked='true'] { border-color: var(--danger); background: var(--danger-bg); color: var(--danger); }
.o-NO_FAULT_FOUND[aria-checked='true'] { border-color: var(--navy-800); background: var(--navy-50); color: var(--navy-800); }
.fault-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(0, 2fr) auto;
  gap: 8px;
}
.link {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.grow {
  flex: 1;
}
.submit {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  box-shadow: var(--shadow-lg);
  flex-wrap: wrap;
}
.ro {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 20px;
}
.pre {
  white-space: pre-wrap;
}
.photos {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  align-content: start;
}
.photos figure {
  margin: 0;
}
.photos img {
  border-radius: var(--radius);
  border: 1px solid var(--border);
  aspect-ratio: 4/3;
  object-fit: cover;
  width: 100%;
}
.decided {
  padding: 14px 18px;
  display: grid;
  gap: 8px;
}
@media (max-width: 1180px) {
  .ro {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 640px) {
  .fault-row {
    grid-template-columns: 1fr auto;
  }
  .fault-row .field:nth-child(2) {
    grid-column: 1 / 2;
  }
}
</style>
