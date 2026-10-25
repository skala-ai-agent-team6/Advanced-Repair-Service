# V2 데이터 구조

기존 핵심 테이블은 보존하고 V8에서 확장한다. 소비자 개인정보·고객 공개본·RAG 검색용 데이터를 분리한다.

```mermaid
erDiagram
    product_model ||--o{ product : model
    product_model ||--o{ warranty_policy : policies
    product ||--o{ repair_case : receptions
    service_center ||--o{ repair_case : center
    app_user ||--o{ case_assignment : assigns
    repair_case ||--o{ case_assignment : history
    repair_case ||--o| consumer_access : private_credentials
    repair_case ||--o{ warranty_assessment : snapshots
    warranty_policy o|--o{ warranty_assessment : basis
    repair_case ||--o{ attachment : originals
    attachment ||--o{ photo_quality_result : inspections
    photo_quality_result ||--o{ photo_quality_confirmation : warnings
    repair_case ||--o{ diagnosis_job : diagnosis
    diagnosis_job ||--o{ diagnosis_input_attachment : frozen_inputs
    attachment ||--o{ diagnosis_input_attachment : selected
    repair_case ||--o{ customer_report : public_versions
    repair_case ||--o| repair_report : actual_repair
    repair_report ||--o{ repair_report_revision : revisions
    repair_report_revision ||--o{ report_replaced_part : replaced
    repair_report_revision ||--o{ report_edit_proposal : proposals
    repair_report_revision ||--o| rag_case_change : confirmed_source
    rag_case_change ||--o{ rag_sync_receipt : acknowledgments
    diagnosis_job ||--o{ reprocess_attempt : operations
```

V8 신규10테이블: consumer_access, warranty_policy, warranty_assessment, case_assignment, customer_report, report_replaced_part, rag_case_change, rag_sync_receipt, report_edit_proposal, reprocess_attempt.

기존 확장: app_user.operations_enabled; repair_case.intake_source/service_type/purchase_date/assigned_technician_id 및 소비자용 nullable technician_id; attachment.uploader_id nullable; product_model.appliance_type; outbox_event.terminal_failure/last_error_code; received_event.original_disposition; agent_execution에 SURFACE 허용(과거 MOTOR/SW 보존).

고객 조회 키는 consumer_access.key_hash로 저장하며 보고서·Kafka·RAG에 넣지 않는다. 실제 교체 부품은 보고서 revision 단위이며 빈 목록을 허용한다. 고객 공개본은 별도 version이며 접수별 PUBLISHED를 최대1개로 제약한다. RAG 문서는 report/revision당1개이고 documentId는 report ID로 고정한다. 수동 재처리 이력은 original_event_id와 request_key로 연결한다.
