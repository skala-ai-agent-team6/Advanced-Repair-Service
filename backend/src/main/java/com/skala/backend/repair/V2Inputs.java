package com.skala.backend.repair;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.*;

public final class V2Inputs {
    public record ConsumerIntake(@NotBlank @Size(max=10000) String symptoms,
        @NotNull LocalDate purchaseDate, @NotBlank @Size(max=100) String serialNumber,
        @NotBlank @Size(max=100) String modelCode, @NotNull @Positive Long centerId,
        @NotBlank @Pattern(regexp="CENTER|FIELD") String serviceType,
        @Size(max=100) String contactName,@Size(max=40) String contactPhone,@Size(max=500) String visitAddress) {}
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
