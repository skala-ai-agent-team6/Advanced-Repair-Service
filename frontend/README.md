# RobotCare AI — 서비스센터 로봇청소기 고장 진단 지원 (Frontend)

Vue 3 · Vite · TypeScript · Composition API · Vue Router · Pinia · Axios · SSE · ECharts

> **AI 가 만든 결과는 모두 "AI 초안"입니다. 사람이 확인·승인한 것만 고장 DB 와 품질 대시보드에 반영됩니다.**

설계 문서(정보 구조·사용자 흐름·와이어프레임·라우터·컴포넌트·스토어·Mock·API/SSE·상태 설계): [`docs/DESIGN.md`](docs/DESIGN.md)

---

## 실행 방법 (VS Code)

요구 사항: **Node.js 20 이상** (권장 22), npm

```bash
# 1) 압축을 풀고 VS Code 로 폴더 열기
code robotcare-ai

# 2) VS Code 터미널(Ctrl + `)에서
npm install
npm run dev          # http://localhost:5173
```

VS Code 가 권장 확장(**Vue - Official**)을 설치하라고 안내하면 설치하세요. (`.vscode/extensions.json`)

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (Mock 모드, 백엔드 불필요) |
| `npm run type-check` | vue-tsc 타입 검사 |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run preview` | 빌드 결과 미리보기 |

### 데모 계정 (비밀번호 모두 `1234`, 로그인 화면에서 아이디·비밀번호를 직접 입력. 새 계정은 `/signup` 에서 만들 수 있음)

| 사번 | 이름 | 역할 |
|---|---|---|
| T1001 | 김정훈 | 서비스센터 기사 (강남) |
| T1002 | 박민수 | 서비스센터 기사 (부산) |
| Q2001 | 이서연 | 본사 품질 담당자 |

### 5분 데모 시나리오

1. **기사(T1001)** 로그인 → 홈 "지금 처리할 일" → `#101` (RC-A100, E103)
2. AI 진단 결과: 모터 하우징 변형 87% · 사진 위 이상 영역 · 근거·출처 확인 → **진단 내용 확인** (상태 TECHNICIAN_REVIEW)
3. 부품·발주: 모터 어셈블리(RM-MT-103)는 수원 창고 7개라 **"창고 재고로 수리 가능"** (발주 없음). 재고 없는 사례는 `#114` → 메인 PCB(재고 0) **"재고 부족 · 발주 필요"** → 확인 체크 → **발주 요청 등록**
4. 수리 리포트: 처리 결과·AI 진단 수용·실제 원인·고장 부위·실제 조치 입력 → **초안 저장** → **리포트 확정** → 상태 CLOSED, 고장 DB·대시보드 반영
5. 확정한 리포트에서 **리포트 수정** → 원인 수정 후 초안 저장(r2) → 다시 확정 → 확정 이력에 r1·r2 표시, 대시보드 레코드는 r2 로 교체
6. 신규 수리 접수: 시리얼 `RC2026000999`, 증상에 "덜컹" 포함 → 진행 화면에서 **추가 사진 요청** 카드 → 사진 추가 → 분석 완료
7. **품질(Q2001)** → 발주 승인 대기 → 3단계에서 요청한 발주 **승인** → 품질 대시보드 → 막대 클릭으로 관련 수리 목록 → 수리 리포트는 읽기 전용으로 조회 (`#106`: AI 와 실제 원인이 다른 재확정 사례)

상단의 **데모 초기화** 버튼으로 언제든 처음 상태로 돌아갈 수 있습니다. (Mock 데이터는 브라우저 localStorage 에 저장)

---

## 실제 백엔드 연결

