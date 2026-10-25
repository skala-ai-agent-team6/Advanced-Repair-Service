package com.skala.backend.repair;

import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;

@RestController
@RequestMapping("/public")
public class PublicConsumerController {
    final ConsumerService service;final Store db;final LocalFiles files;
    public PublicConsumerController(ConsumerService service,Store db,LocalFiles files){this.service=service;this.db=db;this.files=files;}
    @GetMapping("/intake-options") public Map<String,Object> options(){return Map.of("centers",db.list("SELECT id,name FROM service_center ORDER BY id"),"models",db.list("SELECT model_code,name,appliance_type FROM product_model ORDER BY id"));}
    @PostMapping(value="/cases",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> create(@Valid @RequestPart("data") V2Inputs.ConsumerIntake data,@RequestPart("files") List<MultipartFile> files){return ResponseEntity.accepted().body(service.create(data,files));}
    @GetMapping("/cases/{number}") public Map<String,Object> get(@PathVariable String number,@RequestHeader(value="Authorization",required=false) String key){return service.get(number,key);}
    @PostMapping(value="/cases/{number}/attachments",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String,Object> upload(@PathVariable String number,@RequestHeader(value="Authorization",required=false) String key,@RequestPart MultipartFile file,@RequestParam(required=false) Long replaces){return service.upload(number,key,file,replaces);}
    // [출장] 경고 사진 그대로 진행
    @PostMapping("/cases/{number}/photos/accept") public Map<String,Object> accept(@PathVariable String number,@RequestHeader(value="Authorization",required=false) String key){return service.acceptPhotos(number,key);}
    @GetMapping("/cases/{number}/attachments/{id}") public ResponseEntity<Resource> file(@PathVariable String number,@PathVariable Long id,@RequestHeader(value="Authorization",required=false) String key){return ApiController.attachment(service.attachment(number,key,id),files);}
}
