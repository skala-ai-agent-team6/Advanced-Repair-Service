package com.skala.backend.repair.api.dto;

import jakarta.validation.constraints.*;
import jakarta.validation.Valid;
import java.util.*;

public final class Inputs {
    public record Intake(@NotNull Long productId,@NotBlank @Size(max=10000) String symptoms,
        @NotNull @Size(max=50) List<@NotBlank @Size(max=100) String> errorCodes,@NotBlank @Size(max=100) String firmware,
        @NotNull Map<String,Object> userInput,java.time.LocalDate purchaseDate,@Pattern(regexp="CENTER|FIELD") String serviceType) {
        public Intake(Long id,String symptoms,List<String> errors,String firmware,Map<String,Object> input){this(id,symptoms,errors,firmware,input,null,null);}
    }
    public record DiagnosisSelection(@NotEmpty List<@NotNull Long> attachmentIds) {}
    public record Resume(@NotNull Long requestId,@NotNull UUID submissionKey,@NotEmpty List<@NotNull Long> attachmentIds,List<@NotNull Long> excludedAttachmentIds) {
        public Resume {excludedAttachmentIds=excludedAttachmentIds==null?List.of():List.copyOf(excludedAttachmentIds);}
        public Resume(Long request,UUID key,List<Long> ids) {this(request,key,ids,List.of());}
    }
    public record PhotoSubmission(@NotNull UUID submissionKey,@NotEmpty List<@NotNull Long> attachmentIds,List<@NotNull Long> excludedAttachmentIds) {
        public PhotoSubmission(UUID key,List<Long> ids) {this(key,ids,List.of());}
    }
    public record Fault(@NotBlank @Pattern(regexp="PCB|MOTOR|SW|OTHER") String area,Long componentId,Long partId) {}
    public record ReportContent(@NotBlank @Size(max=10000) String actualCause,@NotNull @Valid List<Fault> faults,
        @NotBlank @Size(max=10000) String actualAction,@NotNull @Size(max=10000) String technicianOpinion,@NotNull Boolean repairSuccessful,
        @NotNull Acceptance aiAcceptance,Outcome outcome,@Size(max=20) @Valid List<V2Inputs.ReplacedPart> replacedParts) {
        public ReportContent {replacedParts=replacedParts==null?List.of():List.copyOf(replacedParts);}
        public ReportContent(String cause,List<Fault> faults,String action,String opinion,Boolean successful,Acceptance assessment,Outcome outcome){this(cause,faults,action,opinion,successful,assessment,outcome,List.of());}
        public ReportContent(String cause,List<Fault> faults,String action,String opinion,Boolean successful,Acceptance assessment) {this(cause,faults,action,opinion,successful,assessment,null,List.of());}
    }
    public enum Outcome { FIXED, NOT_FIXED, NO_FAULT_FOUND }
    public enum Acceptance { ACCEPTED, PARTIAL, REJECTED, NOT_AVAILABLE }
    public record Draft(@Min(0) long version,@NotNull @Valid ReportContent content) {}
    public record Confirm(@Min(0) long version,@Min(1) int revision) {}
    public record Comment(@Min(1) int revision,@NotBlank @Size(max=4000) String body,@NotNull UUID requestKey) {}
    public enum Source { WAREHOUSE, FACTORY }
    public record Item(@NotNull Long partId,@Min(1) int quantity,@NotNull Source source,Long warehouseId,Long factoryId) {}
    public record Proposal(@NotEmpty @Valid List<Item> items) {}
    // [통합 추가] 기사 진단 확인·반려·본사 검토 요청, 본사 수동 진단 회신. 프론트가 원래 쓰던 POST /repairs/{id}/approval 본문 그대로
    public record Approval(@NotBlank @Pattern(regexp="DIAGNOSIS|MANUAL_REVIEW") String target,@NotBlank @Pattern(regexp="APPROVE|REJECT|REQUEST_HQ_REVIEW|RETURN_TO_TECHNICIAN") String action,@Size(max=4000) String comment) {}
    public record Decision(@NotBlank @Size(max=2000) String reason) {}
}
