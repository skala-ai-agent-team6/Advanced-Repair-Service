<script setup lang="ts">
/* =========================================================================
 * 출장 전 진단 리포트 모달 (출장기사) — '오늘의 출장' 위에 띄우는 큰 모달 (BaseModal → Teleport body)
 *  데이터: 기존 진단 리포트(/repairs/:id/diagnosis)와 같은 수리 건 · AI 진단 · 사진 · 부품 API 를 그대로 조회 (복사본 없음)
 *    방문 정보(시간·고객·구·동)는 출장 일정(useFieldVisits)에서 visitId 로 찾는다
 *  구성: 방문 정보 요약 / 결함 위치(대표 사진 + 이상 영역 + 썸네일) / 진단 요약(AI 예상 원인 · AI 판단 점수 · 근거 3개)
 *        / 기사 수정 / 출장 전 준비 부품(재고 · 발주 신청)
 *  하단: [닫기] … [수정] [리포트 확인 완료]  — 방문 완료 건(readonly)은 조회만
 *  수정값은 AI 결과와 별도(기사 수정안)로 저장. 리포트 확인 완료 = TECHNICIAN_REVIEWED 기록 (최종 수리 확정 아님)
 * ========================================================================= */
import { computed, reactive, ref, watch } from 'vue'
import { CircleCheck, Clock, MapPin, PencilLine, Save, User, Loader2, ImageOff, Package, Stethoscope, X } from 'lucide-vue-next'
import BaseModal from '@/components/common/BaseModal.vue'
import AiBadge from '@/components/common/AiBadge.vue'
import ConfidenceBar from '@/components/common/ConfidenceBar.vue'
import StateView from '@/components/common/StateView.vue'
import SkeletonBlock from '@/components/common/SkeletonBlock.vue'
import AnnotatedImage from '@/components/diagnosis/AnnotatedImage.vue'
import TechnicianEditPanel from '@/components/diagnosis/TechnicianEditPanel.vue'
import PreVisitPartsSection from '@/components/diagnosis/PreVisitPartsSection.vue'
import SimilarCasesList from '@/components/diagnosis/SimilarCasesList.vue'
import { usePreVisitEdit } from '@/composables/usePreVisitEdit'
import { useFieldVisits } from '@/composables/useFieldVisits'
import { repairApi, toErrorMessage, ApiError } from '@/api'
import { FEATURES } from '@/api/features'
import { useOrderStore } from '@/stores/orders'
import { useToastStore } from '@/stores/toast'
import { PHOTO_KIND_LABEL } from '@/constants/status'
import { PRODUCT_TYPE_LABEL } from '@/constants/products'
import { formatDate } from '@/utils/format'
import type { Diagnosis, Repair } from '@/types'

const props = defineProps<{ open: boolean; repairId: number | null; visitId: string | null; readonly: boolean }>()
const emit = defineEmits<{ close: []; edit: []; confirmed: []; 'order-requested': [partId: string] }>()
const toast = useToastStore()
const orders = useOrderStore()
const field = useFieldVisits()

/* ---------- 조회 ---------- */
const visit = computed(() => field.visits.value.find((v) => v.visitId === props.visitId) ?? field.visits.value.find((v) => v.repairId === props.repairId) ?? null)
const repair = ref<Repair | null>(null)
const diagnosis = ref<Diagnosis | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let seq = 0
async function load() {
  const id = props.repairId
  if (!id) return
  const my = ++seq
  loading.value = true
  error.value = null
  try {
    const [r, d] = await Promise.all([repairApi.get(id), repairApi.diagnosis(id)])
    if (my !== seq) return
    repair.value = r
    diagnosis.value = d.current
  } catch (e) {
    if (my === seq) error.value = toErrorMessage(e)
  } finally {
    if (my === seq) loading.value = false
  }
}
const pre = reactive(usePreVisitEdit(computed(() => (props.open ? (props.repairId ?? undefined) : undefined)), diagnosis))

/** 열 때마다 새로 조회, 닫으면 선택 사진 · 임시 수정 상태 초기화 */
watch(
  () => [props.open, props.repairId] as const,
  ([open]) => {
    selectedImageId.value = null
    notice.value = ''
    if (!open) {
      pre.cancelEdit()
      repair.value = null
      diagnosis.value = null
      return
    }
    void load()
  },
)

