package com.skala.backend.repair.warranty;

import com.skala.backend.repair.api.dto.V2Inputs;
import com.skala.backend.repair.security.Access;
import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import java.time.*;
import java.util.*;

@Service
public class WarrantyService {
    final Store db;final Access access;final boolean allowDevelopment;
    public WarrantyService(Store db,Access access,@Value("${app.warranty.allow-development:false}") boolean allowDevelopment) {this.db=db;this.access=access;this.allowDevelopment=allowDevelopment;}
    public static LocalDate today() {return LocalDate.now(ZoneId.of("Asia/Seoul"));}
    public static LocalDate date(Object value) {return value==null?null:LocalDate.parse(value.toString());}
    @Transactional public Map<String,Object> assess(Long caseId) {access.technician();access.repair(caseId);return record(caseId,today());}
    public Map<String,Object> record(Long caseId,LocalDate on) {
        var assessment=preview(caseId,on);
        Long id=db.insert("INSERT INTO warranty_assessment(case_id,purchase_date,assessed_on,policy_id,policy_version,expires_on_exclusive,result,reason) VALUES (?,?,?,?,?,?,?,?)",
            caseId,assessment.get("purchase_date"),on,assessment.get("policy_id"),assessment.get("policy_version"),assessment.get("expires_on_exclusive"),assessment.get("result"),assessment.get("reason"));
        return db.one("SELECT * FROM warranty_assessment WHERE id=?",id);
    }
    /** Calculates a current suggestion without appending assessment history. */
    public Map<String,Object> preview(Long caseId,LocalDate on) {
        var r=db.one("SELECT r.purchase_date,p.model_id FROM repair_case r JOIN product p ON p.id=r.product_id WHERE r.id=?",caseId);
        LocalDate purchase=date(r.get("purchase_date"));
        if(purchase!=null && purchase.isAfter(on)) throw ApiError.bad("FUTURE_PURCHASE_DATE");
        var policies=purchase==null?List.<Map<String,Object>>of():db.list("SELECT * FROM warranty_policy WHERE model_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) AND (NOT development_only OR ?) ORDER BY effective_from DESC,id DESC LIMIT 1",r.get("model_id"),purchase,purchase,allowDevelopment);
        var p=policies.isEmpty()?null:policies.getFirst();LocalDate expires=p==null?null:purchase.plusMonths(Json.number(p.get("duration_months")));
        String result=p==null?"UNKNOWN":on.isBefore(expires)?"WITHIN_PERIOD":"OUTSIDE_PERIOD";
        String reason=purchase==null?"PURCHASE_DATE_MISSING":p==null?"POLICY_NOT_REGISTERED":Boolean.TRUE.equals(p.get("development_only"))?"DEVELOPMENT_POLICY_NOT_FREE_REPAIR_DECISION":"PERIOD_ONLY_NOT_FREE_REPAIR_DECISION";
        var assessment=new LinkedHashMap<String,Object>();
        assessment.put("purchase_date",purchase);assessment.put("assessed_on",on);
        assessment.put("policy_id",p==null?null:p.get("id"));assessment.put("policy_version",p==null?null:p.get("version"));
        assessment.put("expires_on_exclusive",expires);assessment.put("result",result);assessment.put("reason",reason);
        return assessment;
    }
    public Map<String,Object> latest(Long id) {var rows=db.list("SELECT purchase_date,assessed_on,policy_version,expires_on_exclusive,result,reason FROM warranty_assessment WHERE case_id=? ORDER BY id DESC LIMIT 1",id);return rows.isEmpty()?Map.of("result","UNKNOWN","reason","NOT_ASSESSED"):rows.getFirst();}
    @Transactional public Map<String,Object> policy(V2Inputs.Policy p) {
        access.manager();if(p.effectiveTo()!=null && !p.effectiveTo().isAfter(p.effectiveFrom())) throw ApiError.bad("POLICY_DATES");
        db.one("SELECT id FROM product_model WHERE id=? FOR UPDATE",p.modelId());
        if(!db.list("SELECT id FROM warranty_policy WHERE model_id=? AND effective_from=?",p.modelId(),p.effectiveFrom()).isEmpty()) throw ApiError.conflict("POLICY_START_CONFLICT");
        Long id=db.insert("INSERT INTO warranty_policy(model_id,version,duration_months,effective_from,effective_to,development_only) VALUES (?,?,?,?,?,?)",p.modelId(),p.version(),p.durationMonths(),p.effectiveFrom(),p.effectiveTo(),p.developmentOnly());
        db.audit(access.user().email(),"WARRANTY_POLICY_CREATED",id,Map.of("version",p.version()));return db.one("SELECT * FROM warranty_policy WHERE id=?",id);
    }
}
