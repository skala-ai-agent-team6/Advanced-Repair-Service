/* 한국 시간(Asia/Seoul) 기준 날짜·시간 */
const TZ = 'Asia/Seoul'

/** 한국 시간 오늘 (YYYY-MM-DD) */
export function kstToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** 시각(ISO 문자열 또는 Date)의 한국 날짜 (YYYY-MM-DD) */
export function kstDay(at: string | Date): string {
  return kstToday(typeof at === 'string' ? new Date(at) : at)
}

/** 한국 시간 지금 (HH:mm) */
export function kstNowTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
}

const WEEK = '일월화수목금토'
/** "10월 22일 (목)" — YYYY-MM-DD 를 달력 날짜로 그대로 읽음 */
export function kstDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${m}월 ${d}일 (${WEEK[day]})`
}
