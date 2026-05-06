-- A-INT-2: persist Hyphen-scraped schedule + closing date directly on Job
-- Additive nullable columns. Idempotent — safe to re-run.
-- Phase 1 rule: targets prod-phase-1 only; do NOT run against prod-main.

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "closingDate" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "hyphenScheduleSyncedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "idx_job_closing_date" ON "Job" ("closingDate");
