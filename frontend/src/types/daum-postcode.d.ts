/* Daum 우편번호 서비스 (https://postcode.map.daum.net/guide) — 쓰는 부분만 선언 */
export {}

declare global {
  interface DaumPostcodeData {
    zonecode: string
    roadAddress: string
    jibunAddress: string
    /** 사용자가 지번을 고르지 않았을 때 자동으로 채워지는 지번 주소 */
    autoJibunAddress: string
    buildingName: string
    /** 법정동·법정리 이름 */
    bname: string
    apartment: 'Y' | 'N'
    userSelectedType: 'R' | 'J'
  }
  interface DaumPostcodeOptions {
    oncomplete: (data: DaumPostcodeData) => void
    width?: string | number
    height?: string | number
  }
  interface DaumPostcode {
    embed(el: HTMLElement, opts?: { q?: string; autoClose?: boolean }): void
  }
  interface Window {
    daum?: { Postcode: new (opts: DaumPostcodeOptions) => DaumPostcode }
  }
}
