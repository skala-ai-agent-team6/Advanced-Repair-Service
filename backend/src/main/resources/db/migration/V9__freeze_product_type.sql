-- Freeze product metadata at intake so resume/retry never depends on later catalog edits.
ALTER TABLE product_model ALTER COLUMN appliance_type SET DEFAULT 'UNKNOWN';
ALTER TABLE repair_case ADD COLUMN product_type text NOT NULL DEFAULT 'unknown'
 CHECK(product_type IN ('vacuum','washing_machine','air_conditioner','unknown'));
UPDATE repair_case r SET product_type=CASE
 WHEN r.product_snapshot ? 'product_type' THEN CASE lower(trim(r.product_snapshot->>'product_type'))
  WHEN 'vacuum' THEN 'vacuum' WHEN 'washing_machine' THEN 'washing_machine'
  WHEN 'air_conditioner' THEN 'air_conditioner' ELSE 'unknown' END
 WHEN r.product_snapshot ? 'productType' THEN CASE lower(trim(r.product_snapshot->>'productType'))
  WHEN 'vacuum' THEN 'vacuum' WHEN 'washing_machine' THEN 'washing_machine'
  WHEN 'air_conditioner' THEN 'air_conditioner' ELSE 'unknown' END
 ELSE CASE upper(trim(CASE WHEN r.product_snapshot ? 'appliance_type'
  THEN r.product_snapshot->>'appliance_type' ELSE m.appliance_type END))
  WHEN 'VACUUM_CLEANER' THEN 'vacuum' WHEN 'VACUUM' THEN 'vacuum'
  WHEN 'WASHING_MACHINE' THEN 'washing_machine' WHEN 'AIR_CONDITIONER' THEN 'air_conditioner'
  ELSE 'unknown' END END
FROM product p JOIN product_model m ON m.id=p.model_id WHERE r.product_id=p.id;
-- Existing published/outstanding outbox payloads and RAG receipts remain immutable.
