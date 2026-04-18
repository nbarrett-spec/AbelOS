-- ============================================================================
-- Job Phase System Migration
-- Customizable billing phases per builder, tracked per job
-- ============================================================================

-- ── Enums ──────────────────────────────────────────────────────────────────

-- Phase amount type: how the phase's dollar value is determined
CREATE TYPE "PhaseAmountType" AS ENUM ('PERCENTAGE', 'FIXED', 'MILESTONE');

-- Phase status: lifecycle of a phase on a specific job
CREATE TYPE "PhaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'READY', 'INVOICED', 'PAID', 'SKIPPED');


-- ── Tables ─────────────────────────────────────────────────────────────────

-- Default phase templates — ops defines these per builder type
CREATE TABLE "JobPhaseTemplate" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "builderType" "BuilderType" NOT NULL,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "amountType"  "PhaseAmountType" NOT NULL DEFAULT 'MILESTONE',
  "percentage"  DOUBLE PRECISION,
  "fixedAmount" DOUBLE PRECISION,
  "isDefault"   BOOLEAN NOT NULL DEFAULT true,
  "isRequired"  BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobPhaseTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobPhaseTemplate_builderType_name_key" ON "JobPhaseTemplate"("builderType", "name");
CREATE INDEX "JobPhaseTemplate_builderType_idx" ON "JobPhaseTemplate"("builderType");
CREATE INDEX "JobPhaseTemplate_sortOrder_idx" ON "JobPhaseTemplate"("sortOrder");


-- Per-builder phase customization
CREATE TABLE "BuilderPhaseConfig" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "builderId"   TEXT NOT NULL,
  "templateId"  TEXT,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "amountType"  "PhaseAmountType" NOT NULL DEFAULT 'MILESTONE',
  "percentage"  DOUBLE PRECISION,
  "fixedAmount" DOUBLE PRECISION,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "isRequired"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BuilderPhaseConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BuilderPhaseConfig_builderId_name_key" ON "BuilderPhaseConfig"("builderId", "name");
CREATE INDEX "BuilderPhaseConfig_builderId_idx" ON "BuilderPhaseConfig"("builderId");
CREATE INDEX "BuilderPhaseConfig_templateId_idx" ON "BuilderPhaseConfig"("templateId");

ALTER TABLE "BuilderPhaseConfig"
  ADD CONSTRAINT "BuilderPhaseConfig_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BuilderPhaseConfig"
  ADD CONSTRAINT "BuilderPhaseConfig_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "JobPhaseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Actual phase instance on a specific job
CREATE TABLE "JobPhase" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"          TEXT NOT NULL,
  "templateId"     TEXT,
  "configId"       TEXT,
  "name"           TEXT NOT NULL,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "status"         "PhaseStatus" NOT NULL DEFAULT 'PENDING',
  "amountType"     "PhaseAmountType" NOT NULL DEFAULT 'MILESTONE',
  "percentage"     DOUBLE PRECISION,
  "expectedAmount" DOUBLE PRECISION,
  "actualAmount"   DOUBLE PRECISION,
  "invoiceId"      TEXT,
  "startedAt"      TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "invoicedAt"     TIMESTAMP(3),
  "skippedAt"      TIMESTAMP(3),
  "skippedBy"      TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobPhase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobPhase_jobId_name_key" ON "JobPhase"("jobId", "name");
CREATE INDEX "JobPhase_jobId_idx" ON "JobPhase"("jobId");
CREATE INDEX "JobPhase_status_idx" ON "JobPhase"("status");
CREATE INDEX "JobPhase_invoiceId_idx" ON "JobPhase"("invoiceId");
CREATE INDEX "JobPhase_templateId_idx" ON "JobPhase"("templateId");
CREATE INDEX "JobPhase_configId_idx" ON "JobPhase"("configId");

ALTER TABLE "JobPhase"
  ADD CONSTRAINT "JobPhase_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobPhase"
  ADD CONSTRAINT "JobPhase_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "JobPhaseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobPhase"
  ADD CONSTRAINT "JobPhase_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "BuilderPhaseConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Seed default templates ─────────────────────────────────────────────────
-- Production builders (Toll-style 5-phase)
INSERT INTO "JobPhaseTemplate" ("id", "name", "description", "builderType", "sortOrder", "amountType", "percentage", "isDefault", "isRequired") VALUES
  (gen_random_uuid()::text, 'Exterior',          'Exterior doors and frames',        'PRODUCTION', 1, 'PERCENTAGE', 30.0,  true, true),
  (gen_random_uuid()::text, 'Interior Trim 1',   'First interior trim package',      'PRODUCTION', 2, 'PERCENTAGE', 25.0,  true, false),
  (gen_random_uuid()::text, 'Interior Labor',    'Interior installation labor',      'PRODUCTION', 3, 'PERCENTAGE', 20.0,  true, false),
  (gen_random_uuid()::text, 'Interior Trim 2',   'Second interior trim package',     'PRODUCTION', 4, 'PERCENTAGE', 15.0,  true, false),
  (gen_random_uuid()::text, 'Final Front',       'Final front door and hardware',    'PRODUCTION', 5, 'PERCENTAGE', 10.0,  true, true);

-- Custom builders (simple 2-phase)
INSERT INTO "JobPhaseTemplate" ("id", "name", "description", "builderType", "sortOrder", "amountType", "percentage", "isDefault", "isRequired") VALUES
  (gen_random_uuid()::text, 'Materials',         'All materials delivery',           'CUSTOM', 1, 'PERCENTAGE', 70.0, true, true),
  (gen_random_uuid()::text, 'Final / Punch',     'Final delivery and punch items',   'CUSTOM', 2, 'PERCENTAGE', 30.0, true, true);
