# 저장소 구조 · 협업 규칙 (B1)

## 브랜치

| 브랜치 | 용도 | 들어가는 방법 |
|---|---|---|
| `main` | 안정본. Phase 1 제출본은 태그 `phase1-end` | dev에서 검증된 것만 PR로 |
| `dev` | 고도화 통합 작업장 | 기능 브랜치에서 PR로 |
| 기능 브랜치 | 작업 하나 | `dev`에서 새로 만든다 |

- `main`, `dev`는 브랜치 보호: **PR로만 병합, 다른 팀원 1명 승인 후 병합**
- 직접 push, 셀프 머지 하지 않는다

## 팀 규칙

| 항목 | 팀 규칙 |
|---|---|
| main 보호 | PR로만 병합, 팀원 1명 승인 후 병합 (GitHub 브랜치 보호로 강제) |
| 브랜치 이름 | `feat/…` · `fix/…` · `docs/…` · 파트 접두어 허용 (`backend/feat/…`, `agent/feat/…`) |
| 커밋 메시지 | `feat: 제품별 RAG 검색` / `fix: 기계 사진 agentType` / `docs: 협업 규칙` |
| PR 크기 | 기능 하나 단위. 자동 생성 파일(openapi.json 등)은 따로 표시 |
| 리뷰 기준 | 실행 확인 · 테스트 통과 · Kafka 계약(`contract/`)·AI 출력 규격 유지 · 관련 문서 함께 수정 |
| 문서 갱신 | API · Kafka 계약 · DB 스키마를 바꾸는 PR은 해당 문서 수정 포함 |

## PR 올리기 전 확인

```bash
uv run pytest tests -q                    # 워커
(cd Rag_mcp && uv run pytest -q)          # RAG MCP
(cd backend && ./gradlew test)            # 백엔드
```

자주 놓친 것 (10/23 실제 사례)

| 바꾼 것 | 같이 해야 하는 것 | 놓쳤을 때 |
|---|---|---|
| `prompts/*.md` | `prompts/manifest.json`의 sha256 갱신 (`shasum -a 256 prompts/파일.md`) | 모든 진단 실패 (#3 → #4) |
| `contract/kafka-event.schema.json` | 워커 예시 명령(`worker/send_test.py`)·테스트 갱신 | 워커 테스트 47개 실패 (#11 → #12) |
| Spring의 허용값 (agentType 등) | 워커가 보내는 값 확인 | 기계 사진 진단 실패 (#5 → #8) |
| 접수·진단 흐름 | 프론트 담당에게 공지 | 화면에서 진단이 시작되지 않음 |

## 리뷰어

| 파트 | 주담당 | 리뷰 |
|---|---|---|
| 에이전트(워커·하네스) | 홍은비 | 유길선 |
| RAG MCP | 전인수 | 홍은비 |
| 백엔드·Kafka | 박시현 · 박진영 | 서로 |
| 프론트 | 최세민 | 박시현 (API 연동) |
| 문서·평가 | 유길선 | 누구나 |

## 비밀값

- `.env`는 커밋하지 않는다. 키 이름은 `.env.example`, `backend/.env.example`, `Rag_mcp/.env.example`에 둔다
- 새 키를 쓰면 `.env.example`에 이름만 추가한다

## 기여 (주요 PR)

| 이름 | GitHub | 주요 PR |
|---|---|---|
| 유길선 (PM) | raphael807-t1 | #1 사진 품질 V7 이관 · #8 기계 사진 진단 수정 · #10 RAG 테스트 경로 · #12 product_type 테스트 |
| 박시현 | lilloo04 | #5 소비자 접수·V2 서비스 · #11 product_type 전달 |
| 전인수 | insusu21 | #6 제품별 RAG · #9 소견 재사용(GPT 중복 제거) |
| 홍은비 | beeyaaa | #7 체크포인터·interrupt 재개 |
| 박진영 | kamillcream | #3 수리 준비 리포트 MCP · 이전 레포 #4 Kafka 재시도 |
| 최세민 | cchloe1006-eng | (프론트 PR 예정) |
