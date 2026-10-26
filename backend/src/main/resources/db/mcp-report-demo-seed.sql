-- 수리 방문 준비 리포트 MCP 데모 데이터
-- V1~V5 마이그레이션이 적용된 public 스키마에서 실행하세요.
-- 이 SQL은 DB 메타데이터만 넣습니다. 아래 object_key에 해당하는 실제 사진 파일은
-- FILE_ROOT(기본 backend/data/files/) 아래에 별도로 있어야 MCP가 사진에 좌표를 그릴 수 있습니다.
-- 실행 후 마지막 SELECT의 repair_id를 get_repair_preparation_report에 전달하세요.

BEGIN;

DO $$
DECLARE
    v_center_id bigint;
    v_technician_id bigint;
    v_model_id bigint;
    v_product_id bigint;
    v_part_id bigint;
    v_warehouse_id bigint;
    v_case_id bigint;
    v_job_id bigint;
    v_candidate_id bigint;
    v_photo_1 bigint;
    v_photo_2 bigint;
    v_photo_3 bigint;
    v_table_name text;
    v_sequence_name text;
    v_max_id bigint;
    v_annotation_1 jsonb := '{"defects":[{"type":"구동 모터 연결부 의심","confidence":0.93,"x":0.34,"y":0.38,"width":0.28,"height":0.24}]}'::jsonb;
    v_annotation_2 jsonb := '{"defects":[{"type":"이물질 유입 의심","confidence":0.86,"x":0.48,"y":0.40,"width":0.22,"height":0.20}]}'::jsonb;
    v_annotation_3 jsonb := '{"defects":[{"type":"모터 배선 접점 의심","confidence":0.81,"x":0.40,"y":0.52,"width":0.20,"height":0.18}]}'::jsonb;
