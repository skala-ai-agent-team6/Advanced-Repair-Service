# 평가셋 v1 · 개선 전 → 후

같은 20문항을 Phase 1(`phase1-end` 1fbbd89)과 Phase 2(`integration/field-service`)에서 돌렸다. 실제 MCP·GPT(gpt-4o-mini), Spring·Kafka 없이 워커만.

```bash
bash eval/run_all.sh <label>     # MCP를 평가 전용 포트로 켜고 cases.json 20건 실행 → eval/results/<label>/
```

## 결과

| 지표 | 개선 전 (baseline, 10/24) | 개선 1 (after, 10/24) | 개선 2 (pcb_v2, 10/25) |
|---|---|---|---|
| **충족률** | **12 / 20 (60%)** | **14 / 20 (70%)** | **17 / 20 (85%)** |
| PCB 결함 검출 (A1~A5) | 1 / 5 | 2 / 5 | 5 / 5 |
| 외부 오류 대응 (E1~E3) | 2 / 3 | 3 / 3 | 3 / 3 |
| 정상 사진 오탐 (C1~C4) | 2 / 4 | 2 / 4 (그대로) | 2 / 4 (그대로) |
| 응답 시간 p95 | 58.6초 | 15.8초 | 13.3초 |
| 진단 1건 GPT 호출 (워커) | 평균 1.45회 | 평균 1.45회 | - |

상세: `results/baseline/summary.md`, `results/after/summary.md`, `results/pcb_v2/summary.md` (문항별 판정·라벨·시간), `results.json` (원시 결과)

## 판정 기준
- `ok` = 진단 완료 · `needs_review` = 추가 사진 요청(확정 보류) · `error` = 실패. 첫 진단 기준
- 충족 = 판정 일치 + (결함 문항) 기대 라벨 포함 + 근거 있음 + (오류 문항) 도구 오류 표시·근거 제한 문구
- 자동 채점 뒤 팀원 2명 교차 확인 (R3 T4) — **교차 확인 기록은 검증 결과서에 남길 것**

## 무엇이 바뀌어서 올랐나
| 문항 | 전 → 후 | 원인 |
|---|---|---|
| A4 PCB short | 미충족 → 충족 | PCB 검출 확신도 하한 0.25 → 0.2 (`worker/config.py PCB_MIN_CONF`). short 0.24가 버려지고 있었다 |
| E2 RAG 중단 | 미충족 → 충족 | 같은 이유로 short를 잡고, RAG 없이도 '근거 제한' 문구와 함께 진단 완료 |
| A2·A3·A5 PCB (개선 2) | 미충족 → 충족 | PCB 모델 가중치 v2로 교체 (PR #15, `mcp_servers/pcb/README.md`: test 회수율 58% → 95%) |
| 응답 시간 | 58.6 → 15.8초 | 체크포인터·소견 재사용(GPT 중복 제거) 등. GPT 응답 속도 편차가 커서 재측정 권장 |

**주의 (과적합 위험):** 확신도 하한은 이 평가셋의 정상·흐린 PCB 사진(C1·C2·D2)이 0.05까지도 검출 0건인 것을 확인하고 정했다. 정상 PCB 표본이 2장뿐이라, 다른 정상 사진으로 오탐을 다시 확인해야 한다.

## 실패 원인 (고치지 못한 것)
| 문항 | 원인 | 다음 단계 |
|---|---|---|
| C3·C4 정상 기계 사진 | 표면 결함 모델이 강판(NEU) 데이터로 학습돼 실제 부품 질감을 결함으로 봄. 신뢰도(0.84~0.89)가 진짜 결함과 겹쳐 기준값으로 못 거름 | 정상 부품 사진 학습 추가 |
| B5 심한 긁힘 | 'dent'로 분류 (긁힘을 찌그러짐으로) | 실사진 라벨 보강 |

## 사진 출처
| 파일 | 출처 |
|---|---|
| `pcb_*.jpg`, `normal_pcb_*.jpg`(결함 없는 영역 자름), `bad_blurry_dark_pcb.jpg`(흐림·어둡게 가공) | PCB 결함 데이터셋 test 폴더 |
| `mech_scratches/patches/pitted_surface.jpg` | NEU 강판 표면 결함 데이터셋 |
| `mech_gear_broken.jpg`, `mech_heavy_scratch.jpg`, `normal_pump.jpg`, `normal_dc_rotor.jpg`, `offtopic_person.jpg` | Wikimedia Commons — **원본 링크·작성자·라이선스 보강 필요** |
