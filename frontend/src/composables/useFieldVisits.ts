/* 출장 일정 공통 (홈 · 오늘의 출장 목록)
 *  - 출장기사(FIELD)만 조회한다. 센터 수리자(CENTER)는 호출하지 않고 0건 (출장 데이터를 임의로 보여주지 않음)
 *  - 실서버에서 FEATURES.fieldSchedule 이 꺼져 있으면 API 함수가 네트워크 호출 없이 빈 목록을 돌려준다
 *  - 날짜·시간은 한국 시간 기준
 *  - 홈 여러 곳(오늘의 출장 영역 · 진행률)에서 쓰므로 데이터는 공유하고, 사용자별로 한 번만 불러온다 */
import { computed, ref } from 'vue'
import { getMyFieldVisits, toErrorMessage } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { kstToday } from '@/utils/kst'
import type { FieldVisit } from '@/types'

/* 공유 상태 (모듈 단위) */
const visits = ref<FieldVisit[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let inflight: Promise<void> | null = null
let inflightFor = ''

export function useFieldVisits() {
  const auth = useAuthStore()
  const today = kstToday()
  const isField = computed(() => auth.technicianType === 'FIELD')

  /** 같은 사용자가 동시에 여러 번 부르면 한 번만 요청 */
  function load(): Promise<void> {
    error.value = null
    if (!isField.value) {
      visits.value = []
      return Promise.resolve()
    }
    const who = auth.user?.employeeId ?? ''
    if (inflight && inflightFor === who) return inflight
    inflightFor = who
    loading.value = true
    inflight = getMyFieldVisits()
      .then((v) => {
        visits.value = v
      })
      .catch((e) => {
        error.value = toErrorMessage(e)
      })
      .finally(() => {
        loading.value = false
        inflight = null
      })
    return inflight
  }

  const byTime = (a: FieldVisit, b: FieldVisit) => `${a.visitDate} ${a.visitTime}`.localeCompare(`${b.visitDate} ${b.visitTime}`)
  /** 오늘 방문 일정 (방문 시간 순) */
  const todayVisits = computed(() => visits.value.filter((v) => v.visitDate === today).sort(byTime))
  const scheduledToday = computed(() => todayVisits.value.filter((v) => v.visitStatus !== 'DONE'))
  /** 다음 방문: 아직 방문하지 않은 가장 빠른 일정 (오늘 이후 포함) */
  const nextVisit = computed(() => [...visits.value].sort(byTime).find((v) => v.visitStatus !== 'DONE') ?? null)

  /** 홈 숫자 — 오늘 출장 기준
   *  부품 확인 필요: 진단을 확인해 부품을 챙겨야 하는 예정 방문(TECHNICIAN_REVIEW)
   *  AI 진단 확인: AI 진단 초안을 아직 확인하지 않은 예정 방문(DIAGNOSIS_COMPLETED) */
  const counts = computed(() => ({
    today: todayVisits.value.length,
    partsCheck: scheduledToday.value.filter((v) => v.status === 'TECHNICIAN_REVIEW').length,
    aiCheck: scheduledToday.value.filter((v) => v.status === 'DIAGNOSIS_COMPLETED').length,
    done: todayVisits.value.filter((v) => v.visitStatus === 'DONE').length,
  }))

  return { visits, loading, error, today, isField, todayVisits, nextVisit, counts, load }
}
