<script setup lang="ts">
/* 신규 수리 접수 — 5단계 스텝 폼
 *  ① 제품 정보 (시리얼 조회 · 라벨 사진은 참고용)  ② 고장 증상 (증상 칩 + 직접 입력 · 에러 코드 · 기사 소견)
 *  ③ 사진 올리기 (촬영 가이드 · 품질 검사)  ④ 방문 정보 (출장 기사가 방문할 고객 정보)
 *  ⑤ 개인정보 동의 · 최종 확인 → 접수 완료 (접수번호 안내)
 * 방문 정보·동의는 고객 개인정보라 AI 입력(userInput)에는 넣지 않는다. Mock 에만 저장, 실서버는 FEATURES.visitInfo 로 켬 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Search, Send, X, Loader2, ScanLine, Pencil, Camera, Trash2, ShieldCheck, MapPin, Home, TriangleAlert } from 'lucide-vue-next'
import BaseModal from '@/components/common/BaseModal.vue'
import StepIndicator from '@/components/repair/StepIndicator.vue'
import ImageUploader from '@/components/repair/ImageUploader.vue'
import PhotoGuide from '@/components/repair/PhotoGuide.vue'
import SameSerialHistory from '@/components/repair/SameSerialHistory.vue'
import WarrantyPeriodNotice from '@/components/repair/WarrantyPeriodNotice.vue'
import { checkWarrantyPeriod, repairApi, toErrorMessage, USE_MOCK } from '@/api'
import { FEATURES } from '@/api/features'
import { useToastStore } from '@/stores/toast'
import { PHOTO_KIND_LABEL, PHOTO_LIMIT } from '@/constants/status'
import type { PhotoKind, PrivacyConsent, ProductInfo, VisitInfo, WarrantyPeriod } from '@/types'
import type { UploadItem } from '@/types/upload'
import { formatDate, repairId } from '@/utils/format'

const toast = useToastStore()
const STEPS = ['제품 정보', '고장 증상', '사진 올리기', '방문 정보', '동의 및 접수']
const LAST = STEPS.length - 1
const step = ref(0)

const form = reactive({
  serial: '',
  product: null as ProductInfo | null,
  /** 자주 있는 증상 칩 (여러 개 선택) */
  symptomChips: [] as string[],
  /** 직접 입력한 증상 */
  symptomText: '',
  errorCodes: [] as string[],
  technicianNote: '',
})
/** 출장 방문 정보 (고객 개인정보) */
const visit = reactive<Omit<VisitInfo, 'purchaseDate'>>({ customerName: '', phone: '', address: '', preferredDate: '' })
/** 구매일 — 무상 수리 여부 확인용. "모름" 이면 null 로 저장 */
const purchaseDate = ref('')
const purchaseUnknown = ref(false)
watch(purchaseUnknown, (v) => v && (purchaseDate.value = ''))
const agreed = ref(false)

/** 접수 사진 2종: PCB · 기계·찌그러짐(모터·외관 변형 등). 칸별 5장, 전체 10장 */
const PHOTO_KINDS = ['PCB', 'MOTOR'] as const
const photos = reactive<Record<(typeof PHOTO_KINDS)[number], UploadItem[]>>({ PCB: [], MOTOR: [] })
const touched = reactive([false, false, false, false, false])
const totalPhotos = computed(() => photos.PCB.length + photos.MOTOR.length)

