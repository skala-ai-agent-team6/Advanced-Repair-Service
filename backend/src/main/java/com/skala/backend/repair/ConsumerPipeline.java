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
 *  (통과 사진이 하나도 없으면 진단을 시작하지 않고 기사 확인을 기다린다). app.consumer.auto-pipeline=true 일 때만 동작
 *  사진 다시 찍기·추가는 접수 화면에서 끝낸다 (접수 후 조회 화면에서는 사진을 다시 요청하지 않음).
 *  AI가 추가 사진을 요청하면 고객이 올린 사진이 품질 통과한 뒤 진단을 재개한다 */
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
        for(var c:db.list("SELECT p.id,j.case_id FROM photo_request p JOIN diagnosis_job j ON j.id=p.job_id JOIN repair_case r ON r.id=j.case_id WHERE r.intake_source='CONSUMER' AND j.status='WAITING_INPUT' AND p.status='OPEN' AND EXISTS(SELECT 1 FROM attachment a WHERE a.request_id=p.id) ORDER BY p.id LIMIT 10")){
            try {tx.executeWithoutResult(s->resume((Long)c.get("case_id"),(Long)c.get("id")));}
            catch(RuntimeException e){log.warn("consumer_pipeline.resume_failed case={} reason={}",c.get("case_id"),e.getMessage());}
        }
    }
    /** 고객이 AI 요청에 올린 사진 중 품질 통과분으로 재개. 아직 검사 중이면 기다린다 */
    void resume(Long id,Long request){
        var photos=db.list("SELECT a.id,q.status,q.verdict FROM attachment a LEFT JOIN photo_quality_result q ON q.id=a.latest_quality_result_id WHERE a.request_id=? AND a.use_status='AVAILABLE' ORDER BY a.id",request);
        if(photos.stream().anyMatch(p->p.get("status")==null || !Set.of("COMPLETED","ERROR").contains(p.get("status")))) return;
        var passed=photos.stream().filter(p->"PASS".equals(p.get("verdict"))).map(p->(Long)p.get("id")).toList();
        if(passed.isEmpty()){log.info("consumer_pipeline.resume_waiting case={} request={} (통과 사진 없음)",id,request);return;}
        repairs.resumeChecked(id,new Inputs.Resume(request,UUID.randomUUID(),passed,List.of()));
        db.audit("consumer-pipeline","CONSUMER_AUTO_RESUME",id,Map.of("requestId",request,"photos",passed.size()));
        log.info("consumer_pipeline.resumed case={} request={} photos={}",id,request,passed.size());
    }
    void process(Long id){
        var r=db.one("SELECT * FROM repair_case WHERE id=? FOR UPDATE",id);
        if(!r.get("status").equals("RECEIVED") || !db.list("SELECT id FROM diagnosis_job WHERE case_id=?",id).isEmpty()) return;
        // 사진 품질 검사가 끝나기 전에는 기다린다
        var photos=db.list("SELECT a.id,q.status,q.verdict FROM attachment a LEFT JOIN photo_quality_result q ON q.id=a.latest_quality_result_id WHERE a.case_id=? AND a.use_status='AVAILABLE' ORDER BY a.id",id);
        if(photos.isEmpty() || photos.stream().anyMatch(p->p.get("status")==null || !Set.of("COMPLETED","ERROR").contains(p.get("status")))) return;
        // 경고 사진은 접수 화면에서 이미 다시 받는다 → 접수 후에는 기다리지 않고 통과 사진으로 진단
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
