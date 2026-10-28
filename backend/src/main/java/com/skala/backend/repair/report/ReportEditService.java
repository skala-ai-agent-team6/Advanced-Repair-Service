package com.skala.backend.repair.report;

import com.skala.backend.repair.api.dto.Inputs;
import com.skala.backend.repair.api.dto.V2Inputs;
import com.skala.backend.repair.security.Access;
import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;
import com.skala.backend.repair.shared.Wire;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import java.util.*;

@Service
public class ReportEditService {
    final Store db;final Access access;final ReportService reports;
    public ReportEditService(Store db,Access access,ReportService reports){this.db=db;this.access=access;this.reports=reports;}
    static Object normalized(Object value){return Wire.ids(Json.object(Json.raw(value)));}
    @Transactional public Map<String,Object> propose(Long id,V2Inputs.Proposal input){
        var original=db.one("SELECT rr.content,r.latest_revision FROM repair_report_revision rr JOIN repair_report r ON r.id=rr.report_id WHERE rr.report_id=? AND rr.revision=? FOR UPDATE OF r",id,input.targetRevision());
        if(Json.number(original.get("latest_revision"))!=input.targetRevision())throw ApiError.conflict("STALE_EDITOR_VERSION");
        db.update("INSERT INTO report_edit_proposal(report_id,target_revision,request_key,original,proposed,author_service) VALUES (?,?,?,?::jsonb,?::jsonb,?) ON CONFLICT(request_key) DO NOTHING",id,input.targetRevision(),input.requestKey(),Json.write(original.get("content")),Json.write(input.proposed()),input.authorService());
        var p=db.one("SELECT * FROM report_edit_proposal WHERE request_key=?",input.requestKey());
        if(!p.get("report_id").equals(id) || Json.number(p.get("target_revision"))!=input.targetRevision() || !normalized(p.get("proposed")).equals(normalized(input.proposed())) || !p.get("author_service").equals(input.authorService()))throw ApiError.conflict("IDEMPOTENCY_KEY_REUSED");return p;
    }
    public List<Map<String,Object>> list(Long id){access.report(id);return db.list("SELECT * FROM report_edit_proposal WHERE report_id=? ORDER BY id",id);}
    @Transactional public Map<String,Object> decide(Long id,Long proposal,V2Inputs.Review input){
        access.technician();var report=access.report(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",report.get("case_id"));
        report=db.one("SELECT * FROM repair_report WHERE id=? FOR UPDATE",id);var p=db.one("SELECT * FROM report_edit_proposal WHERE id=? AND report_id=? FOR UPDATE",proposal,id);
        if(!p.get("state").equals("PENDING"))throw ApiError.conflict("PROPOSAL_ALREADY_DECIDED");
        Integer revision=null;
        if(input.action().equals("ACCEPT")){
            if(Json.number(report.get("latest_revision"))!=Json.number(p.get("target_revision")))throw ApiError.conflict("STALE_EDITOR_VERSION");
            var content=JsonMapper.builder().build().readValue(Json.write(p.get("proposed")),Inputs.ReportContent.class);
            var saved=reports.draft((Long)report.get("case_id"),new Inputs.Draft(((Number)report.get("version")).longValue(),content));revision=Json.number(saved.get("latest_revision"));
        }
        db.update("UPDATE report_edit_proposal SET state=?,decided_by=?,decided_at=now(),accepted_revision=? WHERE id=?",input.action().equals("ACCEPT")?"ACCEPTED":"REJECTED",access.user().id(),revision,proposal);
        db.audit(access.user().email(),"REPORT_EDIT_"+input.action(),id,Map.of("proposalId",proposal));return db.one("SELECT * FROM report_edit_proposal WHERE id=?",proposal);
    }
}
