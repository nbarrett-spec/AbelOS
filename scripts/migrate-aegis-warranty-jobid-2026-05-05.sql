-- P1 — WarrantyClaim.jobId persistence (2026-05-05)
--
-- The /api/builders/warranty POST endpoint validates a builder-supplied
-- jobId for ownership but never persists it — the WarrantyClaim model
-- had no jobId column, so the link from claim → Job was lost the moment
-- the validator returned.
--
-- This migration adds the column + a B-tree index so ops can query
-- "all claims on Job X" without a table scan. Additive only, idempotent,
-- safe to apply on a populated DB.
--
-- Pairs with prisma/schema.prisma model WarrantyClaim (jobId String?,
-- @@index([jobId], map: "idx_warrantyclaim_jobid")). Run `npx prisma
-- generate` after schema changes so the client picks up the field.

-- ───────────────────────────────────────────────────────────────────
-- Add the jobId column (nullable; existing claims stay untouched)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "WarrantyClaim"
  ADD COLUMN IF NOT EXISTS "jobId" TEXT;

-- ───────────────────────────────────────────────────────────────────
-- Index it — ops dashboard filters by jobId, builder portal may too
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_warrantyclaim_jobid"
  ON "WarrantyClaim" ("jobId");
