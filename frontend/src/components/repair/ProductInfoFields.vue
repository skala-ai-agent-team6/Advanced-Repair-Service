<script setup lang="ts">
/* 제품 정보 입력 — 기사 수리 접수 · 소비자 고장 접수 공통 (한쪽만 고치면 둘 다 바뀜)
 *  시리얼 번호 * (스캔 아이콘 + [조회] → 제품 종류·제조사·모델명 자동 채움) · [제품 라벨 사진 등록]
 *  2열: 제품 종류 | 제조사 *  ·  모델명 * (자동완성) | 구매일 * + [ ] 구매일을 몰라요 (체크하면 시리얼로 보증 기간 추정)
 *  시리얼·구매일이 바뀌면 보증 기간 안내(WarrantyPeriodNotice). 검증 메시지는 부모가 errors 로 넘긴다
 *  labelOcr: 라벨 사진에서 시리얼 인식(기사 · FEATURES.labelOcr). 끄면 사진은 보면서 직접 입력용
 *  demoHint: 개발용 데모 시리얼 안내 (기사 화면만) */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { CircleAlert, CircleCheck, Search, Loader2, ScanLine, Camera, Trash2 } from 'lucide-vue-next'
import WarrantyPeriodNotice from '@/components/repair/WarrantyPeriodNotice.vue'
import { checkWarrantyPeriod, repairApi, toErrorMessage } from '@/api'
import { FEATURES } from '@/api/features'
import { modelsFor, PRODUCT_TYPE_DETAIL_MAX, PRODUCT_TYPE_OPTIONS, type ProductType } from '@/constants/products'
import type { ProductInfo, WarrantyPeriod } from '@/types'

const props = withDefaults(
  defineProps<{
    idPrefix?: string
    errors?: Partial<Record<'serial' | 'typeDetail' | 'manufacturer' | 'model' | 'purchase', string | null>>
    showErrors?: boolean
    labelOcr?: boolean
    demoHint?: boolean
  }>(),
  { idPrefix: 'pi', errors: () => ({}) },
)
const serial = defineModel<string>('serial', { required: true })
const productType = defineModel<ProductType | ''>('productType', { required: true })
const productTypeDetail = defineModel<string>('productTypeDetail', { required: true })
const manufacturer = defineModel<string>('manufacturer', { required: true })
const model = defineModel<string>('model', { required: true })
const purchaseDate = defineModel<string>('purchaseDate', { required: true })
const purchaseUnknown = defineModel<boolean>('purchaseUnknown', { required: true })
/** 시리얼 조회 결과 (공장·펌웨어 등 — 기사 화면이 추가 정보 카드에 사용) */
const product = defineModel<ProductInfo | null>('product', { default: null })

const id = (k: string) => `${props.idPrefix}-${k}`
const err = (k: keyof NonNullable<typeof props.errors>) => (props.showErrors ? props.errors?.[k] : null) ?? null
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

watch(productType, (v) => v !== 'unknown' && (productTypeDetail.value = ''))
watch(purchaseUnknown, (v) => v && (purchaseDate.value = ''))
const modelOptions = computed(() => modelsFor(productType.value))
const makerOptions = computed(() => [...new Set(modelOptions.value.map((m) => m.manufacturer))])

/* ---------- 시리얼 조회 → 제품 종류 · 제조사 · 모델명 채우기 ---------- */
const lookup = reactive({ loading: false, error: null as string | null })
async function findProduct() {
  const s = serial.value.trim().toUpperCase()
  serial.value = s
  lookup.error = null
  if (!s) {
    lookup.error = '시리얼 번호를 입력해 주세요.'
    return
  }
  lookup.loading = true
  try {
    const p = await repairApi.lookupProduct(s)
    product.value = p
    // 등록 제품 DB 는 로봇청소기 = 청소기
    const type: ProductType = p.productType ?? 'vacuum'
    productType.value = type
    model.value = p.model
    manufacturer.value = p.manufacturer ?? modelsFor(type).find((m) => m.name === p.model)?.manufacturer ?? manufacturer.value
  } catch (e) {
    product.value = null
    lookup.error = toErrorMessage(e)
  } finally {
    lookup.loading = false
  }
}
watch(serial, (v) => {
  if (product.value && v.trim().toUpperCase() !== product.value.serialNumber) product.value = null
  // 등록 제품 형식(RC + 숫자 10자리)을 다 입력하면 자동 조회
  if (/^RC\d{10}$/i.test(v.trim()) && !lookup.loading && !product.value) void findProduct()
})
/** 시리얼: 앞뒤 공백 제거 · 대문자로 저장 */
function onSerialBlur() {
  serial.value = serial.value.trim().toUpperCase()
  void refreshWarranty()
}

