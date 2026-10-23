package com.skala.backend.repair;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.security.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

@Service
public class ConsumerService {
    final Store db;final Catalog catalog;final LocalFiles files;final PhotoQualityExecutor validation;final PhotoQualityService quality;final WarrantyService warranty;final TransactionTemplate tx;final int keyDays;
    final SecureRandom random=new SecureRandom();
    public ConsumerService(Store db,Catalog catalog,LocalFiles files,PhotoQualityExecutor validation,PhotoQualityService quality,WarrantyService warranty,PlatformTransactionManager manager,@Value("${app.consumer.key-days:90}") int keyDays) {this.db=db;this.catalog=catalog;this.files=files;this.validation=validation;this.quality=quality;this.warranty=warranty;this.tx=new TransactionTemplate(manager);if(keyDays<1 || keyDays>365) throw new IllegalArgumentException("consumer key days");this.keyDays=keyDays;}
    static String hash(String key) {try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8)));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    void validatePhotos(List<MultipartFile> uploads) {
        if(uploads==null || uploads.isEmpty() || uploads.size()>10) throw ApiError.bad("PHOTOS_REQUIRED_MAX_10");
        long bytes=0;for(var f:uploads){bytes+=f.getSize();if(bytes>50L*1024*1024) throw ApiError.bad("REQUEST_SIZE");validation.validate(f);if(!Set.of("image/png","image/jpeg").contains(f.getContentType())) throw ApiError.bad("PHOTO_REQUIRED");}
    }
    public Map<String,Object> create(V2Inputs.ConsumerIntake input,List<MultipartFile> uploads) {
        if(input.purchaseDate()!=null && input.purchaseDate().isAfter(WarrantyService.today())) throw ApiError.bad("INVALID_PURCHASE_DATE");
        validatePhotos(uploads);
        byte[] secret=new byte[32];random.nextBytes(secret);String key=Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        return tx.execute(status->{
            db.one("SELECT id FROM service_center WHERE id=?",input.centerId());
            var model=db.one("SELECT id FROM product_model WHERE model_code=?",input.modelCode());
            // Product identity is verified against the model; never mutate another product's identity.
            var existing=db.list("SELECT id,model_id FROM product WHERE serial_number=?",input.serialNumber());Long product;
            if(existing.isEmpty()) product=db.insert("INSERT INTO product(serial_number,model_id) VALUES (?,?)",input.serialNumber(),model.get("id"));
            else {var p=existing.getFirst();if(!p.get("model_id").equals(model.get("id"))) throw ApiError.bad("PRODUCT_IDENTITY_MISMATCH");product=(Long)p.get("id");}
            String number="C-"+UUID.randomUUID();
            Long id=db.insert("INSERT INTO repair_case(case_number,product_id,center_id,technician_id,symptom,purchase_date,intake_source,service_type) VALUES (?,?,?,NULL,?,?,'CONSUMER',?)",number,product,input.centerId(),input.symptoms(),input.purchaseDate(),input.serviceType());
            var snapshot=catalog.product(input.serialNumber());
            db.update("UPDATE repair_case SET product_snapshot=?::jsonb,product_type=? WHERE id=?",Json.write(snapshot),snapshot.get("product_type"),id);
            Instant expires=Instant.now().plus(Duration.ofDays(keyDays));
            db.update("INSERT INTO consumer_access(case_id,key_hash,expires_at,contact_name,contact_phone,visit_address) VALUES (?,?,?,?,?,?)",id,hash(key),expires.atOffset(ZoneOffset.UTC),input.contactName(),input.contactPhone(),input.visitAddress());
            var ids=new ArrayList<Long>();for(var f:uploads) ids.add(save(id,f));warranty.record(id,WarrantyService.today());
            db.audit("consumer","CONSUMER_INTAKE_CREATED",id,Map.of("photoCount",ids.size()));
            return Map.of("caseNumber",number,"lookupKey",key,"expiresAt",expires.toString(),"status","RECEIVED","attachmentIds",ids,"requiresTechnicianReview",true);
        });
    }
    Long authorized(String number,String authorization) {
        String key=authorization!=null && authorization.startsWith("Bearer ")?authorization.substring(7):"";
        if(key.length()!=43 || number.length()>100) throw ApiError.missing();
        var rows=db.list("SELECT r.id FROM repair_case r JOIN consumer_access c ON c.case_id=r.id WHERE r.case_number=? AND c.key_hash=? AND c.expires_at>now()",number,hash(key));
        if(rows.isEmpty()) throw ApiError.missing();return (Long)rows.getFirst().get("id");
    }
    Long save(Long caseId,MultipartFile upload) {
        var saved=files.save(upload);
        // Public filenames are not persisted: a client may put personal data in a filename.
        Long id=db.insert("INSERT INTO attachment(case_id,kind,target,object_key,original_name,mime_type,byte_size,sha256) VALUES (?,'IMAGE','GENERAL',?,'consumer-photo',?,?,?)",caseId,saved.key(),saved.mime(),saved.size(),saved.hash());
        quality.uploaded(id,"IMAGE");return id;
    }
    public Map<String,Object> upload(String number,String authorization,MultipartFile file) {
        Long id=authorized(number,authorization);validatePhotos(List.of(file));
        return tx.execute(s->{db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",id);if(!db.list("SELECT id FROM diagnosis_job WHERE case_id=?",id).isEmpty()) throw ApiError.conflict("TECHNICIAN_PHOTO_REQUEST_REQUIRED");
            if(Json.number(db.one("SELECT count(*) AS n FROM attachment WHERE case_id=?",id).get("n"))>=20) throw ApiError.conflict("PHOTO_LIMIT");
            return Map.of("attachmentId",save(id,file),"status","STORED");});
    }
    public Map<String,Object> get(String number,String authorization) {
        Long id=authorized(number,authorization);var r=db.one("SELECT status FROM repair_case WHERE id=?",id);
        String state=switch((String)r.get("status")){case "CLOSED"->"COMPLETED";case "CANCELLED"->"CANCELLED";case "RECEIVED"->"RECEIVED";case "REPAIRING"->"REPAIRING";default->"UNDER_REVIEW";};
        var published=db.list("SELECT version,kind,cause_summary,planned_work,published_at FROM customer_report WHERE case_id=? AND status='PUBLISHED'",id);
        var response=new LinkedHashMap<String,Object>();response.put("caseNumber",number);response.put("status",state);response.put("warranty",warranty.latest(id));response.put("report",published.isEmpty()?null:published.getFirst());
        // [출장] 고객 진행 조회 화면용: 제품명·접수일·담당 기사·방문 일정·기사가 확정한 무상/유상 (개인정보·AI 초안은 넣지 않음)
        var info=db.one("SELECT r.created_at,r.visit_at,m.name AS product_name,u.name AS technician_name FROM repair_case r JOIN product p ON p.id=r.product_id JOIN product_model m ON m.id=p.model_id LEFT JOIN app_user u ON u.id=coalesce(r.assigned_technician_id,r.technician_id) WHERE r.id=?",id);
        response.put("productName",info.get("product_name"));response.put("receivedAt",info.get("created_at"));response.put("technicianName",info.get("technician_name"));response.put("visitAt",info.get("visit_at"));
        var decision=db.list("SELECT result FROM warranty_decision WHERE case_id=? ORDER BY id DESC LIMIT 1",id);response.put("warrantyDecision",decision.isEmpty()?null:decision.getFirst().get("result"));
        response.put("photos",db.list("SELECT a.id,coalesce(q.status,CASE WHEN a.quality_required THEN 'PENDING' ELSE 'LEGACY_UNCHECKED' END) AS status,q.verdict,q.issues FROM attachment a LEFT JOIN photo_quality_result q ON q.id=a.latest_quality_result_id WHERE a.case_id=? ORDER BY a.id",id));
        return response;
    }
    public Map<String,Object> attachment(String number,String authorization,Long attachment) {Long id=authorized(number,authorization);var rows=db.list("SELECT * FROM attachment WHERE id=? AND case_id=?",attachment,id);if(rows.isEmpty()) throw ApiError.missing();return rows.getFirst();}
}
