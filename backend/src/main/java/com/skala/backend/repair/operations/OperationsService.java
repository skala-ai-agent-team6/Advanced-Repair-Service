package com.skala.backend.repair.operations;

import com.skala.backend.repair.api.dto.V2Inputs;
import com.skala.backend.repair.diagnosis.DiagnosisEvents;
import com.skala.backend.repair.security.Access;
import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.util.*;

@Service
public class OperationsService {
    final Store db;final Access access;final DiagnosisEvents events;final TransactionTemplate tx;final int maxManual;
    public OperationsService(Store db,Access access,DiagnosisEvents events,PlatformTransactionManager manager,@Value("${app.operations.max-manual-attempts:3}") int maxManual){this.db=db;this.access=access;this.events=events;this.tx=new TransactionTemplate(manager);if(maxManual<1 || maxManual>10)throw new IllegalArgumentException("manual retry limit");this.maxManual=maxManual;}
    public Map<String,Object> list(int size){access.operator();if(size<1 || size>100)throw ApiError.bad("PAGE");return Map.of("maxManualAttempts",maxManual,
        "tasks",db.list("SELECT id,case_id,status,execution_id,input_revision,error_code,error_message,retry_count,finished_at,'RESULT' AS failure_stage,4 AS max_delivery_attempts FROM diagnosis_job WHERE status='FAILED' ORDER BY finished_at DESC LIMIT ?",size),
        "outbox",db.list("SELECT id,event_key,job_id,event_type,publish_attempts,next_attempt_at,published_at,terminal_failure,last_error_code,agent_status,'OUTBOX' AS failure_stage,CASE WHEN terminal_failure THEN 'TERMINAL_FAILURE' WHEN published_at IS NOT NULL THEN 'PUBLISHED' ELSE 'PENDING' END AS status FROM outbox_event WHERE topic IS NOT NULL ORDER BY id DESC LIMIT ?",size),
        "events",db.list("SELECT event_id,job_id,disposition,received_at FROM received_event WHERE disposition='DLT' ORDER BY received_at DESC LIMIT ?",size));}
    public List<Map<String,Object>> history(UUID event){access.operator();return db.list("SELECT * FROM reprocess_attempt WHERE original_event_id=? ORDER BY id",event);}
    public Map<String,Object> retry(UUID event,String stage,V2Inputs.Reprocess request){
        access.operator();Long actor=access.user().id();
        var created=tx.execute(s->{
            // Serialize retries of a given original event, including concurrent request keys.
            db.one("SELECT pg_advisory_xact_lock(hashtextextended(?,0))",event.toString());
            var old=db.list("SELECT * FROM reprocess_attempt WHERE request_key=?",request.requestKey());
            if(!old.isEmpty()){var a=old.getFirst();if(!a.get("original_event_id").equals(event) || !a.get("stage").equals(stage))throw ApiError.conflict("IDEMPOTENCY_KEY_REUSED");return a;}
            if(!db.list("SELECT id FROM reprocess_attempt WHERE original_event_id=? AND state='QUEUED'",event).isEmpty())throw ApiError.conflict("REPROCESS_IN_PROGRESS");
            if(Json.number(db.one("SELECT count(*) AS n FROM reprocess_attempt WHERE original_event_id=?",event).get("n"))>=maxManual)throw ApiError.conflict("REPROCESS_LIMIT");
            Long job;
            if(stage.equals("RESULT")){
                var r=db.one("SELECT e.* FROM received_event e WHERE event_id=? AND disposition='DLT'",event);job=(Long)r.get("job_id");var t=db.one("SELECT * FROM diagnosis_job WHERE id=? FOR UPDATE",job);var parsed=DiagnosisEvents.parse(Json.write(r.get("body")));
                if(!t.get("status").equals("FAILED") || !Objects.equals(t.get("error_code"),"RESULT_EVENT_DLT") || !t.get("execution_id").equals(parsed.executionId()) || Json.number(t.get("input_revision"))!=parsed.inputRevision() || !job.equals(db.one("SELECT id FROM diagnosis_job WHERE case_id=? ORDER BY created_at DESC,id DESC LIMIT 1",t.get("case_id")).get("id")))throw ApiError.conflict("REPROCESS_STALE_STATE");
            }else{
                var o=db.one("SELECT * FROM outbox_event WHERE event_key=? AND topic IS NOT NULL FOR UPDATE",event);job=(Long)o.get("job_id");
                if(!Boolean.TRUE.equals(o.get("terminal_failure")))throw ApiError.conflict("OUTBOX_NOT_TERMINAL");
                var t=db.one("SELECT * FROM diagnosis_job WHERE id=? FOR UPDATE",job);
                var payload=(Map<?,?>)o.get("payload");
                if(!Set.of("QUEUED","RUNNING","WAITING_INPUT").contains(t.get("status")) || !t.get("execution_id").toString().equals(payload.get("executionId").toString()) || Json.number(t.get("input_revision"))!=Json.number(payload.get("inputRevision")))throw ApiError.conflict("REPROCESS_STALE_STATE");
            }
            Long id=db.insert("INSERT INTO reprocess_attempt(original_event_id,job_id,stage,request_key,requested_by,state) VALUES (?,?,?,?,?,'QUEUED')",event,job,stage,request.requestKey(),actor);
            return db.one("SELECT * FROM reprocess_attempt WHERE id=?",id);
        });
        if(!created.get("state").equals("QUEUED"))return created;
        try{
            tx.executeWithoutResult(s->{
                var attempt=db.one("SELECT * FROM reprocess_attempt WHERE id=? FOR UPDATE",created.get("id"));if(!attempt.get("state").equals("QUEUED"))return;
                if(stage.equals("RESULT"))events.reprocess(event);
                else db.update("UPDATE outbox_event SET terminal_failure=false,last_error_code=NULL,publish_attempts=0,next_attempt_at=now(),lease_until=NULL WHERE event_key=?",event);
                db.update("UPDATE reprocess_attempt SET state='SUCCEEDED',completed_at=now() WHERE id=?",created.get("id"));
                db.audit(access.user().email(),"OPERATION_REPROCESS",(Long)created.get("job_id"),Map.of("eventId",event,"stage",stage));
            });
        }catch(RuntimeException failure){
            tx.executeWithoutResult(s->db.update("UPDATE reprocess_attempt SET state='ERROR',error_code=?,completed_at=now() WHERE id=?",failure instanceof ApiError a?a.code():"REPROCESS_ERROR",created.get("id")));
        }
        return db.one("SELECT * FROM reprocess_attempt WHERE id=?",created.get("id"));
    }
}
