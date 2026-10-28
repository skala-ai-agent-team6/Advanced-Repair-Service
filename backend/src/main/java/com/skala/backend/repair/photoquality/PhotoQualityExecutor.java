package com.skala.backend.repair.photoquality;

import com.skala.backend.repair.shared.ApiError;
import com.skala.backend.repair.storage.LocalFiles;

import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import jakarta.annotation.PreDestroy;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class PhotoQualityExecutor {
    final ThreadPoolExecutor pool;final PhotoQualityChecker checker;
    public PhotoQualityExecutor(PhotoQualityProperties properties,PhotoQualityChecker checker) {
        this.checker=checker;var n=new AtomicInteger();
        pool=new ThreadPoolExecutor(properties.workers(),properties.workers(),0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(properties.queueCapacity()),r->{var t=new Thread(r,"photo-quality-"+n.incrementAndGet());t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    }
    public void validate(MultipartFile file) {
        if(TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Image decoding cannot run in a DB transaction");
        if(file.isEmpty() || file.getSize()>10485760) throw ApiError.bad("FILE_SIZE");
        try {
            byte[] bytes=file.getBytes();String mime=LocalFiles.detect(bytes);
            if(!mime.startsWith("image/")) return;
            Future<?> future;
            try {future=pool.submit(()->{try(var in=new ByteArrayInputStream(bytes)){checker.validate(in);}catch(IOException e){throw ApiError.bad("IMAGE_DECODE_FAILED");}});}
            catch(RejectedExecutionException full) {throw new ApiError(429,"PHOTO_VALIDATION_BUSY");}
            try {future.get(30,TimeUnit.SECONDS);}
            catch(ExecutionException e) {if(e.getCause() instanceof ApiError error) throw error;throw new ApiError(503,"PHOTO_VALIDATION_ERROR");}
            catch(TimeoutException e) {future.cancel(true);throw new ApiError(503,"PHOTO_VALIDATION_TIMEOUT");}
            catch(InterruptedException e) {Thread.currentThread().interrupt();future.cancel(true);throw new ApiError(503,"PHOTO_VALIDATION_INTERRUPTED");}
        } catch(IOException e) {throw new ApiError(500,"FILE_READ_ERROR");}
    }
    boolean execute(Runnable work) {try {pool.execute(work);return true;}catch(RejectedExecutionException full){return false;}}
    int freeSlots() {return pool.getQueue().remainingCapacity()+Math.max(0,pool.getMaximumPoolSize()-pool.getActiveCount());}
    @PreDestroy void close() {pool.shutdownNow();}
}
