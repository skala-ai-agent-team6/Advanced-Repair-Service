package com.skala.backend.repair.photoquality;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

@ConfigurationProperties("app.photo-quality")
public record PhotoQualityProperties(boolean enabled,String policyVersion,int minWidth,int minHeight,
    int maxWidth,int maxHeight,long maxDecodePixels,int inspectionMaxSize,
    int darkPixelThreshold,int brightPixelThreshold,double darkRatioWarning,double brightRatioWarning,
    double sharpnessWarning,int workers,int queueCapacity,int maxAttempts,int leaseSeconds) {
    public PhotoQualityProperties {
        if(policyVersion==null || policyVersion.isBlank() || minWidth<1 || minHeight<1 || maxWidth<minWidth || maxHeight<minHeight ||
            maxDecodePixels<1 || inspectionMaxSize<3 || inspectionMaxSize>4096 || darkPixelThreshold<0 || brightPixelThreshold>255 ||
            darkPixelThreshold>=brightPixelThreshold || !Double.isFinite(darkRatioWarning) || !Double.isFinite(brightRatioWarning) || darkRatioWarning<=0 || darkRatioWarning>1 || brightRatioWarning<=0 || brightRatioWarning>1 ||
            !Double.isFinite(sharpnessWarning) || sharpnessWarning<0 || workers<1 || workers>8 || queueCapacity<1 || queueCapacity>100 || maxAttempts<1 || leaseSeconds<10)
            throw new IllegalArgumentException("Invalid photo quality configuration");
    }
    public String effectiveVersion() {
        String policy=minWidth+":"+minHeight+":"+maxWidth+":"+maxHeight+":"+maxDecodePixels+":"+inspectionMaxSize+":"+darkPixelThreshold+":"+brightPixelThreshold+":"+darkRatioWarning+":"+brightRatioWarning+":"+sharpnessWarning;
        try {return policyVersion+"-"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(policy.getBytes(StandardCharsets.UTF_8))).substring(0,12);}
        catch(java.security.NoSuchAlgorithmException impossible) {throw new IllegalStateException(impossible);}
    }
}
@Configuration
@EnableConfigurationProperties(PhotoQualityProperties.class)
class PhotoQualityConfiguration {}
