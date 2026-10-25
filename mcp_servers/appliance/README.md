# appliance-mcp

가전(에어컨·세탁기·로봇청소기) 사진 진단 MCP 서버. 출장 수리 전에 **소비자가 찍어 보낸 사진**을 보고 기사가 미리 상태를 파악하도록 돕는다.
심각도와 상태 판정은 **전부 학습된 모델 출력**이다. GPT 비전은 학습 사진 라벨을 붙이는 교사로만 썼고, 서버는 GPT를 부르지 않는다.

## 실행

```bash
cd mcp_servers/appliance
uv sync
uv run python server.py          # http://127.0.0.1:9105/mcp  (PORT로 변경)
uv run pytest -q                 # 단위 시험 + 가중치가 있으면 실제 모델 스모크
```

## 도구

| 도구 | 모델 | 출력 |
|---|---|---|
| `detect_common_defects(image_path, conf)` | YOLO11 탐지 4종 (rust·dent·crack·scratch) + YOLO11-cls 심각도 (minor·moderate·severe) | 결함마다 type·confidence·box_xyxy·severity·severity_confidence, overall_severity, 박스 그린 사진 |
| `inspect_appliance_part(image_path, product_type)` | CLIP ViT-B-32 이미지 특징 + 로지스틱 회귀 (부위 인식기 1개, 부위별 상태 분류기) | part·state·severity·확신도. 부위를 못 알아보거나 확신도가 기준 미만이거나 학습 사진이 부족하면 `status: "uncertain"` |
| `list_inspection_items(product_type)` | — | 가전별 점검 부위, 상태, 상태별 심각도 |

점검 부위와 상태 (`parts_spec.py`):

| 가전 | 부위 | 상태 → 심각도 |
|---|---|---|
| 에어컨 | 필터 `ac_filter` | clean→none, mildly_dirty→minor, heavily_dirty→severe |
| 에어컨 | 배수 호스 `ac_drain_hose` | ok→none, kinked_or_blocked→moderate |
| 로봇청소기 | 모터 `rv_motor` | normal→none, burn_marks→severe |
| 로봇청소기 | 바퀴 `rv_wheel` | ok→none, worn→moderate, broken→severe |
| 세탁기 | 급수 호스 `wm_inlet_hose` | ok→none, damaged→severe |
| 세탁기 | 배수 필터 `wm_drain_filter` | clean→none, clogged→moderate |
| 세탁기 | 도어 고무 패킹 `wm_door_gasket` | ok→none, mold_or_torn→moderate |

## 결과 (홀드아웃, `uv run python training/evaluate.py <appliance_data>` → `weights/eval_report.json`)

### 공통 결함 탐지 (`weights/defects.pt`, YOLO11n, test 254장, conf 0.25)
| 결함 | 정밀도 | 재현율 | mAP50 |
|---|---|---|---|
| rust | 0.79 | 0.58 | 0.57 |
| crack | 0.71 | 0.44 | 0.40 |
| dent | 0.50 | 0.13 | 0.08 |
| scratch | 0.47 | 0.14 | 0.11 |
| **전체 mAP50** | | | **0.29** |

학습: yolo11n, imgsz 512, 40 epoch (`yolo detect train model=yolo11n.pt data=<appliance_data>/defects/data.yaml epochs=40 imgsz=512 batch=8`). 640 미세조정은 val mAP50 0.284로 더 낮아 쓰지 않았다.

### 결함 심각도 (`weights/severity.pt`, YOLO11s-cls 320, 학습에 안 쓴 val 248장)
| 심각도 | 정밀도 | 재현율 | n |
|---|---|---|---|
| minor | 0.80 | 0.76 | 82 |
| moderate | 0.60 | 0.53 | 75 |
| severe | 0.74 | 0.83 | 91 |
| **정확도** | | **0.718** | 248 |

추론 때는 탐지 박스 주변(가로·세로 50% 여유)을 잘라 심각도 모델에 넣는다.

### 가전 부위 상태 (`weights/parts_head.joblib`, CLIP + 로지스틱 회귀)
- 수집 1,278장 → GPT 교사 라벨 680장 → **관련 사진 102장** (나머지 578장은 not_relevant → 부위 인식기의 `other`)
- 검색어 라벨은 GPT 라벨과 일치율 10%(50/480)라 학습에서 뺐다. 라벨을 안 붙인 598장도 학습에 안 썼다
- 부위 인식 (홀드아웃 170장, 기준 0.6): 부위 사진 26장 중 11장을 맞게 인식, 부위라고 답한 17장 중 11장이 정답 (정밀도 0.65, 재현율 0.42). 나머지는 `uncertain`
- 상태 분류는 **클래스당 5장 이상인 부위만** 만들었다

