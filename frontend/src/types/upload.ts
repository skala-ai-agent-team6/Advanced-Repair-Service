import type { PhotoQualityRecord } from './index'

export interface UploadItem {
  id: string
  file: File
  dataUrl: string
  name: string
  size: number
}

/** 사진 칸 하나의 품질 검사 요약 (ImageUploader → 접수 화면) */
export interface QualitySummary {
  /** 검사 중(PENDING) 사진 수 — 0 이 될 때까지 진단 요청 불가 */
  checking: number
  /** 확인이 필요한 사진 수 (확인 안 한 WARNING + FAILED) */
  problems: number
  /** 불합격(FAILED) — 재촬영해야 진행 */
  failed: number
  /** 기사 확인 전인 WARNING */
  unacked: number
  /** 사진 id → 검사 기록 (업로드 시 함께 저장) */
  records: Record<string, PhotoQualityRecord>
}
