package com.skala.backend.repair.photoquality;

import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.storage.LocalFiles;

import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import java.nio.file.Files;

@Component
public class PhotoQualityWorker {
    final PhotoQualityProperties policy;final PhotoQualityRepository repository;final PhotoQualityExecutor executor;final PhotoQualityChecker checker;final LocalFiles files;
    public PhotoQualityWorker(PhotoQualityProperties policy,PhotoQualityRepository repository,PhotoQualityExecutor executor,PhotoQualityChecker checker,LocalFiles files) {this.policy=policy;this.repository=repository;this.executor=executor;this.checker=checker;this.files=files;}
    @Scheduled(fixedDelayString="${app.photo-quality.poll-ms:500}") public void runOnce() {
        if(!policy.enabled()) return;
        repository.recover();
        for(int i=0,slots=executor.freeSlots();i<slots;i++) {
            var job=repository.claim();if(job==null) break;
            if(!executor.execute(()->{
                long start=System.nanoTime();PhotoQualityChecker.Result result=null;String error=null;
                try {
                    if(TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Image computation inside transaction");
                    if(!PhotoQualityChecker.VERSION.equals(job.get("checker_version")) || !policy.effectiveVersion().equals(job.get("policy_version"))) error="POLICY_CHANGED";
                    else try(var in=Files.newInputStream(files.path((String)job.get("object_key")))) {result=checker.check(in);}
                } catch(Exception e) {error=e instanceof ApiError?"IMAGE_DECODE_FAILED":"INSPECTION_ERROR";}
                repository.complete(job,result,Math.max(0,(System.nanoTime()-start)/1_000_000),error);
            })) {repository.release(job);break;}
        }
    }
}
