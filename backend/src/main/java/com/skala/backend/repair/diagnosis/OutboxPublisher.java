package com.skala.backend.repair.diagnosis;

import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.kafka.annotation.*;
import org.springframework.kafka.core.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Component
public class OutboxPublisher {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(OutboxPublisher.class);
    final Store db; final KafkaTemplate<String,String> kafka; final TransactionTemplate tx;
    private final int maxAttempts;
    public OutboxPublisher(Store db,KafkaTemplate<String,String> kafka,PlatformTransactionManager manager,
            @org.springframework.beans.factory.annotation.Value("${app.outbox.max-attempts:8}") int maxAttempts) {
        this.db=db;this.kafka=kafka;this.tx=new TransactionTemplate(manager);
        if(maxAttempts<1) throw new IllegalArgumentException("outbox max attempts must be positive");
        this.maxAttempts=maxAttempts;
    }
    @Scheduled(fixedDelayString="${app.outbox-delay:1000}") public void publish() {
        db.update("UPDATE outbox_event SET terminal_failure=true,last_error_code='PUBLISH_ATTEMPTS_EXHAUSTED' WHERE topic IS NOT NULL AND published_at IS NULL AND publish_attempts>=? AND NOT terminal_failure AND (lease_until IS NULL OR lease_until<now())",maxAttempts);
        // Claim immediately before each send so queued rows do not lose their lease while waiting.
        for(int sent=0;sent<10;sent++) if(!publishNext()) break;
    }
    private boolean publishNext() {
        var rows=tx.execute(s->db.list("UPDATE outbox_event SET lease_until=now()+interval '30 seconds',publish_attempts=publish_attempts+1 WHERE id IN (SELECT id FROM outbox_event WHERE topic IS NOT NULL AND NOT terminal_failure AND publish_attempts<? AND published_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *",maxAttempts));
        if(rows==null || rows.isEmpty()) return false;
        for(var row:rows) {
            try {
                kafka.send(String.valueOf(row.get("topic")),String.valueOf(row.get("job_id")),Json.write(row.get("payload"))).get(10,TimeUnit.SECONDS);
                int changed=db.update("UPDATE outbox_event SET published_at=now(),lease_until=NULL WHERE id=? AND publish_attempts=? AND lease_until=?::timestamptz AND published_at IS NULL",row.get("id"),row.get("publish_attempts"),row.get("lease_until"));
                if(changed!=1) return true; // A recovered attempt owns this row now.
                log.info("outbox.published outboxId={} taskId={} eventType={} attempt={}",row.get("id"),row.get("job_id"),row.get("event_type"),row.get("publish_attempts"));
            } catch(Exception e) {
                if(e instanceof InterruptedException) Thread.currentThread().interrupt();
                int delay=Math.min(300,1 << Math.min(8,Json.number(row.get("publish_attempts"))));
                db.update("UPDATE outbox_event SET lease_until=NULL,next_attempt_at=now()+(? * interval '1 second'),last_error_code='KAFKA_PUBLISH_FAILED',terminal_failure=(publish_attempts>=?) WHERE id=? AND publish_attempts=? AND lease_until=?::timestamptz AND published_at IS NULL",delay,maxAttempts,row.get("id"),row.get("publish_attempts"),row.get("lease_until"));
                log.warn("outbox.publish_failed outboxId={} taskId={} eventType={} attempt={} errorType={}",row.get("id"),row.get("job_id"),row.get("event_type"),row.get("publish_attempts"),e.getClass().getSimpleName());
            }
        }
        return true;
    }
}
