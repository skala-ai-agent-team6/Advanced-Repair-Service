# 평가 결과: after

- 평가셋 v1 · 20건 · 모델 gpt-4o-mini · 워커 skeleton-0.2
- **충족 14 / 20 (70%)**
- 정상 사진 오탐: 2 / 4
- 응답 시간 p95: 15.8초 (최대 29.5초)

| ID | 유형 | 기대 | 실제 | 검출 라벨 | 충족 | 사유 | 초 |
|---|---|---|---|---|---|---|---|
| A1 | PCB 결함 | ok | ok | missing_hole | 충족 | - | 29.5 |
| A2 | PCB 결함 | ok | needs_review | - | 미충족 | 판정 needs_review (기대 ok); 라벨 없음 (기대 ['mouse_bite']) | 8.4 |
| A3 | PCB 결함 | ok | needs_review | - | 미충족 | 판정 needs_review (기대 ok); 라벨 없음 (기대 ['open_circuit']) | 7.1 |
| A4 | PCB 결함 | ok | ok | short | 충족 | - | 10.9 |
| A5 | PCB 결함 | ok | needs_review | - | 미충족 | 판정 needs_review (기대 ok); 라벨 없음 (기대 ['spur']) | 10.5 |
| B1 | 기계 결함 | ok | ok | dent, scratches | 충족 | - | 15.8 |
| B2 | 기계 결함 | ok | ok | breakage, patches | 충족 | - | 9.2 |
| B3 | 기계 결함 | ok | ok | dent, pitted_surface | 충족 | - | 10.2 |
| B4 | 기계 결함 (실사진) | ok | ok | dent, patches | 충족 | - | 9.7 |
| B5 | 기계 결함 (실사진) | ok | ok | dent | 미충족 | 라벨 ['dent'] (기대 ['scratches']) | 7.6 |
| C1 | 정상 사진 | needs_review | needs_review | - | 충족 | - | 6.8 |
| C2 | 정상 사진 | needs_review | needs_review | - | 충족 | - | 7.8 |
| C3 | 정상 사진 | needs_review | ok | dent, patches | 미충족 | 판정 ok (기대 needs_review) | 10.9 |
| C4 | 정상 사진 | needs_review | ok | dent, inclusion, patches, scratches | 미충족 | 판정 ok (기대 needs_review) | 11.7 |
| D1 | 범위 밖 (답 불가) | needs_review | needs_review | - | 충족 | - | 5.3 |
| D2 | 범위 밖 (흐리고 어두움) | needs_review | needs_review | - | 충족 | - | 8.5 |
| D3 | 실패 유도 | needs_review | needs_review | - | 충족 | - | 8.0 |
| E1 | 외부 오류 (기계 MCP 중단) | needs_review | needs_review | - | 충족 | - | 6.8 |
| E2 | 외부 오류 (RAG 중단) | ok | ok | short | 충족 | - | 15.4 |
| E3 | 외부 오류 (PCB MCP 중단) | needs_review | needs_review | - | 충족 | - | 4.6 |
