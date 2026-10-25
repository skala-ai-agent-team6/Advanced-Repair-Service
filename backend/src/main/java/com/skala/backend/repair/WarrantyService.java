package com.skala.backend.repair;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import java.time.*;
import java.util.*;

@Service
public class WarrantyService {
    final Store db;final Access access;final boolean allowDevelopment;
    public WarrantyService(Store db,Access access,@Value("${app.warranty.allow-development:false}") boolean allowDevelopment) {this.db=db;this.access=access;this.allowDevelopment=allowDevelopment;}
    static LocalDate today() {return LocalDate.now(ZoneId.of("Asia/Seoul"));}
    static LocalDate date(Object value) {return value==null?null:LocalDate.parse(value.toString());}
    @Transactional public Map<String,Object> assess(Long caseId) {access.technician();access.repair(caseId);return record(caseId,today());}
    Map<String,Object> record(Long caseId,LocalDate on) {
        var r=db.one("SELECT r.purchase_date,p.model_id FROM repair_case r JOIN product p ON p.id=r.product_id WHERE r.id=?",caseId);
        LocalDate purchase=date(r.get("purchase_date"));
        if(purchase!=null && purchase.isAfter(on)) throw ApiError.bad("FUTURE_PURCHASE_DATE");
        var policies=purchase==null?List.<Map<String,Object>>of():db.list("SELECT * FROM warranty_policy WHERE model_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) AND (NOT development_only OR ?) ORDER BY effective_from DESC,id DESC LIMIT 1",r.get("model_id"),purchase,purchase,allowDevelopment);
        var p=policies.isEmpty()?null:policies.getFirst();LocalDate expires=p==null?null:purchase.plusMonths(Json.number(p.get("duration_months")));
        String result=p==null?"UNKNOWN":on.isBefore(expires)?"WITHIN_PERIOD":"OUTSIDE_PERIOD";
        String reason=purchase==null?"PURCHASE_DATE_MISSING":p==null?"POLICY_NOT_REGISTERED":Boolean.TRUE.equals(p.get("development_only"))?"DEVELOPMENT_POLICY_NOT_FREE_REPAIR_DECISION":"PERIOD_ONLY_NOT_FREE_REPAIR_DECISION";
        Long id=db.insert("INSERT INTO warranty_assessment(case_id,purchase_date,assessed_on,policy_id,policy_version,expires_on_exclusive,result,reason) VALUES (?,?,?,?,?,?,?,?)",caseId,purchase,on,p==null?null:p.get("id"),p==null?null:p.get("version"),expires,result,reason);
        return db.one("SELECT * FROM warranty_assessment WHERE id=?",id);
    }
    public Map<String,Object> latest(Long id) {var rows=db.list("SELECT purchase_date,assessed_on,policy_version,expires_on_exclusive,result,reason FROM warranty_assessment WHERE case_id=? ORDER BY id DESC LIMIT 1",id);return rows.isEmpty()?Map.of("result","UNKNOWN","reason","NOT_ASSESSED"):rows.getFirst();}
    @Transactional public Map<String,Object> policy(V2Inputs.Policy p) {
        access.manager();if(p.effectiveTo()!=null && !p.effectiveTo().isAfter(p.effectiveFrom())) throw ApiError.bad("POLICY_DATES");
        db.one("SELECT id FROM product_model WHERE id=? FOR UPDATE",p.modelId());
        if(!db.list("SELECT id FROM warranty_policy WHERE model_id=? AND effective_from=?",p.modelId(),p.effectiveFrom()).isEmpty()) throw ApiError.conflict("POLICY_START_CONFLICT");
        Long id=db.insert("INSERT INTO warranty_policy(model_id,version,duration_months,effective_from,effective_to,development_only) VALUES (?,?,?,?,?,?)",p.modelId(),p.version(),p.durationMonths(),p.effectiveFrom(),p.effectiveTo(),p.developmentOnly());
        db.audit(access.user().email,"WARRANTY_POLICY_CREATED",id,Map.of("version",p.version()));return db.one("SELECT * FROM warranty_policy WHERE id=?",id);
    }
}
