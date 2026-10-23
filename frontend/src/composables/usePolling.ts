/* 상태가 끝날 때까지 주기적으로 다시 조회 (사내 사례 동기화 · 자동 재처리 카드 공통)
 *  - active(v) 가 true 인 동안 interval 마다 다시 조회, timeout(기본 120초)이 지나면 멈추고 timedOut
 *  - 조회 실패: maxErrors 번까지는 retrying 으로 자동 재시도, 그 뒤 error (수동 [다시 시도])
 *  - 403·404: forbidden (권한 없음 · 담당 건 아님) — 재시도하지 않음 */
import { onBeforeUnmount, ref, type Ref } from 'vue'
import { ApiError, toErrorMessage } from '@/api'

export function usePolling<T>(fetcher: () => Promise<T>, opts: { active: (v: T) => boolean; interval?: number; timeout?: number; maxErrors?: number }) {
  const interval = opts.interval ?? 3000
  const timeout = opts.timeout ?? 120_000
  const maxErrors = opts.maxErrors ?? 3

  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(false)
  const error = ref<string | null>(null)
  const forbidden = ref(false)
  const retrying = ref(false)
  const polling = ref(false)
  const timedOut = ref(false)

  let timer: number | undefined
  let startedAt = 0
  let errors = 0
  let seq = 0

  function schedule() {
    timer = window.setTimeout(tick, interval)
  }
  async function tick() {
    const my = ++seq
    try {
      const v = await fetcher()
      if (my !== seq) return
      data.value = v
      error.value = null
      errors = 0
      retrying.value = false
      if (opts.active(v)) {
        if (Date.now() - startedAt >= timeout) {
          timedOut.value = true
          polling.value = false
          return
        }
        polling.value = true
        schedule()
      } else polling.value = false
    } catch (e) {
      if (my !== seq) return
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        forbidden.value = true
        polling.value = retrying.value = false
        return
      }
      errors += 1
      if (errors < maxErrors) {
        retrying.value = true
        schedule()
      } else {
        retrying.value = polling.value = false
        error.value = toErrorMessage(e)
      }
    } finally {
      if (my === seq) loading.value = false
    }
  }

  function stop() {
    window.clearTimeout(timer)
    seq += 1
    polling.value = false
  }
  /** 처음부터 다시 (120초 제한도 다시 센다) */
  function start() {
    stop()
    startedAt = Date.now()
    errors = 0
    error.value = null
    forbidden.value = false
    retrying.value = false
    timedOut.value = false
    loading.value = data.value === null
    void tick()
  }
  onBeforeUnmount(stop)

  return { data, loading, error, forbidden, retrying, polling, timedOut, start, stop }
}
