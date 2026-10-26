# 평가 결과: context16k

- 평가셋 v1 · 20건 · 모델 gpt-4o-mini · 워커 skeleton-0.2
- **충족 17 / 20 (85%)**
- 정상 사진 오탐: 2 / 4
- 응답 시간 p95: 9.6초 (최대 12.9초)

| ID | 유형 | 기대 | 실제 | 검출 라벨 | 충족 | 사유 | 초 |
|---|---|---|---|---|---|---|---|
| A1 | PCB 결함 | ok | ok | missing_hole | 충족 | - | 9.6 |
| A2 | PCB 결함 | ok | ok | missing_hole, mouse_bite | 충족 | - | 9.3 |
| A3 | PCB 결함 | ok | ok | missing_hole, open_circuit | 충족 | - | 9.2 |
| A4 | PCB 결함 | ok | ok | missing_hole, short | 충족 | - | 6.7 |
| A5 | PCB 결함 | ok | ok | missing_hole, spur | 충족 | - | 8.9 |
| B1 | 기계 결함 | ok | ok | dent, scratches | 충족 | - | 7.6 |
| B2 | 기계 결함 | ok | ok | breakage, patches | 충족 | - | 5.9 |
| B3 | 기계 결함 | ok | ok | dent, pitted_surface | 충족 | - | 4.9 |
| B4 | 기계 결함 (실사진) | ok | ok | dent, patches | 충족 | - | 6.0 |
| B5 | 기계 결함 (실사진) | ok | ok | dent | 미충족 | 라벨 ['dent'] (기대 ['scratches']) | 7.5 |
| C1 | 정상 사진 | needs_review | needs_review | - | 충족 | - | 4.6 |
| C2 | 정상 사진 | needs_review | needs_review | - | 충족 | - | 3.4 |
| C3 | 정상 사진 | needs_review | ok | dent, patches | 미충족 | 판정 ok (기대 needs_review) | 6.4 |
| C4 | 정상 사진 | needs_review | ok | dent, inclusion, patches, scratches | 미충족 | 판정 ok (기대 needs_review) | 4.9 |
| D1 | 범위 밖 (답 불가) | needs_review | needs_review | - | 충족 | - | 3.0 |
| D2 | 범위 밖 (흐리고 어두움) | needs_review | needs_review | - | 충족 | - | 4.9 |
| D3 | 실패 유도 | needs_review | needs_review | - | 충족 | - | 4.3 |
| E1 | 외부 오류 (기계 MCP 중단) | needs_review | needs_review | - | 충족 | - | 4.9 |
| E2 | 외부 오류 (RAG 중단) | ok | ok | missing_hole, short | 충족 | - | 12.9 |
| E3 | 외부 오류 (PCB MCP 중단) | needs_review | needs_review | - | 충족 | - | 2.1 |
