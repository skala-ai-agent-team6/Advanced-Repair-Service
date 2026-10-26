/* AI 진단 변환: 백엔드 Task(+result) · ToolExecution → 프론트 Diagnosis (에이전트 v2 필드가 있으면 우선 사용)
 * 백엔드에 없는 필드(에러코드 해석·유사 사례·점검 순서)는 빈 배열로 두고, 화면은 데이터가 없으면 해당 카드를 숨긴다. */
import type { AgentResult, AgentType, AgentVerdict, DataSource, Decision, Diagnosis, ImageAnnotation, Part, Urgency } from '@/types'
import type { BeAgent, BeCandidate, BeEvidence, BeSimilarCase, BeTask, BeToolExecution } from './types'

/** 백엔드·AI 서버 confidence 는 0~1 → 화면 'AI 판단 점수' 0~100 (확률이 아니라 후보 비교 점수) */
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100)

/** "1. 커넥터 재체결\n2. 교체" 같은 문자열 → 단계 배열 */
export function splitSteps(s: string | undefined): string[] {
  return (s ?? '')
    .split(/\r?\n|(?:^|\s)(?=\d+[.)]\s)/)
    .map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
}

const EVIDENCE_TYPE: Record<string, DataSource['type']> = {
  IMAGE: 'IMAGE',
  PHOTO: 'IMAGE',
  MANUAL: 'MANUAL',
  DOCUMENT: 'MANUAL',
  REPAIR_DB: 'REPAIR_DB',
  CASE: 'REPAIR_DB',
  LOG: 'SENSOR_LOG',
  SENSOR_LOG: 'SENSOR_LOG',
  ERROR_CODE: 'ERROR_CODE_TABLE',
}
function toSource(e: BeEvidence, i: number): DataSource {
  const type = EVIDENCE_TYPE[e.type?.toUpperCase()] ?? (e.attachmentId ? 'IMAGE' : 'MANUAL')
  return { id: `E${i + 1}`, type, title: e.citation || (e.attachmentId ? `첨부 사진 #${e.attachmentId}` : e.type), ref: e.attachmentId ? `attachment ${e.attachmentId}` : e.type }
}

/** evidence.annotation({label,x,y,w,h,severity} 형태일 때) → 사진 위 이상 영역 */
function toAnnotation(e: BeEvidence): ImageAnnotation | null {
  const a = e.annotation
  if (!a || !e.attachmentId) return null
  const n = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : NaN)
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map(n)
  if ([x, y, w, h].some(Number.isNaN)) return null
  const sev = String(a.severity ?? 'MEDIUM').toUpperCase()
  return { imageId: e.attachmentId, label: String(a.label ?? e.citation ?? '이상 영역'), x, y, w, h, severity: sev === 'HIGH' || sev === 'LOW' ? sev : 'MEDIUM' }
}

/** agent_type → 부위별 분석 카드 (PCB · 기계(MOTOR)). RAG·소견 정리 등 그 외 도구는 카드로 만들지 않는다 */
function agentOf(t: string): AgentType | null {
  const u = t.toUpperCase()
  if (u.includes('PCB')) return 'PCB'
  if (u.includes('MOTOR') || u.includes('MECH')) return 'MOTOR'
  return null
}

/** 도구 실행 이력 → Agent 별 결과. output_payload 는 정해진 스키마가 없어 흔한 키(verdict/summary/findings/confidence)만 읽는다 */
export function toAgents(tools: BeToolExecution[], annotations: ImageAnnotation[] = []): AgentResult[] {
  const byAgent = new Map<AgentType, BeToolExecution[]>()
  for (const t of tools) {
    const a = agentOf(t.agent_type)
    if (a) byAgent.set(a, [...(byAgent.get(a) ?? []), t])
  }
  return [...byAgent.entries()].map(([agent, runs]) => {
    const last = runs[runs.length - 1]
    const out = (last.output_payload ?? {}) as Record<string, unknown>
    const v = String(out.verdict ?? '').toUpperCase()
    const verdict: AgentVerdict = (['NORMAL', 'ABNORMAL', 'SUSPICIOUS', 'SKIPPED'] as const).find((x) => x === v) ?? (last.status === 'FAILED' ? 'SKIPPED' : 'SUSPICIOUS')
    const dur = last.finished_at ? (new Date(last.finished_at).getTime() - new Date(last.started_at).getTime()) / 1000 : 0
    return {
      agent,
      verdict,
      summary: String(out.summary ?? last.error_message ?? `${last.tool_name} 실행 ${runs.length}회`),
      findings: Array.isArray(out.findings) ? out.findings.map(String) : runs.map((r) => `${r.tool_name} · ${r.status}`),
      confidence: typeof out.confidence === 'number' ? pct(out.confidence) : 0,
      annotations,
      sourceIds: [],
      durationSec: Math.max(0, Math.round(dur)),
    }
  })
}

