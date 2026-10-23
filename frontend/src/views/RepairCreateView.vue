<script setup lang="ts">
/* 신규 수리 접수 (기사 전용 · 직원 레이아웃) — 5단계 스텝 폼. 고객용 고장 접수(/service/request)와는 다른 화면
 *  ① 제품 정보 (시리얼 조회 · 라벨 사진 인식 · 제품 종류 · 제조사 · 모델명 · 구매일)
 *  ② 고장 증상 (증상 칩 + 직접 입력 · 발생 시점·조건 · 에러 코드 · 기사 소견)  ③ 사진 올리기 (촬영 가이드 · 품질 검사)
 *  ④ 고객·방문 정보 (센터/출장 수리 · 고객 · 주소 검색 · 희망 방문일)  ⑤ 확인 및 접수 (최종 확인 · 동의 · 담당 기사) → 접수 완료
 *  입력값(사진 제외)은 탭을 닫기 전까지 sessionStorage 에 보관 — 새로고침해도 유지, 접수 완료 시 삭제
 * 방문 정보·동의는 고객 개인정보라 AI 입력(userInput)에는 넣지 않는다. Mock 에만 저장, 실서버는 FEATURES.visitInfo 로 켬 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Send, X, Loader2, ScanLine, Pencil, ShieldCheck, MapPin, List, TriangleAlert } from 'lucide-vue-next'
import StepIndicator from '@/components/repair/StepIndicator.vue'
import ProductInfoFields from '@/components/repair/ProductInfoFields.vue'
import AddressSearchField from '@/components/address/AddressSearchField.vue'
import { DETAIL_ADDRESS_MAX, emptyVisitAddress, normalizeVisitAddress, toAddressLine } from '@/api/adapters/address'
import { PRODUCT_TYPE_LABEL, type ProductType } from '@/constants/products'
import ImageUploader from '@/components/repair/ImageUploader.vue'
import PhotoGuide from '@/components/repair/PhotoGuide.vue'
import SameSerialHistory from '@/components/repair/SameSerialHistory.vue'
import { repairApi, toErrorMessage, USE_MOCK } from '@/api'
import { useToastStore } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import ServiceTypeChangeModal from '@/components/repair/ServiceTypeChangeModal.vue'
import { SERVICE_TYPE_LABEL, type ServiceType } from '@/constants/serviceType'
import { PHOTO_KIND_LABEL, PHOTO_LIMIT } from '@/constants/status'
import type { PhotoKind, PrivacyConsent, ProductInfo, VisitAddress, VisitInfo } from '@/types'
import type { QualitySummary, UploadItem } from '@/types/upload'
import { formatDate, repairId } from '@/utils/format'

const toast = useToastStore()
const STEPS = ['제품 정보', '고장 증상', '사진 올리기', '고객·방문 정보', '확인 및 접수']
const LAST = STEPS.length - 1
const step = ref(0)

const form = reactive({
  serial: '',
  /** 시리얼 조회 결과 (공장·펌웨어 등 추가 정보). 없어도 아래 칸을 직접 입력해 접수할 수 있다 */
  product: null as ProductInfo | null,
  productType: '' as ProductType | '',
  productTypeDetail: '',
  manufacturer: '',
  model: '',
  /** 자주 있는 증상 칩 (여러 개 선택) */
  symptomChips: [] as string[],
  /** 직접 입력한 증상 */
  symptomText: '',
  /** 증상 발생 시점 · 조건 (예: 청소 시작 3분 후 · 물걸레 장착 시) */
  occurrence: '',
  errorCodes: [] as string[],
  technicianNote: '',
})
/** 출장 방문 정보 (고객 개인정보) */
const auth = useAuthStore()
/** 수리 방법: 고객이 고른 값을 이어받는다 — 기사 접수는 접수 기사 유형을 기본값으로 (출장기사 → 방문 수리, 센터 수리자 → 센터 방문)
 *  입력란 대신 배지로 보여 주고, 바꿀 때만 [수리 방법 변경](사유 필수 · 접수 시 이력 기록) */
const DEFAULT_SERVICE: ServiceType = auth.technicianType === 'FIELD' ? 'VISIT' : 'CENTER'
const visit = reactive<Omit<VisitInfo, 'purchaseDate' | 'address'>>({ customerName: '', phone: '', preferredDate: '', serviceType: DEFAULT_SERVICE })
// 센터 수리자 기본값: 자기 센터
if (DEFAULT_SERVICE === 'CENTER') visit.centerName = auth.user?.branch
const serviceChange = ref<{ from: ServiceType; reason: string } | null>(null)
const serviceModal = ref(false)
function onServiceChange(v: { serviceType: ServiceType; centerId?: string; centerName?: string; reason: string }) {
  serviceChange.value = { from: serviceChange.value?.from ?? (visit.serviceType ?? DEFAULT_SERVICE), reason: v.reason }
  Object.assign(visit, { serviceType: v.serviceType, centerId: v.centerId, centerName: v.centerName })
  serviceModal.value = false
}
/** 방문 주소 (구조화 · 주소 검색) — 서버에는 한 줄 주소(toAddressLine)와 함께 보낸다 */
const visitAddress = ref<VisitAddress>(emptyVisitAddress())
watch(() => form.productType, (v) => v !== 'unknown' && (form.productTypeDetail = ''))
/** 구매일 — 무상 수리 여부 확인용. "모름" 이면 null 로 저장 */
const purchaseDate = ref('')
const purchaseUnknown = ref(false)
const agreed = ref(false)