/* ---------- 제품 라벨 사진 (참고용 · 접수에 첨부하지 않음) ---------- */
const labelInput = ref<HTMLInputElement | null>(null)
const labelPhoto = ref<string | null>(null)
const ocr = reactive({ loading: false, serial: '', error: null as string | null })
async function onLabelPhoto(files: FileList | null) {
  const f = files?.[0]
  if (!f || !f.type.startsWith('image/')) return
  if (labelPhoto.value) URL.revokeObjectURL(labelPhoto.value)
  labelPhoto.value = URL.createObjectURL(f)
  if (labelInput.value) labelInput.value.value = ''
  if (!props.labelOcr || !FEATURES.labelOcr) return
  Object.assign(ocr, { loading: true, serial: '', error: null })
  try {
    const r = await repairApi.recognizeLabel(f)
    ocr.serial = r.serial
    serial.value = r.serial
  } catch (e) {
    ocr.error = toErrorMessage(e)
  } finally {
    ocr.loading = false
  }
}
function clearLabelPhoto() {
  if (labelPhoto.value) URL.revokeObjectURL(labelPhoto.value)
  labelPhoto.value = null
  ocr.serial = ''
}
onBeforeUnmount(clearLabelPhoto)

/* ---------- 보증 기간 안내 (시리얼 입력 0.5초 후 · 칸을 벗어날 때 · 구매일이 바뀔 때) ---------- */
const warrantyPeriod = ref<WarrantyPeriod | null>(null)
/** 오늘 이후가 아닌 구매일만 사용, "몰라요"면 시리얼(제조일)로 추정 */
const wpPurchase = computed(() => (!purchaseUnknown.value && purchaseDate.value && purchaseDate.value <= today ? purchaseDate.value : undefined))
let wpTimer: number | undefined
let wpSeq = 0
let wpKey = ''
async function refreshWarranty() {
  window.clearTimeout(wpTimer)
  const s = serial.value.trim().toUpperCase()
  if (!FEATURES.warrantyPeriod || !/^RC\d{10}$/.test(s)) {
    warrantyPeriod.value = null
    wpKey = ''
    return
  }
  const key = `${s}|${wpPurchase.value ?? ''}`
  if (key === wpKey) return
  wpKey = key
  const seq = ++wpSeq
  try {
    const res = await checkWarrantyPeriod(s, wpPurchase.value)
    if (seq === wpSeq) warrantyPeriod.value = res
  } catch {
    // 안내용이라 실패해도 접수는 계속 (박스만 숨김)
    if (seq === wpSeq) {
      warrantyPeriod.value = null
      wpKey = ''
    }
  }
}
watch(serial, () => {
  window.clearTimeout(wpTimer)
  wpTimer = window.setTimeout(refreshWarranty, 500)
})
watch(wpPurchase, () => void refreshWarranty())
onBeforeUnmount(() => window.clearTimeout(wpTimer))
// 새로고침으로 값이 복원된 경우에도 안내
if (serial.value) void refreshWarranty()
</script>

