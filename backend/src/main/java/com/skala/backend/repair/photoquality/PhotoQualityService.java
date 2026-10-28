package com.skala.backend.repair.photoquality;

import com.skala.backend.repair.consumer.ConsumerPipeline;
import com.skala.backend.repair.security.Access;
import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class PhotoQualityService {
    final Store db;final Access access;final PhotoQualityRepository repository;final PhotoQualityProperties policy;
    static final Map<String,String> MESSAGES=Map.of(
        "LOW_RESOLUTION","사진 해상도가 낮습니다. 원본 사진으로 다시 등록해 주세요.",
        "TOO_DARK","사진이 어둡습니다. 조명을 보완해 촬영해 주세요.",
        "TOO_BRIGHT","사진 일부가 너무 밝습니다. 조명이나 촬영 각도를 조정해 주세요.",
        "BLURRY","사진이 흐릴 수 있습니다. 부품에 초점을 맞춰 다시 촬영해 주세요.");
    public PhotoQualityService(Store db,Access access,PhotoQualityRepository repository,PhotoQualityProperties policy) {this.db=db;this.access=access;this.repository=repository;this.policy=policy;}
    public void uploaded(Long attachment,String kind) {if(policy.enabled() && kind.equals("IMAGE")) repository.enqueue(attachment,null,1);}
    Map<String,Object> authorized(Long id) {var a=db.one("SELECT * FROM attachment WHERE id=?",id);access.repair((Long)a.get("case_id"));return a;}
    Map<String,Object> decorate(Map<String,Object> q) {
        q=new LinkedHashMap<>(q);q.remove("run_token");q.remove("lease_until");
        List<?> codes=(List<?>)q.get("issues");q.put("guidance",codes.stream().map(code->Map.of("code",code,"message",MESSAGES.getOrDefault(code,"사진을 확인해 주세요."))).toList());
        q.put("confirmedByCurrentUser",!db.list("SELECT id FROM photo_quality_confirmation WHERE result_id=? AND confirmed_by=?",q.get("id"),access.user().id()).isEmpty());return q;
    }
    public Map<String,Object> get(Long id) {
        var a=authorized(id);var response=new LinkedHashMap<String,Object>();response.put("attachmentId",id);response.put("enabled",policy.enabled());response.put("required",a.get("quality_required"));response.put("useStatus",a.get("use_status"));response.put("replacedByAttachmentId",a.get("replaced_by_id"));
        if(a.get("latest_quality_result_id")==null) {
            response.put("status",!a.get("kind").equals("IMAGE")?"NOT_APPLICABLE":Boolean.TRUE.equals(a.get("quality_required"))?"PENDING":"LEGACY_UNCHECKED");response.put("latest",null);
        } else {var q=db.one("SELECT * FROM photo_quality_result WHERE id=?",a.get("latest_quality_result_id"));response.put("status",q.get("status"));response.put("latest",decorate(q));}
        response.put("history",db.list("SELECT * FROM photo_quality_result WHERE attachment_id=? ORDER BY attempt DESC LIMIT 100",id).stream().map(this::decorate).toList());return response;
    }
    @Transactional public Map<String,Object> acknowledge(Long id,Long result) {
        access.technician();var a=authorized(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",a.get("case_id"));a=db.one("SELECT * FROM attachment WHERE id=? FOR UPDATE",id);
        if(!Objects.equals(a.get("latest_quality_result_id"),result)) throw ApiError.conflict("QUALITY_RESULT_CHANGED");
        var q=db.one("SELECT * FROM photo_quality_result WHERE id=? AND attachment_id=?",result,id);
        if(!q.get("status").equals("COMPLETED") || !q.get("verdict").equals("WARNING")) throw ApiError.conflict("QUALITY_WARNING_REQUIRED");
        int created=db.update("INSERT INTO photo_quality_confirmation(attachment_id,result_id,confirmed_by) VALUES (?,?,?) ON CONFLICT DO NOTHING",id,result,access.user().id());
        if(created==1) db.audit(access.user().email(),"PHOTO_WARNING_CONFIRMED",id,Map.of("resultId",result));return get(id);
    }
    @Transactional public Map<String,Object> retry(Long id,Long expected) {
        access.technician();if(!policy.enabled()) throw ApiError.conflict("QUALITY_DISABLED");
        var a=authorized(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",a.get("case_id"));a=db.one("SELECT * FROM attachment WHERE id=? FOR UPDATE",id);
        if(!a.get("kind").equals("IMAGE")) throw ApiError.bad("PHOTO_REQUIRED");
        if(expected!=null) {
            db.one("SELECT id FROM photo_quality_result WHERE id=? AND attachment_id=?",expected,id);
            var duplicate=db.list("SELECT id FROM photo_quality_result WHERE previous_result_id=? AND attachment_id=?",expected,id);
            if(!duplicate.isEmpty()) {var response=get(id);response.put("requestedResultId",duplicate.getFirst().get("id"));return response;}
        }
        if(!Objects.equals(a.get("latest_quality_result_id"),expected)) throw ApiError.conflict("QUALITY_RESULT_CHANGED");
        if(expected!=null) {
            var previous=db.one("SELECT * FROM photo_quality_result WHERE id=?",expected);
            if(Set.of("PENDING","RUNNING").contains(previous.get("status"))) throw ApiError.conflict("QUALITY_ALREADY_RUNNING");
            boolean same=previous.get("checker_version").equals(PhotoQualityChecker.VERSION) && previous.get("policy_version").equals(policy.effectiveVersion());
            if(same && !previous.get("status").equals("ERROR")) throw ApiError.conflict("QUALITY_RECHECK_REQUIRES_NEW_POLICY");
        }
        int runs=Json.number(db.one("SELECT count(*)::integer AS count FROM photo_quality_result WHERE attachment_id=? AND checker_version=? AND policy_version=?",id,PhotoQualityChecker.VERSION,policy.effectiveVersion()).get("count"));
        if(runs>=policy.maxAttempts()) throw ApiError.conflict("QUALITY_RETRY_LIMIT");
        int next=Json.number(db.one("SELECT coalesce(max(attempt),0)+1 AS attempt FROM photo_quality_result WHERE attachment_id=?",id).get("attempt"));
        Long result=repository.enqueue(id,expected,next);db.audit(access.user().email(),"PHOTO_QUALITY_RETRIED",id,Map.of("resultId",result));var response=get(id);response.put("requestedResultId",result);return response;
    }
    @Transactional public Map<String,Object> selection(Long id,boolean excluded,Long replacement) {
        access.technician();var a=authorized(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",a.get("case_id"));
        if(replacement!=null) {
            if(id.equals(replacement) || !excluded) throw ApiError.bad("INVALID_REPLACEMENT");
            var other=db.one("SELECT * FROM attachment WHERE id=? AND case_id=?",replacement,a.get("case_id"));
            if(!other.get("kind").equals("IMAGE") || !a.get("kind").equals("IMAGE") || !other.get("use_status").equals("AVAILABLE") || !Objects.equals(other.get("request_id"),a.get("request_id"))) throw ApiError.bad("INVALID_REPLACEMENT");
        }
        db.update("UPDATE attachment SET use_status=?,replaced_by_id=? WHERE id=?",replacement!=null?"REPLACED":excluded?"EXCLUDED":"AVAILABLE",replacement,id);
        db.audit(access.user().email(),"PHOTO_SELECTION_CHANGED",id,Map.of("excluded",excluded));return get(id);
    }
    public List<Long> chooseInitial(Long repair,List<Long> requested) {
        if(requested==null && policy.enabled()) throw ApiError.conflict("PHOTO_SELECTION_REQUIRED");
        if(requested==null) return db.list("SELECT id FROM attachment WHERE case_id=? AND use_status='AVAILABLE' ORDER BY id",repair).stream().map(a->(Long)a.get("id")).toList();
        if(requested.isEmpty() || requested.size()!=new HashSet<>(requested).size()) throw ApiError.bad("INVALID_ATTACHMENT_SELECTION");return requested;
    }
    public void freeze(Long repair,Long job,int revision,List<Long> selected,List<Long> added) {freeze(repair,job,revision,selected,added,null);}
    /** confirmer: 로그인 사용자 없이(ConsumerPipeline) 경고 사진 확인자를 지정할 때 */
    public void freeze(Long repair,Long job,int revision,List<Long> selected,List<Long> added,Long confirmer) {
        if(selected.isEmpty() || selected.size()!=new HashSet<>(selected).size()) throw ApiError.bad("INVALID_ATTACHMENT_SELECTION");
        int images=0;
        for(Long id:selected) {
            var a=db.one("SELECT * FROM attachment WHERE id=? AND case_id=? FOR UPDATE",id,repair);
            if(!a.get("use_status").equals("AVAILABLE")) throw ApiError.conflict("ATTACHMENT_EXCLUDED");
            Long result=(Long)a.get("latest_quality_result_id"),confirmation=null;String gate="NOT_APPLICABLE";
            if(a.get("kind").equals("IMAGE")) {
                images++;gate=!policy.enabled()?"DISABLED":!Boolean.TRUE.equals(a.get("quality_required"))?"LEGACY":"CHECKED";
                if(gate.equals("CHECKED")) {
                    if(result==null) throw ApiError.conflict("PHOTO_QUALITY_PENDING");
                    var q=db.one("SELECT * FROM photo_quality_result WHERE id=?",result);
                    if(!q.get("status").equals("COMPLETED")) throw ApiError.conflict(q.get("status").equals("ERROR")?"PHOTO_QUALITY_ERROR":"PHOTO_QUALITY_PENDING");
                    if(!q.get("checker_version").equals(PhotoQualityChecker.VERSION) || !q.get("policy_version").equals(policy.effectiveVersion())) throw ApiError.conflict("PHOTO_POLICY_CHANGED");
                    if(q.get("verdict").equals("WARNING")) {
                        var ack=db.list("SELECT id FROM photo_quality_confirmation WHERE result_id=? AND confirmed_by=?",result,confirmer!=null?confirmer:access.user().id());
                        if(ack.isEmpty()) throw ApiError.conflict("PHOTO_WARNING_NOT_CONFIRMED");confirmation=(Long)ack.getFirst().get("id");
                    }
                }
            }
            db.update("INSERT INTO diagnosis_input_attachment(job_id,input_revision,attachment_id,quality_result_id,warning_confirmation_id,added,quality_gate) VALUES (?,?,?,?,?,?,?)",job,revision,id,result,confirmation,added.contains(id),gate);
        }
        if(policy.enabled() && images==0) throw ApiError.bad("PHOTO_REQUIRED");
    }
}
