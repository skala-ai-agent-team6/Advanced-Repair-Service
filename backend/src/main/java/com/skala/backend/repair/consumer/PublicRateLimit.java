package com.skala.backend.repair.consumer;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.core.Ordered;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.*;

/** Local bounded protection. Distributed ingress limits are a deployment responsibility. */
@Component @Order(Ordered.HIGHEST_PRECEDENCE+10)
public class PublicRateLimit extends OncePerRequestFilter {
    final int perMinute;final Map<String,Bucket> buckets=new HashMap<>();
    record Bucket(long minute,int count) {}
    public PublicRateLimit(@Value("${app.consumer.requests-per-minute:30}") int perMinute){if(perMinute<1)throw new IllegalArgumentException("public rate limit");this.perMinute=perMinute;}
    public synchronized boolean allow(String address,long minute){
        buckets.entrySet().removeIf(e->e.getValue().minute()!=minute);
        String key=ConsumerService.hash(address);var old=buckets.get(key);
        if(old==null && buckets.size()>=10000)return false;
        int count=old==null?0:old.count();if(count>=perMinute)return false;
        buckets.put(key,new Bucket(minute,count+1));return true;
    }
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)throws ServletException,IOException{
        if(req.getRequestURI().substring(req.getContextPath().length()).startsWith("/public/") && !allow(req.getRemoteAddr(),System.currentTimeMillis()/60000)){
            res.setStatus(429);res.setHeader("Retry-After","60");res.setContentType("application/json");res.getWriter().write("{\"code\":\"PUBLIC_RATE_LIMIT\",\"status\":429}");return;
        }
        chain.doFilter(req,res);
    }
}
