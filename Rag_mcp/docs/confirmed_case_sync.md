# 확정 수리 사례 자동 반영

Spring의 기존 `GET /internal/confirmed-cases?page=0&size=100` 응답을 주기적으로 읽는다.
기사 소견, 보고 원인, 실제 조치, 결과를 검색 문서로 변환한다. Spring 응답의 각 보고서 최상위에 `product_type`을 추가해야 제품별 검색에 포함된다. 누락된 보고서는 `unknown`으로 저장하고 제품별 검색에서는 제외한다. [제품 종류·연동 규격](product_types.md).
출장/센터 구분을 조회 조건으로 사용하지 않아 API가 반환하는 모든 확정 보고서가 대상이다.
현재 API에 없는 접수 증상, 제품 모델, 사진 모델 라벨, 출장/센터 구분은 만들어 넣지 않는다.

## 실행

RAG 프로젝트의 `.env`에 설정한다. 내부 토큰은 백엔드 담당자가 제공하는 값이며 OpenAI 키와 다르다.

```dotenv
REPAIR_SYNC_ENABLED=true
REPAIR_SYNC_INTERVAL_SECONDS=30
SPRING_BASE_URL=http://localhost:8080
INTERNAL_SERVICE_TOKEN=백엔드와_동일한_내부서비스토큰
```

```bash
uv run repair-mcp index
uv run repair-mcp serve rag --transport http --host 127.0.0.1 --port 8014
```

기존 HTTP RAG 서버가 실행 중이면 먼저 정상 종료한 뒤 설정을 적용해 다시 시작한다.
`index`는 서버 시작 전에 실행한다. 같은 로컬 Qdrant 경로를 여는 두 번째 서버/색인 프로세스를 실행하지 않는다.
서버 시작 시 첫 동기화를 수행하고, 완료 후 30초마다 재조회한다. HTTP 요청 실패는 다음 주기에 재시도한다.
Spring이 내려가도 이미 저장한 사례는 검색할 수 있다.

다른 터미널에서 실행 중인 MCP 서버에 요청한다.

```bash
uv run python examples/sync_confirmed_cases.py status
uv run python examples/sync_confirmed_cases.py sync
uv run python examples/sync_confirmed_cases.py search --product-type vacuum --query "청소기 왼쪽 바퀴가 걸리고 회전하지 않아요"
```

`sync`는 동일한 자동 동기화 작업을 즉시 실행한다. 이미 실행 중이면 `busy`를 반환하므로 완료 상태 확인 후 다시 요청한다.
상태에는 마지막 실행 결과, 신규/수정/변경 없음/실패 건수, 누적 보고서 수가 표시된다.
색인과 `search_repair_cases`는 OpenAI 키가 필요 없다. 기존 `retrieve_repair_context`의 소견 정규화·최종 소견 생성에는 필요하다.

## 시연 순서

1. `search`로 현재 공개/사내 사례를 조회한다.
2. 실제 화면에서 기사가 보고서를 확정한다. 초안 저장만으로는 가져오지 않는다.
3. `sync` 또는 다음 자동 동기화 후 `added: 1`을 확인한다.
4. 같은 질문으로 검색한다. 관련성이 충분하면 `internal:report:<보고서ID>`가 결과에 포함된다.
5. 재동기화하면 `unchanged`가 증가하고 누적 사례 수는 늘지 않는다.
6. 보고서를 수정하고 새 버전을 확정하면 `updated: 1`로 이전 내용을 교체한다.

검색 순위는 동일한 임베딩 모델의 유사도 기준이다. 사내 사례를 무조건 1위로 올리지 않는다.
`case_briefs`에는 사례 ID, 한 줄 요약, `공개 사례`/`사내 확정 사례`가 표시된다.
과거 보고서가 확정됐다는 사실은 현재 검색 중인 기기의 원인이 확정됐다는 뜻이 아니다.

## 저장과 갱신

