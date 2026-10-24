/* 수리 리포트 변환: 백엔드 Report(header + revisions) ↔ 프론트 RepairReport */
import type { RepairReport, ReportContent } from '@/types'
import type { BeReport, BeReportContent } from './types'

const user = (id: string) => `사용자 #${id}`

function toContent(c: BeReportContent): ReportContent {
  return {
    actualCause: c.actualCause,
    actualAction: c.actualAction,
    technicianOpinion: c.technicianOpinion,
    faults: c.faults.map((f) => ({ area: f.area, ...(f.partId ? { partId: f.partId } : {}) })),
    repairSuccessful: c.repairSuccessful,
    // outcome 을 생략하면 백엔드가 repairSuccessful 로 FIXED/NOT_FIXED 를 정한다
    outcome: c.outcome ?? (c.repairSuccessful ? 'FIXED' : 'NOT_FIXED'),
    aiAcceptance: c.aiAcceptance,
  }
}

/** 프론트 → PUT /report/draft 본문의 content (componentId 는 보내지 않음) */
export function toBeContent(c: ReportContent): BeReportContent {
  return { ...c, faults: c.faults.map((f) => ({ area: f.area, partId: f.partId ?? null })) }
}

export function toRepairReport(r: BeReport): RepairReport {
  const revs = [...r.revisions].sort((a, b) => a.revision - b.revision)
  const latest = revs.find((x) => x.revision === r.latest_revision) ?? revs[revs.length - 1]
  const first = revs[0]
  const confirmedLatest = r.confirmed_revision != null && r.confirmed_revision === r.latest_revision
  return {
    id: String(r.id),
    repairId: Number(r.case_id),
    version: r.version,
    revision: r.latest_revision,
    status: confirmedLatest ? 'CONFIRMED' : 'DRAFT',
    content: toContent(latest.content),
    createdBy: user(first?.author_id ?? r.author_id),
    updatedBy: user(latest.author_id),
    updatedAt: latest.created_at,
    confirmedBy: confirmedLatest ? user(latest.author_id) : undefined,
    confirmedAt: confirmedLatest ? (latest.confirmed_at ?? r.confirmed_at ?? undefined) : undefined,
    // 확정된 revision 들 (작성자 = 그 revision 작성자)
    confirmations: revs.filter((x) => x.confirmed_at).map((x) => ({ revision: x.revision, confirmedBy: user(x.author_id), confirmedAt: x.confirmed_at! })),
  }
}
