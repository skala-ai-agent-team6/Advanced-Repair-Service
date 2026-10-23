package com.skala.backend.repair;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.client.RestClient;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.*;

public interface BusinessMcp {
    // Normalized tool result: stocks [{partId,warehouseId,onHand,reserved,available}], factories [{partId,factoryId,region,contact}].
    Map<String,Object> lookup(List<Long> partIds);
    /** [출장] 업무 MCP get_repair_preparation_report: 방문 준비 리포트(원인·증상 요약, 공구·부품, 재고, 고장 위치). 없으면 UNAVAILABLE */
    default Map<String,Object> preparation(Long repairId) {return Map.of("report_status","UNAVAILABLE");}
}
@Component
@Profile("(!dev & !test) | realmcp") // [통합] dev에서도 realmcp 프로필을 붙이면 실제 업무 MCP(게이트웨이 경유)를 쓴다
class HttpBusinessMcp implements BusinessMcp {
    final RestClient client;
    HttpBusinessMcp(@Value("${app.mcp-url}") String url,@Value("${app.mcp-token}") String token) {
        var factory=new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        client=RestClient.builder().baseUrl(url).requestFactory(factory).defaultHeader("Authorization","Bearer "+token).build();
    }
    @Override public Map<String,Object> preparation(Long repairId) {
        var response=client.post().body(Map.of("jsonrpc","2.0","id",UUID.randomUUID().toString(),"method","tools/call","params",Map.of("name","preparation.report","arguments",Map.of("repairId",repairId))))
            .retrieve().body(String.class);
        var rpc=Json.object(response);
        if(rpc.containsKey("error") || !(rpc.get("result") instanceof Map<?,?> result) || !(result.get("structuredContent") instanceof Map<?,?> data)) throw new IllegalStateException("MCP_TOOL_FAILED");
        @SuppressWarnings("unchecked") var out=(Map<String,Object>)data;return out;
    }
    @Override public Map<String,Object> lookup(List<Long> ids) {
        // Team contract: stateless JSON-RPC tools/call HTTP endpoint (JSON response, no LLM).
        var response=client.post().body(Map.of("jsonrpc","2.0","id",UUID.randomUUID().toString(),"method","tools/call","params",Map.of("name","inventory.lookup","arguments",Map.of("partIds",ids.stream().map(Object::toString).toList()))))
            .retrieve().body(String.class);
        var rpc=Json.object(response);
        if(rpc.containsKey("error") || !(rpc.get("result") instanceof Map<?,?> result) || Boolean.TRUE.equals(result.get("isError"))) throw new IllegalStateException("MCP_TOOL_FAILED");
        Object data=result.get("structuredContent");
        if(!(data instanceof Map<?,?>)) throw new IllegalStateException("MCP_CONTRACT_ERROR");
        @SuppressWarnings("unchecked") var normalized=(Map<String,Object>)data;
        Json.objects(normalized.get("stocks"));Json.objects(normalized.get("factories")); return normalized;
    }
}
@Component
@Profile("(dev | test) & !realmcp") // [통합] realmcp일 때는 가짜를 끈다
class MockBusinessMcp implements BusinessMcp {
    final Store db;
    MockBusinessMcp(Store db) {this.db=db;}
    @Override public Map<String,Object> lookup(List<Long> ids) {
        var stocks=new ArrayList<Map<String,Object>>();var factories=new ArrayList<Map<String,Object>>();
        for(Long id:ids) {
            stocks.addAll(db.list("SELECT part_id AS \"partId\",warehouse_id AS \"warehouseId\",on_hand AS \"onHand\",reserved,on_hand-reserved AS available FROM inventory WHERE part_id=? ORDER BY warehouse_id",id));
            factories.addAll(db.list("SELECT p.id AS \"partId\",f.id AS \"factoryId\",f.region,f.phone AS contact,s.lead_days FROM part p JOIN part_supplier s ON s.part_id=p.id JOIN factory f ON f.id=s.factory_id WHERE p.id=? ORDER BY s.lead_days NULLS LAST,f.id",id));
        }
        return Map.of("stocks",stocks,"factories",factories);
    }
}
