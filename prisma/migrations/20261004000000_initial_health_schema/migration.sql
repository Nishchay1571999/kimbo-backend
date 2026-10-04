-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('guest', 'member');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'unspecified');

-- CreateEnum
CREATE TYPE "GoalIntention" AS ENUM ('lose', 'maintain', 'gain');

-- CreateEnum
CREATE TYPE "ExerciseFrequency" AS ENUM ('never', 'once_or_twice', 'four_to_five_plus');

-- CreateEnum
CREATE TYPE "HealthyEatingFrequency" AS ENUM ('not_so_much', 'most_of_the_time', 'every_time');

-- CreateEnum
CREATE TYPE "EntityTag" AS ENUM ('note', 'nutrition', 'exercise');

-- CreateEnum
CREATE TYPE "InputSource" AS ENUM ('text', 'image', 'audio', 'mixed');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('not_requested', 'pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "HealthMetric" AS ENUM ('weight', 'calories_intake', 'calories_burned');

-- CreateEnum
CREATE TYPE "HealthRecordSource" AS ENUM ('user', 'extracted', 'calculated');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('active', 'archived', 'deleted');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100),
    "email" VARCHAR(320),
    "auth_provider_id" VARCHAR(255),
    "account_status" "AccountStatus" NOT NULL DEFAULT 'guest',
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
    "onboarding_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_health_profiles" (
    "user_id" UUID NOT NULL,
    "height_cm" DECIMAL(6,2) NOT NULL,
    "initial_weight_kg" DECIMAL(6,2) NOT NULL,
    "age_at_onboarding" INTEGER NOT NULL,
    "age_recorded_on" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "goal_intention" "GoalIntention" NOT NULL,
    "exercise_frequency" "ExerciseFrequency" NOT NULL,
    "healthy_eating_frequency" "HealthyEatingFrequency" NOT NULL,
    "default_wake_time" TIME(0) NOT NULL,
    "default_sleep_time" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_health_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "preferred_chat_model_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "entities" (
    "entity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tag" "EntityTag" NOT NULL,
    "entry_date" DATE NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_timezone" VARCHAR(100) NOT NULL,
    "input_source" "InputSource" NOT NULL,
    "entity_attachments" JSONB NOT NULL DEFAULT '[]',
    "entity_tag_details_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "entities_pkey" PRIMARY KEY ("entity_id")
);

