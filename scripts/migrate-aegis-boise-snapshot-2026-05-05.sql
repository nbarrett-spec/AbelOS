-- A-PERF-10 — BoiseSpendSnapshot (2026-05-05)
--
-- Pre-computed daily aggregate of Boise Cascade PO spend. The supply-chain /
-- vendor pages were re-running a multi-join SUM across PurchaseOrder +
-- PurchaseOrderItem + Vendor on every page load. This table holds the
-- pre-baked numbers — totalSpend, poCount, itemCount, byCategory map, and
-- a 12-month byMonth series — keyed by (periodStart, periodEnd) so the
-- "30 days", "90 days", and "YTD" windows each get their own row.
--
-- Cron `boise-spend-snapshot` upserts these rows nightly at 4am Central
-- (10 UTC). The read endpoint at /api/ops/vendors/boise/spend serves the
-- latest snapshot per window and falls back to live computation if no
-- snapshot exists yet.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, every index uses IF NOT EXISTS.
-- Re-running this script after a partial apply is safe. Run
-- `npx prisma generate` after applying so the client picks up the new model.

-- ───────────────────────────────────────────────────────────────────
-- 1. Table
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BoiseSpendSnapshot" (
  "id"          TEXT PRIMARY KEY,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd"   TIMESTAMP(3) NOT NULL,
  "totalSpend"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "poCount"     INTEGER NOT NULL DEFAULT 0,
  "itemCount"   INTEGER NOT NULL DEFAULT 0,
  "byCategory"  JSONB NOT NULL DEFAULT '{}'::jsonb,
  "byMonth"     JSONB NOT NULL DEFAULT '[]'::jsonb,
  "computedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────────────
-- 2. Indexes
-- (periodStart, periodEnd) unique — drives the upsert key in the cron.
-- computedAt DESC — cheap "latest snapshot" lookup for the read endpoint.
-- ───────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "BoiseSpendSnapshot_periodStart_periodEnd_key"
  ON "BoiseSpendSnapshot" ("periodStart", "periodEnd");

CREATE INDEX IF NOT EXISTS "BoiseSpendSnapshot_computedAt_idx"
  ON "BoiseSpendSnapshot" ("computedAt" DESC);