/* ---------- 결함 위치: 대표 사진 + 썸네일 ---------- */
const images = computed(() => repair.value?.images ?? [])
const selectedImageId = ref<string | null>(null)
const agents = computed(() => diagnosis.value?.agents ?? [])
const annotationsOf = (imageId: string) => agents.value.flatMap((a) => a.annotations.filter((an) => an.imageId === imageId))
/** 처음에는 가장 심각한 결함 위치(HIGH → MEDIUM)가 표시된 사진을 대표로 */
const SEV_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const
const worstOf = (imageId: string) => Math.max(0, ...annotationsOf(imageId).map((a) => SEV_RANK[a.severity]))
const mainImage = computed(
  () => images.value.find((i) => i.id === selectedImageId.value) ?? [...images.value].sort((a, b) => worstOf(b.id) - worstOf(a.id))[0] ?? null,
)
const thumbFailed = ref<Record<string, boolean>>({})

/* ---------- 진단 요약 ---------- */
/** 유사 사례를 찾는 RAG가 결과를 못 냈으면 그 도구 이름 (센터 진단 결과와 같은 기준) */
const ragMissing = computed(() => {
  const t = (repair.value?.tools ?? []).find((x) => x.kind === 'RAG' && (x.state === 'FAILED' || x.state === 'SKIPPED'))
  return t ? t.label : null
})
const evidence = computed(() => (diagnosis.value?.candidates ?? []).flatMap((c) => c.evidence).slice(0, 3))
const productLabel = computed(() => {
  const p = repair.value?.product
  if (!p) return ''
  const type = p.productTypeDetail || (p.productType ? PRODUCT_TYPE_LABEL[p.productType] : '')
  return [type, p.modelName || p.model].filter(Boolean).join(' · ')
})

/* ---------- 권한 · 버튼 ---------- */
const canEdit = computed(() => !props.readonly && pre.enabled && !!diagnosis.value)
const confirmKind = computed<'ready' | 'done' | 'locked' | 'hidden'>(() => {
  const st = diagnosis.value?.technicianDecision.state
  if (!diagnosis.value) return 'hidden'
  if (st === 'PENDING') return !props.readonly && FEATURES.diagnosisDecision && repair.value?.status === 'DIAGNOSIS_COMPLETED' ? 'ready' : 'locked'
  if (st === 'APPROVED') return !pre.enabled || pre.reviewedCurrent ? 'done' : props.readonly ? 'locked' : 'ready'
  return 'hidden'
})
const reviewed = computed(() => confirmKind.value === 'done')

/* ---------- 리포트 확인 완료 ---------- */
const confirmDlg = ref(false)
const busy = ref(false)
const notice = ref('')
function onConfirm() {
  if (pre.editing) {
    notice.value = '수정 내용을 먼저 저장해 주세요.'
    toast.warning(notice.value)
    return
  }
  if (confirmKind.value === 'ready') confirmDlg.value = true
}
async function doConfirm() {
  if (!repair.value || busy.value) return
  busy.value = true
  try {
    if (diagnosis.value?.technicianDecision.state === 'PENDING') {
      await repairApi.approval(repair.value.id, { target: 'DIAGNOSIS', action: 'APPROVE', comment: '', diagnosisVersion: diagnosis.value.version })
    }
    if (pre.enabled) await pre.markReviewed()
    confirmDlg.value = false
    toast.success('리포트 확인을 완료했습니다.')
    await load()
    emit('confirmed')
  } catch (e) {
    toast.error(toErrorMessage(e))
    if (e instanceof ApiError && e.status === 409) void pre.load()
  } finally {
    busy.value = false
  }
}

/* ---------- 수정 · 저장 · 취소 ---------- */
function startEdit() {
  notice.value = ''
  pre.startEdit()
  emit('edit')
}
const saveDlg = ref(false)
function openSave() {
  pre.touched = true
  if (!pre.valid) return void toast.warning('입력 내용을 확인해 주세요.')
  saveDlg.value = true
}
async function doSave() {
  try {
    await pre.save()
    saveDlg.value = false
    notice.value = ''
    toast.success('리포트 수정 내용이 저장되었습니다.')
  } catch (e) {
    saveDlg.value = false
    toast.error(toErrorMessage(e))
    if (e instanceof ApiError && e.status === 409) void pre.load()
  }
}
/** 저장 안 한 수정이 있으면 먼저 확인 (바깥 클릭 · ESC · X · 닫기 · 수정 취소) */
const discard = reactive({ open: false, then: null as null | (() => void) })
function guard(then: () => void) {
  if (pre.editing && pre.dirty) return void Object.assign(discard, { open: true, then })
  pre.cancelEdit()
  then()
}
function confirmDiscard() {
  const then = discard.then
  Object.assign(discard, { open: false, then: null })
  pre.cancelEdit()
  notice.value = ''
  then?.()
}
function requestClose() {
  guard(() => emit('close'))
}