/** 접수 사진 2종: PCB · 기계·찌그러짐(모터·외관 변형 등). 칸별 5장, 전체 10장 */
const PHOTO_KINDS = ['PCB', 'MOTOR'] as const
const photos = reactive<Record<(typeof PHOTO_KINDS)[number], UploadItem[]>>({ PCB: [], MOTOR: [] })
const touched = reactive([false, false, false, false, false])
const totalPhotos = computed(() => photos.PCB.length + photos.MOTOR.length)

/* ---------- ③ 사진 품질 검사 (FEATURES.photoQualityCheck 가 꺼져 있으면 항상 0) ---------- */
// US-03: PENDING 이면 진단 요청 불가 · FAILED 는 재촬영 · WARNING 은 사진마다 [현재 사진 사용](확인자·시각 기록) 또는 [재촬영]
const EMPTY_Q: QualitySummary = { checking: 0, problems: 0, failed: 0, unacked: 0, records: {} }
const quality = reactive<Record<(typeof PHOTO_KINDS)[number], QualitySummary>>({ PCB: { ...EMPTY_Q }, MOTOR: { ...EMPTY_Q } })
const qChecking = computed(() => quality.PCB.checking + quality.MOTOR.checking)
const qProblems = computed(() => quality.PCB.problems + quality.MOTOR.problems)
const qFailed = computed(() => quality.PCB.failed + quality.MOTOR.failed)
const qUnacked = computed(() => quality.PCB.unacked + quality.MOTOR.unacked)
const qWait = ref(false)
watch(qChecking, (n) => !n && (qWait.value = false))
/** 사진 단계를 넘어가도 되는지: 검사 중이면 기다리게, 확인이 필요한 사진이 있으면 사진 칸으로 안내 */
function photosReady(): boolean {
  if (qChecking.value) {
    qWait.value = true
    return false
  }
  if (qProblems.value) {
    void nextTick(() => document.querySelector('.problem')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    return false
  }
  return true
}

/* ---------- ① 제품 정보: 시리얼 조회 · 라벨 사진 · 보증 기간 안내는 공통 ProductInfoFields 가 처리 ---------- */

/* ---------- ② 증상 · 에러코드 ---------- */
const SYMPTOMS = ['청소 중 큰 소음', '주행 중 멈춤', '한쪽으로만 회전', '충전 안 됨', '전원 안 켜짐', '흡입력 약함', '물걸레 작동 안 함', '바퀴 헛돎']
function toggleChip(s: string) {
  form.symptomChips = form.symptomChips.includes(s) ? form.symptomChips.filter((x) => x !== s) : [...form.symptomChips, s]
}
/** 서버로 보내는 증상 = 선택한 칩 + 직접 입력 */
const symptom = computed(() => {
  const base = [...form.symptomChips, form.symptomText.trim()].filter(Boolean).join(', ')
  const when = form.occurrence.trim()
  return when ? `${base} (발생: ${when})` : base
})

const codeInput = ref('')
const codeError = ref<string | null>(null)
const COMMON_CODES = ['E103', 'E105', 'E210', 'E302', 'E401', 'E501']
function addCode(c?: string) {
  const v = (c ?? codeInput.value).trim().toUpperCase()
  codeError.value = null
  if (!v) return
  if (!/^E\d{3}$/.test(v)) {
    codeError.value = '에러 코드는 E + 숫자 3자리입니다. (예: E103)'
    return
  }
  if (!form.errorCodes.includes(v)) form.errorCodes.push(v)
  codeInput.value = ''
}

/* ---------- ④ 방문 정보 ---------- */
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/


/* ---------- 검증 ---------- */
const errs = computed(() => ({
  serial: !form.serial.trim() ? '시리얼 번호를 입력해 주세요.' : !/^[A-Za-z0-9-]{4,30}$/.test(form.serial.trim()) ? '시리얼 번호는 영문·숫자로 입력해 주세요.' : null,
  manufacturer: !form.manufacturer.trim() ? '제조사를 입력해 주세요.' : null,
  model: !form.model.trim() ? '모델명을 입력하거나 시리얼로 조회해 주세요.' : null,
  typeDetail: form.productType === 'unknown' && !form.productTypeDetail.trim() ? '제품 종류를 입력해 주세요.' : null,
  symptom: !form.symptomChips.length && form.symptomText.trim().length < 5 ? '증상을 하나 이상 고르거나 5자 이상 직접 입력해 주세요.' : null,
  // 에러 코드는 선택. 입력란에 쓰고 [추가]를 안 누른 코드만 확인
  codes: codeInput.value.trim() ? '입력한 에러 코드를 [추가]로 등록하거나 지워 주세요.' : null,
  note: form.technicianNote.length > 1000 ? '기사 소견은 1000자까지 입력할 수 있습니다.' : null,
  photos: PHOTO_KINDS.filter((k) => !photos[k].length),
  photoTotal: totalPhotos.value > PHOTO_LIMIT.total ? `사진은 전체 ${PHOTO_LIMIT.total}장까지 등록할 수 있습니다. (현재 ${totalPhotos.value}장)` : null,
  name: !visit.customerName.trim() ? '고객 이름을 입력해 주세요.' : null,
  phone: !PHONE_RE.test(visit.phone.trim()) ? '연락처를 숫자로 입력해 주세요. (예: 010-1234-5678)' : null,
  address: !visitAddress.value.roadAddress.trim() ? '방문 주소를 검색해 주세요.' : null,
  detailAddress: !visitAddress.value.roadAddress.trim()
    ? null
    : !visitAddress.value.detailAddress.trim()
      ? '상세주소를 입력해 주세요.'
      : visitAddress.value.detailAddress.trim().length > DETAIL_ADDRESS_MAX
        ? `상세주소는 ${DETAIL_ADDRESS_MAX}자 이하로 입력해 주세요.`
        : null,
  date: !visit.preferredDate ? '희망 방문일을 골라 주세요.' : visit.preferredDate < today ? '오늘 이후 날짜를 골라 주세요.' : null,
  purchase: purchaseUnknown.value ? null : !purchaseDate.value ? '구매일을 골라 주세요. 모르면 "구매일을 몰라요"를 체크해 주세요.' : purchaseDate.value > today ? '오늘 이후 날짜는 고를 수 없어요.' : null,
  consent: !agreed.value ? '개인정보 수집·이용에 동의해 주세요.' : null,
}))
const stepValid = computed(() => {
  const e = errs.value
  return [
    !e.serial && !e.manufacturer && !e.model && !e.typeDetail && !e.purchase,
    !e.symptom && !e.codes && !e.note,
    !e.photos.length && !e.photoTotal,
    !e.name && !e.phone && !e.address && !e.detailAddress && !e.date,
    !e.consent,
  ]
})

function next() {
  touched[step.value] = true
  if (!stepValid.value[step.value]) {
    document.querySelector<HTMLElement>('[aria-invalid="true"], .invalid')?.focus()
    return
  }
  if (step.value === 2 && !photosReady()) return
  step.value = Math.min(LAST, step.value + 1)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function prev() {
  step.value = Math.max(0, step.value - 1)
}
function goStep(i: number) {
  step.value = i
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ---------- 제출: 접수 생성 → 사진 업로드 → 진단 요청 → 접수 완료 화면 ---------- */
const submit = reactive({ running: false, phase: '' as '' | 'create' | 'upload' | 'request' | 'done', uploaded: 0, error: null as string | null, repairId: null as number | null, receiptNo: '' })

async function doSubmit() {
  touched.fill(true)
  const bad = stepValid.value.findIndex((v) => !v)
  if (bad >= 0) {
    if (bad !== step.value) goStep(bad)
    return
  }
  if (!photosReady()) {
    goStep(2)
    return
  }
  submit.running = true
  submit.error = null
  const consent: PrivacyConsent = { agreed: true, agreedAt: new Date().toISOString(), version: 'v1' }
  const addr = normalizeVisitAddress(visitAddress.value)
  const visitInfo: VisitInfo = { customerName: visit.customerName.trim(), phone: visit.phone.trim(), address: toAddressLine(addr), visitAddress: addr, preferredDate: visit.preferredDate, purchaseDate: purchaseUnknown.value ? null : purchaseDate.value, serviceType: visit.serviceType, centerId: visit.centerId, centerName: visit.centerName }
  try {
    const req = { product: buildProduct(), symptom: symptom.value, technicianNote: form.technicianNote.trim() || undefined, errorCodes: form.errorCodes, visitInfo, consent, ...(serviceChange.value ? { serviceTypeChange: serviceChange.value } : {}) }
    if (!USE_MOCK) {
      // 실서버: 접수 정보 + 사진을 multipart 한 번으로 보내고(202), 서버가 진단 작업까지 만든다
      submit.phase = 'create'
      const files = PHOTO_KINDS.flatMap((kind) => photos[kind].map((p) => ({ kind: kind as PhotoKind, file: p.file })))
      const { repairId: id } = await repairApi.intake(req, files)
      submit.repairId = id
      // 접수번호(case_number)는 접수 응답에 없어 상세를 한 번 조회. 실패해도 접수는 완료된 상태
      submit.receiptNo = await repairApi.get(id).then((r) => r.receiptNo).catch(() => '')
    } else {
      if (!submit.repairId) {
        submit.phase = 'create'
        const r = await repairApi.create(req)
        submit.repairId = r.id
        submit.receiptNo = r.receiptNo
      }
      submit.phase = 'upload'
      submit.uploaded = 0
      // 재시도 시에도 같은 접수 건에 업로드 (중복 접수 방지)
      for (const kind of PHOTO_KINDS) {
        for (const p of photos[kind]) {
          await repairApi.uploadImage(submit.repairId, { kind: kind as PhotoKind, file: p.file, dataUrl: p.dataUrl, quality: quality[kind].records[p.id] })
          submit.uploaded++
        }
      }
      submit.phase = 'request'
      await repairApi.submit(submit.repairId)
    }
    submit.phase = 'done'
    dirty.value = false
    clearDraft()
    toast.success(`수리 ID ${repairId(submit.repairId!)} 로 접수되었습니다. AI 분석을 시작합니다.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e) {
    submit.error = toErrorMessage(e)
  } finally {
    submit.running = false
  }
}

/** 접수에 보낼 제품 정보: 조회 결과가 있으면 그 위에, 없으면 직접 입력한 값으로 */
function buildProduct(): ProductInfo {
  const model = form.model.trim()
  const type = form.productType || undefined
  const typeLabel = form.productType === 'unknown' ? form.productTypeDetail.trim() : form.productType ? PRODUCT_TYPE_LABEL[form.productType] : ''
  const base: ProductInfo = form.product ?? { serialNumber: '', model, modelName: '', manufacturedAt: '', factory: '', warrantyUntil: '', firmware: '' }
  return {
    ...base,
    serialNumber: form.serial.trim().toUpperCase(),
    model,
    modelName: form.product && form.product.model === model ? form.product.modelName : [typeLabel, model].filter(Boolean).join(' '),
    manufacturer: form.manufacturer.trim(),
    productType: type,
    ...(form.productType === 'unknown' ? { productTypeDetail: form.productTypeDetail.trim() } : {}),
  }
}

/* ---------- 새로고침해도 입력 유지 (사진 파일은 저장할 수 없어 제외) ---------- */
const DRAFT_KEY = 'robotcare-intake-draft'
function restoreDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null')
    if (!d) return
    Object.assign(form, d.form ?? {})
    Object.assign(visit, d.visit ?? {})
    visitAddress.value = { ...emptyVisitAddress(), ...(d.visitAddress ?? {}) }
    purchaseDate.value = d.purchaseDate ?? ''
    purchaseUnknown.value = !!d.purchaseUnknown
    step.value = Math.min(LAST, Math.max(0, Number(d.step) || 0))
  } catch {
    /* 저장소를 못 쓰면 새로 시작 */
  }
}
function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, visit, visitAddress: visitAddress.value, purchaseDate: purchaseDate.value, purchaseUnknown: purchaseUnknown.value, step: step.value }))
  } catch {
    /* noop */
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    /* noop */
  }
}
restoreDraft()

/* ---------- 작성 중 이탈 방지 ---------- */
const dirty = ref(false)
watch([form, photos, visit, visitAddress, agreed, purchaseDate, purchaseUnknown], () => (dirty.value = true), { deep: true })
watch([form, visit, visitAddress, purchaseDate, purchaseUnknown, step], () => submit.phase !== 'done' && saveDraft(), { deep: true })
onBeforeRouteLeave(() => (!dirty.value || submit.phase === 'done' ? true : window.confirm('작성 중인 접수 내용이 사라집니다. 나가시겠습니까?')))
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>신규 수리 접수</h1>
        <p class="sub">필수 정보를 입력하면 AI 가 PCB·모터 분석을 자동으로 시작합니다.</p>
      </div>
    </div>

    <!-- ========== 접수 완료 ========== -->
    <section v-if="submit.phase === 'done'" class="card done" aria-live="polite">
      <CircleCheck :size="56" class="done-ic" aria-hidden="true" />
      <h2>접수가 완료되었습니다</h2>
      <p class="muted">AI 분석을 시작했습니다. 결과가 나오면 알림으로 알려 드립니다.</p>
      <dl class="receipt">
        <div v-if="submit.receiptNo">
          <dt>접수번호</dt>
          <dd class="mono rn">{{ submit.receiptNo }}</dd>
        </div>
        <div>
          <dt>수리 ID</dt>
          <dd class="mono">{{ repairId(submit.repairId!) }}</dd>
        </div>
        <div>
          <dt>희망 방문일</dt>
          <dd>{{ formatDate(visit.preferredDate) }}</dd>
        </div>
      </dl>
      <p class="faint">고객에게 접수번호를 안내해 주세요.</p>
      <div class="row center">
        <RouterLink to="/repairs" class="btn btn-lg"><List :size="20" /> 수리 접수 관리로</RouterLink>
        <RouterLink :to="`/repairs/${submit.repairId}/progress`" class="btn btn-primary btn-lg">진행 상황 보기 <ArrowRight :size="20" /></RouterLink>
      </div>
    </section>

    <template v-else>
      <StepIndicator :steps="STEPS" :current="step" :style="{ '--n': STEPS.length }" />

      <!-- ========== ① 제품 정보 ========== -->
      <section v-show="step === 0" class="card card-pad stack" aria-labelledby="s1">
        <h2 id="s1" class="section-title">① 제품 정보</h2>
        <ProductInfoFields
          v-model:serial="form.serial"
          v-model:product-type="form.productType"
          v-model:product-type-detail="form.productTypeDetail"
          v-model:manufacturer="form.manufacturer"
          v-model:model="form.model"
          v-model:purchase-date="purchaseDate"
          v-model:purchase-unknown="purchaseUnknown"
          v-model:product="form.product"
          id-prefix="t"
          :errors="errs"
          :show-errors="touched[0]"
          label-ocr
          demo-hint
        />

        <div v-if="form.product" class="prod card" aria-live="polite">
          <div class="row between">
            <strong class="pn">{{ form.product.modelName }}</strong>
            <span class="badge tone-success"><CircleCheck :size="15" /> 제품 확인됨</span>
          </div>
          <dl class="kv cols">
            <div><dt>모델</dt><dd>{{ form.product.model }}</dd></div>
            <div><dt>생산 공장</dt><dd>{{ form.product.factory || '-' }}</dd></div>
            <div><dt>제조일</dt><dd>{{ form.product.manufacturedAt ? formatDate(form.product.manufacturedAt) : '-' }}</dd></div>
            <div><dt>펌웨어</dt><dd>{{ form.product.firmware || '-' }}</dd></div>
          </dl>
        </div>
        <SameSerialHistory v-if="form.product" :serial="form.product.serialNumber" compact new-tab />
      </section>

      <!-- ========== ② 고장 증상 ========== -->
      <section v-show="step === 1" class="card card-pad stack" aria-labelledby="s2">
        <h2 id="s2" class="section-title">② 고장 증상</h2>
        <div class="field">
          <span id="chips-label" class="label req">고객이 설명한 증상</span>
          <div class="chips" role="group" aria-labelledby="chips-label">
            <button v-for="s in SYMPTOMS" :key="s" type="button" class="chip" :aria-pressed="form.symptomChips.includes(s)" @click="toggleChip(s)">
              <CircleCheck v-if="form.symptomChips.includes(s)" :size="16" aria-hidden="true" /> {{ s }}
            </button>
          </div>
          <label for="symptom" class="sub-label">직접 입력 <span class="faint">(칩에 없는 증상이나 자세한 상황)</span></label>
          <textarea id="symptom" v-model="form.symptomText" class="textarea" :class="{ invalid: touched[1] && errs.symptom }" placeholder="예) 청소 도중 큰 소음이 나고 2~3분 뒤 멈춤" :aria-invalid="touched[1] && !!errs.symptom" />
          <p v-if="touched[1] && errs.symptom" class="error-text"><CircleAlert :size="16" /> {{ errs.symptom }}</p>
        </div>

        <div class="field">
          <label for="occurrence">증상 발생 시점 및 조건 <span class="faint">(선택)</span></label>
          <input id="occurrence" v-model="form.occurrence" class="input" maxlength="200" placeholder="예) 청소 시작 3분 후 · 물걸레 모듈 장착 시 · 매번 발생" />
        </div>

        <div class="field">
          <label for="code">에러 코드 <span class="faint">(선택)</span></label>
          <p class="help">제품에 표시된 코드가 있으면 추가해 주세요. 없으면 비워 두고 다음 단계로 넘어가도 됩니다.</p>
          <div class="row nowrap">
            <input id="code" v-model="codeInput" class="input mono" placeholder="E103" maxlength="4" @keydown.enter.prevent="addCode()" />
            <button type="button" class="btn btn-lg" @click="addCode()">추가</button>
          </div>
          <div class="quick">
            <span class="faint">자주 나오는 코드</span>
            <button v-for="c in COMMON_CODES" :key="c" type="button" class="btn btn-sm mono" :disabled="form.errorCodes.includes(c)" @click="addCode(c)">{{ c }}</button>
          </div>
          <div v-if="form.errorCodes.length" class="codes" aria-label="입력한 에러 코드">
            <span v-for="c in form.errorCodes" :key="c" class="badge tone-info code">
              <span class="mono">{{ c }}</span>
              <button type="button" :aria-label="`${c} 삭제`" @click="form.errorCodes = form.errorCodes.filter((x) => x !== c)"><X :size="14" /></button>
            </span>
          </div>
          <p v-if="codeError" class="error-text"><CircleAlert :size="16" /> {{ codeError }}</p>
          <p v-else-if="touched[1] && errs.codes" class="error-text"><CircleAlert :size="16" /> {{ errs.codes }}</p>
        </div>

        <div class="field">
          <label for="tech-note">기사 소견 <span class="faint">(선택)</span></label>
          <p class="help">직접 보고 판단한 내용을 자유롭게 적어 주세요. AI 분석에 함께 사용됩니다.</p>
          <textarea id="tech-note" v-model="form.technicianNote" class="textarea" :class="{ invalid: !!errs.note }" maxlength="1000" placeholder="예) 하우징 아래쪽이 눌린 흔적이 있고, 바퀴를 손으로 돌리면 걸리는 느낌이 있음" :aria-invalid="!!errs.note" />
          <p class="faint count">{{ form.technicianNote.length }} / 1000</p>
          <p v-if="errs.note" class="error-text"><CircleAlert :size="16" /> {{ errs.note }}</p>
        </div>
      </section>

      <!-- ========== ③ 사진 올리기 ========== -->
      <section v-show="step === 2" class="card card-pad stack" aria-labelledby="s3">
        <h2 id="s3" class="section-title">③ 사진 올리기</h2>
        <p class="muted">아래 그림처럼 찍어 주세요. 사진이 흐리면 AI 가 추가 사진을 요청할 수 있습니다.</p>
        <div class="grid-2">
          <div class="stack">
            <PhotoGuide kind="PCB" />
            <ImageUploader v-model="photos.PCB" label="PCB 사진" description="보드 전체가 정면으로 보이게" required quality-target="PCB" example-src="/mock/pcb.svg" :max="PHOTO_LIMIT.perKind" :invalid="touched[2] && !photos.PCB.length" @quality="quality.PCB = $event" />
          </div>
          <div class="stack">
            <PhotoGuide kind="MOTOR" />
            <ImageUploader v-model="photos.MOTOR" label="기계·찌그러짐·외관 사진" description="모터·하우징·외관 변형 부위가 보이게" required quality-target="MOTOR" example-src="/mock/motor.svg" :max="PHOTO_LIMIT.perKind" :invalid="touched[2] && !photos.MOTOR.length" @quality="quality.MOTOR = $event" />
          </div>
        </div>
        <p v-if="touched[2] && errs.photos.length" class="error-text" role="alert">
          <CircleAlert :size="16" /> {{ errs.photos.map((k) => `${PHOTO_KIND_LABEL[k]} 사진`).join(', ') }}을(를) 등록해 주세요.
        </p>
        <p v-if="errs.photoTotal" class="error-text" role="alert"><CircleAlert :size="16" /> {{ errs.photoTotal }}</p>
        <p class="faint">칸별 최대 {{ PHOTO_LIMIT.perKind }}장, 전체 최대 {{ PHOTO_LIMIT.total }}장</p>
      </section>

      <!-- ========== ④ 고객 · 방문 정보 ========== -->
      <section v-show="step === 3" class="card card-pad stack" aria-labelledby="s4">
        <h2 id="s4" class="section-title">④ 고객 · 방문 정보</h2>
        <p class="muted"><MapPin :size="16" class="inline-ic" /> 고객 연락과 방문 일정에 쓰는 정보입니다. 이 정보는 AI 분석에 사용되지 않습니다.</p>
        <div class="field">
          <span class="label">수리 방법</span>
          <div class="row">
            <span class="badge tone-info">{{ SERVICE_TYPE_LABEL[visit.serviceType ?? DEFAULT_SERVICE] }}</span>
            <span v-if="visit.serviceType === 'CENTER' && visit.centerName" class="faint">{{ visit.centerName }}</span>
            <button type="button" class="btn btn-sm btn-ghost" aria-haspopup="dialog" @click="serviceModal = true">수리 방법 변경</button>
          </div>
          <p v-if="serviceChange" class="help">변경 사유: {{ serviceChange.reason }} (접수하면 처리 이력에 기록)</p>
        </div>
        <ServiceTypeChangeModal :open="serviceModal" :current="visit.serviceType ?? DEFAULT_SERVICE" :current-center-id="visit.centerId" :product-type="form.productType" @close="serviceModal = false" @submit="onServiceChange" />
        <div class="grid-2">
          <div class="field">
            <label for="v-name" class="req">고객 이름</label>
            <input id="v-name" v-model="visit.customerName" class="input" :class="{ invalid: touched[3] && errs.name }" maxlength="30" autocomplete="off" placeholder="예) 홍길동" :aria-invalid="touched[3] && !!errs.name" />
            <p v-if="touched[3] && errs.name" class="error-text"><CircleAlert :size="16" /> {{ errs.name }}</p>
          </div>
          <div class="field">
            <label for="v-phone" class="req">연락처</label>
            <input id="v-phone" v-model="visit.phone" class="input" :class="{ invalid: touched[3] && errs.phone }" type="tel" inputmode="tel" maxlength="13" autocomplete="off" placeholder="010-1234-5678" :aria-invalid="touched[3] && !!errs.phone" />
            <p v-if="touched[3] && errs.phone" class="error-text"><CircleAlert :size="16" /> {{ errs.phone }}</p>
          </div>
        </div>
        <AddressSearchField v-model="visitAddress" id-prefix="v-addr" :address-error="touched[3] ? errs.address : null" :detail-error="touched[3] ? errs.detailAddress : null" />
        <div class="field date-field">
          <label for="v-date" class="req">{{ visit.serviceType === 'CENTER' ? '센터 방문 예정일' : '희망 방문일' }}</label>
          <input id="v-date" v-model="visit.preferredDate" class="input" :class="{ invalid: touched[3] && errs.date }" type="date" :min="today" :aria-invalid="touched[3] && !!errs.date" />
          <p v-if="touched[3] && errs.date" class="error-text"><CircleAlert :size="16" /> {{ errs.date }}</p>
        </div>
      </section>

      <!-- ========== ⑤ 확인 및 접수 ========== -->
      <section v-show="step === 4" class="stack" aria-labelledby="s5">
        <div class="card card-pad stack">
          <h2 id="s5" class="section-title">⑤ 확인 및 접수</h2>
          <dl class="kv review">
            <dt>제품</dt>
            <dd>
              {{ [form.productType === 'unknown' ? form.productTypeDetail : form.productType ? PRODUCT_TYPE_LABEL[form.productType] : '', form.manufacturer, form.model].filter(Boolean).join(' · ') || '-' }}
              <span class="mono faint">({{ form.serial || '-' }})</span>
              <button type="button" class="btn btn-sm btn-ghost" @click="goStep(0)"><Pencil :size="14" /> 수정</button>
            </dd>
            <dt>구매일</dt>
            <dd>{{ purchaseUnknown ? '모름' : formatDate(purchaseDate) }}</dd>
            <dt>증상</dt>
            <dd>{{ symptom || '-' }} <button type="button" class="btn btn-sm btn-ghost" @click="goStep(1)"><Pencil :size="14" /> 수정</button></dd>
            <dt>에러 코드</dt>
            <dd>{{ form.errorCodes.length ? form.errorCodes.join(', ') : '없음' }}</dd>
            <dt>기사 소견</dt>
            <dd class="pre">{{ form.technicianNote.trim() || '없음' }}</dd>
            <dt>사진</dt>
            <dd>{{ totalPhotos }}장 (PCB {{ photos.PCB.length }} · 기계·외관 {{ photos.MOTOR.length }}) <button type="button" class="btn btn-sm btn-ghost" @click="goStep(2)"><Pencil :size="14" /> 수정</button></dd>
            <dt>수리 방식</dt>
            <dd>{{ visit.serviceType ? SERVICE_TYPE_LABEL[visit.serviceType] : '-' }}<template v-if="visit.serviceType === 'CENTER' && visit.centerName"> · {{ visit.centerName }}</template></dd>
            <dt>고객 · 방문</dt>
            <dd>{{ visit.customerName }} · {{ visit.phone }} · {{ toAddressLine(visitAddress) || '-' }} · {{ formatDate(visit.preferredDate) }} <button type="button" class="btn btn-sm btn-ghost" @click="goStep(3)"><Pencil :size="14" /> 수정</button></dd>
            <dt>접수 담당 기사</dt>
            <dd>{{ auth.user?.name }} · {{ auth.user?.branch }} · {{ auth.technicianType === 'FIELD' ? '출장기사' : '센터 수리자' }} <span class="mono faint">({{ auth.user?.employeeId }})</span></dd>
          </dl>
          <p class="callout tone-ai"><ScanLine :size="20" /> 접수 후 AI 가 필요한 분석(PCB·모터)을 선택합니다. 결과는 <b>AI 초안</b>으로 표시되며 기사님의 확인이 필요합니다.</p>
        </div>

        <div class="card card-pad stack">
          <h2 class="section-title">개인정보 수집·이용 동의</h2>
          <div class="notice">
            <dl class="kv">
              <dt>수집 항목</dt>
              <dd>고객 이름, 연락처, 주소, 희망 방문일, 구매일</dd>
              <dt>이용 목적</dt>
              <dd>수리 방문 일정 안내 및 수리 진행 연락</dd>
              <dt>보유 기간</dt>
              <dd>수리 완료 후 회사 개인정보 처리방침에 따른 기간</dd>
            </dl>
            <p class="faint">고객은 동의를 거부할 수 있으며, 거부하면 수리 접수가 제한됩니다. 이 정보는 AI 분석에 사용되지 않습니다.</p>
          </div>
          <label class="check" :class="{ invalid: touched[4] && errs.consent }">
            <input v-model="agreed" type="checkbox" :aria-invalid="touched[4] && !!errs.consent" />
            <span><ShieldCheck :size="18" class="inline-ic" /> 고객이 개인정보 수집·이용에 동의했습니다. (필수)</span>
          </label>
          <p v-if="touched[4] && errs.consent" class="error-text" role="alert"><CircleAlert :size="16" /> {{ errs.consent }}</p>

          <div v-if="submit.running || submit.error" class="progress" :class="{ err: submit.error }" role="status" aria-live="polite">
            <template v-if="submit.error">
              <CircleAlert :size="20" />
              <span><strong>접수 중 오류가 발생했습니다.</strong> {{ submit.error }} <template v-if="submit.repairId">입력한 내용은 저장되어 있으니 다시 시도해 주세요.</template></span>
            </template>
            <template v-else>
              <Loader2 :size="20" class="spin" />
              <span v-if="submit.phase === 'create'">접수 정보를 저장하고 있습니다…</span>
              <span v-else-if="submit.phase === 'upload'">사진을 올리고 있습니다… ({{ submit.uploaded }}/{{ totalPhotos }})</span>
              <span v-else>AI 진단을 요청하고 있습니다…</span>
            </template>
          </div>
        </div>
      </section>

      <!-- 하단 고정 이동 버튼 -->
      <div class="nav card">
        <p v-if="step === 2 && qChecking && qWait" class="callout tone-info nav-warn" role="status"><Loader2 :size="18" class="spin" /> 사진 검사가 끝날 때까지 잠시 기다려 주세요.</p>
        <p v-else-if="step === 2 && qProblems" class="callout nav-warn" :class="qFailed ? 'tone-danger' : 'tone-warning'" role="alert">
          <TriangleAlert :size="18" />
          <span>
            <template v-if="qFailed">불합격 사진 {{ qFailed }}장은 [재촬영]해야 진단할 수 있어요.</template>
            <template v-if="qUnacked"> 확인이 필요한 사진 {{ qUnacked }}장: 사진마다 [재촬영] 또는 [현재 사진 사용]을 눌러 주세요.</template>
          </span>
        </p>
        <button v-if="step > 0" type="button" class="btn btn-lg" :disabled="submit.running" @click="prev"><ArrowLeft :size="20" /> 이전</button>
        <RouterLink v-else to="/repairs" class="btn btn-lg btn-ghost">취소</RouterLink>
        <span class="spacer" />
        <span class="faint step-count">{{ step + 1 }} / {{ STEPS.length }}<span class="step-word"> 단계</span></span>
        <button v-if="step < LAST" type="button" class="btn btn-primary btn-lg" @click="next">다음 <ArrowRight :size="20" /></button>
        <button v-else type="button" class="btn btn-primary btn-lg" :disabled="submit.running" @click="doSubmit">
          <Send :size="20" /> {{ submit.error ? '다시 시도' : '접수하기' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fields {
  align-items: start;
}
.sub-field {
  margin-top: 12px;
}
.date-field {
  max-width: 320px;
}
.opt {
  min-height: 64px;
}
.opt span {
  display: grid;
}
.opt small {
  font-weight: 500;
  color: var(--text-3);
}
.review dd {
  overflow-wrap: anywhere;
}
.nowrap {
  flex-wrap: nowrap;
}
.sw {
  position: relative;
  flex: 1;
}
.sw .input {
  padding-left: 44px;
}
.si {
  position: absolute;
  left: 14px;
  top: 16px;
  color: var(--text-3);
}
.big {
  font-size: var(--fs-lg);
  letter-spacing: 0.04em;
  min-height: 54px;
}
.prod {
  padding: 18px 20px;
  display: grid;
  gap: 12px;
  background: var(--success-bg);
  border-color: var(--success-border);
}
.pn {
  font-size: var(--fs-lg);
}
.cols {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px 20px;
}
.cols > div {
  display: grid;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.quick .btn {
  font-weight: 500;
}
.codes {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.code {
  font-size: var(--fs-md);
  padding: 4px 6px 4px 12px;
}
.code button {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: inherit;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
}
.code button:hover {
  background: rgba(0, 0, 0, 0.08);
}
.check {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  font-weight: 600;
  cursor: pointer;
}
.check input {
  width: 22px;
  height: 22px;
  accent-color: var(--navy-800);
}
.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--radius);
  background: var(--info-bg);
  color: var(--info);
  font-weight: 600;
}
.progress.err {
  background: var(--danger-bg);
  color: var(--danger);
}
.nav {
  position: sticky;
  bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  box-shadow: var(--shadow-lg);
  z-index: 10;
}
.pre {
  white-space: pre-wrap;
}
.count {
  text-align: right;
  font-size: var(--fs-xs);
}
/* 휴대폰: 이전 · 단계 · 다음 버튼이 한 줄에 들어가게 */
@media (max-width: 480px) {
  .nav {
    gap: 8px;
    padding: 10px 12px;
  }
  .nav .btn-lg {
    min-height: var(--tap);
    padding: 0 18px;
    font-size: var(--fs-md);
  }
  .step-word {
    display: none;
  }
  .receipt {
    padding: 16px;
  }
}
.nav-warn {
  flex: 1 1 100%;
  padding: 10px 14px;
  font-size: var(--fs-sm);
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--primary);
}
.chip[aria-pressed='true'] {
  background: var(--blue-50);
  border-color: var(--primary);
  color: var(--primary);
}
.sub-label {
  margin-top: 6px;
  font-weight: 600;
}
.label-photo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}
.label-img {
  width: min(360px, 100%);
  max-height: 240px;
  object-fit: contain;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.label-acts {
  flex: 1 1 220px;
}
.inline-ic {
  vertical-align: -3px;
  color: var(--primary);
}
.notice {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: var(--fs-sm);
}
.check.invalid {
  color: var(--danger);
}
.done {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 12px;
  padding: 48px 24px;
}
.done-ic {
  color: var(--success);
}
.done h2 {
  font-size: var(--fs-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
}
.receipt {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 32px;
  margin: 8px 0 0;
  padding: 18px 28px;
  border-radius: var(--radius-lg);
  background: var(--blue-50);
}
.receipt div {
  display: grid;
  gap: 2px;
}
.receipt dt {
  color: var(--text-2);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.receipt dd {
  margin: 0;
  font-weight: 700;
}
.receipt .rn {
  font-size: var(--fs-xl);
  color: var(--primary);
}
.center {
  justify-content: center;
}
.track-link {
  max-width: 420px;
  color: var(--text-2);
  font-size: var(--fs-sm);
}
.track-link a {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 700;
}
</style>
