/* 브라우저 안에서 동작하는 Mock DB. localStorage 에 저장해 새로고침해도 데모 흐름이 유지된다. */
import { createDefectRecords, createSeed, type DefectRecord, type MockDbState } from './data'
import type { RepairEvent } from '@/types'

const KEY = 'robotcare-mock-db-v16'
const KEY_RECORDS = 'robotcare-mock-approved-v16'

function load(): MockDbState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as MockDbState
  } catch {
    /* 저장소 사용 불가 시 시드로 시작 */
  }
  return createSeed()
}

export const db: MockDbState = load()

/** 승인되어 "사내 고장 DB" 에 반영된 레코드 = 시드 이력 + 데모 중 승인된 건 */
export const baseDefectRecords: DefectRecord[] = createDefectRecords()
export const approvedRecords: DefectRecord[] = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY_RECORDS) ?? '[]') as DefectRecord[]
  } catch {
    return []
  }
})()

let saveTimer: number | undefined
function flush() {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
    localStorage.setItem(KEY_RECORDS, JSON.stringify(approvedRecords))
  } catch (e) {
    console.warn('[mock-db] 저장 실패', e)
  }
}
/** 변경을 모아 150ms 뒤 저장. 새로고침·탭 닫기 직전에는 즉시 저장 */
export function persist() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(flush, 150)
}
window.addEventListener('pagehide', () => saveTimer !== undefined && flush())
window.addEventListener('beforeunload', () => saveTimer !== undefined && flush())

export function resetDb() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(KEY_RECORDS)
  } catch {
    /* noop */
  }
  window.location.reload()
}

export function nextId() {
  db.seq += 1
  persist()
  return db.seq
}

/* ---------------- SSE 대용 이벤트 버스 ---------------- */
type Listener = (e: RepairEvent) => void
const listeners = new Map<number, Set<Listener>>()
const anyListeners = new Set<Listener>()

export function emit(e: RepairEvent) {
  listeners.get(e.repairId)?.forEach((l) => l(e))
  anyListeners.forEach((l) => l(e))
}

export function on(repairId: number | '*', l: Listener): () => void {
  if (repairId === '*') {
    anyListeners.add(l)
    return () => anyListeners.delete(l)
  }
  if (!listeners.has(repairId)) listeners.set(repairId, new Set())
  listeners.get(repairId)!.add(l)
  return () => listeners.get(repairId)?.delete(l)
}
