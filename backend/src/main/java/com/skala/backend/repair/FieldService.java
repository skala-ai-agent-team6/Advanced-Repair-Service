package com.skala.backend.repair;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** 출장기사 화면(최세민 프론트) 대응: 방문 일정, 출장 부품, 재고 예약·출고·이력, 보증 확정.
 *  재고 수량은 기존 inventory.reserved/on_hand를 그대로 쓴다 (발주 승인·출고와 같은 칸). */
@Service
public class FieldService {
    static final ZoneId KST=ZoneId.of("Asia/Seoul");
    final Store db;final Access access;final WarrantyService warranty;final Catalog catalog;
    public FieldService(Store db,Access access,WarrantyService warranty,Catalog catalog){this.db=db;this.access=access;this.warranty=warranty;this.catalog=catalog;}

    // ---------- 방문 일정 ----------
    public List<Map<String,Object>> visits(LocalDate from){
        access.technician();var u=access.user();
        var rows=db.list("SELECT r.id,r.status,r.symptom,r.visit_at,r.visit_done_at,r.created_at,m.name AS model,c.contact_name,c.visit_address FROM repair_case r "
            +"JOIN product p ON p.id=r.product_id JOIN product_model m ON m.id=p.model_id LEFT JOIN consumer_access c ON c.case_id=r.id "
            +"WHERE r.service_type='FIELD' AND r.assigned_technician_id=? AND (r.visit_at IS NULL OR r.visit_at>=?) ORDER BY r.visit_at NULLS LAST,r.id",
            u.id,from==null?OffsetDateTime.of(1970,1,1,0,0,0,0,ZoneOffset.UTC):from.atStartOfDay(KST).toOffsetDateTime());
        var out=new ArrayList<Map<String,Object>>();
        for(var r:rows){
            var at=r.get("visit_at")==null?null:Instant.parse((String)r.get("visit_at")).atZone(KST);
            String[] addr=String.valueOf(Objects.requireNonNullElse(r.get("visit_address"),"")).trim().split("\\s+");
            var v=new LinkedHashMap<String,Object>();
            v.put("visitId",String.valueOf(r.get("id")));v.put("repairId",r.get("id"));v.put("technicianId",u.email);
            v.put("visitDate",at==null?"":at.toLocalDate().toString());v.put("visitTime",at==null?"":at.format(DateTimeFormatter.ofPattern("HH:mm")));
            v.put("customerName",Objects.requireNonNullElse(r.get("contact_name"),"고객"));
            v.put("district",addr.length>1?addr[1]:addr[0]);v.put("neighborhood",addr.length>2?addr[2]:"");
            v.put("model",r.get("model"));v.put("symptom",r.get("symptom"));v.put("status",r.get("status"));
            v.put("visitStatus",r.get("visit_done_at")==null?"SCHEDULED":"DONE");out.add(v);
        }
        return out;
    }
    @Transactional public Map<String,Object> schedule(Long id,OffsetDateTime at,Boolean done){
        access.repair(id);db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",id);
        if(at!=null) db.update("UPDATE repair_case SET visit_at=?,version=version+1 WHERE id=?",at,id);
        if(done!=null) db.update("UPDATE repair_case SET visit_done_at="+(done?"now()":"NULL")+",version=version+1 WHERE id=?",id);
        db.audit(access.user().email,"VISIT_SCHEDULED",id,Map.of("visitAt",String.valueOf(at),"done",String.valueOf(done)));
        return db.one("SELECT id,visit_at,visit_done_at FROM repair_case WHERE id=?",id);
    }

