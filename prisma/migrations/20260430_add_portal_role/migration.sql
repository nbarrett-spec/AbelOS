-- Builder Portal — Phase 0.1
-- Add PortalRole enum + BuilderContact.portalRole field.
-- Additive only. Idempotent. Safe to apply on a populated prod table.

DO $$ BEGIN
  CREATE TYPE "PortalRole" AS ENUM ('PM', 'EXECUTIVE', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "BuilderContact"
  ADD COLUMN IF NOT EXISTS "portalRole" "PortalRole" NOT NULL DEFAULT 'PM';

-- Backfill: map existing ContactRole values to a sensible PortalRole default
-- so existing OWNER/DIVISION_VP contacts land at EXECUTIVE on first portal
-- login. Everything else stays PM (the column default).
UPDATE "BuilderContact"
   SET "portalRole" = 'EXECUTIVE'
 WHERE "role" IN ('OWNER', 'DIVISION_VP')
   AND "portalRole" = 'PM';
