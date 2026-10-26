> PR #6 이후 제품 유형 전달 테스트와 최신 검증은 [PRODUCT_TYPE.md](PRODUCT_TYPE.md)를 참고한다. 아래는 V2 구현 당시 기록이다.

# V2 실제 검증 기록

2026-10-23 Asia/Seoul. Java21/Spring Boot4.1.1, 독립 PostgreSQL17·Kafka4.1.1 Testcontainers, 합성 JPEG/PNG, MockMvc 및 테스트용 indexer를 사용했다. 운영 DB·실제 제조사·Vue·실제 AI·RAG/Qdrant에는 연결하지 않았다.

## 실행 결과

backend에서 실제 실행:

```bash
DOCKER_HOST=unix://$HOME/.docker/run/docker.sock ./gradlew test bootJar
python3 -m unittest discover -s scripts -p 'test_rag_sync_adapter.py'
node scripts/test_swagger_ui.cjs
```

최종 BUILD SUCCESSFUL(36s). Java 총70개, 실패0·오류0·생략0. Python adapter mock4개 통과, Node Swagger UI interceptor 검증 통과. Swagger76 operations/71 paths, 모든 컨트롤러 경로·메서드와 OpenAPI 일치 테스트 통과. OpenAPI 내부 참조·operationId 중복 검증 및 git diff --check 통과. V8까지의 기존 자료 이관과 schema.sql 컬럼·제약·인덱스 일치를 검증했다.

| Java 테스트 | 개수 | 내용 |
|---|---:|---|
| BackendApplicationTests |23| 기존 인증·센터·보고서·발주·Kafka·SSE·비활성화 회귀, Swagger 제공·보호 유지·전체 경로 일치 |
| V2ServiceTests |25| 아래 V2 시나리오 및 동시성 |
| PhotoQualityIntegrationTests |11| 검사 gate·최신 WARNING·재검사·추가 사진 재개·권한·기존 통합 기능 보존 |
| JavaPhotoQualityCheckerTests |8| JPEG/PNG 계산·손상·흐림 변화·픽셀 한계·투명/극소 이미지 |
| PhotoQualityExecutorTests |1| worker/queue 포화 제한 |
| PhotoQualityBenchmarkTests |1| 합성 이미지 계산 측정; 실제 부품 정확도 아님 |
| SchemaMigrationTests |1| 비어 있지 않은 V3 자료 이관·V8 포함 canonical schema parity |

결과 파일: build/test-results/test, build/reports/tests/test/index.html. 실행 산출물: build/libs/backend-0.0.1-SNAPSHOT.jar. scripts/demo_v2_consumer.py는 --help만 확인했고 실제 개발 DB에 접수를 만들지는 않았다. 사용자가 명시적으로 실행하면 CENTER/FIELD 소비자 접수2건을 만들고 조회 키는 .local/의0600 파일에 보관하며 출력하지 않는다.

## TC-01~TC-10 대응표

**원문 TC-01~TC-10이 저장소와 제공된 첨부 텍스트에 없어 아래는 이번 요구사항을 기준으로 한 임시 매핑이다. 원문 TC 충족 또는 Vue/Agent/RAG 통합 성공을 주장하지 않는다.** 원문 제공 후 번호/내용의 최종 대응을 확인해야 한다.

