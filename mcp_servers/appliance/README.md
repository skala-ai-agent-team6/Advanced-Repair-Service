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

## 결과

(학습 후 채움)

## 데이터 출처와 라이선스

(학습 후 채움)

## 알려진 한계

(학습 후 채움)
