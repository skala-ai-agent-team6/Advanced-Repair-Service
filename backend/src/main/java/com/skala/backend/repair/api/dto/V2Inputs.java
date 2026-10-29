package com.skala.backend.repair.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.*;

public final class V2Inputs {
    public record ConsumerIntake(@NotBlank @Size(max=10000) String symptoms,
        LocalDate purchaseDate, @NotBlank @Size(max=100) String serialNumber,  // [출장] 구매일 모르면 비움 → 보증 UNKNOWN
        @NotBlank @Size(max=100) String modelCode, @NotNull @Positive Long centerId,
        @NotBlank @Pattern(regexp="CENTER|FIELD") String serviceType,
        @Size(max=100) String contactName,@Size(max=40) String contactPhone,@Size(max=500) String visitAddress,
        LocalDate preferredDate,@Pattern(regexp="AM|PM") String visitSlot) {  // [출장] 고객 희망 방문일·시간대 → 방문 일정 초안
        public ConsumerIntake(String symptoms,LocalDate purchaseDate,String serialNumber,String modelCode,Long centerId,String serviceType,String contactName,String contactPhone,String visitAddress) {
            this(symptoms,purchaseDate,serialNumber,modelCode,centerId,serviceType,contactName,contactPhone,visitAddress,null,null);}
    }
    public record Assignment(@NotNull @Positive Long technicianId,@NotBlank @Size(max=1000) String reason) {}
    public record Policy(@NotNull @Positive Long modelId,@NotBlank @Size(max=100) String version,
        @Min(1) @Max(600) int durationMonths,@NotNull LocalDate effectiveFrom,LocalDate effectiveTo,boolean developmentOnly) {}
    public record CustomerDraft(@Min(0) int expectedVersion,@NotBlank @Pattern(regexp="ESTIMATE|CONFIRMED") String kind,
        @NotBlank @Size(max=4000) String causeSummary,@NotBlank @Size(max=4000) String plannedWork,Integer sourceRevision) {}
    public record Publish(@Min(1) int version) {}
    public record ReplacedPart(@NotNull @Positive Long partId,@Min(1) @Max(100) int quantity) {}
    public record SyncReceipt(@NotNull UUID requestKey,@NotNull @Positive Long reportId,@Min(1) int revision,
        @NotBlank @Pattern(regexp="SUCCEEDED|ERROR") String status,@Pattern(regexp="[A-Z0-9_]{1,100}") String errorCode) {}
    public record Proposal(@NotNull UUID requestKey,@Min(1) int targetRevision,
        @NotBlank @Size(max=100) String authorService,@NotNull @Valid Inputs.ReportContent proposed) {}
    public record Review(@NotBlank @Pattern(regexp="ACCEPT|REJECT") String action) {}
    public record Reprocess(@NotNull UUID requestKey) {}
}
