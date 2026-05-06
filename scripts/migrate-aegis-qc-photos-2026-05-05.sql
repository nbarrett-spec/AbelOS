-- B-FEAT-5 — QC photo queue (2026-05-05)
--
-- Adds two tables to support structured QC photo requirements at two stages:
--   POST_MFG  — per door, 2 photos required (DOOR_FULL, DOOR_BORE)
--   DELIVERY  — per load, 5 photos required (TRIM_FULL, TRIM_FRONT,
--               DOORS_FULL, DOORS_SIDE, HARDWARE)
--
-- Idempotent — safe to apply on a populated DB. Additive only:
--   • CREATE TABLE IF NOT EXISTS for both tables.
--   • CREATE INDEX IF NOT EXISTS for QcPhoto lookups.
--   • Seed rows use ON CONFLICT DO NOTHING against the unique (stage, photoType).
--
-- The actual photo bytes live in DocumentVault — QcPhoto.documentVaultId is the
-- pointer. We don't enforce a FK at the DB layer (DocumentVault uses cuid
-- TEXT ids the same way) so this stays compatible with the existing vault
-- bootstrap pattern in /api/ops/documents/vault.

-- ───────────────────────────────────────────────────────────────────
-- QcPhotoRequirement — catalog of required photoTypes per stage
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QcPhotoRequirement" (
  "id"          TEXT PRIMARY KEY,
  "stage"       TEXT NOT NULL,
  "photoType"   TEXT NOT NULL,
  "required"    BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "QcPhotoRequirement_stage_photoType_key"
  ON "QcPhotoRequirement" ("stage", "photoType");

-- ───────────────────────────────────────────────────────────────────
-- QcPhoto — actual upload record, links to DocumentVault
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QcPhoto" (
  "id"              TEXT PRIMARY KEY,
  "jobId"           TEXT,
  "doorIdentityId"  TEXT,
  "deliveryId"      TEXT,
  "stage"           TEXT NOT NULL,
  "photoType"       TEXT NOT NULL,
  "documentVaultId" TEXT,
  "uploadedBy"      TEXT,
  "uploadedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "QcPhoto_jobId_idx"          ON "QcPhoto" ("jobId");
CREATE INDEX IF NOT EXISTS "QcPhoto_deliveryId_idx"     ON "QcPhoto" ("deliveryId");
CREATE INDEX IF NOT EXISTS "QcPhoto_doorIdentityId_idx" ON "QcPhoto" ("doorIdentityId");
CREATE INDEX IF NOT EXISTS "QcPhoto_stage_photoType_idx" ON "QcPhoto" ("stage", "photoType");

-- ───────────────────────────────────────────────────────────────────
-- Seed the 7 required QcPhotoRequirement rows
-- ───────────────────────────────────────────────────────────────────
INSERT INTO "QcPhotoRequirement" ("id", "stage", "photoType", "required", "description")
VALUES
  ('qpr_postmfg_door_full',   'POST_MFG', 'DOOR_FULL',    true, 'Full-door photo after manufacturing — verifies finish, slab, and frame.'),
  ('qpr_postmfg_door_bore',   'POST_MFG', 'DOOR_BORE',    true, 'Close-up of bore prep — verifies bore depth, edge, and lock prep.'),
  ('qpr_delivery_trim_full',  'DELIVERY', 'TRIM_FULL',    true, 'Full-load photo of trim packaging on the truck.'),
  ('qpr_delivery_trim_front', 'DELIVERY', 'TRIM_FRONT',   true, 'Front view of trim bundles — verifies labels and counts.'),
  ('qpr_delivery_doors_full', 'DELIVERY', 'DOORS_FULL',   true, 'Full-load photo of all doors staged on the truck.'),
  ('qpr_delivery_doors_side', 'DELIVERY', 'DOORS_SIDE',   true, 'Side photo of door stack — verifies dunnage and protection.'),
  ('qpr_delivery_hardware',   'DELIVERY', 'HARDWARE',     true, 'Hardware boxes / bins on the truck — verifies kit completeness.')
ON CONFLICT ("stage", "photoType") DO NOTHING;
