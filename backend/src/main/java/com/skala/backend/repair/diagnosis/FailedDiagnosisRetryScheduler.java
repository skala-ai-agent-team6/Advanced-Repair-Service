package com.skala.backend.repair.diagnosis;

import com.skala.backend.repair.casework.RepairService;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.kafka.annotation.*;
import org.springframework.kafka.core.*;
import java.util.*;

@Component
class FailedDiagnosisRetryScheduler {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(FailedDiagnosisRetryScheduler.class);
    final Store db; final RepairService repairs;
    @org.springframework.beans.factory.annotation.Value("${app.diagnosis.auto-retry:false}") boolean enabled;
    FailedDiagnosisRetryScheduler(Store db,RepairService repairs) { this.db=db;this.repairs=repairs; }
    @Scheduled(fixedDelayString="${app.failed-diagnosis-retry-delay:30000}")
    public void retryFailed() {
        if(!enabled)return;
        var rows=db.list("SELECT j.id FROM diagnosis_job j WHERE j.status='FAILED' AND j.error_code IN ('AGENT_TEMPORARY_FAILURE','SERVICE_UNAVAILABLE') AND j.id=(SELECT j2.id FROM diagnosis_job j2 WHERE j2.case_id=j.case_id ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1) AND (SELECT count(*) FROM diagnosis_job all_jobs WHERE all_jobs.case_id=j.case_id)<4 ORDER BY j.finished_at LIMIT 20");
        if(!rows.isEmpty()) log.info("diagnosis_retry.candidates count={}",rows.size());
        for(var row:rows) repairs.retryFailedDiagnosis(Json.id(row.get("id")));
    }
}
