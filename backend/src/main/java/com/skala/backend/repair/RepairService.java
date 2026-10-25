package com.skala.backend.repair;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.beans.factory.annotation.Value;
import java.time.Instant;
import java.util.*;

@Service
public class RepairService {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(RepairService.class);
    final Store db;final Access access;final LocalFiles files;final Catalog catalog;final String commands;final WarrantyService warranty;final PhotoQualityService quality;final PhotoQualityExecutor validation;final com.skala.backend.repair.quality.PhotoQualityProperties policy;final org.springframework.transaction.support.TransactionTemplate tx;
    public RepairService(Store db,Access access,LocalFiles files,Catalog catalog,WarrantyService warranty,PhotoQualityService quality,PhotoQualityExecutor validation,com.skala.backend.repair.quality.PhotoQualityProperties policy,org.springframework.transaction.PlatformTransactionManager manager,@Value("${app.commands-topic}") String commands) {this.warranty=warranty;this.db=db;this.access=access;this.files=files;this.catalog=catalog;this.commands=commands;this.quality=quality;this.validation=validation;this.policy=policy;this.tx=new org.springframework.transaction.support.TransactionTemplate(manager);}
    public Map<String,Object> create(Inputs.Intake data,List<MultipartFile> uploads) {return create(data,uploads,null);}
    // [통합 패치] 사진마다 부위(target)를 받는다. 프론트 PCB/MECHANICAL → DB 규칙 PCB/MOTOR
    public Map<String,Object> create(Inputs.Intake data,List<MultipartFile> uploads,List<String> targets) {
        access.technician();
        if(uploads==null || uploads.isEmpty() || uploads.size()>10) throw ApiError.bad("INITIAL_FILES_REQUIRED_MAX_10");
        for(var file:uploads) validation.validate(file);
        return tx.execute(status->createSaved(data,uploads,targets));
    }
    private Map<String,Object> createSaved(Inputs.Intake data,List<MultipartFile> uploads,List<String> targets) {
        access.technician();var user=access.user();
        var product=db.one("SELECT serial_number FROM product WHERE id=?",data.productId());var snapshot=catalog.product((String)product.get("serial_number"));
        if(data.purchaseDate()!=null && data.purchaseDate().isAfter(WarrantyService.today()))throw ApiError.bad("FUTURE_PURCHASE_DATE");
        Long id=db.insert("INSERT INTO repair_case(case_number,center_id,product_id,technician_id,symptom,error_codes,firmware_version,user_input,product_snapshot) VALUES (?,?,?,?,?,?::jsonb,?,?::jsonb,?::jsonb)",
            "R-"+UUID.randomUUID(),user.centerId,data.productId(),user.id,data.symptoms(),Json.write(data.errorCodes()),data.firmware(),Json.raw(data.userInput()),Json.write(snapshot));
        db.update("UPDATE repair_case SET purchase_date=?,service_type=?,product_type=? WHERE id=?",data.purchaseDate(),data.serviceType()==null?"CENTER":data.serviceType(),snapshot.get("product_type"),id);
        warranty.record(id,WarrantyService.today());
        if(uploads==null || uploads.isEmpty() || uploads.size()>10) throw ApiError.bad("INITIAL_FILES_REQUIRED_MAX_10");
        var attachments=new ArrayList<Map<String,Object>>();for(int i=0;i<uploads.size();i++) attachments.add(addFile(id,null,uploads.get(i),targets==null||i>=targets.size()?null:targets.get(i)));
        db.audit(user.email,"REPAIR_CREATED",id,data);
        if(policy.enabled()) {var result=new LinkedHashMap<String,Object>();result.put("repairId",id);result.put("taskId",null);result.put("status","RECEIVED");result.put("requiresDiagnosisRequest",true);result.put("attachments",attachments);return result;}
        var result=new LinkedHashMap<>(start(id,null));result.put("attachments",attachments);result.put("requiresDiagnosisRequest",false);return result;
    }
    @Transactional public Map<String,Object> start(Long repair) {return start(repair,null);}
    @Transactional public Map<String,Object> start(Long repair,UUID key) {return start(repair,key,null);}
    @Transactional public Map<String,Object> start(Long repair,UUID key,List<Long> requested) {
        access.technician();access.repair(repair);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",repair);
        if(key!=null) {var keyed=db.list("SELECT * FROM diagnosis_job WHERE request_key=?",key);if(!keyed.isEmpty() && !repair.equals(keyed.getFirst().get("case_id"))) throw ApiError.conflict("IDEMPOTENCY_KEY_REUSED");}
        var existing=db.list("SELECT id,status FROM diagnosis_job WHERE case_id=? ORDER BY created_at DESC",repair);
        if(!existing.isEmpty()) {
            if(requested!=null) {
                var used=db.list("SELECT attachment_id FROM diagnosis_input_attachment WHERE job_id=? AND input_revision=1",existing.getFirst().get("id")).stream().map(a->(Long)a.get("attachment_id")).toList();
                if(requested.size()!=new HashSet<>(requested).size() || !new HashSet<>(used).equals(new HashSet<>(requested))) throw ApiError.conflict("DIAGNOSIS_SELECTION_CHANGED");
            }
            return Map.of("repairId",repair,"taskId",existing.getFirst().get("id"),"status",existing.getFirst().get("status"));
        }
        var intake=db.one("SELECT intake_source,purchase_date FROM repair_case WHERE id=?",repair);
        if(intake.get("intake_source").equals("CONSUMER") && (intake.get("purchase_date")==null || requested==null))throw ApiError.conflict("CONSUMER_REVIEW_AND_SELECTION_REQUIRED");
        if(intake.get("purchase_date")!=null && WarrantyService.date(intake.get("purchase_date")).isAfter(WarrantyService.today()))throw ApiError.bad("FUTURE_PURCHASE_DATE");
        if(db.list("SELECT id FROM attachment WHERE case_id=?",repair).isEmpty()) throw ApiError.conflict("ATTACHMENTS_REQUIRED");
        var selected=quality.chooseInitial(repair,requested);
        Long task=db.insert("INSERT INTO diagnosis_job(case_id,request_key,workflow_version) VALUES (?,?,'repair-v2')",repair,key==null?UUID.randomUUID():key);
        quality.freeze(repair,task,1,selected,List.of());
        db.update("UPDATE repair_case SET technician_id=coalesce(technician_id,?) WHERE id=?",access.user().id,repair);
        db.update("UPDATE repair_case SET status='DIAGNOSING',version=version+1 WHERE id=?",repair);command(repair,task,"DIAGNOSIS_REQUESTED",null,List.of());
        db.event(repair,"DIAGNOSIS_QUEUED",Map.of("taskId",task));return Map.of("repairId",repair,"taskId",task,"status","QUEUED");
    }
    public Map<String,Object> upload(Long repair,Long request,MultipartFile file) {return upload(repair,request,file,null);}
    public Map<String,Object> upload(Long repair,Long request,MultipartFile file,String target) {
        access.technician();access.repair(repair);validation.validate(file);
        return tx.execute(status->{
            db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",repair);
            if(request==null) {
                if(!db.list("SELECT id FROM diagnosis_job WHERE case_id=?",repair).isEmpty()) throw ApiError.conflict("PHOTO_REQUEST_REQUIRED");
            } else {
                var req=db.one("SELECT p.* FROM photo_request p JOIN diagnosis_job j ON j.id=p.job_id WHERE p.id=? AND j.case_id=? AND j.status='WAITING_INPUT' FOR UPDATE OF j,p",request,repair);
                if(!req.get("status").equals("OPEN")) throw ApiError.conflict("REQUEST_ALREADY_FULFILLED");
            }
            return addFile(repair,request,file,target);
        });
    }
    static String target(String raw) {
        if(raw==null) return "GENERAL";
        return switch(raw.trim().toUpperCase()) {case "PCB"->"PCB";case "MECHANICAL","MOTOR"->"MOTOR";case "SW"->"SW";default->"GENERAL";};
    }
    Map<String,Object> addFile(Long repair,Long request,MultipartFile file) {return addFile(repair,request,file,null);}
    Map<String,Object> addFile(Long repair,Long request,MultipartFile file,String target) {
        var saved=files.save(file);String name=Optional.ofNullable(file.getOriginalFilename()).orElse("attachment");if(name.length()>255) name=name.substring(name.length()-255);
        String kind=saved.mime().startsWith("image/")?"IMAGE":saved.mime().equals("text/plain")?"LOG":"DOCUMENT";
        Long id=db.insert("INSERT INTO attachment(case_id,request_id,uploader_id,kind,target,object_key,original_name,mime_type,byte_size,sha256) VALUES (?,?,?,?,?,?,?,?,?,?)",repair,request,access.user().id,kind,target(target),saved.key(),name,saved.mime(),saved.size(),saved.hash());
        quality.uploaded(id,kind);
        db.audit(access.user().email,"ATTACHMENT_CREATED",id,Map.of("attachmentId",id));return Map.of("attachmentId",id,"mimeType",saved.mime(),"size",saved.size(),"sha256",saved.hash(),"quality",quality.get(id));
    }
    @Transactional public Map<String,Object> resume(Long repair,Inputs.Resume input) {
        access.technician();access.repair(repair);return resumeChecked(repair,input);
    }
    /** [출장] 권한 확인 뒤 재개. 고객 추가 사진은 ConsumerPipeline이 품질 통과 후 이걸로 재개한다 */
    Map<String,Object> resumeChecked(Long repair,Inputs.Resume input) {
        db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",repair);var task=db.one("SELECT * FROM diagnosis_job WHERE case_id=? ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",repair);
        var request=db.one("SELECT * FROM photo_request WHERE id=? AND job_id=? FOR UPDATE",input.requestId(),task.get("id"));
        if(request.get("status").equals("SUBMITTED")) {
            if(!input.submissionKey().equals(request.get("submission_key"))) throw ApiError.conflict("REQUEST_ALREADY_FULFILLED");
            var prior=db.one("SELECT payload FROM outbox_event WHERE job_id=? AND event_type='DIAGNOSIS_RESUMED' AND payload->'payload'->>'requestId'=?",task.get("id"),input.requestId().toString());
            var body=(Map<?,?>)prior.get("payload");var p=(Map<?,?>)body.get("payload");
            if(!new HashSet<>(((List<?>)p.get("addedAttachmentIds")).stream().map(Object::toString).toList()).equals(new HashSet<>(input.attachmentIds().stream().map(Object::toString).toList()))) throw ApiError.conflict("IDEMPOTENCY_KEY_REUSED");
            Set<String> previousExcluded=new HashSet<>(((List<?>)(p.containsKey("explicitlyExcludedAttachmentIds")?p.get("explicitlyExcludedAttachmentIds"):List.of())).stream().map(Object::toString).toList());
            if(!previousExcluded.equals(new HashSet<>(input.excludedAttachmentIds().stream().map(Object::toString).toList()))) throw ApiError.conflict("IDEMPOTENCY_KEY_REUSED");
            return Map.of("repairId",repair,"taskId",task.get("id"),"inputRevision",body.get("inputRevision"));
        }
        if(!task.get("status").equals("WAITING_INPUT") || !request.get("status").equals("OPEN")) throw ApiError.conflict("NOT_WAITING_INPUT");
        if(new HashSet<>(input.attachmentIds()).size()!=input.attachmentIds().size()) throw ApiError.bad("DUPLICATE_ATTACHMENT");
        for(Long id:input.attachmentIds()) {
            var attachment=db.one("SELECT kind FROM attachment WHERE id=? AND case_id=? AND request_id=?",id,repair,input.requestId());
            if(!attachment.get("kind").equals("IMAGE")) throw ApiError.bad("PHOTO_REQUIRED");
        }
        int previousRevision=Json.number(task.get("input_revision"));
        var prior=db.list("SELECT a.id,a.use_status FROM diagnosis_input_attachment i JOIN attachment a ON a.id=i.attachment_id WHERE i.job_id=? AND i.input_revision=? ORDER BY a.id",task.get("id"),previousRevision);
        Set<Long> previousIds=new HashSet<>(prior.stream().map(a->(Long)a.get("id")).toList());
        if(input.excludedAttachmentIds().size()!=new HashSet<>(input.excludedAttachmentIds()).size() || !previousIds.containsAll(input.excludedAttachmentIds())) throw ApiError.bad("INVALID_EXCLUDED_ATTACHMENTS");
        var selected=new ArrayList<Long>();for(var a:prior) if(a.get("use_status").equals("AVAILABLE") && !input.excludedAttachmentIds().contains(a.get("id"))) selected.add((Long)a.get("id"));
        selected.addAll(input.attachmentIds());quality.freeze(repair,(Long)task.get("id"),previousRevision+1,selected,input.attachmentIds());
        db.update("UPDATE photo_request SET status='SUBMITTED',submitted_at=now(),submission_key=? WHERE id=?",input.submissionKey(),input.requestId());
        db.update("UPDATE diagnosis_job SET status='QUEUED',input_revision=input_revision+1,execution_id=?,last_sequence=0,version=version+1,updated_at=now() WHERE id=?",UUID.randomUUID(),task.get("id"));
        db.update("UPDATE repair_case SET status='DIAGNOSING',version=version+1 WHERE id=?",repair);
        command(repair,(Long)task.get("id"),"DIAGNOSIS_RESUMED",input.requestId(),input.attachmentIds());
        db.update("UPDATE outbox_event SET payload=jsonb_set(payload,'{payload,explicitlyExcludedAttachmentIds}',?::jsonb) WHERE job_id=? AND event_type='DIAGNOSIS_RESUMED' AND payload->>'inputRevision'=?",Json.write(input.excludedAttachmentIds()),task.get("id"),String.valueOf(previousRevision+1));db.event(repair,"DIAGNOSIS_RESUMED",Map.of("taskId",task.get("id")));
        return Map.of("repairId",repair,"taskId",task.get("id"),"inputRevision",Json.number(task.get("input_revision"))+1);
    }
    // [통합 추가] 백엔드에 DIAGNOSED → REPAIRING 전이가 없어 프론트 리포트 화면(TECHNICIAN_REVIEW=REPAIRING)이 열리지 않던 문제.
    // 확인·반려 모두 기사가 수리를 시작하는 것(AI 수용 여부는 리포트 aiAcceptance에 남는다). 본사 검토 요청은 MANUAL_REVIEW, 본사 회신은 다시 REPAIRING.
    @Transactional public void approval(Long repair,Inputs.Approval input) {
        boolean manual=input.target().equals("MANUAL_REVIEW");
        if(manual) access.manager(); else access.technician();
        access.repair(repair);var row=db.one("SELECT status FROM repair_case WHERE id=? FOR UPDATE",repair);
        String from=manual?"MANUAL_REVIEW":"DIAGNOSED",to=input.action().equals("REQUEST_HQ_REVIEW")?"MANUAL_REVIEW":"REPAIRING";
        if(manual!=input.action().equals("RETURN_TO_TECHNICIAN")) throw ApiError.bad("APPROVAL_ACTION_TARGET_MISMATCH");
        if(!row.get("status").equals(from)) throw ApiError.conflict("NOT_"+from);
        db.update("UPDATE repair_case SET status=?,version=version+1 WHERE id=?",to,repair);
        var data=new LinkedHashMap<String,Object>();data.put("target",input.target());data.put("action",input.action());data.put("comment",input.comment());
        db.event(repair,"APPROVAL_"+input.action(),data);db.audit(access.user().email,"APPROVAL_"+input.action(),repair,data);
    }
    public Map<String,Object> analysisInput(Long repair,Long task) {
        var result=new LinkedHashMap<String,Object>();result.put("repair",ProductTypes.wireRepair(db.one("SELECT * FROM repair_case WHERE id=?",repair)));
        result.put("task",db.one("SELECT * FROM diagnosis_job WHERE id=? AND case_id=?",task,repair));
        var attachments=db.list("SELECT a.id,a.request_id,a.kind,a.target,a.mime_type,a.byte_size,a.sha256,i.quality_result_id,i.warning_confirmation_id,i.quality_gate FROM diagnosis_input_attachment i JOIN attachment a ON a.id=i.attachment_id JOIN diagnosis_job j ON j.id=i.job_id WHERE j.id=? AND j.case_id=? AND i.input_revision=j.input_revision ORDER BY a.created_at,a.id",task,repair);
        for(var a:attachments) a.put("downloadPath","/internal/attachments/"+a.get("id"));result.put("attachments",attachments);return result;
    }
    @Transactional public void retryProcurement(Long repair) {
        access.technician();access.repair(repair);var job=db.one("SELECT * FROM procurement_job WHERE case_id=? FOR UPDATE",repair);
        if(Boolean.TRUE.equals(job.get("done")) || (job.get("lease_until")!=null && Instant.parse(String.valueOf(job.get("lease_until"))).isAfter(Instant.now()))) throw ApiError.conflict("PROCUREMENT_NOT_RETRYABLE");
        db.update("UPDATE procurement_job SET attempts=0,next_attempt_at=now(),lease_until=NULL WHERE case_id=?",repair);
        db.update("UPDATE repair_case SET procurement_status='PENDING' WHERE id=?",repair);db.audit(access.user().email,"PROCUREMENT_RETRIED",repair,Map.of());
    }
    @Transactional public void retryFailedDiagnosis(Long taskId) {
        var original=db.list("SELECT case_id FROM diagnosis_job WHERE id=?",taskId);if(original.isEmpty())return;
        db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",original.getFirst().get("case_id"));
        var failed=db.list("SELECT * FROM diagnosis_job WHERE id=? AND status='FAILED' AND error_code IN ('AGENT_TEMPORARY_FAILURE','SERVICE_UNAVAILABLE','RESULT_EVENT_DLT') FOR UPDATE",taskId);
        if(failed.isEmpty()) return;
        var old=failed.getFirst(); Long repair=Json.id(old.get("case_id"));
        db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",repair);
        // Only retry the latest failed diagnosis, with at most three replacement jobs per case.
        var latest=db.one("SELECT id,status FROM diagnosis_job WHERE case_id=? ORDER BY created_at DESC,id DESC LIMIT 1",repair);
        if(!taskId.equals(Json.id(latest.get("id"))) || !"FAILED".equals(latest.get("status"))) return;
        long jobs=Json.number(db.one("SELECT count(*) AS n FROM diagnosis_job WHERE case_id=?",repair).get("n"));
        if(jobs>=4) return;
        if(!db.list("SELECT a.id FROM diagnosis_input_attachment i JOIN attachment a ON a.id=i.attachment_id LEFT JOIN photo_quality_result q ON q.id=i.quality_result_id WHERE i.job_id=? AND i.input_revision=? AND (a.use_status<>'AVAILABLE' OR (i.quality_gate='CHECKED' AND (a.latest_quality_result_id IS DISTINCT FROM i.quality_result_id OR q.status<>'COMPLETED' OR q.policy_version<>?)))",taskId,old.get("input_revision"),policy.effectiveVersion()).isEmpty())return;
        Long retry=db.insert("INSERT INTO diagnosis_job(case_id,request_key,workflow_version,retry_count) VALUES (?,?,?,?)",
            repair,UUID.randomUUID(),old.get("workflow_version"),Math.max(1,Json.number(old.get("retry_count"))+1));
        db.update("UPDATE repair_case SET status='DIAGNOSING',version=version+1 WHERE id=?",repair);
        db.update("INSERT INTO diagnosis_input_attachment(job_id,input_revision,attachment_id,quality_result_id,warning_confirmation_id,added,quality_gate) SELECT ?,1,attachment_id,quality_result_id,warning_confirmation_id,false,quality_gate FROM diagnosis_input_attachment WHERE job_id=? AND input_revision=?",retry,taskId,old.get("input_revision"));
        db.update("UPDATE diagnosis_job SET photo_request_count=? WHERE id=?",old.get("photo_request_count"),retry);
        command(repair,retry,"DIAGNOSIS_REQUESTED",null,List.of());
        db.event(repair,"DIAGNOSIS_RETRY_QUEUED",Map.of("taskId",retry,"retryOfTaskId",taskId,"retryCount",jobs));
        log.info("diagnosis_retry.queued repairId={} previousTaskId={} taskId={} retryCount={}",repair,taskId,retry,Json.number(old.get("retry_count"))+1);
    }
    void command(Long repair,Long task,String type,Long request,List<Long> added) {
        var t=db.one("SELECT * FROM diagnosis_job WHERE id=?",task);var payload=analysisInput(repair,task);
        payload.put("attachmentIds",((List<?>)payload.get("attachments")).stream().map(a->((Map<?,?>)a).get("id")).toList());payload.put("selectedAttachmentIds",payload.get("attachmentIds"));
        payload.put("excludedAttachmentIds",db.list("SELECT a.id FROM attachment a WHERE a.case_id=? AND NOT EXISTS(SELECT 1 FROM diagnosis_input_attachment i WHERE i.job_id=? AND i.input_revision=? AND i.attachment_id=a.id) ORDER BY a.id",repair,task,t.get("input_revision")).stream().map(a->a.get("id")).toList());
        payload.put("addedAttachmentIds",added);payload.put("requestId",request);
        payload.put("requestKey",request==null?null:db.one("SELECT request_key FROM photo_request WHERE id=?",request).get("request_key"));payload.put("round",t.get("photo_request_count"));payload.put("checkpoint",t.get("checkpoint_ref"));
        UUID event=UUID.randomUUID();var body=new LinkedHashMap<String,Object>();body.put("eventId",event);body.put("eventType",type);body.put("schemaVersion",2);body.put("occurredAt",Instant.now().toString());body.put("repairId",repair);body.put("taskId",task);body.put("correlationId",((Map<?,?>)payload.get("repair")).get("correlation_id"));body.put("inputRevision",t.get("input_revision"));body.put("executionId",t.get("execution_id"));body.put("sequence",0);body.put("payload",payload);
        db.update("INSERT INTO outbox_event(case_id,job_id,event_key,event_type,topic,payload) VALUES (?,?,?,?,?,?::jsonb)",repair,task,event,type,commands,Json.write(body));
    }
}
