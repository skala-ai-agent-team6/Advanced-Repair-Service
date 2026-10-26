/* 브랜드 설정 — 로고 파일 경로 · 이름 · 소개 문구를 이 파일 하나에서 관리
 *  - 전체 로고(그림 위 · 글씨 아래): 로그인 전 화면(로그인 · 회원가입 · 고객 홈) — BrandLogo
 *  - 그림 로고(집 + 렌치): 로그인 후 사이드바 · 고객 화면 머리글 — AppLogo
 * 예전 로고 public/images/rovia-logo.png 는 파일만 남겨 두고 쓰지 않는다 */
const base = import.meta.env.BASE_URL

export const BRAND_NAME = '수리들어간다'
/** 로고 아래 서비스 소개 한 줄 */
export const BRAND_TAGLINE = '가전제품 AI 고장 진단 서비스'
export const BRAND_LOGO_FULL_SRC = `${base}images/suri-logo-full.png`
export const BRAND_LOGO_SYMBOL_SRC = `${base}images/suri-logo-symbol.png`

/** 로고 이미지의 대체 텍스트 */
export const BRAND_LOGO_ALT = BRAND_NAME
