-- A-BIZ-12 — Quote revision tracking (2026-05-05)
--
-- Adds an append-only revision log for Quote edits. Every PATCH on a Quote
-- snapshots the post-update state (header + items) and computes a
-- field-by-field diff against the previous revision. Revision 0 is the
-- Quote row itself (no row written on insert); revision 1 is the first
-- UPDATE; etc.
--
-- Idempotent — safe to apply on a populated DB. Additive only:
--   - Table created with CREATE TABLE IF NOT EXISTS.
--   - Indexes added with CREATE INDEX IF NOT EXISTS.
--   - Unique constraint added with DO-block guard so re-apply is no-op.
--   - No FK to Quote cascading delete here — we keep history even if the
--     Quote is hard-deleted, so use ON DELETE NO ACTION semantics by
--     not declaring the FK at all (mirrors AuditLog convention).
--   - authorStaffId nullable + no FK to Staff so rotated staff don't
--     cascade.

-- ───────────────────────────────────────────────────────────────────
-- Table
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuoteRevision" (
  "id"            TEXT PRIMARY KEY,
  "quoteId"       TEXT NOT NULL,
  "revision"      INTEGER NOT NULL,
  "snapshot"      JSONB NOT NULL,
  "changes"       JSONB,
  "authorStaffId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ───────────────────────────────────────────────────────────────────
-- Constraints — match Prisma @@unique declaration
-- ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'QuoteRevision_quoteId_revision_key'
  ) THEN
    ALTER TABLE "QuoteRevision"
      ADD CONSTRAINT "QuoteRevision_quoteId_revision_key"
      UNIQUE ("quoteId", "revision");
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────
-- Indexes — match @@index() declarations in schema.prisma
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "QuoteRevision_quoteId_createdAt_idx"
  ON "QuoteRevision" ("quoteId", "createdAt" DESC);
