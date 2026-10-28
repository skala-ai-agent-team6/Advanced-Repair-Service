package com.skala.backend.repair.diagnosis;

import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.kafka.annotation.*;
import org.springframework.kafka.core.*;
import java.util.*;

@Configuration
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="app.scheduling.enabled",havingValue="true",matchIfMissing=true)
@EnableScheduling
class SchedulerConfig {}
