package com.skala.backend.repair;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.kafka.annotation.*;
import org.springframework.kafka.core.*;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.retrytopic.RetryTopicConfigurationSupport;
import org.springframework.kafka.annotation.BackOff;
import org.springframework.kafka.annotation.RetryableTopic;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.util.*;
import java.util.concurrent.TimeUnit;

@Configuration
@EnableKafkaRetryTopic
class MessagingConfig {
    @Bean org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler taskScheduler() {
        var scheduler=new org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler();
        scheduler.setPoolSize(4);scheduler.setThreadNamePrefix("repair-jobs-");return scheduler;
    }
    @Bean NewTopic commandsTopic() { return TopicBuilder.name("diagnosis.commands.v2").partitions(3).replicas(1).build(); }
    @Bean NewTopic eventsTopic() { return TopicBuilder.name("diagnosis.events.v2").partitions(3).replicas(1).build(); }
    @Bean NewTopic processingStatusTopic() { return TopicBuilder.name("diagnosis.processing-status.v2").partitions(3).replicas(1).build(); }
}
@Component
class ResultConsumer {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(ResultConsumer.class);
    final DiagnosisEvents events;
    ResultConsumer(DiagnosisEvents events) { this.events=events; }
    @RetryableTopic(attempts="4",backOff=@BackOff(delay=1000,multiplier=2),exclude={ApiError.class},numPartitions="3",replicationFactor="1",retryTopicSuffix=".retry",dltTopicSuffix=".dlt")
    @KafkaListener(topics="${app.events-topic}",groupId="repair-results-v2")
    public void result(ConsumerRecord<String,String> record) {
        var e=DiagnosisEvents.parse(record.value());
        if(!e.taskId().toString().equals(record.key())) throw ApiError.bad("PARTITION_KEY");
        log.info("result_event.received eventId={} eventType={} taskId={} executionId={} sequence={}",e.eventId(),e.eventType(),e.taskId(),e.executionId(),e.sequence());
        events.retryCount(e, retries(record));
        events.receive(record.value());
        log.info("result_event.processed eventId={} eventType={} taskId={} executionId={} sequence={}",e.eventId(),e.eventType(),e.taskId(),e.executionId(),e.sequence());
    }
    static int retries(ConsumerRecord<String,String> record) {
        var header=record.headers().lastHeader("retry_topic-attempts");
        return header==null?0:Math.max(0,java.nio.ByteBuffer.wrap(header.value()).getInt()-1);
    }
    @DltHandler public void dlt(ConsumerRecord<String,String> record) {
        log.error("result_event.dead_lettered topic={} key={} offset={}",record.topic(),record.key(),record.offset());
        events.deadLetter(record.value(),Math.max(0,retries(record)-1));
    }
}
@Component
class AgentProcessingStatusConsumer {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(AgentProcessingStatusConsumer.class);
    final Store db;
    AgentProcessingStatusConsumer(Store db) { this.db=db; }
    @RetryableTopic(attempts="4",backOff=@BackOff(delay=1000,multiplier=2),exclude={ApiError.class},numPartitions="3",replicationFactor="1",retryTopicSuffix=".retry",dltTopicSuffix=".dlt")
    @KafkaListener(topics="diagnosis.processing-status.v2",groupId="repair-processing-status-v2")
    @org.springframework.transaction.annotation.Transactional
    public void status(ConsumerRecord<String,String> record) {
        var message=Json.object(record.value());
        Long task=Json.id(message.get("taskId"));
        String commandEventId=String.valueOf(message.get("commandEventId"));
        UUID.fromString(commandEventId);
        String executionId=String.valueOf(message.get("executionId"));
        UUID.fromString(executionId);
        String status=String.valueOf(message.get("status"));
        if(!Set.of("SUCCEEDED","FAILED").contains(status) || !task.toString().equals(record.key()))
            throw new IllegalArgumentException("Invalid processing status message");
        log.info("processing_status.received taskId={} commandEventId={} executionId={} status={}",task,commandEventId,executionId,status);
        int updated=db.update("UPDATE outbox_event SET agent_status=?,agent_finished_at=now() WHERE job_id=? AND event_key=? AND payload->>'executionId'=? AND topic IS NOT NULL",
            status,task,UUID.fromString(commandEventId),executionId);
        if(updated!=1) throw new IllegalStateException("Command outbox row not found for processing status");
        log.info("processing_status.applied taskId={} commandEventId={} executionId={} status={} rows={}",task,commandEventId,executionId,status,updated);
    }
}
@Component
class OutboxPublisher {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(OutboxPublisher.class);
    final Store db; final KafkaTemplate<String,String> kafka; final TransactionTemplate tx;
    OutboxPublisher(Store db,KafkaTemplate<String,String> kafka,PlatformTransactionManager manager) { this.db=db;this.kafka=kafka;this.tx=new TransactionTemplate(manager); }
    @Scheduled(fixedDelayString="${app.outbox-delay:1000}") public void publish() {
        var rows=tx.execute(s->db.list("UPDATE outbox_event SET lease_until=now()+interval '30 seconds',publish_attempts=publish_attempts+1 WHERE id IN (SELECT id FROM outbox_event WHERE topic IS NOT NULL AND published_at IS NULL AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *"));
        if(rows==null) return;
        for(var row:rows) {
            try {
                kafka.send(String.valueOf(row.get("topic")),String.valueOf(row.get("job_id")),Json.write(row.get("payload"))).get(10,TimeUnit.SECONDS);
                db.update("UPDATE outbox_event SET published_at=now(),lease_until=NULL WHERE id=?",row.get("id"));
                log.info("outbox.published outboxId={} taskId={} eventType={} attempt={}",row.get("id"),row.get("job_id"),row.get("event_type"),row.get("publish_attempts"));
            } catch(Exception e) {
                if(e instanceof InterruptedException) Thread.currentThread().interrupt();
                int delay=Math.min(300,1 << Math.min(8,Json.number(row.get("publish_attempts"))));
                db.update("UPDATE outbox_event SET lease_until=NULL,next_attempt_at=now()+(? * interval '1 second') WHERE id=?",delay,row.get("id"));
                log.warn("outbox.publish_failed outboxId={} taskId={} eventType={} attempt={} errorType={}",row.get("id"),row.get("job_id"),row.get("event_type"),row.get("publish_attempts"),e.getClass().getSimpleName());
            }
        }
    }
}

@Component
class FailedDiagnosisRetryScheduler {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(FailedDiagnosisRetryScheduler.class);
    final Store db; final RepairService repairs;
    FailedDiagnosisRetryScheduler(Store db,RepairService repairs) { this.db=db;this.repairs=repairs; }
    @Scheduled(fixedDelayString="${app.failed-diagnosis-retry-delay:30000}")
    public void retryFailed() {
        var rows=db.list("SELECT j.id FROM diagnosis_job j WHERE j.status='FAILED' AND j.id=(SELECT j2.id FROM diagnosis_job j2 WHERE j2.case_id=j.case_id ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1) AND (SELECT count(*) FROM diagnosis_job all_jobs WHERE all_jobs.case_id=j.case_id)<4 ORDER BY j.finished_at LIMIT 20");
        if(!rows.isEmpty()) log.info("diagnosis_retry.candidates count={}",rows.size());
        for(var row:rows) repairs.retryFailedDiagnosis(Json.id(row.get("id")));
    }
}

@Configuration
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="app.scheduling.enabled",havingValue="true",matchIfMissing=true)
@EnableScheduling
class SchedulerConfig {}
