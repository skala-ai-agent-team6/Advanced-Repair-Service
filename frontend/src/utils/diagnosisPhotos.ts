/* 사진별 분석 카드 데이터 (진단 리포트 1쪽 · 출장 전 리포트 모달 공통)
 *  PCB → 기계 → 추가 사진 순. 사진이 없는 부위는 카드가 생기지 않는다 */
import type { AgentResult, PhotoKind, RepairImage } from '@/types'

export const PHOTO_KINDS: { kind: PhotoKind; label: string }[] = [
  { kind: 'PCB', label: 'PCB' },
  { kind: 'MOTOR', label: '기계' },
  { kind: 'ADDITIONAL', label: '추가 사진' },
]

/** 이 사진에 이상 영역을 표시한 부위 판단 → 없으면 사진 종류로 (추가 사진은 기계 분석에 쓰임) */
function agentFor(agents: AgentResult[], imageId: string, kind: PhotoKind): AgentResult | undefined {
  return agents.find((a) => a.annotations.some((an) => an.imageId === imageId)) ?? agents.find((a) => a.agent === (kind === 'PCB' ? 'PCB' : 'MOTOR'))
}

export function buildPhotoCards(images: RepairImage[], agents: AgentResult[]) {
  return PHOTO_KINDS.flatMap(({ kind }) =>
    images
      .filter((i) => i.kind === kind)
      .map((image, i) => ({
        image,
        index: i + 1,
        agent: agentFor(agents, image.id, kind),
        anns: agents.flatMap((a) => a.annotations.filter((an) => an.imageId === image.id)),
      })),
  )
}

/** "PCB ×1 · 기계 ×2" */
export function photoCountLabel(cards: { image: RepairImage }[]) {
  return PHOTO_KINDS.map((k) => ({ ...k, n: cards.filter((c) => c.image.kind === k.kind).length }))
    .filter((k) => k.n)
    .map((k) => `${k.label} ×${k.n}`)
    .join(' · ')
}
