package com.skala.backend.repair.api;

import com.skala.backend.repair.operations.OperationsService;
import com.skala.backend.repair.api.dto.V2Inputs;
import com.skala.backend.repair.casework.CaseWorkService;
import com.skala.backend.repair.report.RagCaseService;
import com.skala.backend.repair.report.ReportEditService;
import com.skala.backend.repair.security.Access;
import com.skala.backend.repair.shared.Store;
import com.skala.backend.repair.warranty.WarrantyService;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api")
public class V2Controller {
    final CaseWorkService work;final WarrantyService warranty;final ReportEditService editor;final RagCaseService rag;final OperationsService operations;final Store db;final Access access;
    public V2Controller(CaseWorkService work,WarrantyService warranty,ReportEditService editor,RagCaseService rag,OperationsService operations,Store db,Access access){this.work=work;this.warranty=warranty;this.editor=editor;this.rag=rag;this.operations=operations;this.db=db;this.access=access;}
    @GetMapping("/repairs/{id}/work-report") public Map<String,Object> work(@PathVariable Long id){return work.work(id);}
    @PostMapping("/repairs/{id}/assignment") public Map<String,Object> assign(@PathVariable Long id,@Valid @RequestBody V2Inputs.Assignment input){return work.assign(id,input);}
    @PostMapping("/warranty-policies") public Map<String,Object> policy(@Valid @RequestBody V2Inputs.Policy input){return warranty.policy(input);}
    @GetMapping("/warranty-policies") public List<Map<String,Object>> policies(){access.manager();return db.list("SELECT * FROM warranty_policy ORDER BY model_id,effective_from");}
    @PostMapping("/repairs/{id}/warranty-assessments") public Map<String,Object> assess(@PathVariable Long id){return warranty.assess(id);}
    @PostMapping("/repairs/{id}/customer-report") public Map<String,Object> draft(@PathVariable Long id,@Valid @RequestBody V2Inputs.CustomerDraft input){return work.customerDraft(id,input);}
    @PostMapping("/repairs/{id}/customer-report/publish") public Map<String,Object> publish(@PathVariable Long id,@Valid @RequestBody V2Inputs.Publish input){return work.publish(id,input.version());}
    @GetMapping("/reports/{id}/rag-sync") public Map<String,Object> sync(@PathVariable Long id){return rag.authorizedState(id);}
    @GetMapping("/reports/{id}/edit-proposals") public List<Map<String,Object>> proposals(@PathVariable Long id){return editor.list(id);}
    @PostMapping("/reports/{id}/edit-proposals/{proposalId}/decision") public Map<String,Object> decide(@PathVariable Long id,@PathVariable Long proposalId,@Valid @RequestBody V2Inputs.Review input){return editor.decide(id,proposalId,input);}
    @GetMapping("/operations/reprocessing") public Map<String,Object> operations(@RequestParam(defaultValue="50") int size){return operations.list(size);}
    @GetMapping("/operations/events/{eventId}/attempts") public List<Map<String,Object>> attempts(@PathVariable UUID eventId){return operations.history(eventId);}
    @PostMapping("/operations/events/{eventId}/retry") public Map<String,Object> retry(@PathVariable UUID eventId,@Valid @RequestBody V2Inputs.Reprocess input){return operations.retry(eventId,"RESULT",input);}
    @PostMapping("/operations/outbox/{eventId}/retry") public Map<String,Object> outbox(@PathVariable UUID eventId,@Valid @RequestBody V2Inputs.Reprocess input){return operations.retry(eventId,"OUTBOX",input);}
}
