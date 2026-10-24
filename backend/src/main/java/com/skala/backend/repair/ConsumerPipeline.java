package com.skala.backend.repair;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.*;

/** [출장] 고객 접수 → (출장이면) 출장기사 자동 배정 → 사진 품질 통과분으로 AI 진단 자동 시작.
 *  기사 화면에는 진단 리포트가 준비된 상태로 보인다. 경고 사진은 사람이 확인해야 하므로 자동으로 쓰지 않는다
 *  (통과 사진이 하나도 없으면 진단을 시작하지 않고 기사 확인을 기다린다). app.consumer.auto-pipeline=true 일 때만 동작 */
@Component
public class ConsumerPipeline {
    static final Logger log=LoggerFactory.getLogger(ConsumerPipeline.class);
    final Store db;final RepairService repairs;final PhotoQualityService quality;final TransactionTemplate tx;final boolean enabled;
    public ConsumerPipeline(Store db,RepairService repairs,PhotoQualityService quality,PlatformTransactionManager manager,@Value("${app.consumer.auto-pipeline:false}") boolean enabled){
        this.db=db;this.repairs=repairs;this.quality=quality;this.tx=new TransactionTemplate(manager);this.enabled=enabled;}

    @Scheduled(fixedDelayString="${app.consumer.poll-ms:5000}") public void run(){
        if(!enabled) return;
        for(var c:db.list("SELECT r.id FROM repair_case r WHERE r.intake_source='CONSUMER' AND r.status='RECEIVED' AND NOT EXISTS(SELECT 1 FROM diagnosis_job j WHERE j.case_id=r.id) ORDER BY r.id LIMIT 10")){
            Long id=(Long)c.get("id");
            try {tx.executeWithoutResult(s->process(id));}
            catch(RuntimeException e){log.warn("consumer_pipeline.failed case={} reason={}",id,e.getMessage());}
        }
    }
    void process(Long id){
        var r=db.one("SELECT * FROM repair_case WHERE id=? FOR UPDATE",id);
        if(!r.get("status").equals("RECEIVED") || !db.list("SELECT id FROM diagnosis_job WHERE case_id=?",id).isEmpty()) return;
        // 사진 품질 검사가 끝나기 전에는 기다린다
        var photos=db.list("SELECT a.id,q.status,q.verdict FROM attachment a LEFT JOIN photo_quality_result q ON q.id=a.latest_quality_result_id WHERE a.case_id=? AND a.use_status='AVAILABLE' ORDER BY a.id",id);
        if(photos.isEmpty() || photos.stream().anyMatch(p->p.get("status")==null || !Set.of("COMPLETED","ERROR").contains(p.get("status")))) return;
        Long tech=(Long)r.get("assigned_technician_id");
        if(r.get("service_type").equals("FIELD") && tech==null) tech=assign(id,(Long)r.get("center_id"));
        if(tech==null) tech=(Long)r.get("technician_id");
        var passed=photos.stream().filter(p->"PASS".equals(p.get("verdict"))).map(p->(Long)p.get("id")).toList();
        if(passed.isEmpty() || tech==null){log.info("consumer_pipeline.waiting_technician case={} passed={} tech={}",id,passed.size(),tech);return;}
        Long task=db.insert("INSERT INTO diagnosis_job(case_id,request_key,workflow_version) VALUES (?,?,'repair-v2')",id,UUID.randomUUID());
        quality.freeze(id,task,1,passed,List.of());
        db.update("UPDATE repair_case SET technician_id=coalesce(technician_id,?),status='DIAGNOSING',version=version+1 WHERE id=?",tech,id);
        repairs.command(id,task,"DIAGNOSIS_REQUESTED",null,List.of());
        db.event(id,"DIAGNOSIS_QUEUED",Map.of("taskId",task,"auto",true));
        db.audit("consumer-pipeline","CONSUMER_AUTO_DIAGNOSIS",id,Map.of("taskId",task,"photos",passed.size()));
        log.info("consumer_pipeline.diagnosis_started case={} task={} photos={}",id,task,passed.size());
    }
    /** 같은 센터 출장기사 우선, 맡은 미완료 출장 건이 적은 순 */
    Long assign(Long id,Long center){
        var techs=db.list("SELECT u.id FROM app_user u WHERE u.role='TECHNICIAN' AND u.active AND u.technician_type='FIELD' ORDER BY (u.center_id IS DISTINCT FROM ?),"
            +"(SELECT count(*) FROM repair_case r WHERE r.assigned_technician_id=u.id AND r.status NOT IN ('CLOSED','CANCELLED')),u.id LIMIT 1",center);
        if(techs.isEmpty()) return null;
        Long tech=(Long)techs.getFirst().get("id");
        var by=db.list("SELECT id FROM app_user WHERE role='QUALITY_MANAGER' AND active ORDER BY id LIMIT 1");
        db.update("UPDATE repair_case SET assigned_technician_id=?,version=version+1 WHERE id=?",tech,id);
        db.update("INSERT INTO case_assignment(case_id,technician_id,assigned_by,reason) VALUES (?,?,?,?)",id,tech,by.isEmpty()?tech:by.getFirst().get("id"),"고객 출장 접수 자동 배정");
        db.audit("consumer-pipeline","CASE_ASSIGNED",id,Map.of("technicianId",tech,"auto",true));
        return tech;
    }
}
