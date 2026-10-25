/* 접수 사진 품질 검사
 *  Mock: 해상도·밝기는 실제 사진에서 잰다. 흐림·반사·거리·부위는 파일 이름 규칙으로 흉내 (0.8초 지연)
 *    - blur / glare → WARNING (기사 확인 필요), far / wrong → FAILED (재촬영)
 *    - 짧은 변 480px 미만 · 밝기 25 미만 → WARNING
 *    - 파일 이름에 error 가 있으면 검사 자체가 실패(ERROR) → [재검사]
 *  실서버: 아직 API 없음 → FEATURES.photoQualityCheck 가 false 면 화면에서 검사 단계를 건너뛴다 */
import { ApiError, http, mockDelay, USE_MOCK } from './http'
import { FEATURES } from './features'
import type { PhotoQualityIssue, PhotoQualityMetrics, PhotoQualityResult } from '@/types'

/** 검사 대상 부위 (접수 사진 칸) */
export type PhotoQualityTarget = 'PCB' | 'MOTOR'

const MOCK_RULES: [RegExp, PhotoQualityIssue][] = [
  [/blur/i, 'BLUR'],
  [/glare/i, 'GLARE'],
  [/far/i, 'TOO_FAR'],
  [/wrong/i, 'WRONG_PART'],
]
/** 이 문제가 있으면 불합격(재촬영). 나머지는 기사가 확인하면 그대로 쓸 수 있다 */
const FAIL_ISSUES: PhotoQualityIssue[] = ['TOO_FAR', 'WRONG_PART']

/** 사진을 64px 로 줄여 평균 밝기를 잰다 (읽지 못하면 null) */
async function measure(file: File): Promise<Omit<PhotoQualityMetrics, 'sharpness'> | null> {
  try {
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')
    if (!ctx) return { width: bmp.width, height: bmp.height, brightness: 60 }
    ctx.drawImage(bmp, 0, 0, 64, 64)
    const px = ctx.getImageData(0, 0, 64, 64).data
    let sum = 0
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
    return { width: bmp.width, height: bmp.height, brightness: Math.round((sum / (px.length / 4) / 255) * 100) }
  } catch {
    return null
  }
}

async function mockCheck(file: File): Promise<PhotoQualityResult> {
  const m = await measure(file)
  return mockDelay(() => {
    if (/error/i.test(file.name)) throw new ApiError(503, '사진 품질 검사 서버가 응답하지 않습니다.', 'QUALITY_CHECK_UNAVAILABLE')
    const issues = MOCK_RULES.filter(([re]) => re.test(file.name)).map(([, code]) => code)
    const metrics: PhotoQualityMetrics = { width: m?.width ?? 0, height: m?.height ?? 0, brightness: m?.brightness ?? 60, sharpness: issues.includes('BLUR') ? 28 : 84 }
    if (m && Math.min(m.width, m.height) < 480) issues.push('LOW_RES')
    if (m && m.brightness < 25) issues.push('DARK')
    const status = issues.some((i) => FAIL_ISSUES.includes(i)) ? 'FAILED' : issues.length ? 'WARNING' : 'PASSED'
    return { ok: status === 'PASSED', status, issues, score: status === 'PASSED' ? 0.93 : 0.42, metrics, checkedAt: new Date().toISOString() }
  }, 800)
}

export async function checkPhotoQuality(file: File, target: PhotoQualityTarget): Promise<PhotoQualityResult> {
  if (USE_MOCK) return mockCheck(file)
  if (!FEATURES.photoQualityCheck) throw new ApiError(501, '사진 품질 검사는 아직 백엔드에서 지원하지 않습니다.', 'NOT_SUPPORTED')
  // 백엔드 API 가 생기면 FEATURES.photoQualityCheck 만 켜면 된다. (경로·필드 이름은 백엔드 확정 후 맞출 것)
  const f = new FormData()
  f.append('file', file)
  f.append('target', target)
  return (await http.post<PhotoQualityResult>('/photos/quality-check', f)).data
}

/** 결과의 판정 (status 가 없는 응답은 ok 로 판단) */
export const qualityStatusOf = (q: PhotoQualityResult) => q.status ?? (q.ok ? 'PASSED' : 'WARNING')
