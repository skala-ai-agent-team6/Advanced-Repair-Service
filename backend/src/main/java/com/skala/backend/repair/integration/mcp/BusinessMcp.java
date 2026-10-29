package com.skala.backend.repair.integration.mcp;

import java.util.*;

public interface BusinessMcp {
    // Normalized tool result: stocks [{partId,warehouseId,onHand,reserved,available}], factories [{partId,factoryId,region,contact}].
    Map<String,Object> lookup(List<Long> partIds);
    /** [출장] 업무 MCP get_repair_preparation_report: 방문 준비 리포트(원인·증상 요약, 공구·부품, 재고, 고장 위치). 없으면 UNAVAILABLE */
    default Map<String,Object> preparation(Long repairId) {return Map.of("report_status","UNAVAILABLE");}
}
