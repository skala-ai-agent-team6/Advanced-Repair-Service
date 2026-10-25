# 제품 종류 연동

접수에서 결정한 `product_type`을 AI 서버 → MCP → 최종 확정 보고서 → Spring 조회 응답까지 유지한다. 모델은 기존처럼 라벨만 반환해도 된다. AI 서버가 접수의 제품 종류를 MCP 입력에 함께 전달한다.

| 값 | 의미 |
|---|---|
| `vacuum` | 청소기. 로봇청소기와 일반 청소기 포함 |
| `washing_machine` | 세탁기 |
| `air_conditioner` | 에어컨 |
| `unknown` | 제품 종류 미확인 또는 필드 누락 |

소문자·언더스코어를 그대로 사용한다. `washer`, `robot_vacuum`, 한글 제품명, 빈 문자열, `null` 등은 허용하지 않는다. 기존 `product_domain`은 내부 메타데이터이며 MCP 입력 필드가 아니다.

## AI 서버에서 호출

`retrieve_repair_context`의 MCP arguments:

```json
{
  "request": {
    "product_type": "washing_machine",
    "raw_text": "세탁이 끝났는데 물이 빠지지 않습니다.",
    "origin": "technician",
    "technician_confirmed": true,
    "pcb_labels": ["open_circuit"],
    "damage_labels": null,
    "top_k": 3
  }
}
```

개별 도구를 호출할 때도 같은 값을 전달한다.

```json
{"raw_text": "물이 빠지지 않습니다.", "product_type": "washing_machine"}
```

위 입력은 `normalize_observation`용이다. `interpret_pcb`는 `{"labels":["open_circuit"],"product_type":"washing_machine"}`, `interpret_damage`는 `{"labels":["scratches"],"product_type":"washing_machine"}` 형식이다.

직접 사례 검색 도구 `search_repair_cases`:

```json
{"query": "배수가 되지 않음", "product_type": "washing_machine", "top_k": 3}
```

미확정 초안 저장 도구 `save_repair_case`에도 `case.product_type`을 전달할 수 있다. 이 도구의 초안은 기존처럼 검색 색인에 포함하지 않는다.

## Spring 최종 확정 보고서 응답

`GET /internal/confirmed-cases?page=0&size=100`의 배열 항목 최상위에 제품 종류를 포함한다. `content` 내부에만 넣으면 RAG가 읽지 못하므로 아래 위치를 사용한다. 아래 내용은 형식 설명용 가상 예시다.

```json
[
  {
    "report_id": 101,
    "case_id": 50,
    "product_type": "washing_machine",
    "confirmed_revision": 1,
    "confirmed_at": "2026-10-23T03:00:00Z",
    "content": {
      "technicianOpinion": "세탁 후 물이 남아 있습니다.",
      "actualCause": "배수 필터에 이물이 쌓여 배수 흐름이 제한됨",
      "actualAction": "필터 이물 제거 후 배수 시험에서 정상 동작 확인",
      "repairSuccessful": true,
      "outcome": "FIXED"
    }
  }
]
```

Spring은 보고서와 접수·제품 정보를 연결해서 위 값을 내려준다. AI 서버의 전달 코드는 연결했으며, Spring 담당자는 최초 접수 이벤트와 위 확정 보고서 API 응답에 `product_type`을 추가해야 한다. Spring 코드는 변경하지 않았다.

## 검색·누락 처리

- 공개·사내 수리 사례 모두 Qdrant에서 `product_type`이 정확히 같은 문서만 검색한다. 다른 제품으로 검색을 넓히지 않는다.
- 기존 DustUp 공개 사례는 모두 `vacuum`으로 색인한다. 세탁기·에어컨은 확정 보고서 동기화 또는 아래 데모 사례 입력 후 검색할 수 있다.
- 입력이 누락되거나 `unknown`이면 사례는 빈 배열이고 `case_search_status=product_type_required`다. PCB·외형 공통 지침과 남은 소견은 계속 처리한다. 제품이 지정됐지만 사례가 없으면 `no_candidates`다.
- 확정 보고서에 제품 종류가 없으면 `unknown`으로 보존하며 제품별 검색에서 제외한다. 제품 종류를 소견 문장에서 추측하지 않는다.
- 잘못된 제품 코드의 보고서는 동기화 실패 건수에 포함한다. 해당 페이지의 다른 유효한 보고서는 계속 처리한다.
- 소견 정규화와 최종 소견에 제품 종류를 전달한다. 현재 43개 표준 소견에 없는 세탁기·에어컨 증상은 원문으로 보존해 검색·최종 소견의 근거로 전달한다.
- PCB·외형 라벨 정의와 공통 점검 지침은 제품 구분과 함께 반환한다. 제품 종류만으로 특정 부품 위치나 제조사 수리 절차를 확정하지 않는다.

