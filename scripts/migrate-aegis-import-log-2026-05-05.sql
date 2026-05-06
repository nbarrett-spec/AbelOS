-- B-FEAT-6 / A-API-14 — Bulk Import audit trail (2026-05-05)
--
-- Generic ImportLog table powering /ops/import. Records every bulk
-- import run (file name, row counts, errors, who ran it). Lets us
-- post-mortem a bad upload and see who imported what when something
-- regresses in InventoryItem.onHand or Product.basePrice.
--
-- Idempotent — safe to apply on a populated DB. Additive only:
--   - Table created with CREATE TABLE IF NOT EXISTS.
--   - Indexes added with CREATE INDEX IF NOT EXISTS.
--   - No FK to Staff (staffId is nullable, mirrors AuditLog convention)
--     so rotated/deleted staff don't cascade.

-- ───────────────────────────────────────────────────────────────────
-- Table
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ImportLog" (
  "id"          TEXT PRIMARY KEY,
  "importType"  TEXT NOT NULL,
  "fileName"    TEXT NOT NULL,
  "rowsTotal"   INTEGER NOT NULL DEFAULT 0,
  "rowsCreated" INTEGER NOT NULL DEFAULT 0,
  "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
  "rowsErrored" INTEGER NOT NULL DEFAULT 0,
  "errors"      JSONB   NOT NULL DEFAULT '[]'::jsonb,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ───────────────────────────────────────────────────────────────────
-- Indexes — match @@index() declarations in schema.prisma
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "ImportLog_importType_idx"
  ON "ImportLog" ("importType");

CREATE INDEX IF NOT EXISTS "ImportLog_createdAt_idx"
  ON "ImportLog" ("createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ImportLog_createdById_idx"
  ON "ImportLog" ("createdById");
