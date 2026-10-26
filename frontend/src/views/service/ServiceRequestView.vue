<script setup lang="ts">
/* =========================================================================
 * 고객(비회원) 고장 접수 (/service/request) — 회원가입·로그인 없이 3단계
 *  ① 제품·증상: 제품 종류 · 제조사 · 모델명(고르거나 직접 입력) · 시리얼(보증 기간 안내) · 구매일(선택) · 고장 증상(제품별 + 공통 칩, 직접 입력)
 *  ② 사진: 사진 올리기 + 촬영 가이드 + 사진 품질 검사
 *  ③ 방문·동의: 이름 · 연락처 · 주소 · 희망 방문일 · 개인정보 동의
 *  접수하면 완료 팝업(접수번호·복사·조회/홈). 팝업을 닫아도 같은 내용이 페이지에 남는다 (새로고침 전까지)
 *  ※ 기사 소견은 기사용 접수 화면에만 있다 (고객은 "고장 증상" 하나로 적는다)
 *  실서버: 접수 API 가 아직 없어 FEATURES.customerIntake 가 false 면 안내만 보이고 접수 버튼은 비활성
 * ========================================================================= */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeft, ArrowRight, Building2, Camera, CircleAlert, CircleCheck, Home, Info, Loader2, Send, ShieldCheck, TriangleAlert } from 'lucide-vue-next'
import ProductPhotoSlots from '@/components/service/ProductPhotoSlots.vue'
import PhotoGuide from '@/components/repair/PhotoGuide.vue'
import ProductInfoFields from '@/components/repair/ProductInfoFields.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import ReceiptDone from '@/components/service/ReceiptDone.vue'
import { submitCustomerRequest, toErrorMessage, USE_MOCK } from '@/api'
import { FEATURES } from '@/api/features'
import AddressSearchField from '@/components/address/AddressSearchField.vue'
import { getServiceCenters } from '@/api'
import { SERVICE_TYPE_DESC, SERVICE_TYPE_LABEL, VISIT_SLOT_LABEL, type ServiceCenter, type ServiceType, type VisitSlot } from '@/constants/serviceType'
import { DETAIL_ADDRESS_MAX, emptyVisitAddress, normalizeVisitAddress, toAddressLine } from '@/api/adapters/address'
import type { VisitAddress } from '@/types'
import { canBringToCenter, symptomsFor, type ProductType, type ProductTypeForm } from '@/constants/products'
import { kstToday } from '@/utils/kst'
import type { ProductInfo } from '@/types'
import type { UploadItem } from '@/types/upload'

const available = USE_MOCK || FEATURES.customerIntake
const today = kstToday()
const STEPS = ['제품·증상', '사진', '방문·동의']
const step = ref(0)

const form = reactive({ ...({ productType: '', productTypeDetail: '' } as ProductTypeForm), manufacturer: '', model: '', serial: '', purchaseDate: '', purchaseUnknown: false, product: null as ProductInfo | null, symptomText: '', customerName: '', phone: '', preferredDate: '', serviceType: '' as ServiceType | '', centerId: '', visitSlot: '' as VisitSlot | '' })
/* ---------- ③ 수리 방법: 방문 수리(주소 · 날짜 · 시간대) / 센터 방문(서비스센터 · 날짜) ---------- */
const centers = ref<ServiceCenter[]>([])
onMounted(async () => {
  centers.value = await getServiceCenters().catch(() => [])
})
/** 큰 제품(에어컨·세탁기 등)은 센터 방문 불가 — constants/products 의 설정값 */
const centerAllowed = computed(() => canBringToCenter(form.productType))
watch(centerAllowed, (ok) => !ok && form.serviceType === 'CENTER' && (form.serviceType = ''))
const selectedCenter = computed(() => centers.value.find((c) => c.id === form.centerId))
/** 방문 주소: 구조화 상태로 유지 (한 줄 주소는 보낼 때 adapters/address 에서 조합). 제품·증상을 바꿔도 그대로 */
const visitAddress = ref<VisitAddress>(emptyVisitAddress())
const chips = ref<string[]>([])
const photos = ref<UploadItem[]>([])
const agreed = ref(false)
const touched = reactive([false, false, false])
const loading = ref(false)
const error = ref<string | null>(null)

