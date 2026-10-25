package com.skala.backend.repair;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class CaseWorkService {
    final Store db;final Access access;final RepairQueries queries;final WarrantyService warranty;final Catalog catalog;
    public CaseWorkService(Store db,Access access,RepairQueries queries,WarrantyService warranty,Catalog catalog){this.db=db;this.access=access;this.queries=queries;this.warranty=warranty;this.catalog=catalog;}
    @Transactional public Map<String,Object> assign(Long id,V2Inputs.Assignment input){
        access.manager();db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",id);
        var u=db.one("SELECT role,active FROM app_user WHERE id=?",input.technicianId());
        if(!u.get("role").equals("TECHNICIAN") || !Boolean.TRUE.equals(u.get("active"))) throw ApiError.bad("ACTIVE_TECHNICIAN_REQUIRED");
        db.update("UPDATE repair_case SET assigned_technician_id=?,version=version+1 WHERE id=?",input.technicianId(),id);
        db.update("INSERT INTO case_assignment(case_id,technician_id,assigned_by,reason) VALUES (?,?,?,?)",id,input.technicianId(),access.user().id,input.reason());
        db.audit(access.user().email,"CASE_ASSIGNED",id,Map.of("technicianId",input.technicianId()));return work(id);
    }
    public Map<String,Object> work(Long id){
        var response=queries.detail(id);var r=access.repair(id);
        response.put("product",catalog.product((String)db.one("SELECT serial_number FROM product WHERE id=?",r.get("product_id")).get("serial_number")));
        response.put("warranty",warranty.latest(id));response.put("assignments",db.list("SELECT * FROM case_assignment WHERE case_id=? ORDER BY id",id));
        var contacts=db.list("SELECT contact_name,contact_phone,visit_address FROM consumer_access WHERE case_id=?",id);
        response.put("visitContact",contacts.isEmpty()?Map.of():contacts.getFirst());
        var missing=new ArrayList<String>();if(r.get("service_type").equals("FIELD")){
            if(r.get("assigned_technician_id")==null)missing.add("TECHNICIAN_UNASSIGNED");
            if(contacts.isEmpty() || contacts.getFirst().get("contact_phone")==null || contacts.getFirst().get("contact_phone").toString().isBlank())missing.add("CONTACT_UNCONFIRMED");
            if(contacts.isEmpty() || contacts.getFirst().get("visit_address")==null || contacts.getFirst().get("visit_address").toString().isBlank())missing.add("ADDRESS_UNCONFIRMED");
        }
        response.put("preparation",Map.of("status",missing.isEmpty()?"AVAILABLE_INFORMATION_READY":"INCOMPLETE","missing",missing));
        var jobs=db.list("SELECT id FROM diagnosis_job WHERE case_id=? ORDER BY created_at DESC,id DESC LIMIT 1",id);
        response.put("diagnosis",jobs.isEmpty()?Map.of("status","NOT_REQUESTED"):queries.task((Long)jobs.getFirst().get("id")));
        response.put("procurement",queries.procurement(id));
        var report=db.list("SELECT id FROM repair_report WHERE case_id=?",id);
        response.put("report",report.isEmpty()?Map.of("status","NOT_WRITTEN"):report((Long)report.getFirst().get("id")));
        var parts=jobs.isEmpty()?List.<Map<String,Object>>of():db.list("SELECT d.part_id,d.quantity,EXISTS(SELECT 1 FROM model_part mp JOIN product p ON p.model_id=mp.model_id WHERE mp.part_id=d.part_id AND p.id=?) AS compatible FROM diagnosis_recommended_part d WHERE job_id=?",r.get("product_id"),jobs.getFirst().get("id"));
        for(var part:parts){var stocks=catalog.stocks((Long)part.get("part_id"));part.put("inventoryStatus",stocks.isEmpty()?"UNKNOWN":"AVAILABLE_DATA");part.put("inventory",stocks);}
        response.put("recommendedParts",parts);response.put("customerReports",db.list("SELECT * FROM customer_report WHERE case_id=? ORDER BY version DESC",id));return response;
    }
    Map<String,Object> report(Long id){var r=access.report(id);r.put("revisions",db.list("SELECT * FROM repair_report_revision WHERE report_id=? ORDER BY revision DESC",id));r.put("comments",db.list("SELECT * FROM report_comment WHERE report_id=? ORDER BY id",id));return r;}
    @Transactional public Map<String,Object> customerDraft(Long id,V2Inputs.CustomerDraft input){
        access.technician();access.repair(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",id);
        int latest=Json.number(db.one("SELECT coalesce(max(version),0) AS n FROM customer_report WHERE case_id=?",id).get("n"));
        if(latest!=input.expectedVersion())throw ApiError.conflict("CUSTOMER_REPORT_VERSION");
        if(input.kind().equals("CONFIRMED")) checkConfirmed(id,input.sourceRevision());
        Long report=db.insert("INSERT INTO customer_report(case_id,version,kind,cause_summary,planned_work,source_revision,author_id) VALUES (?,?,?,?,?,?,?)",id,latest+1,input.kind(),input.causeSummary(),input.plannedWork(),input.sourceRevision(),access.user().id);
        db.audit(access.user().email,"CUSTOMER_REPORT_DRAFT",id,Map.of("version",latest+1));return db.one("SELECT * FROM customer_report WHERE id=?",report);
    }
    void checkConfirmed(Long id,Integer revision){if(revision==null || db.list("SELECT id FROM repair_report WHERE case_id=? AND confirmed_revision=?",id,revision).isEmpty())throw ApiError.conflict("CONFIRMED_SOURCE_REQUIRED");}
    @Transactional public Map<String,Object> publish(Long id,int version){
        access.technician();access.repair(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",id);
        var r=db.one("SELECT * FROM customer_report WHERE case_id=? AND version=?",id,version);
        if(r.get("status").equals("PUBLISHED"))return r;
        if(!r.get("status").equals("DRAFT") || Json.number(db.one("SELECT max(version) AS n FROM customer_report WHERE case_id=?",id).get("n"))!=version)throw ApiError.conflict("CUSTOMER_REPORT_VERSION");
        if(r.get("kind").equals("CONFIRMED"))checkConfirmed(id,Json.number(r.get("source_revision")));
        db.update("UPDATE customer_report SET status='RETIRED' WHERE case_id=? AND status='PUBLISHED'",id);
        db.update("UPDATE customer_report SET status='PUBLISHED',published_at=now() WHERE id=?",r.get("id"));
        db.audit(access.user().email,"CUSTOMER_REPORT_PUBLISHED",id,Map.of("version",version));return db.one("SELECT * FROM customer_report WHERE id=?",r.get("id"));
    }
}