| 임시 TC | 요구사항 묶음 | 실제 자동 테스트 |
|---|---|---|
|TC-01| 소비자 접수·필수값·사진·출처·제품 스냅샷·자동 진단 분리 | V2ServiceTests.consumerIntakeStoresHashAndNeverStartsAgent, publicHttpRequiresMandatoryFieldsAndRejectsInvalidDates, consumerPhotosStayBoundToTheirOwnCase |
|TC-02| 미래/잘못된 구매일·정책 미등록·경계·버전 추적 | warrantySnapshotsHandleBoundariesAndUnknownPolicies, warrantyPolicyVersionChangePreservesPriorAssessmentAndDisabledRagCannotClaimSuccess |
|TC-03| 접수번호만 조회 불가·다른 사진/접수·만료·비공개 정보 | publicKeysDoNotAuthorizeOtherCasesOrStaffActions, customerPublicationIsExplicitAndExcludesInternalData |
|TC-04| 센터/출장 배정·재배정·본사/내부 권한 | fieldAssignmentsExtendOnlyExplicitTechnicianAccess, ragAndEditorInternalHttpRequireServiceToken 및 기존 센터 회귀 |
|TC-05| 소비자 경고 확인 차단·최신 결과 확인·PENDING/ERROR 보류 | publicKeysDoNotAuthorizeOtherCasesOrStaffActions, PhotoQualityIntegrationTests 전체 |
|TC-06| 추가 사진3회·동일 작업 재개·잘못된 AI·비호환 부품·다른 가전 | BackendApplicationTests.photosResumeSameTaskAndOnlyThreeRounds, PhotoQualityIntegrationTests 추가 사진 테스트, invalidAiPartsAndEvidenceAreRejectedAndZeroSequenceIsAllowed, otherApplianceCanBeRegisteredWithoutPretendingAnAiModelExists |
|TC-07| 실제 원인/조치 필수·0교체·최신 확정 통계·코멘트 독립 | actualRepairRequiresCauseActionAndAllowsZeroReplacements 및 기존 리포트/통계 회귀 |
|TC-08| 동일시각 페이지·고정 window·동시 commit·RAG 중복/역전/실패 | ragCursorUsesStableWindowAndDoesNotMissSameTimestampChanges, ragWindowWaitsForEarlierUncommittedConfirmation, ragCallbacksAreIdempotentAndOlderSuccessCannotCompleteNewRevision, ragPayloadOmitsContactsAddressesAndPrivateOpinion, ragBootstrapKeepsHistoricalOutcomeInsteadOfLatestHeader, Python adapter4개 |
|TC-09| 편집 원본/제안/승인·구버전 덮어쓰기·고객 초안 차단 | editorSuggestionNeverAutoConfirmsOrPublishesAndStaleAcceptanceFails, customerPublicationIsExplicitAndExcludesInternalData |
|TC-10| 재처리 권한·상한·중복·동시 replay·사진/3회 예산 보존 | manualDltReplayHasSeparatePermissionHistoryAndBoundedAttempts, validDltReplayAppliesOriginalEventExactlyOnce, concurrentManualReplayCreatesOneBusinessEffect, outboxHasTerminalLimitAndOperatorCanExplicitlyRequeue, diagnosisRetryPreservesPhotosAndThreeRoundBudget |

표의 테스트 이름은 실제 소스에 있는 이름을 기준으로 유지한다. BackendApplicationTests의 추가 사진 회귀 이름은 아래 소스/HTML 리포트에서 확인할 수 있다.

## 백엔드 단독과 외부 통합의 구분

| 항목 | 검증 상태 |
|---|---|
| Spring HTTP·인증·DB·Kafka·Outbox·SSE | 독립 Testcontainers/MockMvc 자동 검증 |
| 증분 journal·receipt·동시성·역전 방지 | Spring DB 통합 검증 |
| RAG adapter의 upsert·실패·searchReady 계약 | mock 검증, 실제 임베딩/검색 아님 |
| Swagger UI 정적 파일·CSRF interceptor | MockMvc/Node 검증, 실제 브라우저 시각 확인 안 함 |
| Vue 화면 연결·쿠키·고객 공개 화면 | 미실행; V2_CONTRACTS.md의 화면 인계 필요 |
| 실제 Agent 출력·SURFACE/PCB·업무·RAG 실행 | 미실행; 공유 Kafka schema와 출력 검증 인계 필요 |
| 실제 Qdrant 검색 반영10건 각각120초 | 미검증 목표. GET/콜백 mock 성공을 검색 성공으로 간주하지 않음 |
| 실제 제조사 보증·SMS/메일·본인확인·키 재발급 | 계약 없음; 호출/구현 안 함 |
| 실제 PCB/모터 사진의 흐림 정확도 | 미검증; 기존 임시 기준 유지 |

확정 뒤 외부 동기화 ERROR가 와도 confirmed_revision이 유지됨을 검증했다. 늦은 이전 revision 성공으로 최신 revision 상태가 완료되지 않는다. 실제 외부 장애·장기 부하·프로세스 강제 종료의 전체 통합 검증은 별도다. 커밋·push·배포는 수행하지 않았다.

추가 확인: DIAGNOSIS_FAILED의 수집 요약을 기사에게 제공하고 최종 미확정을 자동 재진단하지 않는다. 과거 확정본 초기 이관은 해당 revision의 결과를 유지한다. 부품 ID가 포함된 편집 제안도 JSON 숫자/문자열 표현과 무관하게 멱등 비교하며 수락은 초안만 생성한다.
