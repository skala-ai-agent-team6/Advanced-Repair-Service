package com.skala.backend.repair.diagnosis;

import com.skala.backend.repair.catalog.ProductTypes;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Builds the existing v2 wire contract and records commands in the caller's transaction. */
@Service
@Transactional(propagation = Propagation.MANDATORY)
public class DiagnosisCommands {
    private final Store db;
    private final String commands;

    public DiagnosisCommands(Store db, @Value("${app.commands-topic}") String commands) {
        this.db = db;
        this.commands = commands;
    }

    @Transactional(readOnly = true)
    public Map<String,Object> analysisInput(Long repair,Long task) {
        var result=new LinkedHashMap<String,Object>();result.put("repair",ProductTypes.wireRepair(db.one("SELECT * FROM repair_case WHERE id=?",repair)));
        result.put("task",db.one("SELECT * FROM diagnosis_job WHERE id=? AND case_id=?",task,repair));
        var attachments=db.list("SELECT a.id,a.request_id,a.kind,a.target,a.mime_type,a.byte_size,a.sha256,i.quality_result_id,i.warning_confirmation_id,i.quality_gate FROM diagnosis_input_attachment i JOIN attachment a ON a.id=i.attachment_id JOIN diagnosis_job j ON j.id=i.job_id WHERE j.id=? AND j.case_id=? AND i.input_revision=j.input_revision ORDER BY a.created_at,a.id",task,repair);
        for(var a:attachments) a.put("downloadPath","/internal/attachments/"+a.get("id"));result.put("attachments",attachments);return result;
    }
    public void command(Long repair,Long task,String type,Long request,List<Long> added) {
        var t=db.one("SELECT * FROM diagnosis_job WHERE id=?",task);var payload=analysisInput(repair,task);
        payload.put("attachmentIds",((List<?>)payload.get("attachments")).stream().map(a->((Map<?,?>)a).get("id")).toList());payload.put("selectedAttachmentIds",payload.get("attachmentIds"));
        payload.put("excludedAttachmentIds",db.list("SELECT a.id FROM attachment a WHERE a.case_id=? AND NOT EXISTS(SELECT 1 FROM diagnosis_input_attachment i WHERE i.job_id=? AND i.input_revision=? AND i.attachment_id=a.id) ORDER BY a.id",repair,task,t.get("input_revision")).stream().map(a->a.get("id")).toList());
        payload.put("addedAttachmentIds",added);payload.put("requestId",request);
        payload.put("requestKey",request==null?null:db.one("SELECT request_key FROM photo_request WHERE id=?",request).get("request_key"));payload.put("round",t.get("photo_request_count"));payload.put("checkpoint",t.get("checkpoint_ref"));
        UUID event=UUID.randomUUID();var body=new LinkedHashMap<String,Object>();body.put("eventId",event);body.put("eventType",type);body.put("schemaVersion",2);body.put("occurredAt",Instant.now().toString());body.put("repairId",repair);body.put("taskId",task);body.put("correlationId",((Map<?,?>)payload.get("repair")).get("correlation_id"));body.put("inputRevision",t.get("input_revision"));body.put("executionId",t.get("execution_id"));body.put("sequence",0);body.put("payload",payload);
        db.update("INSERT INTO outbox_event(case_id,job_id,event_key,event_type,topic,payload) VALUES (?,?,?,?,?,?::jsonb)",repair,task,event,type,commands,Json.write(body));
    }
}