/* ---------- ① 제품 정보: 기사 접수와 같은 공통 ProductInfoFields (시리얼 조회 · 라벨 사진 · 보증 기간 안내) ---------- */
const isUnknownType = computed(() => form.productType === 'unknown')
/** 서버로 보낼 구매일: 오늘 이후가 아닌 날짜만, "몰라요"면 보내지 않음 (시리얼로 보증 기간 추정) */
const purchaseForSubmit = computed(() => (!form.purchaseUnknown && form.purchaseDate && form.purchaseDate <= today ? form.purchaseDate : undefined))
/* ---------- ① 고장 증상: 제품별 증상 + 공통 증상 칩 + 직접 입력 ---------- */
const SYMPTOMS = computed(() => symptomsFor(form.productType))
// 제품 종류를 바꾸면 새 목록에 없는 증상 선택은 지움
watch(SYMPTOMS, (list) => (chips.value = chips.value.filter((c) => list.includes(c))))
function toggleChip(s: string) {
  chips.value = chips.value.includes(s) ? chips.value.filter((x) => x !== s) : [...chips.value, s]
}
const symptom = computed(() => [...chips.value, form.symptomText.trim()].filter(Boolean).join(', '))

/* ---------- ② 사진 품질 검사 ---------- */
const quality = ref({ checking: 0, problems: 0 })
const problemsAccepted = ref(false)
const problemDlg = ref(false)
const qWait = ref(false)
watch(photos, () => (problemsAccepted.value = false), { deep: true })
watch(() => quality.value.checking, (n) => !n && (qWait.value = false))
/** 사진 단계를 넘어가도 되는지: 검사 중이면 기다리게, 문제 사진이 있으면 한 번 더 확인 */
function photosReady(): boolean {
  if (quality.value.checking) {
    qWait.value = true
    return false
  }
  if (quality.value.problems && !problemsAccepted.value) {
    problemDlg.value = true
    return false
  }
  return true
}
function acceptProblems() {
  problemsAccepted.value = true
  problemDlg.value = false
  next()
}

/* ---------- 검증 ---------- */
/** YYYY-MM-DD 이면서 실제로 있는 날짜인지 (2025-02-30 같은 값 거름) */
function isValidDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
const errs = computed(() => ({
  // 기사 접수와 같은 기준: 시리얼 · 제조사 · 모델명 · 구매일(모르면 제외) 필수, 제품 종류는 선택 (기타면 직접 입력 필수)
  typeDetail: isUnknownType.value && !form.productTypeDetail.trim() ? '제품 종류를 입력해 주세요.' : null,
  manufacturer: !form.manufacturer.trim() ? '제조사를 입력해 주세요.' : null,
  model: !form.model.trim() ? '모델명을 입력하거나 시리얼로 조회해 주세요.' : null,
  serial: !form.serial.trim() ? '시리얼 번호를 입력해 주세요.' : !/^[A-Za-z0-9-]{4,30}$/.test(form.serial.trim()) ? '시리얼 번호는 영문·숫자로 입력해 주세요.' : null,
  purchase: form.purchaseUnknown
    ? null
    : !form.purchaseDate
      ? '구매일을 골라 주세요. 모르면 "구매일을 몰라요"를 체크해 주세요.'
      : !isValidDate(form.purchaseDate)
        ? '날짜 형식이 올바르지 않아요. (예: 2025-03-14)'
        : form.purchaseDate > today
          ? '오늘 이후 날짜는 고를 수 없어요.'
          : null,
  // '기타'만 고르면 직접 입력이 필요
  symptom: !chips.value.some((c) => c !== '기타') && form.symptomText.trim().length < 5 ? '증상을 하나 이상 고르거나 5자 이상 적어 주세요.' : null,
  photos: !photos.value.length ? '제품 사진을 1장 이상 올려 주세요.' : null,
  name: !form.customerName.trim() ? '이름을 입력해 주세요.' : null,
  phone: !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(form.phone.trim()) ? '휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)' : null,
  serviceType: !form.serviceType ? '수리 방법을 골라 주세요.' : null,
  center: form.serviceType === 'CENTER' && !form.centerId ? '서비스센터를 골라 주세요.' : null,
  slot: form.serviceType === 'VISIT' && !form.visitSlot ? '방문 시간대를 골라 주세요.' : null,
  address: form.serviceType !== 'VISIT' ? null : !visitAddress.value.roadAddress.trim() ? '방문 주소를 검색해 주세요.' : null,
  detailAddress: form.serviceType !== 'VISIT' || !visitAddress.value.roadAddress.trim()
    ? null
    : !visitAddress.value.detailAddress.trim()
      ? '상세주소를 입력해 주세요.'
      : visitAddress.value.detailAddress.trim().length > DETAIL_ADDRESS_MAX
        ? `상세주소는 ${DETAIL_ADDRESS_MAX}자 이하로 입력해 주세요.`
        : null,
  date: !form.preferredDate ? (form.serviceType === 'CENTER' ? '방문 예정일을 골라 주세요.' : '방문 희망일을 골라 주세요.') : !isValidDate(form.preferredDate) ? '날짜 형식이 올바르지 않아요. (예: 2025-03-14)' : form.preferredDate < today ? '오늘 이후 날짜를 골라 주세요.' : null,
  consent: !agreed.value ? '개인정보 수집·이용에 동의해 주세요.' : null,
}))
const stepValid = computed(() => {
  const e = errs.value
  return [!e.serial && !e.typeDetail && !e.manufacturer && !e.model && !e.purchase && !e.symptom, !e.photos, !e.serviceType && !e.center && !e.slot && !e.name && !e.phone && !e.address && !e.detailAddress && !e.date && !e.consent]
})

