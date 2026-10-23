package com.skala.backend.repair;

import org.junit.jupiter.api.Test;
import org.flywaydb.core.Flyway;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.sql.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

@Testcontainers
class ProductTypeMigrationTests {
    @Container static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17-alpine");
    @Test void v9UsesSnapshotBeforeCatalogAndPreservesPublishedOutbox()throws Exception{
        Flyway.configure().dataSource(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword()).target("8").load().migrate();
        try(var c=DriverManager.getConnection(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword());var s=c.createStatement()){
            s.execute("INSERT INTO service_center(code,name,region) VALUES ('TEST','Test','Test'); INSERT INTO app_user(email,password_hash,name,role,center_id) VALUES ('test','hash','Test','TECHNICIAN',1); INSERT INTO product_model(model_code,name,appliance_type) VALUES ('TEST','Test','WASHING_MACHINE'); INSERT INTO product(serial_number,model_id) VALUES ('TEST',1)");
            s.execute("INSERT INTO repair_case(case_number,product_id,center_id,technician_id,symptom,product_snapshot) VALUES ('SNAPSHOT',1,1,1,'vacuum symptom is not metadata','{\"appliance_type\":\"AIR_CONDITIONER\"}'),('FALLBACK',1,1,1,'symptom','{}'),('UNSUPPORTED',1,1,1,'symptom','{\"appliance_type\":\"washer\"}'),('NULL',1,1,1,'symptom','{\"product_type\":null}'),('CANONICAL',1,1,1,'symptom','{\"product_type\":\"VACUUM\"}')");
            s.execute("INSERT INTO outbox_event(case_id,event_key,event_type,payload,topic,published_at) VALUES (1,'00000000-0000-4000-8000-000000000001','DIAGNOSIS_REQUESTED','{\"payload\":{\"repair\":{}}}','diagnosis.commands.v2',now())");
        }
        Flyway.configure().dataSource(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword()).load().migrate();
        try(var c=DriverManager.getConnection(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword());var s=c.createStatement()){
            var types=new HashMap<String,String>();try(var r=s.executeQuery("SELECT case_number,product_type FROM repair_case")){while(r.next())types.put(r.getString(1),r.getString(2));}
            assertThat(types).containsEntry("SNAPSHOT","air_conditioner").containsEntry("FALLBACK","washing_machine").containsEntry("UNSUPPORTED","unknown").containsEntry("NULL","unknown").containsEntry("CANONICAL","vacuum");
            try(var r=s.executeQuery("SELECT payload->'payload'->'repair' ? 'product_type' FROM outbox_event")){r.next();assertThat(r.getBoolean(1)).isFalse();}
            s.execute("INSERT INTO product_model(model_code,name) VALUES ('MISSING','Missing metadata')");try(var r=s.executeQuery("SELECT appliance_type FROM product_model WHERE model_code='MISSING'")){r.next();assertThat(r.getString(1)).isEqualTo("UNKNOWN");}
        }
    }
}