/* ---------- ③ 사진 품질 검사 (FEATURES.photoQualityCheck 가 꺼져 있으면 항상 0) ---------- */
const quality = reactive<Record<(typeof PHOTO_KINDS)[number], { checking: number; problems: number }>>({ PCB: { checking: 0, problems: 0 }, MOTOR: { checking: 0, problems: 0 } })
const qChecking = computed(() => quality.PCB.checking + quality.MOTOR.checking)
const qProblems = computed(() => quality.PCB.problems + quality.MOTOR.problems)
/** "이대로 제출" 확인을 받았는지. 사진이 바뀌면 다시 묻는다 */
const problemsAccepted = ref(false)
const problemDlg = ref(false)
const qWait = ref(false)
watch(photos, () => (problemsAccepted.value = false), { deep: true })
watch(qChecking, (n) => !n && (qWait.value = false))
/** 사진 단계를 넘어가도 되는지: 검사 중이면 기다리게, 문제 사진이 있으면 한 번 더 확인 */
function photosReady(): boolean {
  if (qChecking.value) {
    qWait.value = true
    return false
  }
  if (qProblems.value && !problemsAccepted.value) {
    problemDlg.value = true
    return false
  }
  return true
}
function acceptProblems() {
  problemsAccepted.value = true
  problemDlg.value = false
  if (step.value === 2) next()
  else void doSubmit()
}

/* ---------- ① 시리얼 → 제품 자동 조회 ---------- */
const lookup = reactive({ loading: false, error: null as string | null })
async function findProduct() {
  const s = form.serial.trim().toUpperCase()
  form.serial = s
  form.product = null
  lookup.error = null
  if (!/^RC\d{10}$/.test(s)) {
    lookup.error = '시리얼 번호는 RC 로 시작하는 12자리입니다. (예: RC2026000187)'
    return
  }
  lookup.loading = true
  try {
    form.product = await repairApi.lookupProduct(s)
  } catch (e) {
    lookup.error = toErrorMessage(e)
  } finally {
    lookup.loading = false
  }
}
watch(
  () => form.serial,
  (v) => {
    if (form.product && v.trim().toUpperCase() !== form.product.serialNumber) form.product = null
    if (/^RC\d{10}$/i.test(v.trim()) && !lookup.loading && !form.product) void findProduct()
  },
)

/** 라벨 사진: 보면서 입력하도록 크게 보여 주기만 한다 (자동 인식 없음 · 접수에 첨부하지 않음) */
const labelInput = ref<HTMLInputElement | null>(null)
const labelPhoto = ref<string | null>(null)
function onLabelPhoto(files: FileList | null) {
  const f = files?.[0]
  if (!f || !f.type.startsWith('image/')) return
  if (labelPhoto.value) URL.revokeObjectURL(labelPhoto.value)
  labelPhoto.value = URL.createObjectURL(f)
  if (labelInput.value) labelInput.value.value = ''
}
function clearLabelPhoto() {
  if (labelPhoto.value) URL.revokeObjectURL(labelPhoto.value)
  labelPhoto.value = null
}
onBeforeUnmount(clearLabelPhoto)

/* ---------- ② 증상 · 에러코드 ---------- */
const SYMPTOMS = ['청소 중 큰 소음', '주행 중 멈춤', '한쪽으로만 회전', '충전 안 됨', '전원 안 켜짐', '흡입력 약함', '물걸레 작동 안 함', '바퀴 헛돎']
function toggleChip(s: string) {
  form.symptomChips = form.symptomChips.includes(s) ? form.symptomChips.filter((x) => x !== s) : [...form.symptomChips, s]
}
/** 서버로 보내는 증상 = 선택한 칩 + 직접 입력 */
const symptom = computed(() => [...form.symptomChips, form.symptomText.trim()].filter(Boolean).join(', '))

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

