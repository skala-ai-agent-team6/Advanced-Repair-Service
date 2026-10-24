-- 출장기사 서비스: 기사 유형, 방문 일정, 출장 부품 재고 예약·이력, 보증 확정
ALTER TABLE app_user ADD COLUMN technician_type text NOT NULL DEFAULT 'CENTER' CHECK(technician_type IN ('CENTER','FIELD'));
ALTER TABLE repair_case ADD COLUMN visit_at timestamptz, ADD COLUMN visit_done_at timestamptz;
CREATE TABLE stock_reservation (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id bigint NOT NULL REFERENCES repair_case, part_id bigint NOT NULL REFERENCES part,
 warehouse_id bigint NOT NULL REFERENCES warehouse, quantity integer NOT NULL CHECK(quantity>0),
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','RELEASED','CANCELLED','EXPIRED')),
 reserved_by bigint NOT NULL REFERENCES app_user, reserved_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, closed_at timestamptz
);
CREATE TABLE stock_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 reservation_id bigint NOT NULL REFERENCES stock_reservation, part_id bigint NOT NULL REFERENCES part,
 warehouse_id bigint NOT NULL REFERENCES warehouse, case_id bigint NOT NULL REFERENCES repair_case,
 change text NOT NULL CHECK(change IN ('RESERVE','CANCEL','EXPIRE','RELEASE')),
 delta integer NOT NULL, quantity integer NOT NULL, actor_id bigint REFERENCES app_user,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE warranty_decision (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 case_id bigint NOT NULL REFERENCES repair_case, result text NOT NULL CHECK(result IN ('FREE','PAID')),
 reason varchar(1000), decided_by bigint NOT NULL REFERENCES app_user, decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_visit_schedule ON repair_case(assigned_technician_id,visit_at) WHERE service_type='FIELD';
CREATE INDEX stock_reservation_case ON stock_reservation(case_id,part_id,id DESC);
CREATE INDEX stock_reservation_due ON stock_reservation(expires_at) WHERE status='RESERVED';
CREATE INDEX stock_history_part ON stock_history(part_id,id DESC);
CREATE INDEX warranty_decision_case ON warranty_decision(case_id,id DESC);
