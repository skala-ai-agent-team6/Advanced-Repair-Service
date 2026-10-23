package com.skala.backend.repair;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.kafka.KafkaContainer;
import java.time.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.awaitility.Awaitility.await;

@SpringBootTest(properties={"app.scheduling.enabled=false","app.mock-ai.enabled=false","app.photo-quality.enabled=true","app.rag-sync.enabled=true","app.warranty.allow-development=true","app.consumer.requests-per-minute=1000","app.internal-token=test-service-secret-at-least-32-characters","app.seed-password=TestPassword-Only123!","app.files=${java.io.tmpdir}/repair-v2-test"})
@ActiveProfiles("dev") @AutoConfigureMockMvc @Testcontainers
class V2ServiceTests {
    @Container static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17-alpine");
    @Container static KafkaContainer kafka=new KafkaContainer("apache/kafka:4.1.1");
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r){r.add("spring.datasource.url",postgres::getJdbcUrl);r.add("spring.datasource.username",postgres::getUsername);r.add("spring.datasource.password",postgres::getPassword);r.add("spring.kafka.bootstrap-servers",kafka::getBootstrapServers);}
    @Autowired Store db;@Autowired ConsumerService consumer;@Autowired WarrantyService warranty;@Autowired CaseWorkService work;@Autowired ReportService reports;@Autowired RagCaseService rag;@Autowired ReportEditService editor;@Autowired RepairService repairs;@Autowired PhotoQualityWorker worker;@Autowired PhotoQualityService quality;@Autowired OperationsService ops;@Autowired DiagnosisEvents events;@Autowired RepairQueries queries;@Autowired DashboardService dashboard;@Autowired MockMvc mvc;@Autowired PlatformTransactionManager manager;
    @BeforeEach void clean(){db.update("TRUNCATE repair_case CASCADE");db.update("DELETE FROM warranty_policy");db.update("UPDATE app_user SET operations_enabled=false");login("tech1");}
    @AfterEach void logout(){SecurityContextHolder.clearContext();}
    void login(String name){SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(name,"unused",List.of()));}
    MockMultipartFile photo(){return new MockMultipartFile("files","photo.png","image/png",com.skala.backend.repair.quality.QualityImages.png(640,480));}
    V2Inputs.ConsumerIntake input(String type){return new V2Inputs.ConsumerIntake("바퀴가 멈춥니다.",WarrantyService.today().minusMonths(6),"ROBOT-SEOUL-001","R1",1L,type,"가상고객","010-0000-0000","가상 출장 주소");}
    Map<String,Object> intake(){return consumer.create(input("CENTER"),List.of(photo()));}
    Long caseId(Map<String,Object> c){return (Long)db.one("SELECT id FROM repair_case WHERE case_number=?",c.get("caseNumber")).get("id");}
    String key(Map<String,Object> c){return "Bearer "+c.get("lookupKey");}
    Long attachment(Map<String,Object> c){return (Long)((List<?>)c.get("attachmentIds")).getFirst();}
    void error(Runnable action,String code){assertThatThrownBy(action::run).isInstanceOf(ApiError.class).hasMessage(code);}
    Inputs.ReportContent content(String cause){return new Inputs.ReportContent(cause,List.of(new Inputs.Fault("SW",null,null)),"실제 조치","INTERNAL_PRIVATE_NOTE",true,Inputs.Acceptance.ACCEPTED);}
    Map<String,Object> draft(Long id){return reports.draft(id,new Inputs.Draft(0,content("실제 원인")));}
    Map<String,Object> confirm(Map<String,Object> r){return reports.confirm((Long)r.get("id"),new Inputs.Confirm(((Number)r.get("version")).longValue(),Json.number(r.get("latest_revision"))));}
    Map<String,Object> confirmed(){return confirm(draft(caseId(intake())));}
    Map<String,Object> event(Map<String,Object> c,int sequence,Map<String,Object> payload){
        var t=db.one("SELECT * FROM diagnosis_job WHERE case_id=? ORDER BY id DESC LIMIT 1",caseId(c));
        return Map.ofEntries(Map.entry("eventId",UUID.randomUUID()),Map.entry("eventType","DIAGNOSIS_COMPLETED"),Map.entry("schemaVersion",2),Map.entry("occurredAt",Instant.now().toString()),Map.entry("repairId",caseId(c)),Map.entry("taskId",t.get("id")),Map.entry("correlationId",db.one("SELECT correlation_id FROM repair_case WHERE id=?",caseId(c)).get("correlation_id")),Map.entry("executionId",t.get("execution_id")),Map.entry("inputRevision",1),Map.entry("sequence",sequence),Map.entry("payload",payload));
    }
    Map<String,Object> validResult(){return new LinkedHashMap<>(Map.of("summary","외형 관찰에 따른 추정","repairMethod","점검 후 결정","modelVersion","fixture","candidates",List.of(Map.of("rank",1,"cause","관찰","explanation","확률로 해석하지 않음","confidence",0.5)),"recommendedParts",List.of(),"evidence",List.of()));}
    Long start(Map<String,Object> c){Long a=attachment(c);worker.runOnce();await().atMost(Duration.ofSeconds(10)).until(()->db.one("SELECT status FROM photo_quality_result WHERE attachment_id=?",a).get("status").equals("COMPLETED"));return (Long)repairs.start(caseId(c),null,List.of(a)).get("taskId");}
    @Test void consumerIntakeStoresHashAndNeverStartsAgent()throws Exception{
        SecurityContextHolder.clearContext();var c=intake();Long id=caseId(c);assertThat(c.get("lookupKey").toString()).hasSize(43);
        assertThat(db.one("SELECT key_hash FROM consumer_access WHERE case_id=?",id).get("key_hash")).isEqualTo(ConsumerService.hash(c.get("lookupKey").toString()));
        assertThat(db.list("SELECT * FROM diagnosis_job")).isEmpty();assertThat(db.list("SELECT * FROM outbox_event WHERE topic IS NOT NULL")).isEmpty();
        assertThat(((Map<?,?>)db.one("SELECT product_snapshot FROM repair_case WHERE id=?",id).get("product_snapshot")).get("model_code")).isEqualTo("R1");
        assertThat(db.one("SELECT intake_source,technician_id FROM repair_case WHERE id=?",id)).containsEntry("intake_source","CONSUMER").containsEntry("technician_id",null);
        mvc.perform(get("/public/cases/"+c.get("caseNumber")).header("Authorization",key(c))).andExpect(status().isOk()).andExpect(jsonPath("$.warranty.result").value("UNKNOWN"));
    }
    @Test void publicHttpRequiresMandatoryFieldsAndRejectsInvalidDates()throws Exception{
        SecurityContextHolder.clearContext();String json=Json.write(input("CENTER"));
        mvc.perform(multipart("/public/cases").file(photo()).file(new MockMultipartFile("data","data.json","application/json",json.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).andExpect(status().isAccepted());
        for(String invalid:List.of(json.replace("바퀴가 멈춥니다.",""),json.replace(input("CENTER").purchaseDate().toString(),"2999-01-01"),json.replace(input("CENTER").purchaseDate().toString(),"2026-02-30"))){
            mvc.perform(multipart("/public/cases").file(photo()).file(new MockMultipartFile("data","data.json","application/json",invalid.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).andExpect(status().isBadRequest());
        }
        mvc.perform(multipart("/public/cases").file(new MockMultipartFile("data","data.json","application/json",json.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).andExpect(status().isBadRequest());
    }
    @Test void publicKeysDoNotAuthorizeOtherCasesOrStaffActions()throws Exception{
        var a=intake();var b=intake();SecurityContextHolder.clearContext();
        for(String token:List.of("",key(b),"Bearer "+a.get("caseNumber"))){mvc.perform(get("/public/cases/"+a.get("caseNumber")).header("Authorization",token)).andExpect(status().isNotFound());}
        mvc.perform(get("/public/cases/"+a.get("caseNumber")+"/attachments/"+attachment(b)).header("Authorization",key(a))).andExpect(status().isNotFound());
        mvc.perform(get("/api/attachments/"+attachment(a))).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/attachments/"+attachment(a)+"/quality/acknowledgment").with(csrf()).header("Authorization",key(a)).contentType("application/json").content("{\"resultId\":1}")).andExpect(status().isUnauthorized());
        db.update("UPDATE consumer_access SET expires_at=now()-interval '1 second' WHERE case_id=?",caseId(a));error(()->consumer.get(a.get("caseNumber").toString(),key(a)),"NOT_FOUND");
    }
    @Test void consumerPhotosStayBoundToTheirOwnCase()throws Exception{
        var a=intake();var b=intake();var uploaded=consumer.upload(a.get("caseNumber").toString(),key(a),photo());
        assertThat(db.one("SELECT case_id FROM attachment WHERE id=?",uploaded.get("attachmentId")).get("case_id")).isEqualTo(caseId(a));
        error(()->consumer.upload(a.get("caseNumber").toString(),key(b),photo()),"NOT_FOUND");
        start(a);error(()->consumer.upload(a.get("caseNumber").toString(),key(a),photo()),"TECHNICIAN_PHOTO_REQUEST_REQUIRED");
    }
    @Test void warrantySnapshotsHandleBoundariesAndUnknownPolicies(){
        var c=intake();Long id=caseId(c);assertThat(warranty.latest(id).get("result")).isEqualTo("UNKNOWN");
        login("quality");warranty.policy(new V2Inputs.Policy(1L,"DEMO-12M",12,LocalDate.of(2000,1,1),null,true));login("tech1");
        var tx=new TransactionTemplate(manager);db.update("UPDATE repair_case SET purchase_date='2025-01-31' WHERE id=?",id);
        tx.executeWithoutResult(s->{assertThat(warranty.record(id,LocalDate.of(2026,1,30)).get("result")).isEqualTo("WITHIN_PERIOD");assertThat(warranty.record(id,LocalDate.of(2026,1,31)).get("result")).isEqualTo("OUTSIDE_PERIOD");});
        assertThat(warranty.latest(id).get("policy_version")).isEqualTo("DEMO-12M");assertThat(db.list("SELECT * FROM warranty_assessment WHERE case_id=?",id)).hasSize(3);
        db.update("UPDATE repair_case SET purchase_date='2999-01-01' WHERE id=?",id);error(()->warranty.assess(id),"FUTURE_PURCHASE_DATE");
    }
    @Test void fieldAssignmentsExtendOnlyExplicitTechnicianAccess(){
        var c=consumer.create(input("FIELD"),List.of(photo()));Long id=caseId(c);login("tech2");error(()->work.work(id),"FORBIDDEN");
        login("quality");Long tech=(Long)db.one("SELECT id FROM app_user WHERE email='tech2'").get("id");work.assign(id,new V2Inputs.Assignment(tech,"출장 배정"));
        login("tech2");assertThat(queries.list(0,20,null,null).get("items").toString()).contains(id.toString());assertThat(work.work(id).get("preparation").toString()).doesNotContain("TECHNICIAN_UNASSIGNED");
        login("quality");Long tech1=(Long)db.one("SELECT id FROM app_user WHERE email='tech1'").get("id");work.assign(id,new V2Inputs.Assignment(tech1,"재배정"));login("tech2");error(()->work.work(id),"FORBIDDEN");assertThat(db.list("SELECT * FROM case_assignment")).hasSize(2);
    }
    @Test void customerPublicationIsExplicitAndExcludesInternalData(){
        var c=intake();Long id=caseId(c);var r=confirm(draft(id));reports.comment((Long)r.get("id"),commentAsManager());login("tech1");
        work.customerDraft(id,new V2Inputs.CustomerDraft(0,"ESTIMATE","관찰상 추정 원인","예정 점검",null));
        assertThat(consumer.get(c.get("caseNumber").toString(),key(c)).get("report")).isNull();
        work.publish(id,1);String json=Json.write(consumer.get(c.get("caseNumber").toString(),key(c)));
        assertThat(json).contains("ESTIMATE","관찰상 추정 원인").doesNotContain("INTERNAL_PRIVATE_NOTE","HQ_PRIVATE","가상고객","가상 출장 주소","010-0000","key_hash","tool","factory");
        work.customerDraft(id,new V2Inputs.CustomerDraft(1,"CONFIRMED","실제 확정 원인","완료 조치",1));
        assertThat(Json.write(consumer.get(c.get("caseNumber").toString(),key(c)))).contains("ESTIMATE").doesNotContain("실제 확정 원인");work.publish(id,2);
        assertThat(Json.write(consumer.get(c.get("caseNumber").toString(),key(c)))).contains("CONFIRMED");
    }
    Inputs.Comment commentAsManager(){login("quality");return new Inputs.Comment(1,"HQ_PRIVATE",UUID.randomUUID());}
    @Test void actualRepairRequiresCauseActionAndAllowsZeroReplacements(){
        Long id=caseId(intake());error(()->reports.draft(id,new Inputs.Draft(0,content(" "))),"ACTUAL_CAUSE_ACTION_REQUIRED");
        var r=draft(id);db.update("UPDATE repair_report_revision SET content=jsonb_set(content,'{actualAction}','\"\"') WHERE report_id=?",r.get("id"));
        error(()->confirm(r),"ACTUAL_CAUSE_ACTION_REQUIRED");assertThat(db.one("SELECT confirmed_revision FROM repair_report WHERE id=?",r.get("id")).get("confirmed_revision")).isNull();
        db.update("UPDATE repair_report_revision SET content=jsonb_set(content,'{actualAction}','\"실제 조치\"') WHERE report_id=?",r.get("id"));var done=confirm(r);
        assertThat(done.get("confirmed_revision")).isEqualTo(1);assertThat(db.list("SELECT * FROM report_replaced_part")).isEmpty();
        var newer=reports.draft(id,new Inputs.Draft(((Number)done.get("version")).longValue(),content("수정 실제 원인")));confirm(newer);
        assertThat(dashboard.counts(WarrantyService.today().minusDays(1),WarrantyService.today().plusDays(1),"PERIOD").getFirst().get("count")).isEqualTo(1L);
    }
    @Test void ragCursorUsesStableWindowAndDoesNotMissSameTimestampChanges(){
        confirmed();confirmed();confirmed();db.update("UPDATE rag_case_change SET confirmed_at='2026-10-23T00:00:00Z'");
        var first=rag.changes(0,null,1);long cursor=((Number)first.get("nextCursor")).longValue(),until=((Number)first.get("until")).longValue();confirmed();
        var second=rag.changes(cursor,until,10);assertThat((List<?>)second.get("items")).hasSize(2);assertThat(second.get("hasMore")).isEqualTo(false);
        var next=rag.changes(until,null,10);assertThat((List<?>)next.get("items")).hasSize(1);
    }
    @Test void ragCallbacksAreIdempotentAndOlderSuccessCannotCompleteNewRevision(){
        var r=confirmed();Long id=(Long)r.get("id");var old=db.one("SELECT * FROM rag_case_change WHERE report_id=?",id);
        var newer=reports.draft((Long)r.get("case_id"),new Inputs.Draft(((Number)r.get("version")).longValue(),content("수정")));confirm(newer);
        var receipt=new V2Inputs.SyncReceipt(UUID.randomUUID(),id,1,"SUCCEEDED",null);rag.receipt((Long)old.get("id"),receipt);rag.receipt((Long)old.get("id"),receipt);
        assertThat(rag.state(id).get("status")).isEqualTo("PENDING");assertThat(db.list("SELECT * FROM rag_sync_receipt")).hasSize(1);
        var latest=rag.state(id);rag.receipt((Long)latest.get("id"),new V2Inputs.SyncReceipt(UUID.randomUUID(),id,2,"ERROR","QDRANT_UNAVAILABLE"));
        assertThat(db.one("SELECT confirmed_revision FROM repair_report WHERE id=?",id).get("confirmed_revision")).isEqualTo(2);
        assertThat(rag.state(id).get("status")).isEqualTo("ERROR");
    }
    @Test void ragPayloadOmitsContactsAddressesAndPrivateOpinion(){
        var c=intake();Long id=caseId(c);var r=reports.draft(id,new Inputs.Draft(0,content("가상고객 010-0000-0000 가상 출장 주소 test@example.com")));confirm(r);
        String json=Json.write(db.one("SELECT document FROM rag_case_change").get("document"));
        assertThat(json).doesNotContain("가상고객","010-0000","가상 출장 주소","test@example.com","INTERNAL_PRIVATE_NOTE").contains("REDACTED");
    }
    @Test void editorSuggestionNeverAutoConfirmsOrPublishesAndStaleAcceptanceFails(){
        var r=confirmed();Long id=(Long)r.get("id");var suggested=new Inputs.ReportContent("AI 제안",List.of(new Inputs.Fault("PCB",null,3L)),"제안 조치","제안 소견",true,Inputs.Acceptance.PARTIAL,null,List.of(new V2Inputs.ReplacedPart(3L,1)));
        var proposalInput=new V2Inputs.Proposal(UUID.randomUUID(),1,"editor-mock",suggested);var p=editor.propose(id,proposalInput);assertThat(editor.propose(id,proposalInput).get("id")).isEqualTo(p.get("id"));
        assertThat(db.one("SELECT confirmed_revision,latest_revision FROM repair_report WHERE id=?",id)).containsEntry("confirmed_revision",1).containsEntry("latest_revision",1);
        editor.decide(id,(Long)p.get("id"),new V2Inputs.Review("ACCEPT"));
        assertThat(db.one("SELECT confirmed_revision,latest_revision FROM repair_report WHERE id=?",id)).containsEntry("confirmed_revision",1).containsEntry("latest_revision",2);
        var stale=editor.propose(id,new V2Inputs.Proposal(UUID.randomUUID(),2,"editor-mock",content("늦은 제안")));
        var current=db.one("SELECT version FROM repair_report WHERE id=?",id);reports.draft((Long)r.get("case_id"),new Inputs.Draft(((Number)current.get("version")).longValue(),content("기사 수정")));
        error(()->editor.decide(id,(Long)stale.get("id"),new V2Inputs.Review("ACCEPT")),"STALE_EDITOR_VERSION");editor.decide(id,(Long)stale.get("id"),new V2Inputs.Review("REJECT"));
    }
    @Test void invalidAiPartsAndEvidenceAreRejectedAndZeroSequenceIsAllowed(){
        var c=intake();start(c);var p=validResult();p.put("recommendedParts",List.of(Map.of("partId",2,"quantity",1)));p.put("evidence",List.of(Map.of("type","MANUAL","citation","TEST-ONLY")));
        error(()->events.receive(Json.write(event(c,1,p))),"INCOMPATIBLE_PART");
        p.put("recommendedParts",List.of(Map.of("partId",1,"quantity",101)));error(()->events.receive(Json.write(event(c,1,p))),"QUANTITY");
        p.put("recommendedParts",List.of(Map.of("partId",1,"quantity",1),Map.of("partId",1,"quantity",1)));error(()->events.receive(Json.write(event(c,1,p))),"DUPLICATE_PART");
        p.put("recommendedParts",List.of());p.put("evidence",List.of(Map.of("type","RAG")));error(()->events.receive(Json.write(event(c,1,p))),"EVIDENCE_SOURCE_REQUIRED");
        var other=intake();p.put("evidence",List.of(Map.of("type","PHOTO","attachmentId",attachment(other))));error(()->events.receive(Json.write(event(c,1,p))),"FOREIGN_EVIDENCE_ATTACHMENT");
        p.put("evidence",List.of());var body=Json.write(event(c,0,p));events.receive(body);events.receive(body);assertThat(db.list("SELECT * FROM diagnosis_candidate")).hasSize(1);
    }
    @Test void manualDltReplayHasSeparatePermissionHistoryAndBoundedAttempts(){
        var c=intake();Long job=start(c);var bad=validResult();bad.put("summary","");String body=Json.write(event(c,1,bad));UUID eventId=Json.uuid(Json.object(body).get("eventId"));events.deadLetter(body,3);
        login("quality");error(()->ops.list(10),"FORBIDDEN");db.update("UPDATE app_user SET operations_enabled=true WHERE email='quality'");
        UUID key=UUID.randomUUID();var first=ops.retry(eventId,"RESULT",new V2Inputs.Reprocess(key));assertThat(first.get("state")).isEqualTo("ERROR");assertThat(ops.retry(eventId,"RESULT",new V2Inputs.Reprocess(key)).get("id")).isEqualTo(first.get("id"));
        ops.retry(eventId,"RESULT",new V2Inputs.Reprocess(UUID.randomUUID()));ops.retry(eventId,"RESULT",new V2Inputs.Reprocess(UUID.randomUUID()));error(()->ops.retry(eventId,"RESULT",new V2Inputs.Reprocess(UUID.randomUUID())),"REPROCESS_LIMIT");assertThat(db.one("SELECT status FROM diagnosis_job WHERE id=?",job).get("status")).isEqualTo("FAILED");
    }
    @Test void validDltReplayAppliesOriginalEventExactlyOnce(){
        var c=intake();Long job=start(c);String body=Json.write(event(c,1,validResult()));UUID eventId=Json.uuid(Json.object(body).get("eventId"));events.deadLetter(body,3);
        db.update("UPDATE app_user SET operations_enabled=true WHERE email='tech1'");var request=new V2Inputs.Reprocess(UUID.randomUUID());var done=ops.retry(eventId,"RESULT",request);
        assertThat(done.get("state")).isEqualTo("SUCCEEDED");assertThat(db.one("SELECT status FROM diagnosis_job WHERE id=?",job).get("status")).isEqualTo("SUCCEEDED");
        ops.retry(eventId,"RESULT",request);events.receive(body);assertThat(db.list("SELECT * FROM diagnosis_candidate")).hasSize(1);assertThat(db.one("SELECT original_disposition FROM received_event WHERE event_id=?",eventId).get("original_disposition")).isEqualTo("DLT");
    }
    @Test void diagnosisRetryPreservesPhotosAndThreeRoundBudget(){
        var c=intake();Long old=start(c);db.update("UPDATE diagnosis_job SET status='FAILED',error_code='SERVICE_UNAVAILABLE',photo_request_count=3 WHERE id=?",old);repairs.retryFailedDiagnosis(old);
        var next=db.one("SELECT * FROM diagnosis_job WHERE case_id=? ORDER BY id DESC LIMIT 1",caseId(c));assertThat(next.get("id")).isNotEqualTo(old);assertThat(Json.number(next.get("photo_request_count"))).isEqualTo(3);
        assertThat(db.list("SELECT * FROM diagnosis_input_attachment WHERE job_id=?",next.get("id"))).hasSize(1);
        for(int n=0;n<5;n++){db.update("UPDATE diagnosis_job SET status='FAILED',error_code='SERVICE_UNAVAILABLE' WHERE case_id=?",caseId(c));Long latest=(Long)db.one("SELECT id FROM diagnosis_job WHERE case_id=? ORDER BY id DESC LIMIT 1",caseId(c)).get("id");repairs.retryFailedDiagnosis(latest);}
        assertThat(db.list("SELECT * FROM diagnosis_job WHERE case_id=?",caseId(c))).hasSize(4);
    }
    @Test void outboxHasTerminalLimitAndOperatorCanExplicitlyRequeue(){
        var c=intake();Long job=start(c);var sent=db.one("SELECT event_key FROM outbox_event WHERE job_id=? AND topic IS NOT NULL",job);UUID event=(UUID)sent.get("event_key");
        @SuppressWarnings("unchecked") var kafkaMock=(org.springframework.kafka.core.KafkaTemplate<String,String>)org.mockito.Mockito.mock(org.springframework.kafka.core.KafkaTemplate.class);
        org.mockito.Mockito.when(kafkaMock.send(org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString())).thenReturn(java.util.concurrent.CompletableFuture.failedFuture(new IllegalStateException("offline")));
        var publisher=new OutboxPublisher(db,kafkaMock,manager);publisher.maxAttempts=2;
        publisher.publish();db.update("UPDATE outbox_event SET next_attempt_at=now() WHERE event_key=?",event);publisher.publish();publisher.publish();
        assertThat(db.one("SELECT terminal_failure,publish_attempts FROM outbox_event WHERE event_key=?",event)).containsEntry("terminal_failure",true).containsEntry("publish_attempts",2);
        db.update("UPDATE app_user SET operations_enabled=true WHERE email='tech1'");assertThat(ops.retry(event,"OUTBOX",new V2Inputs.Reprocess(UUID.randomUUID())).get("state")).isEqualTo("SUCCEEDED");
        assertThat(db.one("SELECT terminal_failure,published_at FROM outbox_event WHERE event_key=?",event)).containsEntry("terminal_failure",false).containsEntry("published_at",null);
    }
    @Test void warrantyPolicyVersionChangePreservesPriorAssessmentAndDisabledRagCannotClaimSuccess(){
        var c=intake();Long id=caseId(c);login("quality");warranty.policy(new V2Inputs.Policy(1L,"POLICY-1",12,LocalDate.of(2000,1,1),null,false));
        login("tech1");warranty.assess(id);assertThat(warranty.latest(id).get("policy_version")).isEqualTo("POLICY-1");
        login("quality");warranty.policy(new V2Inputs.Policy(1L,"POLICY-2",6,LocalDate.of(2020,1,1),null,false));login("tech1");warranty.assess(id);
        assertThat(warranty.latest(id).get("policy_version")).isEqualTo("POLICY-2");assertThat(db.list("SELECT policy_version FROM warranty_assessment WHERE case_id=? ORDER BY id",id).stream().map(v->v.get("policy_version"))).containsExactly(null,"POLICY-1","POLICY-2");
        error(()->new RagCaseService(db,new Access(null,db),false).changes(0,null,10),"RAG_SYNC_DISABLED");
    }
    @Test void ragAndEditorInternalHttpRequireServiceToken()throws Exception{
        SecurityContextHolder.clearContext();mvc.perform(get("/internal/rag/confirmed-changes")).andExpect(status().isUnauthorized());
        mvc.perform(get("/internal/rag/confirmed-changes").header("Authorization","Bearer test-service-secret-at-least-32-characters")).andExpect(status().isOk());
        mvc.perform(post("/internal/reports/1/edit-proposals").contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
    }
    @Test void ragWindowWaitsForEarlierUncommittedConfirmation()throws Exception{
        var report=draft(caseId(intake()));var inserted=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var writer=pool.submit(()->{login("tech1");try{new TransactionTemplate(manager).executeWithoutResult(status->{confirm(report);inserted.countDown();try{release.await(5,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){throw new IllegalStateException(e);}});}finally{SecurityContextHolder.clearContext();}});
            assertThat(inserted.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            var started=new java.util.concurrent.CountDownLatch(1);var reader=pool.submit(()->{started.countDown();return rag.changes(0,null,100);});
            assertThat(started.await(5,java.util.concurrent.TimeUnit.SECONDS)).isTrue();assertThat(reader.isDone()).isFalse();release.countDown();writer.get(5,java.util.concurrent.TimeUnit.SECONDS);
            assertThat((List<?>)reader.get(5,java.util.concurrent.TimeUnit.SECONDS).get("items")).hasSize(1);
        }finally{release.countDown();}
    }
    @Test void concurrentManualReplayCreatesOneBusinessEffect()throws Exception{
        var c=intake();start(c);String body=Json.write(event(c,1,validResult()));UUID event=Json.uuid(Json.object(body).get("eventId"));events.deadLetter(body,3);db.update("UPDATE app_user SET operations_enabled=true WHERE email='tech1'");var input=new V2Inputs.Reprocess(UUID.randomUUID());
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var jobs=new ArrayList<java.util.concurrent.Future<?>>();
            for(int n=0;n<2;n++)jobs.add(pool.submit(()->{login("tech1");try{ops.retry(event,"RESULT",input);}finally{SecurityContextHolder.clearContext();}}));
            for(var job:jobs)job.get(10,java.util.concurrent.TimeUnit.SECONDS);
        }
        assertThat(db.list("SELECT * FROM reprocess_attempt")).hasSize(1);assertThat(db.list("SELECT * FROM diagnosis_candidate")).hasSize(1);
    }
    @Test void otherApplianceUsesUnknownProductMetadata(){
        db.update("UPDATE product_model SET appliance_type='REFRIGERATOR' WHERE id=2");
        try{
            var input=new V2Inputs.ConsumerIntake("개발용 다른 가전 접수",WarrantyService.today().minusDays(1),"NEW-APPLIANCE-TEST","R2",1L,"CENTER",null,null,null);
            var c=consumer.create(input,List.of(photo()));Long task=start(c);
            var payload=(Map<?,?>)db.one("SELECT payload FROM outbox_event WHERE job_id=? AND topic IS NOT NULL",task).get("payload");
            assertThat(((Map<?,?>)((Map<?,?>)payload.get("payload")).get("repair")).get("product_type")).isEqualTo("unknown");
        }finally{db.update("UPDATE product_model SET appliance_type='VACUUM_CLEANER' WHERE id=2");}
    }
    @Test void finalFailureKeepsCollectedSummaryForTechnicianWithoutStartingProcurement(){
        var c=intake();Long task=start(c);var failed=new LinkedHashMap<String,Object>(event(c,1,Map.of("errorCode","INCONCLUSIVE_AFTER_THIRD_PHOTO","summary","수집된 단서는 있으나 확정할 수 없습니다.","analysisResults",List.of())));
        failed.put("eventType","DIAGNOSIS_FAILED");events.receive(Json.write(failed));
        assertThat(queries.task(task)).containsEntry("status","FAILED").containsEntry("error_message","수집된 단서는 있으나 확정할 수 없습니다.");
        assertThat(db.list("SELECT * FROM procurement_job")).isEmpty();
        repairs.retryFailedDiagnosis(task);assertThat(db.list("SELECT * FROM diagnosis_job")).hasSize(1);
    }
    @Test void ragBootstrapKeepsHistoricalOutcomeInsteadOfLatestHeader(){
        Long id=caseId(intake());var notFixed=new Inputs.ReportContent("당시 원인",List.of(),"당시 미완료 조치","내부",false,Inputs.Acceptance.PARTIAL);
        var first=confirm(reports.draft(id,new Inputs.Draft(0,notFixed)));Long report=(Long)first.get("id");
        confirm(reports.draft(id,new Inputs.Draft(((Number)first.get("version")).longValue(),content("최종 실제 원인"))));
        db.update("DELETE FROM rag_case_change WHERE report_id=?",report);rag.changes(0,null,100);
        var rows=db.list("SELECT document->>'outcome' AS outcome FROM rag_case_change WHERE report_id=? ORDER BY revision",report);
        assertThat(rows.stream().map(r->r.get("outcome"))).containsExactly("NOT_FIXED","FIXED");
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"STAFF,VACUUM_CLEANER,vacuum","STAFF,WASHING_MACHINE,washing_machine","STAFF,AIR_CONDITIONER,air_conditioner","STAFF,REFRIGERATOR,unknown","CONSUMER,VACUUM_CLEANER,vacuum","CONSUMER,WASHING_MACHINE,washing_machine","CONSUMER,AIR_CONDITIONER,air_conditioner","CONSUMER,REFRIGERATOR,unknown"})
    void productTypeSurvivesIntakeResumeRetryReplayAndConfirmedQueries(String source,String appliance,String expected)throws Exception{
        db.update("UPDATE product_model SET appliance_type=? WHERE id=1",appliance);
        try{
            Map<String,Object> c;
            if(source.equals("CONSUMER"))c=intake();
            else{
                var saved=repairs.create(new Inputs.Intake(1L,"증상으로 제품을 추측하지 않음",List.of(),"1",Map.of()),List.of(photo()));
                Long id=(Long)saved.get("repairId");Long a=(Long)((Map<?,?>)((List<?>)saved.get("attachments")).getFirst()).get("attachmentId");
                c=Map.of("caseNumber",db.one("SELECT case_number FROM repair_case WHERE id=?",id).get("case_number"),"attachmentIds",List.of(a));
            }
            assertThat(db.one("SELECT intake_source,product_type FROM repair_case WHERE id=?",caseId(c))).containsEntry("intake_source",source).containsEntry("product_type",expected);
            // A later catalog correction must not change this reception's commands or historical report.
            db.update("UPDATE product_model SET appliance_type='CHANGED_AFTER_INTAKE' WHERE id=1");
            Long task=start(c);var requested=db.one("SELECT payload FROM outbox_event WHERE job_id=? AND event_type='DIAGNOSIS_REQUESTED'",task);
            assertCommandType(requested.get("payload"),expected);
            var photoEvent=new LinkedHashMap<String,Object>(event(c,1,Map.of("requestKey",UUID.randomUUID(),"round",1,"bodyPart","GENERAL","description","추가 사진","checkpoint","cp")));
            photoEvent.put("eventType","PHOTO_REQUESTED");events.receive(Json.write(photoEvent));
            Long request=(Long)db.one("SELECT id FROM photo_request WHERE job_id=?",task).get("id");
            Long extra=(Long)repairs.upload(caseId(c),request,photo()).get("attachmentId");worker.runOnce();
            await().atMost(Duration.ofSeconds(10)).until(()->db.one("SELECT status FROM photo_quality_result WHERE attachment_id=?",extra).get("status").equals("COMPLETED"));
            repairs.resume(caseId(c),new Inputs.Resume(request,UUID.randomUUID(),List.of(extra)));
            assertCommandType(db.one("SELECT payload FROM outbox_event WHERE job_id=? AND event_type='DIAGNOSIS_RESUMED'",task).get("payload"),expected);
            db.update("UPDATE diagnosis_job SET status='FAILED',error_code='SERVICE_UNAVAILABLE' WHERE id=?",task);repairs.retryFailedDiagnosis(task);
            var retry=db.one("SELECT * FROM outbox_event WHERE topic IS NOT NULL ORDER BY id DESC LIMIT 1");assertCommandType(retry.get("payload"),expected);
            db.update("UPDATE app_user SET operations_enabled=true WHERE email='tech1'");db.update("UPDATE outbox_event SET terminal_failure=true WHERE id=?",retry.get("id"));
            assertThat(ops.retry((UUID)retry.get("event_key"),"OUTBOX",new V2Inputs.Reprocess(UUID.randomUUID())).get("state")).isEqualTo("SUCCEEDED");
            var replay=db.one("SELECT payload FROM outbox_event WHERE id=?",retry.get("id"));assertThat(replay.get("payload")).isEqualTo(retry.get("payload"));assertCommandType(replay.get("payload"),expected);
            confirm(draft(caseId(c)));
            assertThat(queries.confirmedCases(0,100).getFirst().get("product_type")).isEqualTo(expected);
            mvc.perform(get("/internal/confirmed-cases").header("Authorization","Bearer test-service-secret-at-least-32-characters")).andExpect(status().isOk()).andExpect(jsonPath("$[0].product_type").value(expected));
            var page=rag.changes(0,null,100);var item=(Map<?,?>)((List<?>)page.get("items")).getFirst();assertThat(item.get("product_type")).isEqualTo(expected);assertThat(((Map<?,?>)item.get("document")).get("product_type")).isEqualTo(expected);
            // Pre-PR6 journals are enriched in the response without rewriting receipts or stored documents.
            db.update("UPDATE rag_case_change SET document=document-'product_type'");
            item=(Map<?,?>)((List<?>)rag.changes(0,null,100).get("items")).getFirst();assertThat(((Map<?,?>)item.get("document")).get("product_type")).isEqualTo(expected);
        }finally{db.update("UPDATE product_model SET appliance_type='VACUUM_CLEANER' WHERE id=1");}
    }
    void assertCommandType(Object body,String expected){
        var repair=(Map<?,?>)((Map<?,?>)((Map<?,?>)body).get("payload")).get("repair");assertThat(repair.get("product_type")).isEqualTo(expected);assertThat(((Map<?,?>)repair.get("product_snapshot")).get("product_type")).isEqualTo(expected);
    }
    @Test void publicRateLimiterHasHardBoundAndMinuteReset(){var limiter=new PublicRateLimit(2);assertThat(limiter.allow("127.0.0.1",1)).isTrue();assertThat(limiter.allow("127.0.0.1",1)).isTrue();assertThat(limiter.allow("127.0.0.1",1)).isFalse();assertThat(limiter.allow("127.0.0.1",2)).isTrue();}
}
