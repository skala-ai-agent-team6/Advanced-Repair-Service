package com.skala.backend.repair.consumer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** The development exception is explicit; production automation selects only PASS photos by default. */
@Component
public record ConsumerDiagnosisPolicy(boolean allowWarningPhotos) {
    public ConsumerDiagnosisPolicy(
            @Value("${app.consumer.allow-warning-photos:false}") boolean allowWarningPhotos) {
        this.allowWarningPhotos = allowWarningPhotos;
    }

    public boolean accepts(Object verdict) {
        return "PASS".equals(verdict) || allowWarningPhotos && "WARNING".equals(verdict);
    }
}
