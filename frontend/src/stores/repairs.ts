/* 수리 목록 스토어 — 목록·필터·요약 카운트 + 전역 SSE 로 실시간 반영 */
import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { partApi, repairApi, toErrorMessage } from '@/api'
import { matchPreset, partsWaitingIds, presetNeedsOrders, type RepairPreset } from '@/utils/repairPresets'
import { connectAllEvents, type SseConnection } from '@/services/sse'
import type { Repair, RepairEvent, RepairQuery, RepairStatusCounts, RepairSummaryCounts } from '@/types'

const EMPTY_COUNTS: RepairSummaryCounts = { needPhoto: 0, technicianReview: 0, reportPending: 0, completed: 0, analyzing: 0, manualReview: 0 }

export const useRepairListStore = defineStore('repairList', () => {
  const items = ref<Repair[]>([])
  const counts = ref<RepairSummaryCounts>({ ...EMPTY_COUNTS })
  const statusCounts = ref<RepairStatusCounts>({})
  const query = reactive<RepairQuery>({ status: 'ALL', keyword: '', sort: 'receivedAt_desc' })
  /** 기사 홈 카드에서 넘어온 필터 (프론트에서 거름, 서버로 보내지 않음) */
  const preset = ref<RepairPreset | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const loadedAt = ref<string | null>(null)
  let stream: SseConnection | null = null
  let refreshTimer: number | undefined

  async function fetch() {
    loading.value = true
    error.value = null
    try {
      const res = await repairApi.list({ ...query })
      items.value = await applyPreset(res.items)
      counts.value = res.counts
      statusCounts.value = res.statusCounts ?? {}
      loadedAt.value = new Date().toISOString()
    } catch (e) {
      error.value = toErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  function applyEvent(e: RepairEvent) {
    const it = items.value.find((r) => r.id === e.repairId)
    if (!it) return
    const statusChanged = it.status !== e.status
    it.status = e.status
    it.progress = e.progress
    it.progressMessage = e.message
    // 상태가 바뀌면 카운트 재조회 (디바운스)
    if (statusChanged) {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => void silentRefresh(), 600)
    }
  }

  async function silentRefresh() {
    try {
      const res = await repairApi.list({ ...query })
      items.value = await applyPreset(res.items)
      counts.value = res.counts
      statusCounts.value = res.statusCounts ?? {}
    } catch {
      /* 백그라운드 갱신 실패는 무시 */
    }
  }

  async function applyPreset(list: Repair[]): Promise<Repair[]> {
    const p = preset.value
    if (!p) return list
    const waiting = presetNeedsOrders(p) ? partsWaitingIds(await partApi.orders()) : new Set<number>()
    return list.filter((r) => matchPreset(r, p, waiting))
  }

  function startLive() {
    if (stream) return
    stream = connectAllEvents(applyEvent)
  }
  function stopLive() {
    stream?.close()
    stream = null
  }

  function resetQuery() {
    Object.assign(query, { status: 'ALL', keyword: '', sort: 'receivedAt_desc', model: undefined, group: undefined })
    preset.value = null
  }

  return { items, counts, statusCounts, query, preset, loading, error, loadedAt, fetch, startLive, stopLive, resetQuery }
})
