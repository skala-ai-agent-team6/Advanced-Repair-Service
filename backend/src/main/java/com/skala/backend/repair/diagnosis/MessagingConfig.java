package com.skala.backend.repair.diagnosis;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.kafka.annotation.*;
import org.springframework.kafka.core.*;
import org.springframework.kafka.config.TopicBuilder;
import org.apache.kafka.clients.admin.NewTopic;
import java.util.*;

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
