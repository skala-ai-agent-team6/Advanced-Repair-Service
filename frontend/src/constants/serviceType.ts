/* 수리 방법 — 고객이 접수 때 고르고(방문 수리 / 센터 방문), 기사는 이어받아 필요하면 사유와 함께 변경 */
export type ServiceType = 'VISIT' | 'CENTER'
export type VisitSlot = 'AM' | 'PM'

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = { VISIT: '방문 수리', CENTER: '센터 방문' }
export const SERVICE_TYPE_DESC: Record<ServiceType, string> = { VISIT: '기사님이 댁으로 방문해요', CENTER: '가까운 서비스센터로 가져가요' }
export const VISIT_SLOT_LABEL: Record<VisitSlot, string> = { AM: '오전 (9~12시)', PM: '오후 (13~18시)' }

/** 서비스센터 (Mock: 기존 시드 지역) */
export interface ServiceCenter {
  id: string
  name: string
  address: string
}
