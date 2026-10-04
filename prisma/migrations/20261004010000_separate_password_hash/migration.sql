-- Preserve existing bearer tokens while separating credentials from identity.
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(255);

-- Existing local password accounts stored their scrypt hash in auth_provider_id.
-- Keep that value unchanged so already-issued tokens continue to identify the row.
UPDATE "users"
SET "password_hash" = "auth_provider_id"
WHERE "account_status" = 'member'
  AND "auth_provider_id" LIKE '$scrypt$%';
