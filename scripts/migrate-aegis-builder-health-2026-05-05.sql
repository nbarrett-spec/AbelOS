-- ─────────────────────────────────────────────────────────────────────────────
-- A-BIZ-10: BuilderHealthSnapshot — native in-Aegis builder health signal
-- 2026-05-05 — Additive only. Idempotent (CREATE TABLE IF NOT EXISTS).
--
-- Why: NUC engine produces builder health externally. If NUC is down (which
-- it is — coordinator running, but worker NUCs not yet provisioned) ops has
-- zero visibility into account posture. This table is Aegis-native and is
-- computed nightly by /api/cron/builder-health-score using only data already
-- in this DB (Order, Invoice, Payment, Activity, Quote, Builder.creditLimit /
-- paymentTerm). Same inputs always produce the same score (reproducible).
--
-- Composite score (0-100):
--   ▸ orderFrequency   30%   orders/month over last 6mo
--   ▸ paymentBehavior  30%   avg days-to-pay vs. paymentTerm over last 90d
--   ▸ arBalance        20%   outstanding AR ÷ creditLimit
--   ▸ activityRecency  20%   days since last interaction
--
-- Trend = sign of (currentScore − scoreAt(now − 30d)) clamped at ±5.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BuilderHealthSnapshot" (
  "id"          TEXT PRIMARY KEY,
  "builderId"   TEXT NOT NULL,
  "score"       INTEGER NOT NULL,
  "trend"       TEXT,
  "factors"     JSONB NOT NULL,
  "computedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Latest-snapshot lookup pattern: WHERE builderId = $1 ORDER BY computedAt DESC LIMIT 1
CREATE INDEX IF NOT EXISTS "BuilderHealthSnapshot_builderId_computedAt_idx"
  ON "BuilderHealthSnapshot" ("builderId", "computedAt" DESC);

-- Sanity check (no-op if table didn't change)
COMMENT ON TABLE "BuilderHealthSnapshot" IS
  'A-BIZ-10: Daily Aegis-native builder health composite score. Independent of NUC engine.';