BEGIN
    -- dev-seed.sql inserts explicit identity IDs. Bring every sequence used below
    -- up to the current table maximum before asking PostgreSQL for generated IDs.
    FOREACH v_table_name IN ARRAY ARRAY[
        'service_center', 'app_user', 'product_model', 'product', 'part', 'warehouse',
        'repair_case', 'diagnosis_job', 'attachment', 'diagnosis_candidate',
        'diagnosis_recommended_part'
    ] LOOP
        EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM public.%I', v_table_name)
            INTO v_max_id;
        v_sequence_name := pg_get_serial_sequence('public.' || v_table_name, 'id');
        PERFORM setval(v_sequence_name::regclass, GREATEST(v_max_id, 1), v_max_id > 0);
    END LOOP;

    INSERT INTO service_center(code, name, region, address, phone)
    VALUES ('MCP-DEMO-CENTER', 'MCP 리포트 데모 센터', '서울', '데모 주소', '02-0000-0000')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_center_id;

    INSERT INTO app_user(email, password_hash, name, role, center_id)
    VALUES ('mcp-demo-tech@example.invalid', 'not-a-login-account', 'MCP 데모 기사', 'TECHNICIAN', v_center_id)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, center_id = EXCLUDED.center_id
    RETURNING id INTO v_technician_id;

    INSERT INTO product_model(model_code, name)
    VALUES ('MCP-DEMO-ROBOT-01', 'MCP 데모 로봇청소기')
    ON CONFLICT (model_code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_model_id;

    INSERT INTO product(serial_number, model_id, manufactured_on, information)
    VALUES ('MCP-DEMO-SERIAL-001', v_model_id, DATE '2025-03-01',
            '{"manufacturer":"Demo","productType":"robot vacuum"}'::jsonb)
    ON CONFLICT (serial_number) DO UPDATE SET model_id = EXCLUDED.model_id,
        manufactured_on = EXCLUDED.manufactured_on, information = EXCLUDED.information
    RETURNING id INTO v_product_id;

    INSERT INTO part(part_number, name, category)
    VALUES ('MCP-DEMO-MOTOR-001', '데모 구동 모터', 'MOTOR')
    ON CONFLICT (part_number) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category
    RETURNING id INTO v_part_id;

    INSERT INTO model_part(model_id, part_id) VALUES (v_model_id, v_part_id)
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_warehouse_id FROM warehouse
    WHERE name = 'MCP 데모 서울 창고' AND region = '서울'
    ORDER BY id LIMIT 1;
    IF v_warehouse_id IS NULL THEN
        INSERT INTO warehouse(name, region, address, phone)
        VALUES ('MCP 데모 서울 창고', '서울', '데모 물류 주소', '02-0000-0001')
        RETURNING id INTO v_warehouse_id;
    END IF;
    INSERT INTO inventory(warehouse_id, part_id, on_hand, reserved)
    VALUES (v_warehouse_id, v_part_id, 8, 1)
    ON CONFLICT (warehouse_id, part_id) DO UPDATE
        SET on_hand = EXCLUDED.on_hand, reserved = EXCLUDED.reserved;

    INSERT INTO repair_case(case_number, product_id, center_id, technician_id, symptom,
                            error_codes, firmware_version, status, user_input, product_snapshot)
    VALUES ('MCP-DEMO-20261023-001', v_product_id, v_center_id, v_technician_id,
            '작동 중 오른쪽 바퀴에서 소음이 나고 주행이 멈춥니다.',
            '["E-MOTOR-07"]'::jsonb, '1.4.2', 'DIAGNOSED',
            '{"customerDescription":"청소를 시작하면 오른쪽에서 갈리는 소리가 나고 몇 초 뒤 멈춥니다."}'::jsonb,
            jsonb_build_object('modelCode', 'MCP-DEMO-ROBOT-01', 'compatibleParts', jsonb_build_array(
                jsonb_build_object('partId', v_part_id::text, 'quantity', 1))))
    ON CONFLICT (case_number) DO UPDATE SET product_id = EXCLUDED.product_id,
        center_id = EXCLUDED.center_id, technician_id = EXCLUDED.technician_id,
        symptom = EXCLUDED.symptom, error_codes = EXCLUDED.error_codes,
        firmware_version = EXCLUDED.firmware_version, status = EXCLUDED.status,
        user_input = EXCLUDED.user_input, product_snapshot = EXCLUDED.product_snapshot
    RETURNING id INTO v_case_id;

    INSERT INTO diagnosis_job(case_id, request_key, status, workflow_version, finished_at,
                              result, stage)
    VALUES (v_case_id, 'b3fd7c5d-7a4f-4f67-a934-592acb603001', 'SUCCEEDED',
            'mcp-report-demo-v1', now(), '{}'::jsonb, 'COMPLETED')
    ON CONFLICT (request_key) DO UPDATE SET case_id = EXCLUDED.case_id,
        status = EXCLUDED.status, workflow_version = EXCLUDED.workflow_version,
        finished_at = EXCLUDED.finished_at, stage = EXCLUDED.stage, updated_at = now()
    RETURNING id INTO v_job_id;

    -- 고정 object_key는 DB 첨부 메타데이터용입니다. 실제 파일이 없으면 리포트에 경고가 표시됩니다.
    INSERT INTO attachment(case_id, uploader_id, kind, target, object_key, mime_type,
                           byte_size, sha256, original_name)
    VALUES (v_case_id, v_technician_id, 'IMAGE', 'GENERAL', 'a3fd7c5d-7a4f-4f67-a934-592acb603001',
            'image/png', 1, repeat('0', 64), 'mcp-demo-photo-1.png')
    ON CONFLICT (object_key) DO UPDATE SET case_id = EXCLUDED.case_id,
        uploader_id = EXCLUDED.uploader_id, kind = EXCLUDED.kind, target = EXCLUDED.target,
        mime_type = EXCLUDED.mime_type, byte_size = EXCLUDED.byte_size,
        sha256 = EXCLUDED.sha256, original_name = EXCLUDED.original_name
    RETURNING id INTO v_photo_1;

    INSERT INTO attachment(case_id, uploader_id, kind, target, object_key, mime_type,
                           byte_size, sha256, original_name)
    VALUES (v_case_id, v_technician_id, 'IMAGE', 'GENERAL', 'a3fd7c5d-7a4f-4f67-a934-592acb603002',
            'image/png', 1, repeat('0', 64), 'mcp-demo-photo-2.png')
    ON CONFLICT (object_key) DO UPDATE SET case_id = EXCLUDED.case_id,
        uploader_id = EXCLUDED.uploader_id, kind = EXCLUDED.kind, target = EXCLUDED.target,
        mime_type = EXCLUDED.mime_type, byte_size = EXCLUDED.byte_size,
        sha256 = EXCLUDED.sha256, original_name = EXCLUDED.original_name
    RETURNING id INTO v_photo_2;

    INSERT INTO attachment(case_id, uploader_id, kind, target, object_key, mime_type,
                           byte_size, sha256, original_name)
    VALUES (v_case_id, v_technician_id, 'IMAGE', 'GENERAL', 'a3fd7c5d-7a4f-4f67-a934-592acb603003',
            'image/png', 1, repeat('0', 64), 'mcp-demo-photo-3.png')
    ON CONFLICT (object_key) DO UPDATE SET case_id = EXCLUDED.case_id,
        uploader_id = EXCLUDED.uploader_id, kind = EXCLUDED.kind, target = EXCLUDED.target,
        mime_type = EXCLUDED.mime_type, byte_size = EXCLUDED.byte_size,
        sha256 = EXCLUDED.sha256, original_name = EXCLUDED.original_name
    RETURNING id INTO v_photo_3;

    INSERT INTO diagnosis_candidate(job_id, part_id, rank, cause_code, cause_description,
                                    confidence, repair_guide, recommended_quantity)
    VALUES (v_job_id, v_part_id, 1, 'MOTOR_DRIVE_FAULT',
            '오른쪽 구동 모터 또는 연결부의 마찰·접점 이상 가능성',
            0.9100, '전원을 분리한 뒤 오른쪽 바퀴 회전 저항과 모터 커넥터를 점검하고, 손상 시 구동 모터를 교체합니다.', 1)
    ON CONFLICT (job_id, rank) DO UPDATE SET part_id = EXCLUDED.part_id,
        cause_code = EXCLUDED.cause_code, cause_description = EXCLUDED.cause_description,
        confidence = EXCLUDED.confidence, repair_guide = EXCLUDED.repair_guide,
        recommended_quantity = EXCLUDED.recommended_quantity
    RETURNING id INTO v_candidate_id;

    DELETE FROM diagnosis_evidence WHERE candidate_id = v_candidate_id;
    DELETE FROM diagnosis_recommended_part WHERE job_id = v_job_id;
    INSERT INTO diagnosis_recommended_part(job_id, part_id, quantity)
    VALUES (v_job_id, v_part_id, 1);

    INSERT INTO diagnosis_evidence(candidate_id, attachment_id, excerpt, annotation, details)
    VALUES
        (v_candidate_id, v_photo_1, '사진 1: 오른쪽 구동 바퀴 주변 마찰 흔적 점검 필요', v_annotation_1,
         jsonb_build_object('attachmentId', v_photo_1, 'type', 'PHOTO', 'annotation', v_annotation_1)),
        (v_candidate_id, v_photo_2, '사진 2: 바퀴 내부 이물질 및 축 회전 상태 점검 필요', v_annotation_2,
         jsonb_build_object('attachmentId', v_photo_2, 'type', 'PHOTO', 'annotation', v_annotation_2)),
        (v_candidate_id, v_photo_3, '사진 3: 모터 배선 커넥터 접점 상태 점검 필요', v_annotation_3,
         jsonb_build_object('attachmentId', v_photo_3, 'type', 'PHOTO', 'annotation', v_annotation_3));

    UPDATE diagnosis_job
    SET result = jsonb_build_object(
            'summary', '오른쪽 구동 바퀴에서 소음과 주행 중단이 발생합니다. 구동 모터 또는 커넥터 접점 이상이 우선 의심됩니다.',
            'modelVersion', 'mcp-report-demo-v1',
            'repairMethod', '전원을 분리한 뒤 바퀴 회전 저항, 이물질, 모터 커넥터를 순서대로 점검합니다. 손상 확인 시 구동 모터를 교체합니다.',
            'candidates', jsonb_build_array(jsonb_build_object(
                'rank', 1, 'causeCode', 'MOTOR_DRIVE_FAULT',
                'cause', '구동 모터 또는 연결부 이상',
                'explanation', '오른쪽 바퀴 소음과 주행 중단 증상에 근거한 의심 원인입니다.',
                'confidence', 0.91, 'partId', v_part_id::text, 'recommendedQuantity', 1)),
            'recommendedParts', jsonb_build_array(jsonb_build_object('partId', v_part_id::text, 'quantity', 1)),
            'recommendedTools', jsonb_build_array(
                jsonb_build_object('name', '절연 드라이버 세트', 'purpose', '전원을 분리한 뒤 모터 커버와 커넥터를 점검합니다.', 'evidence', '저장된 수리 가이드의 커버·커넥터 점검 단계'),
                jsonb_build_object('name', '핀셋 및 소형 브러시', 'purpose', '바퀴 축 주변 이물질을 확인하고 제거합니다.', 'evidence', '저장된 수리 가이드의 회전 저항·이물질 점검 단계')),
            'analysisResults', jsonb_build_array(
                jsonb_build_object('attachmentId', v_photo_1),
                jsonb_build_object('attachmentId', v_photo_2),
                jsonb_build_object('attachmentId', v_photo_3)),
            'evidence', jsonb_build_array(
                jsonb_build_object('type', 'PHOTO', 'attachmentId', v_photo_1, 'candidateRank', 1, 'annotation', v_annotation_1),
                jsonb_build_object('type', 'PHOTO', 'attachmentId', v_photo_2, 'candidateRank', 1, 'annotation', v_annotation_2),
                jsonb_build_object('type', 'PHOTO', 'attachmentId', v_photo_3, 'candidateRank', 1, 'annotation', v_annotation_3))
        ), status = 'SUCCEEDED', finished_at = now(), updated_at = now(), stage = 'COMPLETED'
    WHERE id = v_job_id;
END $$;

COMMIT;

SELECT id AS repair_id, case_number
FROM repair_case
WHERE case_number = 'MCP-DEMO-20261023-001';
