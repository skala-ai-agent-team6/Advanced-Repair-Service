<script setup lang="ts">
/* 방문 주소 입력 — [우편번호][주소 검색] / [도로명주소] / 지번·참고 항목 / [상세주소]
 *  우편번호·도로명주소는 읽기 전용 (누르면 주소 검색 모달). 상세주소는 주소를 고른 뒤에 입력
 *  결과를 고르면 모달을 닫고 상세주소 칸으로 포커스 이동 */
import { computed, nextTick, ref } from 'vue'
import { Search, CircleAlert } from 'lucide-vue-next'
import AddressSearchModal from './AddressSearchModal.vue'
import { DETAIL_ADDRESS_MAX } from '@/api/adapters/address'
import type { AddressSearchResult, VisitAddress } from '@/types'

const props = defineProps<{
  modelValue: VisitAddress
  /** 검증 메시지 (보여 줄 때만 넘김) */
  addressError?: string | null
  detailError?: string | null
  idPrefix?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [VisitAddress] }>()

const id = (k: string) => `${props.idPrefix ?? 'visit'}-${k}`
const open = ref(false)
const detailEl = ref<HTMLInputElement | null>(null)
const hasAddress = computed(() => !!props.modelValue.roadAddress)

function openSearch() {
  open.value = true
}
async function onSelect(r: AddressSearchResult) {
  const prev = props.modelValue
  emit('update:modelValue', {
    postalCode: r.postalCode,
    roadAddress: r.roadAddress,
    jibunAddress: r.jibunAddress ?? '',
    buildingName: r.buildingName ?? '',
    // 같은 주소를 다시 고르면 상세주소는 그대로, 다른 주소면 비움
    detailAddress: prev.roadAddress === r.roadAddress ? prev.detailAddress : '',
  })
  open.value = false
  // 모달이 닫히며 검색 버튼으로 돌아간 포커스를 상세주소로 옮김
  await nextTick()
  await nextTick()
  detailEl.value?.focus()
}
function setDetail(v: string) {
  emit('update:modelValue', { ...props.modelValue, detailAddress: v })
}
</script>

<template>
  <fieldset class="addr-field" :aria-describedby="addressError ? id('addr-err') : undefined">
    <legend class="label req">방문 주소</legend>

    <div class="zip-row">
      <label :for="id('zip')" class="sr-only">우편번호</label>
      <input
        :id="id('zip')"
        :value="modelValue.postalCode"
        class="input mono readonly"
        readonly
        placeholder="우편번호"
        :class="{ invalid: addressError }"
        :aria-invalid="!!addressError"
        aria-haspopup="dialog"
        @click="openSearch"
        @keydown.enter.prevent="openSearch"
      />
      <button type="button" class="btn btn-primary search-btn" aria-haspopup="dialog" @click="openSearch">
        <Search :size="18" aria-hidden="true" /> {{ hasAddress ? '주소 다시 검색' : '주소 검색' }}
      </button>
    </div>

    <div class="road">
      <label :for="id('road')" class="sr-only">도로명주소</label>
      <Search :size="18" class="road-ic" aria-hidden="true" />
      <input
        :id="id('road')"
        :value="modelValue.roadAddress"
        class="input readonly"
        readonly
        placeholder="주소 검색을 눌러 도로명주소를 찾아 주세요"
        :class="{ invalid: addressError }"
        aria-haspopup="dialog"
        @click="openSearch"
        @keydown.enter.prevent="openSearch"
      />
    </div>

    <p v-if="modelValue.jibunAddress || modelValue.buildingName" class="extra faint">
      <template v-if="modelValue.jibunAddress">지번주소: {{ modelValue.jibunAddress }}</template>
      <template v-if="modelValue.jibunAddress && modelValue.buildingName"><br /></template>
      <template v-if="modelValue.buildingName">참고 항목: {{ modelValue.buildingName }}</template>
    </p>
    <p v-if="addressError" :id="id('addr-err')" class="error-text"><CircleAlert :size="16" aria-hidden="true" /> {{ addressError }}</p>

    <label :for="id('detail')" class="sr-only">상세주소</label>
    <input
      :id="id('detail')"
      ref="detailEl"
      :value="modelValue.detailAddress"
      class="input"
      :maxlength="DETAIL_ADDRESS_MAX"
      autocomplete="address-line2"
      :disabled="!hasAddress"
      :placeholder="hasAddress ? '상세주소를 입력해 주세요 (예: 101동 1001호)' : '주소를 먼저 검색해 주세요'"
      :class="{ invalid: detailError }"
      :aria-invalid="!!detailError"
      :aria-describedby="detailError ? id('detail-err') : undefined"
      @input="setDetail(($event.target as HTMLInputElement).value)"
      @blur="setDetail(($event.target as HTMLInputElement).value.trim())"
    />
    <p v-if="detailError" :id="id('detail-err')" class="error-text"><CircleAlert :size="16" aria-hidden="true" /> {{ detailError }}</p>

    <AddressSearchModal :open="open" @close="open = false" @select="onSelect" />
  </fieldset>
</template>

<style scoped>
.addr-field {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.addr-field legend {
  padding: 0;
  margin-bottom: 6px;
}
.zip-row {
  display: grid;
  grid-template-columns: minmax(0, 200px) auto;
  gap: 8px;
}
.search-btn {
  min-height: 48px;
  white-space: nowrap;
}
.readonly {
  cursor: pointer;
  background: var(--surface-2);
}
.road {
  position: relative;
}
.road .input {
  width: 100%;
  padding-left: 40px;
}
.road-ic {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  pointer-events: none;
}
.extra {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
@media (max-width: 480px) {
  .zip-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
