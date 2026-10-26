/* 출장 전 진단 리포트 모달 열림 상태 (앱 전체에서 하나)
 *  '오늘의 출장' 목록의 [출장 전 리포트]와 '다음 방문' 카드의 [출장 전 리포트]가 같은 open() 을 부르고,
 *  모달은 AppLayout 에 한 번만 그려진다 (출장기사만). 닫으면 선택한 방문 · 임시 수정 상태를 비운다 */
import { reactive } from 'vue'
import type { FieldVisit } from '@/types'

const state = reactive({ open: false, repairId: null as number | null, visitId: null as string | null, readonly: false })

export function usePreVisitReportModal() {
  /** 방문 완료 건은 조회 전용 */
  function open(v: Pick<FieldVisit, 'repairId' | 'visitId' | 'visitStatus'>) {
    Object.assign(state, { open: true, repairId: v.repairId, visitId: v.visitId, readonly: v.visitStatus === 'DONE' })
  }
  function close() {
    Object.assign(state, { open: false, repairId: null, visitId: null, readonly: false })
  }
  return { state, open, close }
}