- 공개 데이터 컬렉션은 기존 방식 그대로 읽는다. 사내 컬렉션 이름은 임베딩 모델·모델 버전·문서 변환 버전에서 결정한다.
- 공개 CSV/JSONL을 바꾸거나 재색인해도 사내 컬렉션 이름은 바뀌지 않는다.
- 한 보고서에 한 포인트를 저장한다. 긴 보고서는 나눈 청크 벡터의 정규화 평균을 사용하고, 전체 문서는 payload에 보존한다.
- `report_id`가 포인트 ID를 결정한다. `confirmed_revision`과 내용 해시를 함께 저장하므로 재시작 후에도 중복 임베딩을 피한다.
- 낮은 버전은 무시한다. 같은 버전의 내용이 달라지면 오류로 표시한다. 실제 수정은 새 확정 버전으로 반영한다.
- Qdrant 저장 성공 후에만 동기화 완료로 간주한다. 저장 실패 시 다음 주기에 재시도한다.
- `FIXED`, `NOT_FIXED`, `NO_FAULT_FOUND`를 각각 수리 완료, 수리 미완료, 고장 미발견으로 보존한다. 미완료를 `Repairable`로 추정하지 않는다.
- 기존 목록 API는 오래된 보고서의 수정 시각으로 증분 조회할 수 없어 매번 전체 페이지를 읽는다. 이미 저장한 버전은 재임베딩하지 않는다.
- 한 주기는 최대 100페이지(10,000건)다. 초과 시 `PAGE_LIMIT_REACHED`를 반환한다. 규모가 커지면 백엔드 변경 이력 API가 필요하다.
- 삭제/확정 취소 이벤트는 현재 API에 없어 자동 삭제는 지원하지 않는다. 목록에서 빠졌다는 이유만으로 기존 사례를 삭제하지 않는다.

원본은 Spring DB에 남는다. Qdrant 볼륨을 삭제하면 전체 확정 목록을 다시 읽어 색인을 복원할 수 있다.
임베딩 모델을 바꾸면 사내 컬렉션이 새로 생성되며 다음 동기화가 전체 보고서를 재색인한다.
한 Spring 환경당 별도의 Qdrant 런타임/볼륨을 사용한다. 다른 회사나 테스트 환경의 같은 report_id를 섞지 않는다.

## Docker 연결

기존 Compose의 `rag-mcp` 서비스에만 아래 환경 변수를 추가하면 된다.

```yaml
environment:
  REPAIR_SYNC_ENABLED: "true"
  REPAIR_SYNC_INTERVAL_SECONDS: "30"
  SPRING_BASE_URL: http://backend:8080
  INTERNAL_SERVICE_TOKEN: ${INTERNAL_SERVICE_TOKEN}
```

`backend`는 예시 서비스 이름이다. 같은 Docker 네트워크의 실제 Spring 서비스 이름을 사용한다.
macOS 호스트에서 Spring을 실행하면 `http://host.docker.internal:8080`을 사용한다.
로컬 Qdrant는 `/app/.runtime`에 영속 볼륨을 연결한다. 검색/동기화 모두 같은 RAG 프로세스의 연결을 쓴다.
이 동기화 기능을 여러 RAG 복제본에서 동시에 켜는 구성은 지원 범위 밖이다.

## 내부 API와 정보 범위

요청은 고정된 Spring URL로만 전송하며 `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`을 사용한다.
즉시 동기화 도구는 URL이나 임의 보고서 본문을 인자로 받지 않는다. 토큰 및 HTTP 오류 응답 원문은 상태/로그에 포함하지 않는다.
보고서에서 필요한 세 텍스트 필드와 결과만 가져온다. 이메일/전화번호는 기본 마스킹하지만 주소·이름 등 모든 개인정보를 판별하는 기능은 아니다.
작성 단계에서 개인정보를 제외하고, 운영 시 백엔드의 RAG 전용 비식별 응답으로 확장한다.
동기화 도구는 검색 색인을 쓰므로 MCP의 readOnlyHint는 false다. 기존 검색/해석 도구는 읽기 전용이다.
내부 서비스 토큰을 보유한 RAG 서버는 신뢰된 내부 네트워크에서 운영한다.

## 백엔드 없는 개발 시연

`examples/confirmed_report.demo.json`은 사람이 만든 가상 보고서이며 실제 수리 사례가 아니다.
아래 데모는 HTTP 응답을 모사하고 임시 Qdrant에 실제 임베딩을 저장한다. 운영 DB와 색인은 수정하지 않는다.

```bash
uv run python examples/demo_confirmed_sync.py
```

공개 사례 준비, 추가 전/후 검색, 중복 확인, 디스크 재개방 후 유지 여부를 출력한다.
실제 Spring과의 인증/네트워크 연동은 별도로 위의 `status`/`sync` 명령으로 확인한다.

실측 결과: [확정 사례 동기화 시연 결과](confirmed_sync_demo_result.md).
