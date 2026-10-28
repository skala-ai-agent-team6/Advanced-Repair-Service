package com.skala.backend.repair.consumer;

import com.skala.backend.repair.api.ApiController;
import com.skala.backend.repair.api.dto.V2Inputs;
import com.skala.backend.repair.photoquality.PhotoQualityChecker;
import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Store;
import com.skala.backend.repair.storage.LocalFiles;

import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@RestController
@RequestMapping("/public")
public class PublicConsumerController {
    final ConsumerService service;final Store db;final LocalFiles files;final PhotoQualityChecker checker;
    public PublicConsumerController(ConsumerService service,Store db,LocalFiles files,PhotoQualityChecker checker){this.service=service;this.db=db;this.files=files;this.checker=checker;}
    /** [출장] 접수 화면에서 사진을 올리자마자 품질 검사 (저장하지 않음). 접수 후 서버 검사와 같은 검사기·기준 */
    @PostMapping(value="/photos/quality-check",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String,Object> qualityCheck(@RequestPart MultipartFile file) throws java.io.IOException {
        if(file.isEmpty() || file.getSize()>10_000_000) throw ApiError.bad("PHOTO_REQUIRED");
        PhotoQualityChecker.Result r;
        try(var in=file.getInputStream()){r=checker.check(in);}
        var issues=r.issues().stream().map(i->switch(i){case "BLURRY"->"BLUR";case "TOO_DARK"->"DARK";case "TOO_BRIGHT"->"GLARE";case "LOW_RESOLUTION"->"LOW_RES";default->i;}).distinct().toList();
        return Map.of("ok",issues.isEmpty(),"status",issues.isEmpty()?"PASSED":"WARNING","issues",issues,
            "metrics",Map.of("width",r.originalWidth(),"height",r.originalHeight(),"brightness",(int)Math.round(r.meanBrightness()/255*100),"sharpness",(int)Math.min(100,Math.round(r.sharpness()))),
            "checkedAt",java.time.Instant.now().toString());
    }
    @GetMapping("/intake-options") public Map<String,Object> options(){return Map.of("centers",db.list("SELECT id,name FROM service_center ORDER BY id"),"models",db.list("SELECT model_code,name,appliance_type FROM product_model ORDER BY id"));}
    @PostMapping(value="/cases",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> create(@Valid @RequestPart("data") V2Inputs.ConsumerIntake data,@RequestPart("files") List<MultipartFile> files){return ResponseEntity.accepted().body(service.create(data,files));}
    @GetMapping("/cases/{number}") public Map<String,Object> get(@PathVariable String number,@RequestHeader(value="Authorization",required=false) String key){return service.get(number,key);}
    @PostMapping(value="/cases/{number}/attachments",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String,Object> upload(@PathVariable String number,@RequestHeader(value="Authorization",required=false) String key,@RequestPart MultipartFile file,@RequestParam(required=false) Long replaces){return service.upload(number,key,file,replaces);}
    @GetMapping("/cases/{number}/attachments/{id}") public ResponseEntity<Resource> file(@PathVariable String number,@PathVariable Long id,@RequestHeader(value="Authorization",required=false) String key){return ApiController.attachment(service.attachment(number,key,id),files);}
}