/* ---------- 발주 신청 (기존 발주 API · Mock handler) ---------- */
const orderDlg = reactive({ open: false, partId: '', name: '', qty: 1, warehouse: '' })
const orderingId = ref<string | null>(null)
function askOrder(partId: string) {
  const p = orders.partById(partId)
  const line = pre.effectiveParts.find((x) => x.partId === partId)
  const best = [...(p?.stocks ?? [])].sort((a, b) => b.quantity - a.quantity)[0]
  Object.assign(orderDlg, { open: true, partId, name: p?.name ?? partId, qty: line?.quantity ?? 1, warehouse: best?.warehouse ?? '' })
}
async function doOrder() {
  if (!repair.value) return
  const { partId, qty, warehouse } = orderDlg
  orderingId.value = partId
  try {
    const draft = orders.repairOrders.find((o) => o.partId === partId && (o.status === 'AI_DRAFT' || o.status === 'REJECTED'))
    await orders.request(repair.value.id, { draftOrderId: draft?.id, partId, quantity: qty, fromWarehouse: warehouse })
    await orders.fetchForRepair(repair.value.id)
    orderDlg.open = false
    toast.success(`${orderDlg.name} ${qty}개 발주를 신청했습니다. 본사 품질 담당자 승인을 기다립니다.`)
    emit('order-requested', partId)
  } catch (e) {
    toast.error(toErrorMessage(e))
  } finally {
    orderingId.value = null
  }
}
</script>