    // ---------- 출장 부품 · 재고 예약 ----------
    /** 24시간 지난 예약을 가용 재고로 되돌린다. 조회·변경 전에 먼저 부른다 */
    void expireDue(){
        for(var r:db.list("SELECT * FROM stock_reservation WHERE status='RESERVED' AND expires_at<now() FOR UPDATE SKIP LOCKED")){
            db.update("UPDATE inventory SET reserved=reserved-? WHERE warehouse_id=? AND part_id=?",r.get("quantity"),r.get("warehouse_id"),r.get("part_id"));
            db.update("UPDATE stock_reservation SET status='EXPIRED',closed_at=now() WHERE id=?",r.get("id"));
            history(r,"EXPIRE",Json.number(r.get("quantity")),null);
        }
    }
    void history(Map<String,Object> r,String change,int delta,Long actor){
        db.update("INSERT INTO stock_history(reservation_id,part_id,warehouse_id,case_id,change,delta,quantity,actor_id) VALUES (?,?,?,?,?,?,?,?)",
            r.get("id"),r.get("part_id"),r.get("warehouse_id"),r.get("case_id"),change,delta,r.get("quantity"),actor);
    }
    Map<String,Object> reservation(Long id){
        var r=db.one("SELECT s.*,w.name AS warehouse_name,u.name AS user_name FROM stock_reservation s JOIN warehouse w ON w.id=s.warehouse_id JOIN app_user u ON u.id=s.reserved_by WHERE s.id=?",id);
        var m=new LinkedHashMap<String,Object>();
        m.put("id",String.valueOf(r.get("id")));m.put("partId",String.valueOf(r.get("part_id")));m.put("repairId",r.get("case_id"));
        m.put("warehouse",r.get("warehouse_name"));m.put("quantity",r.get("quantity"));m.put("status",r.get("status"));
        m.put("reservedBy",r.get("user_name"));m.put("reservedAt",r.get("reserved_at"));m.put("expiresAt",r.get("expires_at"));
        if(r.get("closed_at")!=null) m.put("closedAt",r.get("closed_at"));
        return m;
    }
    @Transactional public List<Map<String,Object>> tripParts(Long id){
        access.repair(id);expireDue();
        var jobs=db.list("SELECT id FROM diagnosis_job WHERE case_id=? AND status='SUCCEEDED' ORDER BY created_at DESC,id DESC LIMIT 1",id);
        if(jobs.isEmpty()) return List.of();
        var out=new ArrayList<Map<String,Object>>();
        for(var p:db.list("SELECT d.part_id,d.quantity,pt.name,pt.part_number FROM diagnosis_recommended_part d JOIN part pt ON pt.id=d.part_id WHERE d.job_id=? ORDER BY d.id",jobs.getFirst().get("id"))){
            var m=new LinkedHashMap<String,Object>();Long part=(Long)p.get("part_id");
            m.put("partId",String.valueOf(part));m.put("partName",p.get("name"));m.put("partNo",p.get("part_number"));m.put("quantity",p.get("quantity"));
            m.put("reason","AI 진단 추천 부품 (기사 확인 필요)");
            var stocks=new ArrayList<Map<String,Object>>();
            for(var s:catalog.stocks(part)) stocks.add(Map.of("warehouse",s.get("warehouse_name"),"location",Objects.requireNonNullElse(s.get("region"),""),"available",s.get("available"),"reserved",s.get("reserved")));
            m.put("stocks",stocks);
            var last=db.list("SELECT id FROM stock_reservation WHERE case_id=? AND part_id=? ORDER BY id DESC LIMIT 1",id,part);
            if(!last.isEmpty()) m.put("reservation",reservation((Long)last.getFirst().get("id")));
            out.add(m);
        }
        return out;
    }
    @Transactional public Map<String,Object> reserve(Long part,int quantity,Long caseId){
        access.technician();access.repair(caseId);expireDue();
        if(quantity<1) throw ApiError.bad("QUANTITY");
        db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE",caseId);
        if(!db.list("SELECT id FROM stock_reservation WHERE case_id=? AND part_id=? AND status='RESERVED'",caseId,part).isEmpty()) throw ApiError.conflict("ALREADY_RESERVED");
        // 가용 재고가 가장 많은 창고에서 잡는다. 동시 예약은 행 잠금으로 막는다
        var stock=db.list("SELECT warehouse_id FROM inventory WHERE part_id=? AND on_hand-reserved>=? ORDER BY on_hand-reserved DESC,warehouse_id LIMIT 1 FOR UPDATE",part,quantity);
        if(stock.isEmpty()) throw ApiError.conflict("STOCK_CONFLICT");
        Long warehouse=(Long)stock.getFirst().get("warehouse_id");
        db.update("UPDATE inventory SET reserved=reserved+? WHERE warehouse_id=? AND part_id=?",quantity,warehouse,part);
        Long id=db.insert("INSERT INTO stock_reservation(case_id,part_id,warehouse_id,quantity,reserved_by,expires_at) VALUES (?,?,?,?,?,now()+interval '24 hours')",caseId,part,warehouse,quantity,access.user().id);
        history(db.one("SELECT * FROM stock_reservation WHERE id=?",id),"RESERVE",-quantity,access.user().id);
        db.audit(access.user().email,"STOCK_RESERVED",caseId,Map.of("partId",part,"quantity",quantity));
        return reservation(id);
    }
    /** cancel: 예약 → 가용으로 되돌림. release: 출고 (보유·예약 둘 다 차감, 가용 변화 0) */
    @Transactional public Map<String,Object> close(Long id,boolean release){
        access.technician();expireDue();
        var r=db.one("SELECT * FROM stock_reservation WHERE id=? FOR UPDATE",id);access.repair((Long)r.get("case_id"));
        if(!r.get("status").equals("RESERVED")) throw ApiError.conflict("RESERVATION_CLOSED");
        int q=Json.number(r.get("quantity"));
        db.update("UPDATE inventory SET reserved=reserved-?"+(release?",on_hand=on_hand-?":"")+" WHERE warehouse_id=? AND part_id=?",
            release?new Object[]{q,q,r.get("warehouse_id"),r.get("part_id")}:new Object[]{q,r.get("warehouse_id"),r.get("part_id")});
        db.update("UPDATE stock_reservation SET status=?,closed_at=now() WHERE id=?",release?"RELEASED":"CANCELLED",id);
        history(r,release?"RELEASE":"CANCEL",release?0:q,access.user().id);
        return reservation(id);
    }
    @Transactional public List<Map<String,Object>> stockHistory(Long part){
        access.technician();expireDue();
        var out=new ArrayList<Map<String,Object>>();
        for(var h:db.list("SELECT h.*,w.name AS warehouse_name,u.name AS actor_name FROM stock_history h JOIN warehouse w ON w.id=h.warehouse_id LEFT JOIN app_user u ON u.id=h.actor_id WHERE h.part_id=? ORDER BY h.id DESC LIMIT 50",part)){
            var m=new LinkedHashMap<String,Object>();
            m.put("id",String.valueOf(h.get("id")));m.put("partId",String.valueOf(h.get("part_id")));m.put("at",h.get("created_at"));
            m.put("change",h.get("change"));m.put("delta",h.get("delta"));m.put("quantity",h.get("quantity"));
            m.put("warehouse",h.get("warehouse_name"));m.put("actor",Objects.requireNonNullElse(h.get("actor_name"),"시스템"));m.put("repairId",h.get("case_id"));out.add(m);
        }
        return out;
    }

