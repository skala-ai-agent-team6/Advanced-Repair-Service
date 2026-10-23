package com.skala.backend.repair;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.util.*;

/** 출장기사 화면 API. 경로는 프론트(frontend/src/api/field.ts·stock.ts·warranty.ts)에 맞춤 */
@RestController
@RequestMapping("/api")
public class FieldController {
    public record Reserve(@NotNull Long partId,@NotNull @Min(1) @Max(100) Integer quantity,@NotNull Long repairId) {}
    public record Visit(OffsetDateTime visitAt,Boolean done) {}
    public record Decision(@NotBlank String result,@Size(max=1000) String reason) {}
    final FieldService field;
    public FieldController(FieldService field){this.field=field;}
    @GetMapping("/field/visits") public List<Map<String,Object>> visits(@RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate from){return field.visits(from);}
    @PutMapping("/repairs/{id}/visit") public Map<String,Object> visit(@PathVariable Long id,@RequestBody Visit input){return field.schedule(id,input.visitAt(),input.done());}
    @GetMapping("/repairs/{id}/trip-parts") public List<Map<String,Object>> tripParts(@PathVariable Long id){return field.tripParts(id);}
    @PostMapping("/stock/reservations") public Map<String,Object> reserve(@Valid @RequestBody Reserve input){return field.reserve(input.partId(),input.quantity(),input.repairId());}
    @PostMapping("/stock/reservations/{id}/cancel") public Map<String,Object> cancel(@PathVariable Long id){return field.close(id,false);}
    @PostMapping("/stock/reservations/{id}/release") public Map<String,Object> release(@PathVariable Long id){return field.close(id,true);}
    @GetMapping("/parts/{id}/stock-history") public List<Map<String,Object>> history(@PathVariable Long id){return field.stockHistory(id);}
    @GetMapping("/repairs/{id}/warranty") public Map<String,Object> warranty(@PathVariable Long id){return field.warranty(id);}
    @PostMapping("/repairs/{id}/warranty/decision") public Map<String,Object> decide(@PathVariable Long id,@Valid @RequestBody Decision input){return field.decide(id,input.result(),input.reason());}
}
