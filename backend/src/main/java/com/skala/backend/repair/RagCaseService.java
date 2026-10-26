package com.skala.backend.repair;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.beans.factory.annotation.Value;
import java.util.*;

@Service
public class RagCaseService {
    final Store db;final Access access;final boolean enabled;
    public RagCaseService(Store db,Access access,@Value("${app.rag-sync.enabled:false}") boolean enabled){this.db=db;this.access=access;this.enabled=enabled;}
    void lock(){db.one("SELECT pg_advisory_xact_lock(73420123)");}
    String clean(Object text,Map<String,Object> privateData){
        String s=Objects.toString(text,"");
        for(var v:privateData.values())if(v instanceof String value && !value.isBlank())s=s.replace(value,"[REDACTED]");
        return s.replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}","[EMAIL]").replaceAll("(?<![0-9])(?:\\+82[- ]?)?0?1[016789][- ]?\\d{3,4}[- ]?\\d{4}(?![0-9])","[PHONE]");
    }
    void confirmed(Long report,int revision){
        // A transaction-wide writer lock makes ID order also commit order; page high-water marks cannot skip an earlier uncommitted row.
        lock();var row=db.one("SELECT r.case_id,rr.content,rr.confirmed_at,c.symptom,c.product_type FROM repair_report r JOIN repair_report_revision rr ON rr.report_id=r.id JOIN repair_case c ON c.id=r.case_id WHERE r.id=? AND rr.revision=? AND rr.confirmed_at IS NOT NULL",report,revision);
        var contacts=db.list("SELECT contact_name,contact_phone,visit_address FROM consumer_access WHERE case_id=?",row.get("case_id"));var privateData=contacts.isEmpty()?Map.<String,Object>of():contacts.getFirst();
        var content=(Map<?,?>)row.get("content");var doc=new LinkedHashMap<String,Object>();
        doc.put("documentId","internal:report:"+report);doc.put("source","INTERNAL_CONFIRMED_REPORT");doc.put("reportId",report);doc.put("revision",revision);doc.put("confirmedAt",row.get("confirmed_at"));
        doc.put("product_type",ProductTypes.canonical(row.get("product_type")));
        doc.put("symptom",clean(row.get("symptom"),privateData));doc.put("actualCause",clean(content.get("actualCause"),privateData));doc.put("actualAction",clean(content.get("actualAction"),privateData));
        doc.put("replacedParts",db.list("SELECT p.part_id,p.quantity FROM report_replaced_part p WHERE report_id=? AND revision=? ORDER BY part_id",report,revision));
        // Mirror the legacy confirmation rule using this revision, never the latest report header.
        doc.put("outcome",content.get("outcome")!=null?content.get("outcome"):Boolean.TRUE.equals(content.get("repairSuccessful"))?"FIXED":"NOT_FIXED");
        db.update("INSERT INTO rag_case_change(report_id,revision,confirmed_at,document) VALUES (?,?,?::timestamptz,?::jsonb) ON CONFLICT(report_id,revision) DO NOTHING",report,revision,row.get("confirmed_at"),Json.write(doc));
    }
    void requireEnabled(){if(!enabled)throw new ApiError(503,"RAG_SYNC_DISABLED");}
    @Transactional public Map<String,Object> changes(long after,Long until,int size){
        requireEnabled();if(after<0 || size<1 || size>500 || until!=null && until<after)throw ApiError.bad("CURSOR");
        lock();
        // Bootstrap pre-V8 confirmed revisions as well, without changing their source reports.
        for(var r:db.list("SELECT r.report_id,r.revision FROM repair_report_revision r WHERE confirmed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rag_case_change c WHERE c.report_id=r.report_id AND c.revision=r.revision) ORDER BY confirmed_at,report_id,revision LIMIT 500"))confirmed((Long)r.get("report_id"),Json.number(r.get("revision")));
        long max=((Number)db.one("SELECT coalesce(max(id),0) AS n FROM rag_case_change").get("n")).longValue();long bound=until==null?max:until;
        if(bound>max)throw ApiError.bad("CURSOR");
        var rows=db.list("SELECT ch.*,c.product_type AS intake_product_type FROM rag_case_change ch JOIN repair_report r ON r.id=ch.report_id JOIN repair_case c ON c.id=r.case_id WHERE ch.id>? AND ch.id<=? ORDER BY ch.id LIMIT ?",after,bound,size);
        for(var item:rows){
            var doc=new LinkedHashMap<String,Object>();((Map<?,?>)item.get("document")).forEach((key,value)->doc.put(key.toString(),value));
            String type=ProductTypes.canonical(doc.containsKey("product_type")?doc.get("product_type"):item.get("intake_product_type"));
            doc.put("product_type",type);item.put("document",doc);item.put("product_type",type);item.remove("intake_product_type");
        }
        long next=rows.isEmpty()?bound:((Number)rows.getLast().get("id")).longValue();
        return Map.of("items",rows,"nextCursor",next,"until",bound,"hasMore",next<bound,"enabled",true);
    }
    @Transactional public Map<String,Object> receipt(Long change,V2Inputs.SyncReceipt input){
        requireEnabled();var c=db.one("SELECT * FROM rag_case_change WHERE id=? FOR UPDATE",change);
        if(!c.get("report_id").equals(input.reportId()) || Json.number(c.get("revision"))!=input.revision())throw ApiError.conflict("SYNC_VERSION");
        if(input.status().equals("ERROR") && input.errorCode()==null)throw ApiError.bad("ERROR_CODE_REQUIRED");
        var old=db.list("SELECT * FROM rag_sync_receipt WHERE request_key=?",input.requestKey());
        if(!old.isEmpty()){
            var p=old.getFirst();if(!p.get("change_id").equals(change) || !p.get("status").equals(input.status()) || !Objects.equals(p.get("error_code"),input.errorCode()))throw ApiError.conflict("IDEMPOTENCY_KEY_REUSED");return state(input.reportId());
        }
        db.update("INSERT INTO rag_sync_receipt(change_id,request_key,status,error_code) VALUES (?,?,?,?)",change,input.requestKey(),input.status(),input.errorCode());
        db.update("UPDATE rag_case_change SET status=?,error_code=?,attempts=attempts+1,updated_at=now(),succeeded_at=CASE WHEN ?='SUCCEEDED' THEN now() ELSE succeeded_at END WHERE id=? AND status<>'SUCCEEDED'",input.status(),input.errorCode(),input.status(),change);
        return state(input.reportId());
    }
    Map<String,Object> state(Long report){var rows=db.list("SELECT id,report_id,revision,status,succeeded_at,error_code,attempts,updated_at FROM rag_case_change WHERE report_id=? ORDER BY revision DESC LIMIT 1",report);return rows.isEmpty()?Map.of("enabled",enabled,"status","NOT_QUEUED"):rows.getFirst();}
    public Map<String,Object> authorizedState(Long report){access.report(report);return Map.of("enabled",enabled,"latest",state(report),"history",db.list("SELECT id,revision,status,succeeded_at,error_code,attempts FROM rag_case_change WHERE report_id=? ORDER BY revision DESC",report));}
}
