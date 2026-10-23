ALTER TABLE outbox_event
 ADD COLUMN agent_status text CHECK(agent_status IN ('SUCCEEDED','FAILED')),
 ADD COLUMN agent_finished_at timestamptz;

CREATE INDEX outbox_agent_status ON outbox_event(job_id,agent_status)
 WHERE topic IS NOT NULL;
