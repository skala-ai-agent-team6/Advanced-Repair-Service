package com.skala.backend.repair.integration.mcp;

import com.skala.backend.repair.shared.Store;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
@Profile("(dev | test) & !realmcp") // [통합] realmcp일 때는 가짜를 끈다
public class MockBusinessMcp implements BusinessMcp {
    final Store db;
    public MockBusinessMcp(Store db) {this.db=db;}
    @Override public Map<String,Object> lookup(List<Long> ids) {
        var stocks=new ArrayList<Map<String,Object>>();var factories=new ArrayList<Map<String,Object>>();
        for(Long id:ids) {
            stocks.addAll(db.list("SELECT part_id AS \"partId\",warehouse_id AS \"warehouseId\",on_hand AS \"onHand\",reserved,on_hand-reserved AS available FROM inventory WHERE part_id=? ORDER BY warehouse_id",id));
            factories.addAll(db.list("SELECT p.id AS \"partId\",f.id AS \"factoryId\",f.region,f.phone AS contact,s.lead_days FROM part p JOIN part_supplier s ON s.part_id=p.id JOIN factory f ON f.id=s.factory_id WHERE p.id=? ORDER BY s.lead_days NULLS LAST,f.id",id));
        }
        return Map.of("stocks",stocks,"factories",factories);
    }
}