<template>
  <BaseModal :open="open" title="출장 전 진단 리포트" :width="1160" mobile-full scroll-body @close="requestClose">
    <template #head-extra>
      <AiBadge compact />
      <span v-if="visit" class="head-meta">{{ formatDate(visit.visitDate) }} {{ visit.visitTime }} · {{ visit.customerName }}</span>
    </template>

    <div v-if="loading && !repair" class="stack" aria-busy="true"><SkeletonBlock :lines="2" :height="44" /><SkeletonBlock :lines="3" :height="140" /></div>
    <StateView v-else-if="error" state="error" :message="error" @retry="load" />
    <div v-else-if="repair" class="pv">
      <!-- 1. 방문 정보 요약 -->
      <section class="summary" aria-label="방문 정보">
        <div class="si"><Clock :size="18" aria-hidden="true" /><span class="k">방문 시간</span><b>{{ visit ? `${formatDate(visit.visitDate)} ${visit.visitTime}` : '-' }}</b></div>
        <div class="si"><User :size="18" aria-hidden="true" /><span class="k">고객</span><b>{{ visit?.customerName ?? '-' }}</b></div>
        <div class="si"><MapPin :size="18" aria-hidden="true" /><span class="k">주소</span><b>{{ visit ? `${visit.district} ${visit.neighborhood}` : '-' }}</b></div>
        <div class="si"><Package :size="18" aria-hidden="true" /><span class="k">제품</span><b>{{ productLabel }}</b></div>
        <div class="si sym"><Stethoscope :size="18" aria-hidden="true" /><span class="k">고장 증상</span><span>{{ repair.symptom }}</span></div>
      </section>
      <p v-if="readonly" class="callout tone-info ro-note">방문 완료 건입니다. 리포트는 조회만 할 수 있습니다.</p>

      <StateView v-if="!diagnosis" state="empty" title="아직 생성된 출장 전 리포트가 없습니다" message="AI 분석이 끝나면 이곳에 출장 전 진단 리포트가 표시됩니다." />
      <template v-else>
        <div class="grid">
          <!-- 2. 결함 위치 -->
          <section class="card-lite" aria-labelledby="h-defect">
            <h3 id="h-defect" class="h">결함 위치</h3>
            <template v-if="mainImage">
              <AnnotatedImage :key="mainImage.id" :image="mainImage" :annotations="annotationsOf(mainImage.id)" :title="`${PHOTO_KIND_LABEL[mainImage.kind]} · 결함 예상 위치`" />
              <div class="thumbs" role="group" aria-label="사진 고르기">
                <button
                  v-for="img in images"
                  :key="img.id"
                  type="button"
                  class="thumb"
                  :class="{ on: img.id === mainImage.id }"
                  :aria-pressed="img.id === mainImage.id"
                  :aria-label="`${PHOTO_KIND_LABEL[img.kind]} 사진 보기`"
                  @click="selectedImageId = img.id"
                >
                  <img v-if="!thumbFailed[img.id]" :src="img.url" alt="" @error="thumbFailed[img.id] = true" />
                  <ImageOff v-else :size="20" aria-hidden="true" />
                  <span>{{ PHOTO_KIND_LABEL[img.kind] }}<template v-if="worstOf(img.id) >= 2"> · 결함</template></span>
                </button>
              </div>
            </template>
            <StateView v-else state="empty" compact title="등록된 제품 사진이 없습니다" />
          </section>

          <!-- 3. 진단 요약 (AI 원문, 수정 불가) -->
          <section class="card-lite ai-zone" aria-labelledby="h-diag">
            <div class="row between">
              <h3 id="h-diag" class="h">진단 요약</h3>
              <AiBadge v-if="reviewed" kind="human" label="기사 확인 완료" />
              <span v-else class="badge tone-warning">기사 확인 필요</span>
            </div>
            <p class="lbl">AI 예상 원인</p>
            <p class="cause">{{ diagnosis.topCause }}</p>
            <ConfidenceBar :value="diagnosis.confidence" size="sm" />
            <p class="faint note">AI 판단 점수는 확률이나 정확도가 아니라 후보끼리 비교한 점수입니다.</p>
            <p class="lbl">분석 근거</p>
            <ol v-if="evidence.length" class="ev">
              <li v-for="(e, i) in evidence" :key="i">{{ e }}</li>
            </ol>
            <p v-else class="faint">표시할 분석 근거가 없습니다.</p>
          </section>
        </div>

        <!-- 과거 유사 사례 (RAG) — 센터 진단 결과와 같은 목록 -->
        <section class="card-lite" aria-labelledby="h-cases">
          <h3 id="h-cases" class="h">과거 유사 사례</h3>
          <SimilarCasesList :diagnosis="diagnosis" :missing="ragMissing" />
        </section>

        <!-- 기사 수정 (AI 결과와 따로) -->
        <TechnicianEditPanel
          v-if="pre.editing || pre.edit"
          :diagnosis="diagnosis"
          :edit="pre.edit"
          :editing="pre.editing"
          :form="pre.form"
          :errors="pre.errors"
          :show-errors="pre.touched"
          :review="pre.review"
          :reviewed-current="pre.reviewedCurrent"
        />

        <!-- 4. 출장 전 준비 부품 -->
        <PreVisitPartsSection
          :repair-id="repair.id"
          :diagnosis="diagnosis"
          :parts="pre.effectiveParts"
          :edited="!!pre.edit"
          :editing="pre.editing"
          :model="repair.product.model"
          :can-order="!readonly"
          order-hint="방문 완료 건은 발주를 신청할 수 없습니다."
          :show-errors="pre.touched"
          :error="pre.errors.parts"
          :ordering-id="orderingId"
          @update:parts="pre.form.parts = $event"
          @order="askOrder"
        />
      </template>
    </div>

    <template #footer>
      <div class="pv-foot">
        <template v-if="pre.editing">
          <button type="button" class="btn" :disabled="pre.saving" @click="guard(() => undefined)"><X :size="18" aria-hidden="true" /> 수정 취소</button>
          <span class="spacer" />
          <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
          <button type="button" class="btn btn-outline-primary" aria-disabled="true" @click="onConfirm">리포트 확인 완료</button>
          <button type="button" class="btn btn-primary" :disabled="pre.saving" @click="openSave"><Save :size="18" aria-hidden="true" /> {{ pre.saving ? '저장 중…' : '수정 내용 저장' }}</button>
        </template>
        <template v-else>
          <button type="button" class="btn" @click="requestClose">닫기</button>
          <span class="spacer" />
          <button v-if="canEdit" type="button" class="btn btn-outline-primary" :disabled="pre.loading" @click="startEdit"><PencilLine :size="18" aria-hidden="true" /> 수정</button>
          <button
            v-if="confirmKind !== 'hidden' && !(readonly && confirmKind !== 'done')"
            type="button"
            class="btn btn-primary"
            :disabled="confirmKind !== 'ready' || busy || pre.reviewing"
            @click="onConfirm"
          >
            <CircleCheck :size="18" aria-hidden="true" /> {{ confirmKind === 'done' ? '확인 완료됨' : '리포트 확인 완료' }}
          </button>
        </template>
      </div>
    </template>
  </BaseModal>

  <!-- 확인 창들 (모달 위 모달: ESC 는 맨 위 것만) -->
  <BaseModal :open="confirmDlg" title="리포트 확인 완료" :width="440" @close="confirmDlg = false">
    <p>이 출장 전 리포트를 확인 완료로 기록하시겠습니까?</p>
    <p class="faint">기사 확인(TECHNICIAN_REVIEWED)으로만 기록되며, 최종 수리 완료나 리포트 확정이 아닙니다.</p>
    <template #footer>
      <button type="button" class="btn" :disabled="busy" @click="confirmDlg = false">취소</button>
      <button type="button" class="btn btn-primary" :disabled="busy" @click="doConfirm"><Loader2 v-if="busy" :size="18" class="spin" /><CircleCheck v-else :size="18" /> 확인 완료</button>
    </template>
  </BaseModal>
  <BaseModal :open="orderDlg.open" title="발주 신청" :width="440" @close="orderDlg.open = false">
    <p><b>{{ orderDlg.name }}</b> {{ orderDlg.qty }}개를 발주 신청하시겠습니까?</p>
    <p class="faint">본사 품질 담당자가 승인해야 발주가 진행됩니다. (출고 창고: {{ orderDlg.warehouse || '-' }})</p>
    <template #footer>
      <button type="button" class="btn" :disabled="!!orderingId" @click="orderDlg.open = false">취소</button>
      <button type="button" class="btn btn-danger" :disabled="!!orderingId" @click="doOrder"><Loader2 v-if="orderingId" :size="18" class="spin" /> 발주 신청</button>
    </template>
  </BaseModal>
  <BaseModal :open="saveDlg" title="수정 내용 저장" :width="440" @close="saveDlg = false">
    <p>수정한 리포트 내용을 저장하시겠습니까?</p>
    <template #footer>
      <button type="button" class="btn" :disabled="pre.saving" @click="saveDlg = false">취소</button>
      <button type="button" class="btn btn-primary" :disabled="pre.saving" @click="doSave"><Save :size="18" /> 저장</button>
    </template>
  </BaseModal>
  <BaseModal :open="discard.open" title="수정 취소" :width="440" @close="discard.open = false">
    <p>저장하지 않은 수정 내용이 있습니다. 수정을 취소하시겠습니까?</p>
    <template #footer>
      <button type="button" class="btn btn-primary" @click="discard.open = false">계속 수정</button>
      <button type="button" class="btn" @click="confirmDiscard">수정 취소</button>
    </template>
  </BaseModal>
</template>

<style scoped>
.head-meta {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-2);
}
.pv {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px 18px;
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.si {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.si svg {
  color: var(--primary);
  flex: none;
}
.si .k {
  color: var(--text-3);
  font-size: var(--fs-sm);
}
.si.sym {
  grid-column: 1 / -1;
}
.ro-note {
  margin: 0;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.card-lite {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  min-width: 0;
}
.card-lite.ai-zone {
  border: 2px dashed var(--ai-border);
}
.h {
  margin: 0;
  font-size: var(--fs-md);
}
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.thumb {
  display: grid;
  justify-items: center;
  gap: 4px;
  width: 92px;
  padding: 4px;
  border: 2px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.thumb img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
}
.thumb svg {
  height: 60px;
}
.thumb.on {
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 700;
}
.thumb:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 1px;
}
.lbl {
  margin: 4px 0 0;
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
.ev {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 4px;
}
.pv-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.notice {
  margin: 0;
  color: var(--danger);
  font-weight: 600;
  font-size: var(--fs-sm);
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 480px) {
  .summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .pv-foot .btn {
    flex: 1 1 100%;
    justify-content: center;
  }
  .pv-foot .spacer {
    display: none;
  }
}
</style>
