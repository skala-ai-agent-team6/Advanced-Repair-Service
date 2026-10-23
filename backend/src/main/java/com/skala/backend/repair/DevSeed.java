package com.skala.backend.repair;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ApplicationArguments;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;
import javax.sql.DataSource;
import java.util.*;

@Component
@Profile("dev")
public class DevSeed implements ApplicationRunner {
    final Store db;final DataSource source;final PasswordEncoder encoder;final String password;
    public DevSeed(Store db,DataSource source,PasswordEncoder encoder,@Value("${app.seed-password}") String password) {this.db=db;this.source=source;this.encoder=encoder;this.password=password;}
    @Override @Transactional public void run(ApplicationArguments args) {
        // [통합] 12자 이상 검사 제거: 로컬 시연에서 tech1/1234로 바로 로그인하려고. dev 프로필에서만 도는 코드다
        new ResourceDatabasePopulator(new ClassPathResource("db/dev-seed.sql")).execute(source);
        String hash=encoder.encode(password);
        for(int n=1;n<=3;n++) {
            String name=n==3?"quality":"tech"+n;String role=n==3?"QUALITY_MANAGER":"TECHNICIAN";
            Long center=n==3?null:(long)n;
            db.update("INSERT INTO app_user(email,name,password_hash,role,center_id) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",name,name,hash,role,center);
        }
        for(String account:List.of("field-tech","ops"))
            db.update("INSERT INTO app_user(email,name,password_hash,role,center_id,operations_enabled) VALUES (?,?,?,'TECHNICIAN',?,?) ON CONFLICT DO NOTHING",account,account,hash,account.equals("field-tech")?2L:1L,account.equals("ops"));
        db.update("INSERT INTO warranty_policy(model_id,version,duration_months,effective_from,development_only) VALUES (1,'DEMO-ONLY-12M',12,'2000-01-01',true) ON CONFLICT DO NOTHING");
        Long user=(Long)db.one("SELECT id FROM app_user WHERE email='tech1'").get("id");
        if(db.list("SELECT id FROM repair_case LIMIT 1").isEmpty()) for(int n=1;n<=3;n++) {
            String status=n==1?"RECEIVED":n==2?"MANUAL_REVIEW":"DIAGNOSED";
            db.update("INSERT INTO repair_case(case_number,center_id,product_id,technician_id,symptom,error_codes,firmware_version,status) VALUES (?,1,1,?,'Seed demonstration','[\"E01\"]','1.0',?) ON CONFLICT DO NOTHING","SEED-"+n,user,status);
        }
        db.update("UPDATE repair_case SET purchase_date=current_date-180 WHERE case_number IN ('SEED-1','SEED-2','SEED-3') AND purchase_date IS NULL");
        db.update("UPDATE repair_case SET service_type='FIELD',assigned_technician_id=(SELECT id FROM app_user WHERE email='field-tech') WHERE case_number='SEED-2' AND service_type='CENTER'");
        // [출장] field-tech는 출장기사, SEED-2는 오늘 14시 방문 일정 (출장 화면 시연용)
        db.update("UPDATE app_user SET technician_type='FIELD' WHERE email='field-tech'");
        db.update("UPDATE repair_case SET visit_at=(current_date+time '14:00') AT TIME ZONE 'Asia/Seoul' WHERE case_number='SEED-2' AND visit_at IS NULL");
        db.update("INSERT INTO consumer_access(case_id,key_hash,expires_at,contact_name,contact_phone,visit_address) SELECT id,encode(sha256(convert_to('seed-2-demo','UTF8')),'hex'),now()+interval '30 days','김고객','010-0000-0000','서울 강남구 역삼동 123' FROM repair_case WHERE case_number='SEED-2' ON CONFLICT DO NOTHING");
        for(String table:List.of("service_center","factory","product_model","part","part_lot","product","product_component","warehouse"))
            db.one("SELECT setval(pg_get_serial_sequence('"+table+"','id'),greatest((SELECT max(id) FROM "+table+")+1,1),false)");
    }
}
