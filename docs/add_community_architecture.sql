-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Two-Tier Builder/Community Architecture
--
-- Adds Community, BuilderContact, CommunityFloorPlan, CommunityNote tables
-- and communityId columns to Job, Task, Activity for production builders.
--
-- Safe to run multiple times (all CREATE/ALTER use IF NOT EXISTS guards).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Builder type classification ──────────────────────────────────────

-- Add BuilderType enum
DO $$ BEGIN
  CREATE TYPE "BuilderType" AS ENUM ('PRODUCTION', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to Builder
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "builderType" "BuilderType" DEFAULT 'CUSTOM';
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "territory" TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "annualVolume" INT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "website" TEXT;
CREATE INDEX IF NOT EXISTS "Builder_builderType_idx" ON "Builder" ("builderType");

-- ── 2. Community table ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "CommunityStatus" AS ENUM ('PLANNING', 'ACTIVE', 'WINDING_DOWN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Community" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "builderId"     TEXT NOT NULL REFERENCES "Builder"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "code"          TEXT,
  "address"       TEXT,
  "city"          TEXT,
  "state"         TEXT,
  "zip"           TEXT,
  "county"        TEXT,
  "totalLots"     INT DEFAULT 0,
  "activeLots"    INT DEFAULT 0,
  "phase"         TEXT,
  "status"        "CommunityStatus" DEFAULT 'ACTIVE',
  "division"      TEXT,
  "avgOrderValue" DOUBLE PRECISION,
  "totalRevenue"  DOUBLE PRECISION DEFAULT 0,
  "totalOrders"   INT DEFAULT 0,
  "notes"         TEXT,
  "boltId"        TEXT,
  "createdAt"     TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ DEFAULT NOW()
);

-- Unique: one community name per builder
CREATE UNIQUE INDEX IF NOT EXISTS "Community_builderId_name_key" ON "Community" ("builderId", "name");
CREATE INDEX IF NOT EXISTS "Community_builderId_idx" ON "Community" ("builderId");
CREATE INDEX IF NOT EXISTS "Community_status_idx" ON "Community" ("status");
CREATE INDEX IF NOT EXISTS "Community_city_state_idx" ON "Community" ("city", "state");
CREATE INDEX IF NOT EXISTS "Community_boltId_idx" ON "Community" ("boltId");

-- ── 3. ContactRole enum & BuilderContact table ──────────────────────────

DO $$ BEGIN
  CREATE TYPE "ContactRole" AS ENUM (
    'OWNER', 'DIVISION_VP', 'PURCHASING', 'SUPERINTENDENT',
    'PROJECT_MANAGER', 'ESTIMATOR', 'ACCOUNTS_PAYABLE', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BuilderContact" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "builderId"       TEXT NOT NULL REFERENCES "Builder"("id") ON DELETE CASCADE,
  "communityId"     TEXT REFERENCES "Community"("id") ON DELETE SET NULL,
  "firstName"       TEXT NOT NULL,
  "lastName"        TEXT NOT NULL,
  "email"           TEXT,
  "phone"           TEXT,
  "mobile"          TEXT,
  "title"           TEXT,
  "role"            "ContactRole" DEFAULT 'OTHER',
  "isPrimary"       BOOLEAN DEFAULT false,
  "receivesPO"      BOOLEAN DEFAULT false,
  "receivesInvoice" BOOLEAN DEFAULT false,
  "notes"           TEXT,
  "active"          BOOLEAN DEFAULT true,
  "createdAt"       TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "BuilderContact_builderId_idx" ON "BuilderContact" ("builderId");
CREATE INDEX IF NOT EXISTS "BuilderContact_communityId_idx" ON "BuilderContact" ("communityId");
CREATE INDEX IF NOT EXISTS "BuilderContact_email_idx" ON "BuilderContact" ("email");
CREATE INDEX IF NOT EXISTS "BuilderContact_role_idx" ON "BuilderContact" ("role");

-- ── 4. CommunityFloorPlan table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CommunityFloorPlan" (
  "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "communityId"       TEXT NOT NULL REFERENCES "Community"("id") ON DELETE CASCADE,
  "name"              TEXT NOT NULL,
  "planNumber"        TEXT,
  "sqFootage"         INT,
  "bedrooms"          INT,
  "bathrooms"         DOUBLE PRECISION,
  "stories"           INT DEFAULT 1,
  "garageType"        TEXT,
  "interiorDoorCount" INT,
  "exteriorDoorCount" INT,
  "basePackagePrice"  DOUBLE PRECISION,
  "blueprintUrl"      TEXT,
  "takeoffNotes"      TEXT,
  "active"            BOOLEAN DEFAULT true,
  "createdAt"         TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommunityFloorPlan_communityId_name_key" ON "CommunityFloorPlan" ("communityId", "name");
CREATE INDEX IF NOT EXISTS "CommunityFloorPlan_communityId_idx" ON "CommunityFloorPlan" ("communityId");

-- ── 5. CommunityNote table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CommunityNote" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "communityId" TEXT NOT NULL,
  "authorId"    TEXT NOT NULL,
  "category"    TEXT DEFAULT 'GENERAL',
  "content"     TEXT NOT NULL,
  "pinned"      BOOLEAN DEFAULT false,
  "createdAt"   TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "CommunityNote_communityId_idx" ON "CommunityNote" ("communityId");
CREATE INDEX IF NOT EXISTS "CommunityNote_category_idx" ON "CommunityNote" ("category");

-- ── 6. Add communityId to existing tables ───────────────────────────────

-- Job
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "communityId" TEXT;
CREATE INDEX IF NOT EXISTS "Job_communityId_idx" ON "Job" ("communityId");

-- Task
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "communityId" TEXT;
CREATE INDEX IF NOT EXISTS "Task_communityId_idx" ON "Task" ("communityId");

-- Activity
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "communityId" TEXT;
CREATE INDEX IF NOT EXISTS "Activity_communityId_idx" ON "Activity" ("communityId");

-- CommunicationLog (already raw SQL table)
ALTER TABLE "CommunicationLog" ADD COLUMN IF NOT EXISTS "communityId" TEXT;
CREATE INDEX IF NOT EXISTS "idx_commlog_community" ON "CommunicationLog" ("communityId");

-- ── 7. Migrate existing BoltCommunity data into new Community table ─────
-- Only runs if BoltCommunity table exists; links communities to builders
-- via matching Job.community → Job.builderName → Builder.companyName

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'BoltCommunity') THEN
    INSERT INTO "Community" ("id", "builderId", "name", "city", "state", "boltId", "createdAt")
    SELECT
      bc.id,
      b.id,
      bc.name,
      bc.city,
      bc.state,
      bc."boltId",
      bc."createdAt"
    FROM "BoltCommunity" bc
    CROSS JOIN LATERAL (
      SELECT DISTINCT j."builderName"
      FROM "Job" j
      WHERE j."community" = bc.name
      LIMIT 1
    ) jb
    JOIN "Builder" b ON b."companyName" = jb."builderName"
    WHERE NOT EXISTS (
      SELECT 1 FROM "Community" c WHERE c."builderId" = b.id AND c."name" = bc.name
    )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── Done ────────────────────────────────────────────────────────────────