/* ---------- 보증 기간 안내 (시리얼 입력 후 0.5초 또는 입력칸을 벗어날 때, 구매일이 바뀌면 다시 계산) ---------- */
const warrantyPeriod = ref<WarrantyPeriod | null>(null)
/** 오늘 이후가 아닌 구매일만 계산에 사용 ("몰라요"면 제조일 추정) */
const wpPurchase = computed(() => (!purchaseUnknown.value && purchaseDate.value && purchaseDate.value <= today ? purchaseDate.value : undefined))
let wpTimer: number | undefined
let wpSeq = 0
let wpKey = ''
async function refreshWarranty() {
  window.clearTimeout(wpTimer)
  const serial = form.serial.trim().toUpperCase()
  if (!FEATURES.warranty || !/^RC\d{10}$/.test(serial)) {
    warrantyPeriod.value = null
    wpKey = ''
    return
  }
  const key = `${serial}|${wpPurchase.value ?? ''}`
  if (key === wpKey) return
  wpKey = key
  const seq = ++wpSeq
  try {
    const res = await checkWarrantyPeriod(serial, wpPurchase.value)
    if (seq === wpSeq) warrantyPeriod.value = res
  } catch {
    // 안내용이라 실패해도 접수는 계속 (박스만 숨김)
    if (seq === wpSeq) {
      warrantyPeriod.value = null
      wpKey = ''
    }
  }
}
watch(
  () => form.serial,
  () => {
    window.clearTimeout(wpTimer)
    wpTimer = window.setTimeout(refreshWarranty, 500)
  },
)
watch(wpPurchase, () => void refreshWarranty())
onBeforeUnmount(() => window.clearTimeout(wpTimer))