-- CreateTable
CREATE TABLE "entity_tag_details" (
    "id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "note" TEXT,
    "tag_data" JSONB NOT NULL DEFAULT '{}',
    "ai_synopsis" TEXT,
    "audio_transcripts" JSONB,
    "ai_structured_data" JSONB,
    "ai_status" "AiStatus" NOT NULL DEFAULT 'not_requested',
    "ai_input_revision" INTEGER,
    "ai_model_id" UUID,
    "ai_pipeline_version" VARCHAR(100),
    "ai_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "ai_next_attempt_at" TIMESTAMPTZ(3),
    "ai_locked_until" TIMESTAMPTZ(3),
    "ai_error_code" VARCHAR(100),
    "ai_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entity_tag_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "metric_type" "HealthMetric" NOT NULL,
    "value" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(10) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "source_entity_id" UUID,
    "source_revision" INTEGER,
    "source" "HealthRecordSource" NOT NULL,
    "supersedes_record_id" UUID,
    "is_void" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL DEFAULT 'openrouter',
    "provider_model_id" VARCHAR(255) NOT NULL,
    "credential_reference" VARCHAR(100),
    "supports_text" BOOLEAN NOT NULL DEFAULT true,
    "supports_images" BOOLEAN NOT NULL DEFAULT false,
    "supports_audio" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ai_model_id" UUID NOT NULL,
    "title" VARCHAR(200),
    "thread_status" "ThreadStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "role" "MessageRole" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'pending',
    "sequence_number" INTEGER NOT NULL,
    "request_id" UUID NOT NULL,
    "reply_to_message_id" UUID,
    "actual_model_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_id_key" ON "users"("auth_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "entities_entity_tag_details_id_key" ON "entities"("entity_tag_details_id");

-- CreateIndex
CREATE INDEX "entities_user_id_entry_date_occurred_at_idx" ON "entities"("user_id", "entry_date" DESC, "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "entities_user_id_tag_entry_date_idx" ON "entities"("user_id", "tag", "entry_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "entities_entity_id_user_id_key" ON "entities"("entity_id", "user_id");

-- CreateIndex
CREATE INDEX "entity_tag_details_ai_status_ai_next_attempt_at_idx" ON "entity_tag_details"("ai_status", "ai_next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "health_records_supersedes_record_id_key" ON "health_records"("supersedes_record_id");

-- CreateIndex
CREATE INDEX "health_records_user_id_metric_type_occurred_at_idx" ON "health_records"("user_id", "metric_type", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "health_records_source_entity_id_source_revision_metric_type_key" ON "health_records"("source_entity_id", "source_revision", "metric_type");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_provider_model_id_key" ON "ai_models"("provider", "provider_model_id");

-- CreateIndex
CREATE INDEX "chat_threads_user_id_updated_at_idx" ON "chat_threads"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_id_thread_id_key" ON "chat_messages"("id", "thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_thread_id_sequence_number_key" ON "chat_messages"("thread_id", "sequence_number");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_thread_id_request_id_role_key" ON "chat_messages"("thread_id", "request_id", "role");

-- AddForeignKey
ALTER TABLE "user_health_profiles" ADD CONSTRAINT "user_health_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_preferred_chat_model_id_fkey" FOREIGN KEY ("preferred_chat_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_entity_tag_details_id_fkey" FOREIGN KEY ("entity_tag_details_id") REFERENCES "entity_tag_details"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_tag_details" ADD CONSTRAINT "entity_tag_details_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_records" ADD CONSTRAINT "health_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_records" ADD CONSTRAINT "health_records_source_entity_id_user_id_fkey" FOREIGN KEY ("source_entity_id", "user_id") REFERENCES "entities"("entity_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_records" ADD CONSTRAINT "health_records_supersedes_record_id_fkey" FOREIGN KEY ("supersedes_record_id") REFERENCES "health_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_actual_model_id_fkey" FOREIGN KEY ("actual_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_message_id_thread_id_fkey" FOREIGN KEY ("reply_to_message_id", "thread_id") REFERENCES "chat_messages"("id", "thread_id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- PostgreSQL constraints Prisma cannot express in its schema language.
ALTER TABLE "user_health_profiles"
  ADD CONSTRAINT "health_profile_measurements_valid" CHECK (
    "height_cm" > 0 AND "initial_weight_kg" > 0 AND "age_at_onboarding" BETWEEN 18 AND 72
  );
ALTER TABLE "entities"
  ADD CONSTRAINT "entity_revision_positive" CHECK ("revision" > 0),
  ADD CONSTRAINT "entity_attachments_array" CHECK (jsonb_typeof("entity_attachments") = 'array');
ALTER TABLE "entity_tag_details"
  ADD CONSTRAINT "tag_data_object" CHECK (jsonb_typeof("tag_data") = 'object'),
  ADD CONSTRAINT "title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "ai_attempt_count_nonnegative" CHECK ("ai_attempt_count" >= 0),
  ADD CONSTRAINT "ai_input_revision_positive" CHECK ("ai_input_revision" IS NULL OR "ai_input_revision" > 0);
ALTER TABLE "health_records"
  ADD CONSTRAINT "health_value_valid" CHECK (
    ("metric_type" = 'weight' AND "unit" = 'kg' AND ("is_void" OR "value" > 0)) OR
    ("metric_type" IN ('calories_intake', 'calories_burned') AND "unit" = 'kcal' AND "value" >= 0)
  ),
  ADD CONSTRAINT "health_source_revision_valid" CHECK (
    ("source_entity_id" IS NULL AND "source_revision" IS NULL) OR
    ("source_entity_id" IS NOT NULL AND "source_revision" IS NOT NULL AND "source_revision" > 0)
  ),
  ADD CONSTRAINT "health_void_requires_predecessor" CHECK (NOT "is_void" OR "supersedes_record_id" IS NOT NULL),
  ADD CONSTRAINT "health_correction_not_self" CHECK ("supersedes_record_id" IS NULL OR "supersedes_record_id" <> "id");
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "message_sequence_positive" CHECK ("sequence_number" > 0),
  ADD CONSTRAINT "message_metadata_object" CHECK (jsonb_typeof("metadata") = 'object'),
  ADD CONSTRAINT "message_not_own_reply" CHECK ("reply_to_message_id" IS NULL OR "reply_to_message_id" <> "id"),
  ADD CONSTRAINT "user_message_not_blank" CHECK ("role" <> 'user' OR length(btrim("message")) > 0);

-- Exactly one pending/processing assistant response per conversation.
CREATE UNIQUE INDEX "one_active_response_per_thread"
ON "chat_messages" ("thread_id")
WHERE "role" = 'assistant' AND "status" IN ('pending', 'processing');

CREATE FUNCTION "protect_fixed_schedule"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."default_wake_time" IS DISTINCT FROM OLD."default_wake_time"
     OR NEW."default_sleep_time" IS DISTINCT FROM OLD."default_sleep_time" THEN
    RAISE EXCEPTION 'Wake and sleep times cannot be changed after onboarding';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "fixed_schedule_immutable" BEFORE UPDATE ON "user_health_profiles"
FOR EACH ROW EXECUTE FUNCTION "protect_fixed_schedule"();

CREATE FUNCTION "protect_health_record_log"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous "health_records"%ROWTYPE;
  entity_revision integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Health records are append-only; append a correction or void record';
  END IF;
  IF NEW."source_entity_id" IS NOT NULL THEN
    SELECT "revision" INTO entity_revision FROM "entities"
    WHERE "entity_id" = NEW."source_entity_id" AND "user_id" = NEW."user_id";
    IF entity_revision IS NULL OR NEW."source_revision" <> entity_revision THEN
      RAISE EXCEPTION 'Health record must reference the current revision of an owned entity';
    END IF;
  END IF;
  IF NEW."supersedes_record_id" IS NOT NULL THEN
    SELECT * INTO previous FROM "health_records" WHERE "id" = NEW."supersedes_record_id" FOR UPDATE;
    IF NOT FOUND OR previous."user_id" <> NEW."user_id"
      OR previous."metric_type" <> NEW."metric_type"
      OR previous."source_entity_id" IS DISTINCT FROM NEW."source_entity_id" THEN
      RAISE EXCEPTION 'Correction must supersede the same owner, metric and source entity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "health_record_log_guard" BEFORE INSERT OR UPDATE OR DELETE ON "health_records"
FOR EACH ROW EXECUTE FUNCTION "protect_health_record_log"();

-- Business-content changes invalidate AI input revisions automatically.
CREATE FUNCTION "advance_entity_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."user_id" <> OLD."user_id" OR NEW."entity_tag_details_id" <> OLD."entity_tag_details_id" THEN
    RAISE EXCEPTION 'Entity ownership and details linkage cannot be reassigned';
  END IF;
  IF ROW(NEW."tag", NEW."entry_date", NEW."occurred_at", NEW."recorded_timezone", NEW."input_source", NEW."entity_attachments", NEW."deleted_at")
    IS DISTINCT FROM ROW(OLD."tag", OLD."entry_date", OLD."occurred_at", OLD."recorded_timezone", OLD."input_source", OLD."entity_attachments", OLD."deleted_at") THEN
    NEW."revision" := GREATEST(NEW."revision", OLD."revision" + 1);
  ELSIF NEW."revision" < OLD."revision" THEN
    RAISE EXCEPTION 'Entity revision cannot decrease';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "entity_revision_guard" BEFORE UPDATE ON "entities"
FOR EACH ROW EXECUTE FUNCTION "advance_entity_revision"();

CREATE FUNCTION "advance_details_entity_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."title", NEW."note", NEW."tag_data") IS DISTINCT FROM ROW(OLD."title", OLD."note", OLD."tag_data") THEN
    UPDATE "entities" SET "revision" = "revision" + 1, "updated_at" = CURRENT_TIMESTAMP
    WHERE "entity_tag_details_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "details_revision_guard" AFTER UPDATE ON "entity_tag_details"
FOR EACH ROW EXECUTE FUNCTION "advance_details_entity_revision"();
