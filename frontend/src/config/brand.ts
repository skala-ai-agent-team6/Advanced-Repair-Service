/* 기업 로고 설정
 * 로고 파일을 public/ 아래에 두고 BRAND_LOGO_SRC 경로만 바꾸면 로그인·회원가입·사이드바에 모두 반영된다.
 *   예) public/images/brand/logo.svg → '/images/brand/logo.svg'
 * 비어 있으면(로고 없음) 로고 자리는 글자·깨진 이미지 없이 비워 둔다. */
export const BRAND_LOGO_SRC: string = `${import.meta.env.BASE_URL}images/rovia-logo.png`

/** 로고 이미지의 대체 텍스트 (화면에 글자로 표시하지 않음) */
export const BRAND_LOGO_ALT = 'ROVIA'