/* ---------- 검증 ---------- */
const errs = computed(() => ({
  product: !form.product ? '시리얼 번호로 제품 정보를 조회해 주세요.' : null,
  symptom: !form.symptomChips.length && form.symptomText.trim().length < 5 ? '증상을 하나 이상 고르거나 5자 이상 직접 입력해 주세요.' : null,
  // 에러 코드는 선택. 입력란에 쓰고 [추가]를 안 누른 코드만 확인
  codes: codeInput.value.trim() ? '입력한 에러 코드를 [추가]로 등록하거나 지워 주세요.' : null,
  note: form.technicianNote.length > 1000 ? '기사 소견은 1000자까지 입력할 수 있습니다.' : null,
  photos: PHOTO_KINDS.filter((k) => !photos[k].length),
  photoTotal: totalPhotos.value > PHOTO_LIMIT.total ? `사진은 전체 ${PHOTO_LIMIT.total}장까지 등록할 수 있습니다. (현재 ${totalPhotos.value}장)` : null,
  name: !visit.customerName.trim() ? '고객 이름을 입력해 주세요.' : null,
  phone: !PHONE_RE.test(visit.phone.trim()) ? '연락처를 숫자로 입력해 주세요. (예: 010-1234-5678)' : null,
  address: visit.address.trim().length < 5 ? '방문할 주소를 입력해 주세요.' : null,
  date: !visit.preferredDate ? '희망 방문일을 골라 주세요.' : visit.preferredDate < today ? '오늘 이후 날짜를 골라 주세요.' : null,
  purchase: purchaseUnknown.value ? null : !purchaseDate.value ? '구매일을 골라 주세요. 모르면 "구매일을 몰라요"를 체크해 주세요.' : purchaseDate.value > today ? '오늘 이후 날짜는 고를 수 없어요.' : null,
  consent: !agreed.value ? '개인정보 수집·이용에 동의해 주세요.' : null,
}))
const stepValid = computed(() => {
  const e = errs.value
  return [!e.product, !e.symptom && !e.codes && !e.note, !e.photos.length && !e.photoTotal, !e.name && !e.phone && !e.address && !e.date && !e.purchase, !e.consent]
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
  if (!form.product) return
  if (!photosReady()) {
    goStep(2)
    return
  }
  submit.running = true
  submit.error = null
  const consent: PrivacyConsent = { agreed: true, agreedAt: new Date().toISOString(), version: 'v1' }
  const visitInfo: VisitInfo = { customerName: visit.customerName.trim(), phone: visit.phone.trim(), address: visit.address.trim(), preferredDate: visit.preferredDate, purchaseDate: purchaseUnknown.value ? null : purchaseDate.value }
  try {
    const req = { product: form.product, symptom: symptom.value, technicianNote: form.technicianNote.trim() || undefined, errorCodes: form.errorCodes, visitInfo, consent }
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
          await repairApi.uploadImage(submit.repairId, { kind: kind as PhotoKind, file: p.file, dataUrl: p.dataUrl })
          submit.uploaded++
        }
      }
      submit.phase = 'request'
      await repairApi.submit(submit.repairId)
    }
    submit.phase = 'done'
    dirty.value = false
    toast.success(`수리 ID ${repairId(submit.repairId!)} 로 접수되었습니다. AI 분석을 시작합니다.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e) {
    submit.error = toErrorMessage(e)
  } finally {
    submit.running = false
  }
}

/* ---------- 작성 중 이탈 방지 ---------- */
const dirty = ref(false)
watch([form, photos, visit, agreed, purchaseDate, purchaseUnknown], () => (dirty.value = true), { deep: true })
onBeforeRouteLeave(() => (!dirty.value || submit.phase === 'done' ? true : window.confirm('작성 중인 접수 내용이 사라집니다. 나가시겠습니까?')))
</script>

<template>
  <div class="page narrow">
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
        <RouterLink to="/" class="btn btn-lg"><Home :size="20" /> 홈으로</RouterLink>
        <RouterLink :to="`/repairs/${submit.repairId}/progress`" class="btn btn-primary btn-lg">진행 상황 보기 <ArrowRight :size="20" /></RouterLink>
      </div>
      <!-- 고객용 조회 화면 (접수번호는 주소창이 아닌 history state 로 전달) -->
      <p v-if="FEATURES.customerReport && submit.receiptNo" class="track-link">
        고객은 접수번호와 휴대폰 뒷자리로
        <RouterLink :to="{ path: '/service/track', state: { receiptNo: submit.receiptNo } }">진행 상황 조회하기 <ArrowRight :size="15" /></RouterLink>
        에서 확인할 수 있어요.
      </p>
    </section>

    <template v-else>
      <StepIndicator :steps="STEPS" :current="step" :style="{ '--n': STEPS.length }" />

      <!-- ========== ① 제품 정보 ========== -->
      <section v-show="step === 0" class="card card-pad stack" aria-labelledby="s1">
        <h2 id="s1" class="section-title">① 제품 정보</h2>
        <div class="field">
          <label for="serial" class="req">시리얼 번호</label>
          <div class="row nowrap">
            <div class="sw">
              <ScanLine :size="20" class="si" aria-hidden="true" />
              <input
                id="serial"
                v-model="form.serial"
                class="input mono big"
                :class="{ invalid: (touched[0] && errs.product) || lookup.error }"
                placeholder="RC2026000187"
                autocomplete="off"
                maxlength="12"
                :aria-invalid="!!lookup.error || (touched[0] && !!errs.product)"
                aria-describedby="serial-help"
                @keydown.enter.prevent="findProduct"
                @blur="refreshWarranty"
              />
            </div>
            <button class="btn btn-lg" type="button" :disabled="lookup.loading" @click="findProduct">
              <Loader2 v-if="lookup.loading" :size="20" class="spin" /><Search v-else :size="20" /> 조회
            </button>
          </div>
          <p id="serial-help" class="help">제품 바닥면 라벨의 12자리 번호를 입력하면 모델을 자동으로 조회합니다. (데모: RC2026000187)</p>
          <p v-if="lookup.error" class="error-text" role="alert"><CircleAlert :size="16" /> {{ lookup.error }}</p>
          <p v-else-if="touched[0] && errs.product" class="error-text" role="alert"><CircleAlert :size="16" /> {{ errs.product }}</p>
          <WarrantyPeriodNotice :period="warrantyPeriod" />
        </div>

        <!-- 라벨 사진 (참고용) -->
        <div class="label-photo">
          <input ref="labelInput" type="file" accept="image/*" capture="environment" class="sr-only" aria-label="제품 라벨 사진 찍기" @change="onLabelPhoto(($event.target as HTMLInputElement).files)" />
          <template v-if="labelPhoto">
            <img :src="labelPhoto" alt="제품 라벨 사진" class="label-img" />
            <div class="stack label-acts">
              <p class="faint">사진을 보며 시리얼 번호를 입력해 주세요. 라벨 사진은 접수에 첨부되지 않습니다.</p>
              <div class="row">
                <button type="button" class="btn btn-sm" @click="labelInput?.click()"><Camera :size="16" /> 다시 찍기</button>
                <button type="button" class="btn btn-sm btn-ghost" @click="clearLabelPhoto"><Trash2 :size="16" /> 지우기</button>
              </div>
            </div>
          </template>
          <button v-else type="button" class="btn" @click="labelInput?.click()"><Camera :size="18" /> 라벨을 사진으로 찍어 보며 입력</button>
        </div>

        <div v-if="lookup.loading" class="prod skeleton" style="height: 150px" />
        <div v-else-if="form.product" class="prod card" aria-live="polite">
          <div class="row between">
            <strong class="pn">{{ form.product.modelName }}</strong>
            <span class="badge tone-success"><CircleCheck :size="15" /> 제품 확인됨</span>
          </div>
          <dl class="kv cols">
            <div><dt>모델</dt><dd>{{ form.product.model }}</dd></div>
            <div><dt>생산 공장</dt><dd>{{ form.product.factory }}</dd></div>
            <div><dt>제조일</dt><dd>{{ formatDate(form.product.manufacturedAt) }}</dd></div>
            <div><dt>펌웨어</dt><dd>{{ form.product.firmware || '-' }}</dd></div>
          </dl>
        </div>
        <SameSerialHistory v-if="form.product" :serial="form.product.serialNumber" compact new-tab />
      </section>

      <!-- ========== ② 고장 증상 ========== -->
      <section v-show="step === 1" class="card card-pad stack" aria-labelledby="s2">
        <h2 id="s2" class="section-title">② 고장 증상</h2>
        <div class="field">
          <span id="chips-label" class="label req">자주 있는 증상</span>
          <div class="chips" role="group" aria-labelledby="chips-label">
            <button
              v-for="s in SYMPTOMS"
              :key="s"
              type="button"
              class="chip"
              :aria-pressed="form.symptomChips.includes(s)"
              @click="toggleChip(s)"
            >
              <CircleCheck v-if="form.symptomChips.includes(s)" :size="16" aria-hidden="true" /> {{ s }}
            </button>
          </div>
          <label for="symptom" class="sub-label">직접 입력 <span class="faint">(칩에 없는 증상이나 자세한 상황)</span></label>
          <textarea id="symptom" v-model="form.symptomText" class="textarea" :class="{ invalid: touched[1] && errs.symptom }" placeholder="예) 청소 도중 큰 소음이 나고 2~3분 뒤 멈춤" :aria-invalid="touched[1] && !!errs.symptom" />
          <p v-if="touched[1] && errs.symptom" class="error-text"><CircleAlert :size="16" /> {{ errs.symptom }}</p>
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
            <ImageUploader v-model="photos.MOTOR" label="기계·찌그러짐 사진" description="모터·하우징·외관 변형 부위가 보이게" required quality-target="MOTOR" example-src="/mock/motor.svg" :max="PHOTO_LIMIT.perKind" :invalid="touched[2] && !photos.MOTOR.length" @quality="quality.MOTOR = $event" />
          </div>
        </div>
        <p v-if="touched[2] && errs.photos.length" class="error-text" role="alert">
          <CircleAlert :size="16" /> {{ errs.photos.map((k) => `${PHOTO_KIND_LABEL[k]} 사진`).join(', ') }}을(를) 등록해 주세요.
        </p>
        <p v-if="errs.photoTotal" class="error-text" role="alert"><CircleAlert :size="16" /> {{ errs.photoTotal }}</p>
        <p class="faint">칸별 최대 {{ PHOTO_LIMIT.perKind }}장, 전체 최대 {{ PHOTO_LIMIT.total }}장</p>
      </section>

      <!-- ========== ④ 방문 정보 ========== -->
      <section v-show="step === 3" class="card card-pad stack" aria-labelledby="s4">
        <h2 id="s4" class="section-title">④ 방문 정보</h2>
        <p class="muted"><MapPin :size="16" class="inline-ic" /> 출장 기사가 방문할 고객 정보입니다. 이 정보는 AI 분석에 사용되지 않습니다.</p>
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
        <div class="field">
          <label for="v-addr" class="req">주소</label>
          <input id="v-addr" v-model="visit.address" class="input" :class="{ invalid: touched[3] && errs.address }" maxlength="200" autocomplete="off" placeholder="예) 서울시 강남구 테헤란로 123, 101동 1001호" :aria-invalid="touched[3] && !!errs.address" />
          <p v-if="touched[3] && errs.address" class="error-text"><CircleAlert :size="16" /> {{ errs.address }}</p>
        </div>
        <div class="field date-field">
          <label for="v-date" class="req">희망 방문일</label>
          <input id="v-date" v-model="visit.preferredDate" class="input" :class="{ invalid: touched[3] && errs.date }" type="date" :min="today" :aria-invalid="touched[3] && !!errs.date" />
          <p v-if="touched[3] && errs.date" class="error-text"><CircleAlert :size="16" /> {{ errs.date }}</p>
        </div>
        <div class="field date-field">
          <label for="v-purchase" :class="{ req: !purchaseUnknown }">구매일</label>
          <p id="purchase-help" class="help">무상 수리 여부 확인에 사용돼요. 영수증이나 앱 구매 내역에서 확인할 수 있어요.</p>
          <input
            id="v-purchase"
            v-model="purchaseDate"
            class="input"
            :class="{ invalid: touched[3] && errs.purchase }"
            type="date"
            :max="today"
            :disabled="purchaseUnknown"
            aria-describedby="purchase-help"
            :aria-invalid="touched[3] && !!errs.purchase"
          />
          <label class="check">
            <input v-model="purchaseUnknown" type="checkbox" />
            <span>구매일을 몰라요</span>
          </label>
          <p v-if="touched[3] && errs.purchase" class="error-text"><CircleAlert :size="16" /> {{ errs.purchase }}</p>
        </div>
        <!-- 구매일이 바뀌면 같은 API 로 다시 계산한 보증 기간 -->
        <WarrantyPeriodNotice :period="warrantyPeriod" />
      </section>

      <!-- ========== ⑤ 개인정보 동의 · 최종 확인 ========== -->
      <section v-show="step === 4" class="stack" aria-labelledby="s5">
        <div class="card card-pad stack">
          <h2 id="s5" class="section-title">⑤ 개인정보 수집·이용 동의</h2>
          <div class="notice">
            <dl class="kv">
              <dt>수집 항목</dt>
              <dd>고객 이름, 연락처, 주소, 희망 방문일, 구매일</dd>
              <dt>이용 목적</dt>
              <dd>출장 수리 방문 일정 안내 및 수리 진행 연락</dd>
              <dt>보유 기간</dt>
              <dd>수리 완료 후 회사 개인정보 처리방침에 따른 기간</dd>
            </dl>
            <p class="faint">고객은 동의를 거부할 수 있으며, 거부하면 출장 수리 접수가 제한됩니다. 이 정보는 AI 분석에 사용되지 않습니다.</p>
          </div>
          <label class="check" :class="{ invalid: touched[4] && errs.consent }">
            <input v-model="agreed" type="checkbox" :aria-invalid="touched[4] && !!errs.consent" />
            <span><ShieldCheck :size="18" class="inline-ic" /> 고객이 개인정보 수집·이용에 동의했습니다. (필수)</span>
          </label>
          <p v-if="touched[4] && errs.consent" class="error-text" role="alert"><CircleAlert :size="16" /> {{ errs.consent }}</p>
        </div>

        <div class="card card-pad stack">
          <h2 class="section-title">최종 확인</h2>
          <dl class="kv review">
            <dt>제품</dt>
            <dd>{{ form.product?.modelName }} <span class="mono faint">({{ form.product?.serialNumber }})</span> <button type="button" class="btn btn-sm btn-ghost" @click="goStep(0)"><Pencil :size="14" /> 수정</button></dd>
            <dt>증상</dt>
            <dd>{{ symptom }} <button type="button" class="btn btn-sm btn-ghost" @click="goStep(1)"><Pencil :size="14" /> 수정</button></dd>
            <dt>에러 코드</dt>
            <dd>{{ form.errorCodes.length ? form.errorCodes.join(', ') : '없음' }}</dd>
            <dt>기사 소견</dt>
            <dd class="pre">{{ form.technicianNote.trim() || '없음' }}</dd>
            <dt>사진</dt>
            <dd>{{ totalPhotos }}장 (PCB {{ photos.PCB.length }} · 기계·찌그러짐 {{ photos.MOTOR.length }}) <button type="button" class="btn btn-sm btn-ghost" @click="goStep(2)"><Pencil :size="14" /> 수정</button></dd>
            <dt>방문 정보</dt>
            <dd>{{ visit.customerName }} · {{ visit.phone }} · {{ visit.address }} · {{ formatDate(visit.preferredDate) }} <button type="button" class="btn btn-sm btn-ghost" @click="goStep(3)"><Pencil :size="14" /> 수정</button></dd>
            <dt>구매일</dt>
            <dd>{{ purchaseUnknown ? '모름' : formatDate(purchaseDate) }}</dd>
          </dl>
          <p class="callout tone-ai"><ScanLine :size="20" /> 접수 후 AI 가 필요한 분석(PCB·모터)을 선택합니다. 결과는 <b>AI 초안</b>으로 표시되며 기사님의 확인이 필요합니다.</p>

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
        <p v-else-if="step === 2 && qProblems" class="callout tone-warning nav-warn" role="alert"><TriangleAlert :size="18" /> 문제 있는 사진이 {{ qProblems }}장 있어요. 다시 찍으면 진단이 더 정확해져요.</p>
        <button v-if="step > 0" type="button" class="btn btn-lg" :disabled="submit.running" @click="prev"><ArrowLeft :size="20" /> 이전</button>
        <RouterLink v-else to="/" class="btn btn-lg btn-ghost">취소</RouterLink>
        <span class="spacer" />
        <span class="faint step-count">{{ step + 1 }} / {{ STEPS.length }}<span class="step-word"> 단계</span></span>
        <button v-if="step < LAST" type="button" class="btn btn-primary btn-lg" @click="next">다음 <ArrowRight :size="20" /></button>
        <button v-else type="button" class="btn btn-primary btn-lg" :disabled="submit.running" @click="doSubmit">
          <Send :size="20" /> {{ submit.error ? '다시 시도' : '접수하기' }}
        </button>
      </div>
    </template>

    <!-- 문제 있는 사진 → "이대로 제출" 한 번 더 확인 -->
    <BaseModal :open="problemDlg" title="문제 있는 사진이 있어요" :width="480" @close="problemDlg = false">
      <p>사진 {{ qProblems }}장에 문제가 있어요. 그대로 제출하면 AI 진단이 부정확하거나 추가 사진을 다시 요청할 수 있어요.</p>
      <template #footer>
        <button type="button" class="btn btn-primary" @click="problemDlg = false"><Camera :size="18" /> 다시 찍기</button>
        <button type="button" class="btn" @click="acceptProblems">이대로 제출</button>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
.narrow {
  max-width: 1100px;
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
.review dd {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
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
.date-field .check {
  margin-top: 2px;
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
.date-field {
  max-width: 320px;
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
