/* 출장 전 진단 리포트 — 기사 수정 모드 상태
 *  AI 원본(Diagnosis)은 읽기만 하고, 기사 수정안은 preVisitApi 로 따로 저장한다.
 *  수정 시작 시 마지막 저장본(없으면 AI 초안 값)으로 폼을 채우고, 저장하지 않은 변경(dirty)을 추적한다.
 *  FEATURES.preVisitReportEdit 가 false 면 불러오지도 않는다 (수정 버튼 숨김) */
import { computed, reactive, ref, watch, type Ref } from 'vue'
import { preVisitApi, toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import type { Diagnosis, PreVisitReport } from '@/types'

export const PRE_VISIT_TEXT_MAX = 1000

interface EditForm {
  suspectedCauseComment: string
  inspectionPlan: string
  repairMethod: string
  technicianMemo: string
  parts: { partId: string; quantity: number }[]
}

export function usePreVisitEdit(repairId: Ref<number | undefined>, diagnosis: Ref<Diagnosis | null | undefined>) {
  const enabled = FEATURES.preVisitReportEdit
  const report = ref<PreVisitReport | null>(null)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const editing = ref(false)
  const saving = ref(false)
  const reviewing = ref(false)
  const touched = ref(false)

  const form = reactive<EditForm>({ suspectedCauseComment: '', inspectionPlan: '', repairMethod: '', technicianMemo: '', parts: [] })
  let snapshot = ''
  const serialize = () => JSON.stringify(form)

  async function load() {
    if (!enabled || !repairId.value) return
    loading.value = true
    loadError.value = null
    try {
      report.value = await preVisitApi.get(repairId.value)
    } catch (e) {
      loadError.value = toErrorMessage(e)
    } finally {
      loading.value = false
    }
  }
  watch(repairId, () => {
    editing.value = false
    void load()
  }, { immediate: true })

  const edit = computed(() => report.value?.technicianEdit ?? null)
  const editVersion = computed(() => edit.value?.version ?? 0)
  const review = computed(() => report.value?.review ?? null)
  /** 지금 수정본(또는 AI 원본)을 기사가 확인했는지 */
  const reviewedCurrent = computed(() => !!review.value && review.value.editVersion === editVersion.value)

  /** AI 초안 부품 (수량 포함) */
  const aiParts = computed(() => (diagnosis.value?.parts ?? []).map((p) => ({ partId: p.partId, quantity: p.quantity })))
  /** 화면·발주에 쓰는 부품: 수정 중이면 폼, 저장된 수정안이 있으면 그것, 아니면 AI 초안 */
  const effectiveParts = computed(() => (editing.value ? form.parts : (edit.value?.parts ?? aiParts.value)))

  function startEdit() {
    const d = diagnosis.value
    const e = edit.value
    Object.assign(form, {
      suspectedCauseComment: e?.suspectedCauseComment ?? '',
      inspectionPlan: e?.inspectionPlan ?? (d?.inspectionSteps ?? []).join('\n'),
      repairMethod: e?.repairMethod ?? (d?.repairMethod ?? []).join('\n'),
      technicianMemo: e?.technicianMemo ?? '',
      parts: (e?.parts ?? aiParts.value).map((p) => ({ ...p })),
    })
    snapshot = serialize()
    touched.value = false
    editing.value = true
  }
  const dirty = computed(() => editing.value && serialize() !== snapshot)
  /** 마지막 저장 상태로 되돌리고 수정 모드 종료 */
  function cancelEdit() {
    editing.value = false
    touched.value = false
  }

  const errors = computed(() => {
    const long = (v: string) => (v.trim().length > PRE_VISIT_TEXT_MAX ? `${PRE_VISIT_TEXT_MAX}자 이하로 입력해 주세요.` : null)
    return {
      suspectedCauseComment: long(form.suspectedCauseComment),
      inspectionPlan: long(form.inspectionPlan),
      repairMethod: long(form.repairMethod),
      technicianMemo: long(form.technicianMemo),
      parts: form.parts.some((p) => !Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 99) ? '부품 수량은 1~99개로 입력해 주세요.' : null,
    }
  })
  const valid = computed(() => Object.values(errors.value).every((v) => !v))

  async function save() {
    if (!repairId.value || saving.value) return
    saving.value = true
    try {
      report.value = await preVisitApi.saveEdit(repairId.value, {
        expectedVersion: editVersion.value,
        diagnosisVersion: diagnosis.value?.version ?? 0,
        suspectedCauseComment: form.suspectedCauseComment,
        inspectionPlan: form.inspectionPlan,
        repairMethod: form.repairMethod,
        technicianMemo: form.technicianMemo,
        parts: form.parts.map((p) => ({ partId: p.partId, quantity: Number(p.quantity) })),
      })
      editing.value = false
    } finally {
      saving.value = false
    }
  }

  /** 기사 리포트 확인(TECHNICIAN_REVIEWED) 기록 — 최종 수리 확정 아님 */
  async function markReviewed() {
    if (!enabled || !repairId.value || reviewing.value) return
    reviewing.value = true
    try {
      report.value = await preVisitApi.markReviewed(repairId.value, editVersion.value)
    } finally {
      reviewing.value = false
    }
  }

  return { enabled, report, loading, loadError, load, editing, saving, reviewing, touched, form, edit, editVersion, review, reviewedCurrent, aiParts, effectiveParts, startEdit, cancelEdit, dirty, errors, valid, save, markReviewed }
}
