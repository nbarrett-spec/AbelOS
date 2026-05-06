-- A-PERF-4 — HyphenTenant incremental sync watermark (2026-05-05)
--
-- The hyphen-sync cron was importing every order/payment/schedule for
-- every tenant on every run. Hyphen's REST API supports a `modifiedSince`
-- query parameter (already used by the legacy `syncSchedules` path), so
-- we can switch to incremental fetch by tracking the last successful
-- sync per tenant.
--
-- The HyphenTenant model already declares `lastSyncAt DateTime?` in
-- prisma/schema.prisma (existing field used today only as a status read-
-- back). This migration is a defensive idempotent ADD COLUMN IF NOT
-- EXISTS guard so any out-of-band Neon branch that drifted from the
-- prisma model gets the column for free, and the cron's incremental
-- read path never throws "column does not exist".
--
-- Additive only. Safe to apply on a populated DB. Run `npx prisma
-- generate` after if the prisma model is ever re-aligned.

-- ───────────────────────────────────────────────────────────────────
-- Defensive: ensure the watermark column exists (already present on
-- main schema; this is a no-op there)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "HyphenTenant"
  ADD COLUMN IF NOT EXISTS "lastSyncAt" TIMESTAMP(3);

-- ───────────────────────────────────────────────────────────────────
-- Index it — every cron run does WHERE syncEnabled=TRUE then reads
-- lastSyncAt to compute the modifiedSince filter. Cheap to maintain
-- (one row per builder, currently <10 rows) and keeps the lookup
-- index-only.
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_hyphentenant_lastsyncat"
  ON "HyphenTenant" ("lastSyncAt");
