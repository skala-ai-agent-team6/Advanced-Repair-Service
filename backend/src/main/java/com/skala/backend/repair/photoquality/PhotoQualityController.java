package com.skala.backend.repair.photoquality;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/attachments/{id}")
public class PhotoQualityController {
    final PhotoQualityService quality;
    public PhotoQualityController(PhotoQualityService quality) {this.quality=quality;}
    public record ResultRequest(@NotNull Long resultId) {}
    public record RetryRequest(Long resultId) {}
    public record Selection(@NotNull Boolean excluded,Long replacedByAttachmentId) {}
    @GetMapping("/quality") public Map<String,Object> get(@PathVariable Long id) {return quality.get(id);}
    @PostMapping("/quality/acknowledgment") public Map<String,Object> acknowledge(@PathVariable Long id,@Valid @RequestBody ResultRequest input) {return quality.acknowledge(id,input.resultId());}
    @PostMapping("/quality/retry") public Map<String,Object> retry(@PathVariable Long id,@Valid @RequestBody RetryRequest input) {return quality.retry(id,input.resultId());}
    @PutMapping("/selection") public Map<String,Object> selection(@PathVariable Long id,@Valid @RequestBody Selection input) {return quality.selection(id,input.excluded(),input.replacedByAttachmentId());}
}
