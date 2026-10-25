# 출장기사 서비스 연동 (integration/field-service)

최세민 프론트(출장기사·소비자 화면)를 실서버에 붙인 기록. 프론트 경로는 그대로 두고 백엔드를 맞췄다.

## 고객 접수 → 출장기사 (자동)

`ConsumerPipeline` (dev에서 `app.consumer.auto-pipeline=true`, 5초마다)
1. 고객 접수(RECEIVED) 사진의 품질 검사가 끝나길 기다린다
2. 출장 접수면 출장기사 자동 배정 (같은 센터 우선, 맡은 건이 적은 순)
3. 품질 **통과** 사진으로 AI 진단 시작 → 출장기사 화면에 리포트·준비 부품·공구가 뜬다
- 경고 사진은 사람이 확인해야 해서 자동으로 쓰지 않는다. 통과 사진이 없으면 기사 확인을 기다린다

## 화면 → API

| 화면 | API | 구현 |
|---|---|---|
| 오늘의 출장 (일정) | `GET /api/field/visits?from=` | 새로 추가. 로그인한 기사에게 배정된 FIELD 건만 (다른 기사는 0건) |
| 방문 일정 지정 | `PUT /api/repairs/{id}/visit` `{visitAt, done}` | 새로 추가 |
| 출장 준비 부품 | `GET /api/repairs/{id}/trip-parts` | AI 추천 부품 + 창고 재고(`inventory`) + 최근 예약 |
| 재고 예약 / 취소 / 출고 | `POST /api/stock/reservations`, `…/{id}/cancel`, `…/{id}/release` | 기존 `inventory.reserved/on_hand` 사용 (발주 승인·출고와 같은 칸). 24시간 지나면 만료 |
| 재고 이력 | `GET /api/parts/{id}/stock-history` | 예약·취소·만료·출고 기록 |
| 준비 공구 | `GET /api/repairs/{id}/preparation-report` | 박진영 업무 MCP `get_repair_preparation_report` (게이트웨이 `preparation.report`) |
| 보증 무상/유상 | `GET /api/repairs/{id}/warranty`, `POST …/warranty/decision` | 기존 보증 기간 판정을 제안으로, 기사 확정은 `warranty_decision` |
| 소비자 접수 | `POST /public/cases` | 박시현 V2 API. 프론트가 형식 변환 (구매일 선택) |
| 소비자 진행 조회 | `GET /public/cases/{번호}` + `Authorization: Bearer 조회키` | 조회 링크 토큰 = `접수번호.조회키`. 휴대폰 뒷자리 조회는 막음 |
| 기사 접수 | `POST /api/repairs` → 품질 검사 대기 → 경고 확인 → `POST /api/repairs/{id}/diagnosis` | 사진 품질 기능 이후 진단이 안 시작되던 문제 해결 |

DB: `V10__field_service.sql` — `app_user.technician_type`, `repair_case.visit_at/visit_done_at`, `stock_reservation`, `stock_history`, `warranty_decision`

## 시연 계정 (dev)

| 계정 | 역할 |
|---|---|
| `field-tech` / 1234 | 출장기사. SEED-2 오늘 14시 방문 |
| `tech1` / 1234 | 센터 기사 (출장 일정 0건) |
| `quality` / 1234 | 본사. 출장 배정 `POST /api/repairs/{id}/assignment` |

## 남은 것

- 출장 전 리포트 기사 수정안(`FEATURES.preVisitReportEdit`), 접수 화면 보증 기간 안내(`warrantyPeriod`), 회원가입은 아직 Mock 전용
- 방문 일정 지정 화면은 없음 (API만)