| 부위 | 학습 사진 (상태별) | 홀드아웃 | 상태 |
|---|---|---|---|
| rv_motor | normal 25, burn_marks 5 | 정확도 0.78 (n=9), **burn_marks 재현율 0 (n=2)** | 학습함 (탄 자국은 사실상 못 잡음) |
| wm_drain_filter | clean 5, clogged 5 | 1.00 (n=3, 너무 작아 의미 없음) | 학습함 |
| ac_filter | heavily 8, mildly 7, clean 4 | — | uncertain (clean 부족) |
| rv_wheel | ok 13, worn 7, broken 2 | — | uncertain (broken 부족) |
| wm_inlet_hose | damaged 8, ok 3 | — | uncertain |
| wm_door_gasket | ok 5, mold 0 | — | uncertain |
| ac_drain_hose | 3 / 2 | — | uncertain |

### 우리 평가셋 사진에서 (기존 mechanical-mcp와 비교, conf 0.25)
| 사진 | 기존 기계 모델 (강판 + 차량 dent) | appliance `detect_common_defects` |
|---|---|---|
| 정상 펌프 모터 | patches ×7 + dent (오탐) | 검출 없음 |
| 정상 DC 모터 로터 | inclusion·patches·scratches ×7 + dent (오탐) | rust ×4 (구리 권선을 녹으로 봄, 오탐) |
| 기어 이빨 파손 | patches ×3 + dent | 검출 없음 (놓침) |
| 심하게 긁힌 금속판 | dent | 검출 없음 (놓침) |
| NEU 강판 scratches | scratches 0.90 | 검출 없음 (흑백 강판 클로즈업은 학습 분포 밖) |
| NEU 강판 patches | patches 0.90 | rust 0.76 |
| 인물 사진 · 정상 PCB | — | 검출 없음 |

정상 사진 오탐은 2장 → 1장으로 줄었지만, 긁힘·파손 실사진은 둘 다 못 잡는다.

## 데이터 출처와 라이선스
학습 데이터는 레포 밖(`04_캡스톤_고도화/작업/appliance_data/`)에 있고, 만드는 스크립트는 `training/`에 있다.

| 데이터 | 쓴 곳 | 라이선스 |
|---|---|---|
| [DrBimmer/car-parts-and-damage-dataset](https://huggingface.co/datasets/DrBimmer/car-parts-and-damage-dataset) 차량 손상 814장 (HF 폴더 이름이 뒤바뀌어 `Car parts dataset`에 손상 라벨) | 결함 탐지: Scratch·Dent·Cracked·Corrosion | MIT |
| [rltjr/metal-surface-defect-v1](https://huggingface.co/datasets/rltjr/metal-surface-defect-v1) (MSDD 정리본) | 결함 탐지: Scratch, Oxidation→rust, 정상 이미지 일부 | CC BY 4.0 |
| [LibreYOLO/corrosion-bi3q3](https://huggingface.co/datasets/LibreYOLO/corrosion-bi3q3) (Roboflow 100) | 결함 탐지: corrosion→rust, crack | CC BY 4.0 |
| [Kaggle prajwalbhamere/car-damage-severity-dataset](https://www.kaggle.com/datasets/prajwalbhamere/car-damage-severity-dataset) 1,631장 | 심각도 분류 (minor·moderate·severe) | **CC BY-NC-SA 4.0 (비상업)** |
| Wikimedia Commons · Openverse 사진 1,278장 | 부위 상태 분류 | 사진마다 다름 → `data/parts_sources.csv` (CC0·PD·BY·BY-SA, 일부 BY-NC·BY-NC-ND 포함) |
| CLIP ViT-B-32 `laion2b_s34b_b79k` (open_clip) | 부위 특징 추출 | open_clip MIT, LAION 가중치 |
| Ultralytics YOLO11 사전학습 가중치 | 탐지·분류 시작점 | AGPL-3.0 |

결함 데이터 합친 결과 (`data/defects_stats.json`): train 1,938장 / val 420 / test 254. 인스턴스 train 기준 rust 1,773 · dent 1,361 · crack 1,446 · scratch 4,209.

## 알려진 한계
- **가전 사진으로 학습한 결함 모델이 아니다.** 차량·금속 부품·구조물 사진으로 학습했다. 가전 외관에 그대로 맞는지는 우리 평가셋으로 다시 재야 한다
- dent·scratch 재현율이 낮다 (차량 데이터의 얕은 긁힘·찌그러짐이 작고 흐림). rust·crack이 상대적으로 낫다
- 심각도 모델은 **차량 손상 심각도**로 학습했다. 가전 결함에 쓰면 기준이 다를 수 있다. 데이터가 비상업 라이선스다
- 부위 상태: 공개 사진에 가전 부품 고장 사진이 거의 없다 (수집의 85%가 무관 사진). 7개 부위 중 2개만 상태를 판정하고, 그것도 표본이 작다. 실제 서비스 사진(소비자 촬영)을 모아 다시 학습해야 한다
- GPT 교사 라벨은 사람이 전수 확인하지 않았다
- 학습 시간: 메모리 부족(스왑)으로 결함 모델은 작은 설정(YOLO11n)으로만 학습했다
- 워커 그래프에는 아직 연결하지 않았다 (리뷰 후 연결)
