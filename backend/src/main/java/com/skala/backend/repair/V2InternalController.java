package com.skala.backend.repair;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/internal")
public class V2InternalController {
    final RagCaseService rag;final ReportEditService editor;
    public V2InternalController(RagCaseService rag,ReportEditService editor){this.rag=rag;this.editor=editor;}
    @GetMapping("/rag/confirmed-changes") public Map<String,Object> changes(@RequestParam(defaultValue="0") long after,@RequestParam(required=false) Long until,@RequestParam(defaultValue="100") int size){return rag.changes(after,until,size);}
    @PostMapping("/rag/confirmed-changes/{id}/receipt") public Map<String,Object> receipt(@PathVariable Long id,@Valid @RequestBody V2Inputs.SyncReceipt input){return rag.receipt(id,input);}
    @PostMapping("/reports/{id}/edit-proposals") public Map<String,Object> proposal(@PathVariable Long id,@Valid @RequestBody V2Inputs.Proposal input){return editor.propose(id,input);}
}
