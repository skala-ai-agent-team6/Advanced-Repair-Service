package com.skala.backend.repair.diagnosis;

import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.shared.Json;
import com.skala.backend.repair.shared.Store;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.kafka.annotation.*;
import org.springframework.kafka.core.*;
import org.springframework.kafka.annotation.BackOff;
import org.springframework.kafka.annotation.RetryableTopic;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import java.util.*;

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