<template>
  <div class="pif">
    <!-- 시리얼 번호 + [조회] -->
    <div class="field">
      <label :for="id('serial')" class="req">시리얼 번호</label>
      <div class="serial-row">
        <div class="sw">
          <ScanLine :size="20" class="si" aria-hidden="true" />
          <input
            :id="id('serial')"
            v-model="serial"
            class="input mono big"
            :class="{ invalid: err('serial') || lookup.error }"
            placeholder="제품 라벨의 시리얼 번호"
            autocomplete="off"
            maxlength="30"
            :aria-invalid="!!lookup.error || !!err('serial')"
            :aria-describedby="id('serial-help')"
            @keydown.enter.prevent="findProduct"
            @blur="onSerialBlur"
          />
        </div>
        <button class="btn btn-lg" type="button" :disabled="lookup.loading" @click="findProduct">
          <Loader2 v-if="lookup.loading" :size="20" class="spin" /><Search v-else :size="20" /> 조회
        </button>
      </div>
      <p :id="id('serial-help')" class="help">
        제품 라벨의 번호를 입력하고 [조회]를 누르면 제품 정보를 채웁니다. 조회되지 않으면 아래 칸을 직접 입력해 주세요.<template v-if="demoHint"> (데모: RC2026000187)</template>
      </p>
      <p v-if="lookup.error" class="error-text" role="alert"><CircleAlert :size="16" /> {{ lookup.error }} 아래 칸을 직접 입력해도 접수할 수 있어요.</p>
      <p v-else-if="err('serial')" class="error-text" role="alert"><CircleAlert :size="16" /> {{ err('serial') }}</p>
      <p v-else-if="product" class="ok-text"><CircleCheck :size="16" /> 조회한 제품 정보를 채웠어요. 다르면 직접 고쳐 주세요.</p>
      <WarrantyPeriodNotice :period="warrantyPeriod" />
    </div>

    <!-- 제품 라벨 사진 (참고용) -->
    <div class="label-photo">
      <input ref="labelInput" type="file" accept="image/*" capture="environment" class="sr-only" aria-label="제품 라벨 사진 등록" @change="onLabelPhoto(($event.target as HTMLInputElement).files)" />
      <template v-if="labelPhoto">
        <img :src="labelPhoto" alt="제품 라벨 사진" class="label-img" />
        <div class="stack label-acts">
          <p v-if="ocr.loading" class="faint"><Loader2 :size="14" class="spin" /> 라벨에서 시리얼 번호를 찾고 있어요…</p>
          <p v-else-if="ocr.serial">인식한 시리얼 <b class="mono">{{ ocr.serial }}</b>을 입력했어요. 사진과 같은지 확인하고, 다르면 고쳐 주세요.</p>
          <p v-else-if="ocr.error" class="error-text">{{ ocr.error }} 사진을 보며 직접 입력해 주세요.</p>
          <p v-else class="faint">사진을 보며 시리얼 번호를 입력해 주세요.</p>
          <p class="faint">라벨 사진은 접수에 첨부되지 않습니다.</p>
          <div class="row">
            <button type="button" class="btn btn-sm" @click="labelInput?.click()"><Camera :size="16" /> 다시 찍기</button>
            <button type="button" class="btn btn-sm btn-ghost" @click="clearLabelPhoto"><Trash2 :size="16" /> 지우기</button>
          </div>
        </div>
      </template>
      <button v-else type="button" class="btn" :disabled="ocr.loading" @click="labelInput?.click()"><Camera :size="18" /> 제품 라벨 사진 등록</button>
    </div>

    <!-- 2열: 제품 종류 | 제조사 · 모델명 | 구매일 -->
    <div class="pif-grid">
      <div class="field">
        <label :for="id('type')">제품 종류</label>
        <select :id="id('type')" v-model="productType" class="select">
          <option value="">제품 종류 선택</option>
          <option v-for="o in PRODUCT_TYPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <div v-if="productType === 'unknown'" class="field sub-field">
          <label :for="id('type-detail')" class="req">제품 종류 직접 입력</label>
          <input
            :id="id('type-detail')"
            v-model="productTypeDetail"
            class="input"
            :maxlength="PRODUCT_TYPE_DETAIL_MAX"
            autocomplete="off"
            placeholder="예) 전자레인지"
            :class="{ invalid: err('typeDetail') }"
            :aria-invalid="!!err('typeDetail')"
            @blur="productTypeDetail = productTypeDetail.trim()"
          />
          <p v-if="err('typeDetail')" class="error-text">{{ err('typeDetail') }}</p>
        </div>
      </div>
      <div class="field">
        <label :for="id('maker')" class="req">제조사</label>
        <input :id="id('maker')" v-model="manufacturer" class="input" :list="id('maker-list')" maxlength="40" autocomplete="off" placeholder="예) ROVIA" :class="{ invalid: err('manufacturer') }" :aria-invalid="!!err('manufacturer')" />
        <datalist :id="id('maker-list')"><option v-for="m in makerOptions" :key="m" :value="m" /></datalist>
        <p v-if="err('manufacturer')" class="error-text">{{ err('manufacturer') }}</p>
      </div>
      <div class="field">
        <label :for="id('model')" class="req">모델명</label>
        <input :id="id('model')" v-model="model" class="input" :list="id('model-list')" maxlength="60" autocomplete="off" placeholder="예) RC-A100" :class="{ invalid: err('model') }" :aria-invalid="!!err('model')" />
        <datalist :id="id('model-list')"><option v-for="m in modelOptions" :key="m.name" :value="m.name">{{ m.manufacturer }}</option></datalist>
        <p v-if="err('model')" class="error-text">{{ err('model') }}</p>
      </div>
      <div class="field">
        <label :for="id('purchase')" :class="{ req: !purchaseUnknown }">구매일</label>
        <input
          :id="id('purchase')"
          v-model="purchaseDate"
          class="input"
          type="date"
          :max="today"
          :disabled="purchaseUnknown"
          :class="{ invalid: err('purchase') }"
          :aria-invalid="!!err('purchase')"
          :aria-describedby="id('purchase-help')"
        />
        <label class="check">
          <input v-model="purchaseUnknown" type="checkbox" />
          <span>구매일을 몰라요</span>
        </label>
        <p :id="id('purchase-help')" class="help">무상 수리 여부 확인에 사용돼요. 모르면 시리얼 번호로 보증 기간을 추정해요.</p>
        <p v-if="err('purchase')" class="error-text">{{ err('purchase') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pif {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--field-gap, 16px);
}
.serial-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}
.sw {
  position: relative;
}
.sw .input {
  width: 100%;
  padding-left: 44px;
}
.si {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.big {
  font-size: var(--fs-lg);
  letter-spacing: 0.04em;
}
.ok-text {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--success);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.label-photo {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 14px;
}
.label-img {
  width: 220px;
  max-width: 100%;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.label-acts {
  flex: 1 1 220px;
}
.label-acts p {
  margin: 0;
}
.pif-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
  align-items: start;
}
.sub-field {
  margin-top: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-weight: 600;
  cursor: pointer;
}
.check input {
  width: 20px;
  height: 20px;
}
/* 휴대폰: 1열 */
@media (max-width: 640px) {
  .pif-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