/** 에이전트 v2 result.agents → Agent 별 결과 (박스 좌표 0~1 → %) */
function fromResultAgents(agents: BeAgent[], tools: BeToolExecution[]): AgentResult[] {
  return agents.flatMap((a) => {
    const agent = agentOf(a.agent)
    if (!agent) return []
    const run = tools.find((t) => t.tool_name === a.tool)
    const dur = run?.finished_at ? (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000 : 0
    const v = a.verdict?.toUpperCase()
    return [{
      agent,
      verdict: (['NORMAL', 'ABNORMAL', 'SUSPICIOUS', 'SKIPPED'] as const).find((x) => x === v) ?? 'SUSPICIOUS',
      summary: a.summary,
      findings: a.findings ?? [],
      confidence: pct(a.confidence ?? 0),
      // [통합] 확신도 0.5 미만 약한 검출은 그리지 않음 ('정상'으로 표시돼 오해를 줌)
      annotations: (a.annotations ?? []).filter((b) => b.score >= 0.5).map((b) => ({
        imageId: String(b.attachmentId),
        label: b.label,
        x: b.x * 100,
        y: b.y * 100,
        w: b.width * 100,
        h: b.height * 100,
        severity: b.score >= 0.8 ? 'HIGH' : b.score >= 0.5 ? 'MEDIUM' : 'LOW',
      })),
      sourceIds: [],
      durationSec: Math.max(0, Math.round(dur)),
    }]
  })
}

/** 유사 사례 (RAG) → 화면 사례. 모델·종결일 정보는 없어 '-' */
const toCase = (c: BeSimilarCase) => ({ receiptNo: c.caseId, model: c.origin === 'EXTERNAL' ? '외부 사례' : '내부 사례', cause: c.summaryKo, resolution: c.originalText ?? '', similarity: pct(c.similarity), closedAt: '', origin: c.origin === 'EXTERNAL' ? ('EXTERNAL' as const) : ('INTERNAL' as const) })

export function toDiagnosis(
  task: BeTask,
  ctx: { parts: Part[]; tools?: BeToolExecution[]; urgency?: Urgency; decision: Decision },
): Diagnosis | null {
  const res = task.result
  // result.candidates(camelCase)가 원본. task.candidates 는 백엔드 정규화 테이블(snake_case: cause_code·cause_description)
  const candidates: BeCandidate[] = res?.candidates?.length
    ? res.candidates
    : (task.candidates ?? []).map((c) => {
        const r = c as unknown as Record<string, unknown>
        return { ...c, cause: c.cause ?? String(r.cause_code ?? '-'), explanation: c.explanation ?? String(r.cause_description ?? '') }
      })
  if (!res && !candidates.length) return null
  const evidence = (res?.evidence?.length ? res.evidence : task.evidence) ?? []
  const recommended = (task.recommendedParts?.length ? task.recommendedParts : res?.recommendedParts) ?? []
  const sources: DataSource[] = res?.sources?.length
    ? res.sources.map((x) => ({ id: x.id, type: EVIDENCE_TYPE[x.type?.toUpperCase()] ?? 'MANUAL', title: x.title, ref: x.ref }))
    : evidence.map(toSource)
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank)
  const annotations = evidence.map(toAnnotation).filter((x): x is ImageAnnotation => !!x)
  return {
    id: task.id,
    repairId: Number(task.case_id),
    version: task.input_revision,
    origin: 'AI',
    raw: res ?? undefined,
    generatedAt: task.finished_at ?? task.updated_at,
    topCause: res?.topCause ?? sorted[0]?.cause ?? res?.summary ?? '-',
    confidence: sorted[0] ? pct(sorted[0].confidence) : 0,
    urgency: res?.urgency ?? ctx.urgency,
    candidates: sorted.map((c) => ({
      rank: c.rank,
      cause: c.causeCode ? `${c.cause} · ${c.causeCode}` : c.cause,
      confidence: pct(c.confidence),
      evidence: [c.explanation, ...(c.evidenceNotes ?? [])].filter(Boolean),
      // v2 는 후보별 출처(sourceIds)가 있다. 없으면 1순위에만 전체 출처를 붙인다
      sourceIds: c.sourceIds ?? (c.rank === sorted[0]?.rank ? sources.map((s) => s.id) : []),
    })),
    agents: res?.agents?.length ? fromResultAgents(res.agents, ctx.tools ?? []) : toAgents(ctx.tools ?? [], annotations),
    errorCodes: [],
    similarCases: (res?.similarCases ?? []).map(toCase),
    similarCaseCount: res?.similarCases?.length ?? 0,
    inspectionSteps: res?.inspectionSteps ?? [],
    repairMethod: res?.repairSteps?.length ? res.repairSteps : splitSteps(res?.repairMethod),
    parts: recommended.map((p) => {
      // [통합] task.recommendedParts는 백엔드 테이블 행이라 part_id(snake_case)로 온다 → '부품 #undefined'가 떴다
      const partId = String(p.partId ?? (p as unknown as Record<string, unknown>).part_id ?? '')
      const part = ctx.parts.find((x) => String(x.id) === partId)
      // [통합] 에이전트는 부품별 이유를 주지 않는다. 리포트 요약을 넣으면 부품마다 같은 긴 글이 반복돼 비운다
      return { partId, partName: part?.name ?? `부품 #${partId}`, partNo: part?.partNo ?? '-', quantity: p.quantity, reason: '' }
    }),
    sources,
    technicianDecision: ctx.decision,
  }
}
