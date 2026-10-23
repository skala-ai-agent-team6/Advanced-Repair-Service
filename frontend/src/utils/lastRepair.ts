/* 기사가 마지막으로 본 수리 건 (수리 작업 상세 메뉴의 "이어서 보기"). 탭을 닫으면 사라짐 */
const KEY = 'robotcare-last-repair'

export function rememberRepair(id: number) {
  try {
    sessionStorage.setItem(KEY, String(id))
  } catch {
    /* 저장소 사용 불가 시 무시 */
  }
}
export function lastRepairId(): number | null {
  try {
    const v = Number(sessionStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
