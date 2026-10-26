ALTER TABLE app_user ADD COLUMN operations_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE repair_case ALTER COLUMN technician_id DROP NOT NULL;
ALTER TABLE repair_case ADD COLUMN intake_source text NOT NULL DEFAULT 'STAFF' CHECK(intake_source IN ('STAFF','CONSUMER')),
 ADD COLUMN service_type text NOT NULL DEFAULT 'CENTER' CHECK(service_type IN ('CENTER','FIELD')),
 ADD COLUMN purchase_date date, ADD COLUMN assigned_technician_id bigint REFERENCES app_user;
ALTER TABLE product_model ADD COLUMN appliance_type text NOT NULL DEFAULT 'VACUUM_CLEANER';
CREATE TABLE consumer_access (
 case_id bigint PRIMARY KEY REFERENCES repair_case ON DELETE CASCADE,
 key_hash char(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 contact_name varchar(100), contact_phone varchar(40), visit_address varchar(500), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warranty_policy (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, model_id bigint NOT NULL REFERENCES product_model,
 version varchar(100) NOT NULL, duration_months integer NOT NULL CHECK(duration_months BETWEEN 1 AND 600),
 effective_from date NOT NULL, effective_to date, development_only boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(model_id,version), CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE TABLE warranty_assessment (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, case_id bigint NOT NULL REFERENCES repair_case ON DELETE CASCADE,
 purchase_date date, assessed_on date NOT NULL, policy_id bigint REFERENCES warranty_policy,
 policy_version text, expires_on_exclusive date, result text NOT NULL CHECK(result IN ('WITHIN_PERIOD','OUTSIDE_PERIOD','UNKNOWN')),
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE case_assignment (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, case_id bigint NOT NULL REFERENCES repair_case ON DELETE CASCADE,
 technician_id bigint NOT NULL REFERENCES app_user, assigned_by bigint NOT NULL REFERENCES app_user,
 reason varchar(1000) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE customer_report (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, case_id bigint NOT NULL REFERENCES repair_case ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0), status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RETIRED')),
 kind text NOT NULL CHECK(kind IN ('ESTIMATE','CONFIRMED')), cause_summary varchar(4000) NOT NULL,
 planned_work varchar(4000) NOT NULL, source_revision integer, author_id bigint NOT NULL REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, UNIQUE(case_id,version)
);
CREATE UNIQUE INDEX one_customer_publication ON customer_report(case_id) WHERE status='PUBLISHED';
CREATE TABLE report_replaced_part (
 report_id bigint NOT NULL, revision integer NOT NULL, part_id bigint NOT NULL REFERENCES part,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100), PRIMARY KEY(report_id,revision,part_id),
 FOREIGN KEY(report_id,revision) REFERENCES repair_report_revision ON DELETE CASCADE
);
CREATE TABLE rag_case_change (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, report_id bigint NOT NULL, revision integer NOT NULL,
 confirmed_at timestamptz NOT NULL, document jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCEEDED','ERROR')),
 succeeded_at timestamptz, error_code varchar(100), attempts integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(report_id,revision),
 FOREIGN KEY(report_id,revision) REFERENCES repair_report_revision ON DELETE CASCADE
);
CREATE TABLE rag_sync_receipt (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, change_id bigint NOT NULL REFERENCES rag_case_change ON DELETE CASCADE,
 request_key uuid NOT NULL UNIQUE, status text NOT NULL CHECK(status IN ('SUCCEEDED','ERROR')),
 error_code varchar(100), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE report_edit_proposal (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, report_id bigint NOT NULL, target_revision integer NOT NULL,
 request_key uuid NOT NULL UNIQUE, original jsonb NOT NULL, proposed jsonb NOT NULL, author_service text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ACCEPTED','REJECTED')),
 decided_by bigint REFERENCES app_user, decided_at timestamptz, accepted_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(report_id,target_revision) REFERENCES repair_report_revision ON DELETE CASCADE
);
CREATE TABLE reprocess_attempt (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, original_event_id uuid NOT NULL, job_id bigint REFERENCES diagnosis_job ON DELETE CASCADE,
 stage text NOT NULL CHECK(stage IN ('RESULT','OUTBOX')), request_key uuid NOT NULL UNIQUE,
 requested_by bigint NOT NULL REFERENCES app_user, state text NOT NULL CHECK(state IN ('SUCCEEDED','ERROR','QUEUED')),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
ALTER TABLE outbox_event ADD COLUMN terminal_failure boolean NOT NULL DEFAULT false, ADD COLUMN last_error_code text;
CREATE INDEX warranty_case_latest ON warranty_assessment(case_id,id DESC);
CREATE INDEX field_assignment ON repair_case(assigned_technician_id) WHERE service_type='FIELD';
-- New visual surface tool; historical MOTOR/SW values remain readable.
ALTER TABLE agent_execution DROP CONSTRAINT agent_execution_agent_type_check;
ALTER TABLE agent_execution ADD CONSTRAINT agent_execution_agent_type_check CHECK(agent_type IN ('PCB','SURFACE','MOTOR','SW','RAG','BUSINESS'));
ALTER TABLE attachment ALTER COLUMN uploader_id DROP NOT NULL;
ALTER TABLE received_event ADD COLUMN original_disposition text;
UPDATE received_event SET original_disposition=disposition;