## 기존 환경 적용

RAG 서버를 종료한 뒤 `Rag_mcp` 폴더에서 공개 자료를 재색인하고 서버를 재시작한다. 제품 메타데이터 추가로 공개 색인 식별자가 바뀐다.

```bash
uv run repair-mcp index
uv run repair-mcp serve rag --transport http --host 0.0.0.0 --port 8014
```

확정 보고서 동기화는 `REPAIR_SYNC_ENABLED=true`, `SPRING_BASE_URL`, `INTERNAL_SERVICE_TOKEN` 설정이 필요하다. Spring이 위 형식의 제품 종류를 내려주면 다음 동기화에서 적용된다.

기존 사내 컬렉션과 보고서 ID는 유지한다. 제품 필드가 없던 과거 보고서 또는 `unknown` 보고서는 원인·조치·소견·결과·확정 버전·시각이 동일하면 제품 정보만 추가할 때 같은 버전으로 갱신할 수 있다. 이미 알려진 제품 종류나 원문 내용을 수정할 때는 새 `confirmed_revision`이 필요하다. API에 없는 과거 보고서를 임의로 청소기로 간주하지 않는다.

검색 확인:

```bash
uv run python examples/sync_confirmed_cases.py search --product-type washing_machine --query "물이 빠지지 않습니다"
```

단위·MCP 테스트는 실제 Qdrant 필터와 가짜 임베딩/LLM 응답으로 제품 격리, API 입력, 동기화·중복·재시작·구형 보고서 갱신을 확인한다. 실제 Spring 연동 및 LLM 답변 품질은 별도로 확인한다.

## Spring 최초 접수 이벤트 → AI 서버

기준 위치는 Kafka 명령의 `payload.repair.product_type`이다.

```json
{"payload":{"repair":{"product_type":"washing_machine","symptom":"세탁 후 물이 남습니다"}}}
```

위 JSON은 제품 필드 위치만 보여주는 발췌다. 기존 이벤트 필수 필드는 그대로 보낸다.
AI 서버는 `payload.repair.product_snapshot.product_type`과 camelCase `productType`, `payload.product_type`도 호환 입력으로 읽는다. 대문자 Java enum 값은 소문자로 변환한다. 서로 다른 제품값을 동시에 보내면 오류로 처리한다. MCP와 확정 보고서 API에는 표의 소문자 값을 사용한다.

`graph.py`에서 제품값을 읽고 `tools.py`·`enrichment.py`를 통해 소견/PCB/외형 해석 및 RAG에 전달한다. 최종 AI 리포트와 미확정 초안에도 제품값을 담는다. 미확정 초안은 검색에 넣지 않는다. Spring은 실제 수리 후 확정한 보고서에서 제품값을 유지해야 한다.

## 데모 사례 6건 추가

실제 이력이 없는 데모를 위한 **가상 데이터**다. 세탁기 3건(배수·탈수 진동·도어), 에어컨 3건(풍량·누수·전원)이 들어 있다.
원본: `data/demo_confirmed_cases.json`. 서버 시작 시 자동으로 추가하지 않는다.

RAG 서버를 멈춘 후 `Rag_mcp`에서:

```bash
uv sync --frozen
uv run repair-mcp index
uv run repair-mcp seed-demo-cases
```

다시 실행하면 동일 사례는 `unchanged`로 처리하며 중복 저장하지 않는다. `demo:confirmed-report:*` ID를 사용하므로 실제 Spring 보고서 ID와 충돌하지 않는다. 검색 결과의 `is_demo=true`, 출처 표시와 요약에 가상 사례임을 유지한다. 임베딩 저장소는 기본 `.runtime/qdrant`, 원격 Qdrant를 쓰면 `QDRANT_URL`이 가리키는 서버다. 실행 환경이 바뀌면 해당 저장소에서도 위 명령을 실행해야 한다. 기존 데이터를 지우지 않는다.

```bash
uv run python examples/sync_confirmed_cases.py search --product-type washing_machine --query "세탁 후 물이 빠지지 않습니다"
uv run python examples/sync_confirmed_cases.py search --product-type air_conditioner --query "에어컨 바람이 약합니다"
```

검색 명령 전에 `uv run repair-mcp serve rag --transport http --host 127.0.0.1 --port 8014`로 서버를 켠다. 위 직접 검색은 임베딩 모델만 사용한다. 소견 정규화와 최종 소견을 포함한 `retrieve_repair_context`는 기존처럼 OpenAI API 키가 필요하다.
