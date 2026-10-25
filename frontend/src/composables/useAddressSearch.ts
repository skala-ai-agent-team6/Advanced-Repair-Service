/* 주소 검색 상태 · 외부 스크립트 로드 (화면 컴포넌트에서 직접 쓰지 않고 이 composable 로)
 *  Mock: searchAddress 로 결과 목록 (검색 전 · 검색 중 · 결과 없음 · 오류 · 결과)
 *  실서버: Daum 우편번호 스크립트를 앱에서 한 번만 불러와 모달 안에 띄운다 (로드 실패 → 오류 + 다시 시도)
 *  검색어·주소는 로그에 남기지 않는다 */
import { ref } from 'vue'
import { searchAddress, ADDRESS_PROVIDER } from '@/api/address'
import type { AddressSearchResult } from '@/types'

const DAUM_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
let daumLoading: Promise<void> | null = null

/** Daum 우편번호 스크립트 — 한 번만 로드 (실패하면 다음 호출 때 다시 시도) */
export function loadDaumPostcode(): Promise<void> {
  if (window.daum?.Postcode) return Promise.resolve()
  if (daumLoading) return daumLoading
  daumLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = DAUM_SRC
    s.async = true
    s.onload = () => (window.daum?.Postcode ? resolve() : reject(new Error('postcode')))
    s.onerror = () => {
      s.remove()
      reject(new Error('postcode'))
    }
    document.head.appendChild(s)
  }).catch((e) => {
    daumLoading = null
    throw e
  })
  return daumLoading
}

/** Daum 결과 → 공통 결과. 건물명이 없으면 공동주택이 아닌 경우 법정동을 참고 항목으로 */
export function fromDaum(d: DaumPostcodeData): AddressSearchResult {
  const extra = d.buildingName || (d.bname && d.apartment !== 'Y' ? d.bname : '')
  return {
    postalCode: d.zonecode,
    roadAddress: d.roadAddress || d.jibunAddress,
    jibunAddress: d.jibunAddress || d.autoJibunAddress || undefined,
    buildingName: extra || undefined,
  }
}

export type AddressSearchStatus = 'idle' | 'loading' | 'empty' | 'error' | 'done'

export function useAddressSearch() {
  const keyword = ref('')
  const results = ref<AddressSearchResult[]>([])
  const status = ref<AddressSearchStatus>('idle')
  /** 직전 검색어 (다시 시도용) */
  let last = ''
  let seq = 0

  async function search(q = keyword.value) {
    const k = q.trim()
    if (!k) {
      status.value = 'idle'
      results.value = []
      return
    }
    last = k
    const my = ++seq
    status.value = 'loading'
    try {
      const list = await searchAddress(k)
      if (my !== seq) return
      results.value = list
      status.value = list.length ? 'done' : 'empty'
    } catch {
      if (my !== seq) return
      results.value = []
      status.value = 'error'
    }
  }
  const retry = () => search(last)
  function reset() {
    seq++
    keyword.value = ''
    results.value = []
    status.value = 'idle'
  }
  return { provider: ADDRESS_PROVIDER, keyword, results, status, search, retry, reset }
}
