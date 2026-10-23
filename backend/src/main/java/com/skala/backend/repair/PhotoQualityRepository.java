package com.skala.backend.repair;

import com.skala.backend.repair.quality.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;

@Repository
public class PhotoQualityRepository {
    final Store db;final TransactionTemplate tx;final PhotoQualityProperties policy;
    public PhotoQualityRepository(Store db,PlatformTransactionManager manager,PhotoQualityProperties policy) {this.db=db;this.tx=new TransactionTemplate(manager);this.policy=policy;}
    Long enqueue(Long attachment,Long previous,int attempt) {
        Long id=db.insert("INSERT INTO photo_quality_result(attachment_id,previous_result_id,attempt,checker_version,policy_version) VALUES (?,?,?,?,?)",attachment,previous,attempt,PhotoQualityChecker.VERSION,policy.effectiveVersion());
        db.update("UPDATE attachment SET quality_required=true,latest_quality_result_id=? WHERE id=?",id,attachment);return id;
    }
    Map<String,Object> claim() {
        return tx.execute(s->{
            var rows=db.list("SELECT q.id FROM photo_quality_result q JOIN attachment a ON a.latest_quality_result_id=q.id WHERE q.status='PENDING' ORDER BY q.created_at,q.id LIMIT 1 FOR UPDATE OF q SKIP LOCKED");
            if(rows.isEmpty()) return null;
            Long id=(Long)rows.getFirst().get("id");UUID token=UUID.randomUUID();
            db.update("UPDATE photo_quality_result SET status='RUNNING',run_token=?,started_at=now(),lease_until=now()+(? * interval '1 second') WHERE id=?",token,policy.leaseSeconds(),id);
            return db.one("SELECT q.*,a.case_id,a.object_key FROM photo_quality_result q JOIN attachment a ON a.id=q.attachment_id WHERE q.id=?",id);
        });
    }
    void release(Map<String,Object> job) {db.update("UPDATE photo_quality_result SET status='PENDING',run_token=NULL,lease_until=NULL WHERE id=? AND run_token=? AND status='RUNNING'",job.get("id"),job.get("run_token"));}
    void complete(Map<String,Object> job,PhotoQualityChecker.Result result,long duration,String failure) {
        tx.executeWithoutResult(s->{
            db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",job.get("case_id"));int changed;
            if(failure==null) changed=db.update("UPDATE photo_quality_result SET status='COMPLETED',verdict=?,original_width=?,original_height=?,inspection_width=?,inspection_height=?,mean_brightness=?,dark_ratio=?,bright_ratio=?,sharpness=?,issues=?::jsonb,completed_at=now(),duration_ms=?,lease_until=NULL WHERE id=? AND run_token=? AND status='RUNNING'",
                result.issues().isEmpty()?"PASS":"WARNING",result.originalWidth(),result.originalHeight(),result.inspectionWidth(),result.inspectionHeight(),result.meanBrightness(),result.darkRatio(),result.brightRatio(),result.sharpness(),Json.write(result.issues()),duration,job.get("id"),job.get("run_token"));
            else changed=db.update("UPDATE photo_quality_result SET status='ERROR',failure_code=?,completed_at=now(),duration_ms=?,lease_until=NULL WHERE id=? AND run_token=? AND status='RUNNING'",failure,duration,job.get("id"),job.get("run_token"));
            if(changed==1 && !db.list("SELECT id FROM attachment WHERE id=? AND latest_quality_result_id=?",job.get("attachment_id"),job.get("id")).isEmpty())
                db.event((Long)job.get("case_id"),failure==null?"PHOTO_QUALITY_COMPLETED":"PHOTO_QUALITY_ERROR",Map.of("attachmentId",job.get("attachment_id"),"resultId",job.get("id"),"status",failure==null?"COMPLETED":"ERROR"));
        });
    }
    void recover() {
        // Expired workers are fenced before their slot is re-used; excessive process crashes become ERROR.
        var rows=db.list("SELECT q.*,a.case_id FROM photo_quality_result q JOIN attachment a ON a.id=q.attachment_id WHERE q.status='RUNNING' AND q.lease_until<now() ORDER BY q.id LIMIT 50");
        for(var row:rows) tx.executeWithoutResult(s->{
            db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",row.get("case_id"));
            if(Json.number(row.get("recovery_count"))>=2) {
                int changed=db.update("UPDATE photo_quality_result SET status='ERROR',failure_code='WORKER_LEASE_EXHAUSTED',completed_at=now(),run_token=NULL,lease_until=NULL WHERE id=? AND status='RUNNING' AND lease_until<now()",row.get("id"));
                if(changed==1) db.event((Long)row.get("case_id"),"PHOTO_QUALITY_ERROR",Map.of("attachmentId",row.get("attachment_id"),"resultId",row.get("id")));
            } else db.update("UPDATE photo_quality_result SET status='PENDING',run_token=NULL,lease_until=NULL,recovery_count=recovery_count+1 WHERE id=? AND status='RUNNING' AND lease_until<now()",row.get("id"));
        });
    }
}
