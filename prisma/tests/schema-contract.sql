-- Run only against an isolated database with the initial migration applied.
-- All fixtures are rolled back, including temporary assertion functions.
BEGIN;
CREATE FUNCTION pg_temp.expect_rejected(statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught_state text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS caught_state = RETURNED_SQLSTATE;
    IF caught_state = expected_state THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected SQLSTATE %, got % for %', expected_state, caught_state, statement;
  END;
  RAISE EXCEPTION 'Statement unexpectedly accepted: %', statement;
END;
$$;

INSERT INTO users (id, updated_at) VALUES
('00000000-0000-4000-8000-000000000001', now()),
('00000000-0000-4000-8000-000000000002', now());
INSERT INTO user_health_profiles
(user_id, height_cm, initial_weight_kg, age_at_onboarding, age_recorded_on, gender, goal_intention, exercise_frequency, healthy_eating_frequency, default_wake_time, default_sleep_time, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 175, 72, 26, '2026-10-04', 'unspecified', 'maintain', 'once_or_twice', 'most_of_the_time', '07:00', '01:00', now());
SELECT pg_temp.expect_rejected($q$UPDATE user_health_profiles SET default_wake_time='09:00'$q$, 'P0001');
UPDATE user_health_profiles SET height_cm=176;

INSERT INTO entity_tag_details (id, title, updated_at)
VALUES ('00000000-0000-4000-8000-000000000010', 'Lunch', now());
INSERT INTO entities (entity_id, user_id, tag, entry_date, occurred_at, recorded_timezone, input_source, entity_tag_details_id, updated_at)
VALUES ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'nutrition', '2026-10-04', now(), 'Asia/Kolkata', 'text', '00000000-0000-4000-8000-000000000010', now());
SELECT pg_temp.expect_rejected($q$UPDATE entities SET entity_attachments='{}'$q$, '23514');
SELECT pg_temp.expect_rejected($q$UPDATE entities SET user_id='00000000-0000-4000-8000-000000000002'$q$, 'P0001');
SELECT pg_temp.expect_rejected($q$UPDATE entity_tag_details SET tag_data='[]'$q$, '23514');

INSERT INTO health_records (id, user_id, metric_type, value, unit, occurred_at, source_entity_id, source_revision, source)
VALUES ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000001', 'calories_intake', 500, 'kcal', now(), '00000000-0000-4000-8000-000000000011', 1, 'calculated');
SELECT pg_temp.expect_rejected($q$UPDATE health_records SET value=600$q$, 'P0001');
SELECT pg_temp.expect_rejected($q$DELETE FROM health_records$q$, 'P0001');
SELECT pg_temp.expect_rejected($q$INSERT INTO health_records (id,user_id,metric_type,value,unit,occurred_at,source_entity_id,source_revision,source) VALUES ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','calories_intake',500,'kcal',now(),'00000000-0000-4000-8000-000000000011',1,'calculated')$q$, 'P0001');
SELECT pg_temp.expect_rejected($q$INSERT INTO health_records (id,user_id,metric_type,value,unit,occurred_at,source_entity_id,source) VALUES ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','calories_intake',500,'kcal',now(),'00000000-0000-4000-8000-000000000011','calculated')$q$, '23514');

UPDATE entity_tag_details SET note='Corrected portion';
DO $$ BEGIN
  IF (SELECT revision FROM entities WHERE entity_id='00000000-0000-4000-8000-000000000011') <> 2 THEN
    RAISE EXCEPTION 'Content edit did not advance revision';
  END IF;
END $$;
UPDATE entity_tag_details SET ai_synopsis='New summary';
DO $$ BEGIN
  IF (SELECT revision FROM entities WHERE entity_id='00000000-0000-4000-8000-000000000011') <> 2 THEN
    RAISE EXCEPTION 'AI output incorrectly advanced revision';
  END IF;
END $$;
INSERT INTO health_records (id,user_id,metric_type,value,unit,occurred_at,source_entity_id,source_revision,source,supersedes_record_id)
VALUES ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','calories_intake',600,'kcal',now(),'00000000-0000-4000-8000-000000000011',2,'calculated','00000000-0000-4000-8000-000000000020');
UPDATE entities SET deleted_at=now();
INSERT INTO health_records (id,user_id,metric_type,value,unit,occurred_at,source_entity_id,source_revision,source,supersedes_record_id,is_void)
VALUES ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','calories_intake',0,'kcal',now(),'00000000-0000-4000-8000-000000000011',3,'calculated','00000000-0000-4000-8000-000000000021',true);

INSERT INTO ai_models (id,name,provider_model_id,updated_at)
VALUES ('00000000-0000-4000-8000-000000000030','Test model','test/model',now());
INSERT INTO chat_threads (id,user_id,ai_model_id,updated_at) VALUES
('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000030',now()),
('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000030',now());
INSERT INTO chat_messages (id,thread_id,message,role,status,sequence_number,request_id,updated_at)
VALUES ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000031','Hello','user','completed',1,'00000000-0000-4000-8000-000000000050',now());
INSERT INTO chat_messages (id,thread_id,role,sequence_number,request_id,reply_to_message_id,updated_at)
VALUES ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','assistant',2,'00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000040',now());
SELECT pg_temp.expect_rejected($q$INSERT INTO chat_messages (id,thread_id,role,sequence_number,request_id,updated_at) VALUES ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000031','assistant',3,'00000000-0000-4000-8000-000000000051',now())$q$, '23505');
SELECT pg_temp.expect_rejected($q$INSERT INTO chat_messages (id,thread_id,role,sequence_number,request_id,reply_to_message_id,updated_at) VALUES ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000032','assistant',1,'00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000040',now())$q$, '23503');
UPDATE chat_messages SET status='completed', actual_model_id='00000000-0000-4000-8000-000000000030' WHERE role='assistant';
INSERT INTO chat_messages (id,thread_id,role,sequence_number,request_id,updated_at)
VALUES ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000031','assistant',3,'00000000-0000-4000-8000-000000000051',now());
ROLLBACK;
