-- ============================================================
-- Migration V3: Division Entity & Org Hierarchy Restructure
-- Adds Division level between Organization and Community
-- Hierarchy: Organization → Division → Community → FloorPlan
-- Builder becomes a Contact linked to Org + optional Division
-- ============================================================

-- ============================================================
-- Division Table
-- ============================================================
CREATE TABLE IF NOT EXISTS "Division" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "region" TEXT,
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,

  -- Override org-level defaults
  "defaultPaymentTerm" "PaymentTerm",
  "creditLimit" DOUBLE PRECISION,
  "taxExempt" BOOLEAN,
  "taxId" TEXT,

  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Division_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Division_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "BuilderOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Division_orgId_name_key" ON "Division"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "Division_organizationId_idx" ON "Division"("organizationId");
CREATE INDEX IF NOT EXISTS "Division_region_idx" ON "Division"("region");

-- ============================================================
-- Add divisionId to Community (optional — allows communities
-- to be linked at org or division level)
-- ============================================================
ALTER TABLE "Community" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Community" ADD CONSTRAINT "Community_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Community_divisionId_idx" ON "Community"("divisionId");

-- ============================================================
-- Add divisionId to Builder (optional — allows contacts to be
-- scoped to a specific division within an org)
-- ============================================================
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Builder" ADD CONSTRAINT "Builder_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Builder_divisionId_idx" ON "Builder"("divisionId");

-- ============================================================
-- Add divisionId to Job (optional — inherit from community
-- or set directly for division-level job tracking)
-- ============================================================
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Job_divisionId_idx" ON "Job"("divisionId");

-- ============================================================
-- Add divisionId to Contract (optional — division-level
-- pricing agreements vs org-wide contracts)
-- ============================================================
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Contract" ADD CONSTRAINT "Contract_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Contract_divisionId_idx" ON "Contract"("divisionId");
