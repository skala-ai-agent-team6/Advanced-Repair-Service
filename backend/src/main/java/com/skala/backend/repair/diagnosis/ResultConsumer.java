package com.skala.backend.repair.diagnosis;

import com.skala.backend.repair.shared.ApiError;

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