async function focusFirstError() {
  await nextTick()
  document.querySelector<HTMLElement>('section:not([hidden]) [aria-invalid="true"], section:not([hidden]) .uploader.invalid button')?.focus()
}
function next() {
  touched[step.value] = true
  if (!stepValid.value[step.value]) return void focusFirstError()
  if (step.value === 1 && !photosReady()) return
  step.value = Math.min(STEPS.length - 1, step.value + 1)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function prev() {
  step.value = Math.max(0, step.value - 1)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ---------- 접수 → 완료 팝업 (닫아도 페이지에 같은 내용 유지) ---------- */
const done = ref<{ receiptNo: string; serviceType: ServiceType; centerName?: string } | null>(null)
const doneDlg = ref(false)

async function submit() {
  touched[2] = true
  const bad = stepValid.value.findIndex((v) => !v)
  if (bad >= 0) {
    step.value = bad
    return void focusFirstError()
  }
  loading.value = true
  error.value = null
  try {
    const res = await submitCustomerRequest(
      {
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        // productType 은 항상 Enum 값, 직접 입력한 제품명은 productTypeDetail 로 따로
        productType: (form.productType || 'unknown') as ProductType,
        productTypeDetail: isUnknownType.value ? form.productTypeDetail.trim() : null,
        manufacturer: form.manufacturer.trim(),
        model: form.model.trim(),
        serial: form.serial.trim().toUpperCase(),
        symptom: symptom.value,
        purchaseDate: purchaseForSubmit.value,
        preferredDate: form.preferredDate,
        // 수리 방법 (개인정보와 마찬가지로 AI 입력과 무관한 접수 필드)
        serviceType: form.serviceType as ServiceType,
        ...(form.serviceType === 'CENTER'
          ? { centerId: form.centerId }
          : {
              visitSlot: form.visitSlot as VisitSlot,
              // 기존 계약(한 줄 주소)은 유지하고, 구조화 주소를 함께 보낸다
              address: toAddressLine(visitAddress.value),
              visitAddress: normalizeVisitAddress(visitAddress.value),
            }),
        consent: { agreed: true, agreedAt: new Date().toISOString(), version: 'v1' },
      },
      photos.value.map((p) => ({ file: p.file, dataUrl: p.dataUrl })),
    )
    done.value = { receiptNo: res.receiptNo, serviceType: form.serviceType as ServiceType, centerName: selectedCenter.value?.name }
    doneDlg.value = true
    window.scrollTo({ top: 0 })
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <!-- 접수 완료 후: 팝업을 닫아도 같은 내용이 페이지에 남음 -->
  <section v-if="done" class="card done-page">
    <ReceiptDone :receipt-no="done.receiptNo" :service-type="done.serviceType" :center-name="done.centerName" />
  </section>

  <form v-else class="request" novalidate @submit.prevent="step === STEPS.length - 1 ? submit() : next()">
    <h1>고장 접수</h1>

    <!-- 진행 표시 -->
    <div class="progress" aria-live="polite">
      <span class="count"><b>{{ step + 1 }}</b>/{{ STEPS.length }}</span>
      <span class="label">{{ STEPS[step] }}</span>
      <ol class="bar" aria-hidden="true">
        <li v-for="(s, i) in STEPS" :key="s" :class="{ on: i <= step }" />
      </ol>
    </div>

    <p v-if="!available" class="callout tone-info"><Info :size="20" /> 온라인 고장 접수는 아직 준비 중이에요. 고객센터로 문의해 주세요.</p>
    <div v-if="error" class="callout tone-danger" role="alert"><CircleAlert :size="20" /> {{ error }}</div>

    <!-- ① 제품·증상 -->
    <section v-show="step === 0" :hidden="step !== 0" class="card form-card form-grid" aria-label="제품·증상">
      <!-- 제품 정보: 기사 수리 접수와 같은 공통 컴포넌트 (데모 안내 문구 없음 · 라벨 사진은 참고용) -->
      <h2 class="sec span-2">① 제품 정보</h2>
      <ProductInfoFields
        v-model:serial="form.serial"
        v-model:product-type="form.productType"
        v-model:product-type-detail="form.productTypeDetail"
        v-model:manufacturer="form.manufacturer"
        v-model:model="form.model"
        v-model:purchase-date="form.purchaseDate"
        v-model:purchase-unknown="form.purchaseUnknown"
        v-model:product="form.product"
        class="span-2"
        id-prefix="c"
        :errors="errs"
        :show-errors="touched[0]"
      />
      <div class="field span-2">
        <span id="c-chips" class="label req">고장 증상</span>
        <div class="chips" role="group" aria-labelledby="c-chips">
          <button v-for="s in SYMPTOMS" :key="s" type="button" class="chip" :aria-pressed="chips.includes(s)" @click="toggleChip(s)">
            <CircleCheck v-if="chips.includes(s)" :size="16" aria-hidden="true" /> {{ s }}
          </button>
        </div>
        <label for="c-symptom" class="sub-label">직접 입력 <span class="faint">(언제부터, 어떤 상황에서 생기는지)</span></label>
        <textarea id="c-symptom" v-model="form.symptomText" class="textarea" maxlength="500" placeholder="예) 어제부터 작동 중에 큰 소리가 나고 멈춰요" :class="{ invalid: touched[0] && errs.symptom }" :aria-invalid="touched[0] && !!errs.symptom" />
        <p v-if="touched[0] && errs.symptom" class="error-text">{{ errs.symptom }}</p>
      </div>
    </section>

    <!-- ② 사진 -->
    <section v-show="step === 1" :hidden="step !== 1" class="card form-card stack" aria-label="사진">
      <p class="muted">제품 전체가 보이도록 촬영해 주세요. 올린 사진마다 품질 검사 결과가 표시돼요.</p>
      <PhotoGuide kind="PRODUCT" />
      <!-- 가로 3칸: 제품 전체 · 고장 난 부분 · 촬영 예시 (1장 이상, 최대 5장) -->
      <ProductPhotoSlots v-model="photos" :max="5" :invalid="touched[1] && !photos.length" example-src="/mock/product.svg" @quality="quality = $event" />
      <p v-if="touched[1] && errs.photos" class="error-text" role="alert">{{ errs.photos }}</p>
      <p v-if="quality.checking && qWait" class="callout tone-info"><Loader2 :size="18" class="spin" /> 사진 검사가 끝날 때까지 잠시 기다려 주세요.</p>
      <p v-else-if="quality.problems" class="callout tone-warning" role="alert"><TriangleAlert :size="18" /> 문제 있는 사진이 {{ quality.problems }}장 있어요. 다시 찍으면 더 정확하게 확인할 수 있어요.</p>
    </section>

    <!-- ③ 방문·동의 -->
    <section v-show="step === 2" :hidden="step !== 2" class="stack" aria-label="방문·동의">
      <div class="card form-card form-grid">
        <!-- 수리 방법 -->
        <div class="field span-2">
          <span id="c-svc" class="label req">수리 방법</span>
          <div class="svc-cards" role="radiogroup" aria-labelledby="c-svc">
            <button
              v-for="t in (['VISIT', 'CENTER'] as const)"
              :key="t"
              type="button"
              class="svc-card"
              role="radio"
              :aria-checked="form.serviceType === t"
              :aria-invalid="t === 'VISIT' && touched[2] && !!errs.serviceType"
              :disabled="t === 'CENTER' && !centerAllowed"
              @click="form.serviceType = t"
            >
              <component :is="t === 'VISIT' ? Home : Building2" :size="28" aria-hidden="true" />
              <strong>{{ SERVICE_TYPE_LABEL[t] }}</strong>
              <small>{{ t === 'CENTER' && !centerAllowed ? '이 제품은 방문 수리만 가능해요' : SERVICE_TYPE_DESC[t] }}</small>
            </button>
          </div>
          <p v-if="touched[2] && errs.serviceType" class="error-text">{{ errs.serviceType }}</p>
        </div>
        <div class="field">
          <label for="c-name" class="req">이름</label>
          <input id="c-name" v-model="form.customerName" class="input" maxlength="30" autocomplete="name" :class="{ invalid: touched[2] && errs.name }" :aria-invalid="touched[2] && !!errs.name" />
          <p v-if="touched[2] && errs.name" class="error-text">{{ errs.name }}</p>
        </div>
        <div class="field">
          <label for="c-phone" class="req">연락처</label>
          <input id="c-phone" v-model="form.phone" class="input" type="tel" inputmode="tel" maxlength="13" autocomplete="tel" placeholder="010-1234-5678" :class="{ invalid: touched[2] && errs.phone }" :aria-invalid="touched[2] && !!errs.phone" />
          <p class="help">접수 내역을 조회할 때 뒷자리 4자리가 필요해요.</p>
          <p v-if="touched[2] && errs.phone" class="error-text">{{ errs.phone }}</p>
        </div>
        <!-- 방문 수리: 주소 · 희망 방문일 · 시간대 -->
        <template v-if="form.serviceType === 'VISIT'">
          <div class="field span-2">
            <AddressSearchField
              v-model="visitAddress"
              id-prefix="c-addr"
              :address-error="touched[2] ? errs.address : null"
              :detail-error="touched[2] ? errs.detailAddress : null"
            />
          </div>
          <div class="field">
            <label for="c-date" class="req">희망 방문일</label>
            <input id="c-date" v-model="form.preferredDate" class="input" type="date" :min="today" :class="{ invalid: touched[2] && errs.date }" :aria-invalid="touched[2] && !!errs.date" />
            <p v-if="touched[2] && errs.date" class="error-text">{{ errs.date }}</p>
          </div>
          <div class="field">
            <span id="c-slot" class="label req">시간대</span>
            <div class="chips" role="radiogroup" aria-labelledby="c-slot">
              <button
                v-for="sl in (['AM', 'PM'] as const)"
                :key="sl"
                type="button"
                class="chip"
                role="radio"
                :aria-checked="form.visitSlot === sl"
                :aria-invalid="sl === 'AM' && touched[2] && !!errs.slot"
                @click="form.visitSlot = sl"
              >
                {{ VISIT_SLOT_LABEL[sl] }}
              </button>
            </div>
            <p v-if="touched[2] && errs.slot" class="error-text">{{ errs.slot }}</p>
          </div>
        </template>
        <!-- 센터 방문: 서비스센터 · 방문 예정일 (주소 입력 없음) -->
        <template v-else-if="form.serviceType === 'CENTER'">
          <div class="field">
            <label for="c-center" class="req">서비스센터</label>
            <select id="c-center" v-model="form.centerId" class="select" :class="{ invalid: touched[2] && errs.center }" :aria-invalid="touched[2] && !!errs.center">
              <option value="">서비스센터 선택</option>
              <option v-for="c in centers" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <p v-if="selectedCenter" class="help">{{ selectedCenter.address }}</p>
            <p v-if="touched[2] && errs.center" class="error-text">{{ errs.center }}</p>
          </div>
          <div class="field">
            <label for="c-date" class="req">방문 예정일</label>
            <input id="c-date" v-model="form.preferredDate" class="input" type="date" :min="today" :class="{ invalid: touched[2] && errs.date }" :aria-invalid="touched[2] && !!errs.date" />
            <p v-if="touched[2] && errs.date" class="error-text">{{ errs.date }}</p>
          </div>
        </template>
      </div>

      <div class="card form-card stack">
        <h2 class="sec">개인정보 수집·이용 동의</h2>
        <dl class="kv notice">
          <dt>수집 항목</dt>
          <dd>이름, 연락처, 주소, 희망 방문일, 구매일, 제품 사진</dd>
          <dt>이용 목적</dt>
          <dd>고장 접수 확인, 방문 일정 안내, 수리 진행 연락</dd>
          <dt>보유 기간</dt>
          <dd>수리 완료 후 회사 개인정보 처리방침에 따른 기간</dd>
        </dl>
        <p class="faint">동의를 거부할 수 있으며, 거부하면 온라인 접수를 이용할 수 없어요.</p>
        <label class="consent" :class="{ invalid: touched[2] && errs.consent }">
          <input v-model="agreed" type="checkbox" :aria-invalid="touched[2] && !!errs.consent" />
          <span><ShieldCheck :size="18" class="inline-ic" /> 개인정보 수집·이용에 동의합니다. (필수)</span>
        </label>
        <p v-if="touched[2] && errs.consent" class="error-text">{{ errs.consent }}</p>
      </div>
    </section>

    <!-- 이동 버튼 -->
    <div class="nav">
      <button v-if="step > 0" type="button" class="btn btn-lg" :disabled="loading" @click="prev"><ArrowLeft :size="20" /> 이전</button>
      <span class="spacer" />
      <button v-if="step < STEPS.length - 1" type="submit" class="btn btn-primary btn-lg">다음 <ArrowRight :size="20" /></button>
      <button v-else type="submit" class="btn btn-primary btn-lg" :disabled="loading || !available">
        <Loader2 v-if="loading" :size="20" class="spin" /><Send v-else :size="20" /> {{ loading ? '접수 중…' : '접수하기' }}
      </button>
    </div>
  </form>

  <!-- 문제 있는 사진 → 한 번 더 확인 -->
  <BaseModal :open="problemDlg" title="문제 있는 사진이 있어요" :width="460" @close="problemDlg = false">
    <p>사진 {{ quality.problems }}장에 문제가 있어요. 그대로 진행하면 기사님이 다시 사진을 요청할 수 있어요.</p>
    <template #footer>
      <button type="button" class="btn btn-primary" @click="problemDlg = false"><Camera :size="18" /> 다시 찍기</button>
      <button type="button" class="btn" @click="acceptProblems">이대로 진행</button>
    </template>
  </BaseModal>

  <!-- 접수 완료 팝업 -->
  <BaseModal :open="doneDlg && !!done" title="접수 완료" :width="440" @close="doneDlg = false">
    <ReceiptDone v-if="done" :receipt-no="done.receiptNo" :service-type="done.serviceType" :center-name="done.centerName" @navigate="doneDlg = false" />
  </BaseModal>
</template>

<style scoped>
.request {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--field-gap);
}
h1 {
  font-size: var(--fs-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
  text-align: center;
  margin: 6px 0 0;
}
/* 진행 표시 1/3 */
.progress {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  gap: 4px 10px;
}
.count {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.count b {
  font-size: var(--fs-lg);
  color: var(--primary);
}
.label {
  font-weight: 700;
}
.bar {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}
.bar li {
  height: 6px;
  border-radius: 999px;
  background: var(--blue-100);
}
.bar li.on {
  background: var(--primary);
}
.sec {
  font-size: var(--fs-md);
  font-weight: 700;
  margin: 0;
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
  padding: 0 16px;
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
.notice {
  font-size: var(--fs-sm);
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
}
.consent {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  font-weight: 600;
  cursor: pointer;
}
.consent input {
  width: 22px;
  height: 22px;
  flex: none;
  accent-color: var(--primary);
}
.consent.invalid {
  color: var(--danger);
}
.inline-ic {
  vertical-align: -3px;
  color: var(--primary);
}
.nav {
  display: flex;
  align-items: center;
  gap: 10px;
}
.done-page {
  padding: var(--form-pad);
}
@media (max-width: 480px) {
  .nav .btn-lg {
    padding: 0 18px;
    font-size: var(--fs-md);
  }
  .chip {
    padding: 0 14px;
  }
}
.svc-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.svc-card {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 18px 12px;
  border: 2px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  text-align: center;
}
.svc-card svg {
  color: var(--primary);
}
.svc-card small {
  color: var(--text-3);
  font-size: var(--fs-sm);
}
.svc-card[aria-checked='true'] {
  border-color: var(--primary);
  background: var(--blue-50);
}
.svc-card:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.svc-card:disabled svg {
  color: var(--text-3);
}
.svc-card:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}
</style>
