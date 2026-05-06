-- A-INT-11 — Boise pricing sync delta detection (2026-05-05)
--
-- Adds two columns to "Product" so the Boise price-sheet ingestion can skip
-- DB writes for SKUs whose price + metadata haven't changed since the last
-- sync. Without this, every monthly price-list re-import was UPDATE-ing
-- every Product row even when 99% of prices were identical.
--
--   • lastBoiseHash      — sha256(sku|price|uom|category|effectiveDate),
--                          stored after a successful update; subsequent
--                          syncs compare against this and skip if equal.
--   • lastBoiseSyncedAt  — timestamp of the most recent sync that touched
--                          this product (whether by update or initial set).
--
-- Idempotent: ALTER TABLE … ADD COLUMN IF NOT EXISTS. Re-running this
-- script after a partial apply is safe. Run `npx prisma generate` after
-- applying so the client picks up the new fields.
--
-- Companion code:
--   src/lib/integrations/boise-pricing-watcher.ts  (computeBoiseRowHash, syncRowsToProducts)
--   src/app/api/admin/boise/upload-pricing/route.ts (returns sync counts)
--   src/app/api/cron/boise-pricing-sync/route.ts    (logs imported/updated/unchanged)

-- ───────────────────────────────────────────────────────────────────
-- 1. Columns
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "lastBoiseHash" TEXT;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "lastBoiseSyncedAt" TIMESTAMP(3);

-- ───────────────────────────────────────────────────────────────────
-- 2. Index
-- Cheap lookup of "products that have been Boise-synced" for ops dashboards
-- and a fast partial filter when the watcher only wants to consider rows
-- it has previously hashed.
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_product_lastBoiseSyncedAt"
  ON "Product" ("lastBoiseSyncedAt" DESC)
  WHERE "lastBoiseSyncedAt" IS NOT NULL;