    // ---------- 보증 (무상/유상) ----------
    /** 기존 보증 기간 판정(warranty_assessment)을 제안으로 쓰고, 기사 확정은 warranty_decision에 남긴다 */
    @Transactional public Map<String,Object> warranty(Long id){
        access.repair(id);
        var rows=db.list("SELECT a.*,p.duration_months FROM warranty_assessment a LEFT JOIN warranty_policy p ON p.id=a.policy_id WHERE a.case_id=? ORDER BY a.id DESC LIMIT 1",id);
        var a=rows.isEmpty()?warranty.record(id,WarrantyService.today()):rows.getFirst();
        if(rows.isEmpty() && a.get("policy_id")!=null) a.put("duration_months",db.one("SELECT duration_months FROM warranty_policy WHERE id=?",a.get("policy_id")).get("duration_months"));
        String result=String.valueOf(a.get("result"));
        var reasons=new ArrayList<String>();
        reasons.add(a.get("purchase_date")==null?"구매일 정보 없음":"구매일 "+a.get("purchase_date"));
        if(a.get("expires_on_exclusive")!=null) reasons.add("보증 만료 "+a.get("expires_on_exclusive")+(result.equals("WITHIN_PERIOD")?" (기간 내)":" (기간 지남)"));
        reasons.add("보증 기간만 본 제안입니다. 고장 원인(제품 결함·사용자 과실)은 기사가 확인해 확정합니다");
        var m=new LinkedHashMap<String,Object>();
        m.put("suggestion",result.equals("WITHIN_PERIOD")?"FREE":result.equals("OUTSIDE_PERIOD")?"PAID":"UNKNOWN");
        if(a.get("purchase_date")!=null) m.put("purchaseDate",String.valueOf(a.get("purchase_date")));
        m.put("warrantyMonths",a.get("duration_months")==null?12:a.get("duration_months"));
        m.put("faultType","UNKNOWN");m.put("reasons",reasons);
        var d=db.list("SELECT w.result,w.reason,w.decided_at,u.name FROM warranty_decision w JOIN app_user u ON u.id=w.decided_by WHERE w.case_id=? ORDER BY w.id DESC LIMIT 1",id);
        if(!d.isEmpty()){var x=d.getFirst();var dec=new LinkedHashMap<String,Object>();dec.put("result",x.get("result"));if(x.get("reason")!=null)dec.put("reason",x.get("reason"));dec.put("decidedBy",x.get("name"));dec.put("decidedAt",x.get("decided_at"));m.put("decision",dec);}
        return m;
    }
    @Transactional public Map<String,Object> decide(Long id,String result,String reason){
        access.technician();access.repair(id);
        if(!Set.of("FREE","PAID").contains(result)) throw ApiError.bad("WARRANTY_RESULT");
        var suggestion=warranty(id).get("suggestion");
        if(!result.equals(suggestion) && (reason==null || reason.isBlank())) throw ApiError.bad("REASON_REQUIRED");
        db.update("INSERT INTO warranty_decision(case_id,result,reason,decided_by) VALUES (?,?,?,?)",id,result,reason,access.user().id);
        db.audit(access.user().email,"WARRANTY_DECIDED",id,Map.of("result",result));
        return warranty(id);
    }
}