백엔드 계약: [skala-ai-agent-team6/backend docs/API.md](https://github.com/skala-ai-agent-team6/backend/blob/main/docs/API.md) · [openapi.json](https://github.com/skala-ai-agent-team6/backend/blob/main/docs/openapi.json)

`.env.development`

```env
VITE_USE_MOCK=false
VITE_API_BASE_URL=                              # 비워 둠: 브라우저는 같은 origin 의 /api 로 요청
VITE_API_PROXY_TARGET=http://localhost:8080     # Vite 가 /api 를 넘길 백엔드 주소
```

```bash
npm run dev    # http://localhost:5173 → /api 는 localhost:8080 으로 프록시
```

> ⚠️ **localhost 와 127.0.0.1 을 섞어 쓰지 마세요.** 브라우저는 둘을 다른 사이트로 보기 때문에
> `http://127.0.0.1:5173` 으로 열면 `localhost` 에 발급된 세션 쿠키가 전달되지 않아 로그인이 계속 풀리거나 403(CSRF)이 납니다.
> 프론트 주소, `VITE_API_PROXY_TARGET`, 백엔드의 `FRONTEND_ORIGIN` 을 모두 같은 호스트 이름(예: `localhost`)으로 맞추세요.

- **인증**: 세션 쿠키(JSESSIONID, HttpOnly) + CSRF. 토큰을 브라우저 저장소에 두지 않습니다.
  로그인 = `GET /api/auth/csrf` → `POST /api/auth/login`(form: username=이메일, password) → CSRF 재조회 → `GET /api/auth/me`.
  앱을 열면 `/api/auth/me` 로 세션을 복원하고, 401 이면 로그인 화면으로 이동합니다.
- **CSRF**: 메모리에 보관하고 POST/PUT/PATCH/DELETE 에 자동 첨부(`src/api/http.ts`). 403 `FORBIDDEN_OR_CSRF` 를 받으면 한 번 재조회 후 재시도합니다.
- **오류**: 백엔드 `{ code, status }` 를 `src/constants/errors.ts` 의 한국어 문구로 바꿔 보여 줍니다.
- **SSE**: `EventSource('/api/repairs/{id}/events', { withCredentials: true })`. 이름 있는 이벤트만 구독하고, payload 대신 상세를 다시 조회합니다. 재연결은 브라우저 기본(Last-Event-ID)에 맡깁니다.

화면·스토어 코드는 `src/api/*.ts` 와 `src/services/sse.ts` 에서 Mock/실서버를 분기합니다.

---

## 폴더 구조

```
robotcare-ai/
├─ .vscode/                     VS Code 권장 확장·설정
├─ docs/DESIGN.md               설계 문서 (1~8장)
├─ public/mock/                 Mock 사진 (제품·모터·PCB·추가·수리 후)
├─ src/
│  ├─ main.ts                   앱 부트스트랩 (Mock 모드: 진행 중 분석 재개)
│  ├─ App.vue
│  ├─ router/index.ts           경로·역할 가드·지연 로딩
│  ├─ types/                    도메인 타입(index) · API DTO(api) · 업로드 · 승인 액션
│  ├─ constants/                status.ts 상태·단계·역할 메타 · errors.ts 백엔드 오류 코드 문구
│  ├─ api/                      http(axios·세션 쿠키·CSRF·오류 정규화) · repairs · parts · dashboard · auth
│  ├─ services/sse.ts           SSE 연결 (named event → 상세 재조회, Mock 겸용)
│  ├─ stores/                   auth · repairs(목록) · repairDetail · orders · dashboard · notifications · toast
│  ├─ composables/              useRepairPage · useReasonDialog
│  ├─ mocks/                    data(시드) · db(영속·이벤트 버스) · engine(AI 파이프라인) · handlers(REST)
│  ├─ utils/                    format · repairFlow(상태→다음 화면·할 일)
│  ├─ styles/                   tokens.css(디자인 토큰) · base.css(공통 UI)
│  ├─ components/
│  │  ├─ common/                RepairStatusBadge · AiBadge · ConfidenceBar · StateView · StatCard · BaseModal …
│  │  ├─ layout/                AppLayout · AppSidebar · AppTopbar
│  │  ├─ repair/                ImageUploader · StepIndicator · RepairFlowNav · RepairProgressTimeline
│  │  │                         AdditionalPhotoRequestCard · RepairSummaryCard · RepairTable
│  │  ├─ diagnosis/             DiagnosisSummaryCard · DiagnosisEvidenceCard · AgentAnalysisCard
│  │  │                         AnnotatedImage · HumanApprovalCard
│  │  ├─ review/                TechnicianCommentForm · ApprovalHistoryTimeline
│  │  ├─ parts/                 PartInventoryCard · PurchaseApprovalCard
│  │  └─ dashboard/             DefectStatisticsChart
│  └─ views/                    Login · Home · RepairList · RepairCreate · RepairProgress
│                               DiagnosisResult · RepairParts · TechnicianReview
│                               ApprovalQueue · ApprovalDetail · PartsOrder · Dashboard · Error
├─ index.html · vite.config.ts · tsconfig*.json · package.json
```

## 디자인 원칙

- 남색 주색 · 흰/밝은 회색 배경 · 정상 초록 / 대기 주황 / 실패·반려 빨강 · 장식 최소화
- **AI 결과 = 보라 점선 영역 + "AI 생성 결과·사람의 확인 필요" 배지**, **사람 확정 = 초록 실선 + "사람 확정"**
- 기본 글자 17px, 버튼 최소 48px(주요 동작 56px), 상태는 색 + 아이콘 + 텍스트 함께
- 데스크톱 우선, 1100px 이하 태블릿에서 사이드바 드로어·1단 레이아웃
