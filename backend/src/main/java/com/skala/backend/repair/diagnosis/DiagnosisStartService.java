package com.skala.backend.repair.diagnosis;

import com.skala.backend.repair.photoquality.PhotoQualityService;
import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Store;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Shared initial-job mutation. Entry services own authorization and photo-selection policy. */
@Service
public class DiagnosisStartService {
    private final Store db;
    private final PhotoQualityService quality;
    private final DiagnosisCommands commands;

    public DiagnosisStartService(Store db, PhotoQualityService quality, DiagnosisCommands commands) {
        this.db = db;
        this.quality = quality;
        this.commands = commands;
    }

    public record Started(Long repairId, Long taskId, String status) {
        public Map<String,Object> response() {
            return Map.of("repairId", repairId, "taskId", taskId, "status", status);
        }
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Started start(Long repair, UUID key, List<Long> selected, Long technician, boolean automatic) {
        db.one("SELECT id FROM repair_case WHERE id=? FOR UPDATE", repair);
        if (!db.list("SELECT id FROM diagnosis_job WHERE case_id=?", repair).isEmpty()) {
            throw ApiError.conflict("DIAGNOSIS_ALREADY_STARTED");
        }
        Long task = db.insert("INSERT INTO diagnosis_job(case_id,request_key,workflow_version) VALUES (?,?,'repair-v2')",
                repair, key == null ? UUID.randomUUID() : key);
        quality.freeze(repair, task, 1, selected, List.of(), technician);
        db.update("UPDATE repair_case SET technician_id=coalesce(technician_id,?),status='DIAGNOSING',version=version+1 WHERE id=?",
                technician, repair);
        commands.command(repair, task, "DIAGNOSIS_REQUESTED", null, List.of());
        db.event(repair, "DIAGNOSIS_QUEUED", automatic
                ? Map.of("taskId", task, "auto", true) : Map.of("taskId", task));
        return new Started(repair, task, "QUEUED");
    }
}
