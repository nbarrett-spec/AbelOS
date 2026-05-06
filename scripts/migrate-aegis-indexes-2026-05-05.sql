-- A-DATA-6 / 7 / 8 / 9 / 10 — missing indexes on common filter+sort fields.
-- Composite indexes added on the Order/Job/Delivery/Invoice list endpoints
-- where queries filter by status and sort by date.
--
-- Builder.status was already indexed in schema.prisma (no-op here).
--
-- Idempotent — safe to apply on prod-main. Pure additive (CREATE INDEX
-- IF NOT EXISTS), no schema changes, no data writes. Concurrent index
-- builds are NOT used here because Prisma's expected names must match
-- exactly; switch to CREATE INDEX CONCURRENTLY in a follow-up if the
-- locks become an issue at scale.
--
-- Index names mirror the `map: "..."` values in schema.prisma so
-- `prisma db pull` and `prisma migrate diff` stay clean.

-- ───────────────────────────────────────────────────────────────────
-- Order: list views filter by status and sort by createdAt DESC
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_order_status_created"
  ON "Order" ("status", "createdAt" DESC);

-- ───────────────────────────────────────────────────────────────────
-- Job: schedule board filters by status + scheduledDate window
-- (Job has no `phase` column — JobStatus is the workflow enum.)
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_job_status_scheduled"
  ON "Job" ("status", "scheduledDate");

-- ───────────────────────────────────────────────────────────────────
-- Delivery: dispatch board filters by status + recency
-- (Delivery has no `scheduledDate` field — only `createdAt`,
--  `departedAt`, `arrivedAt`, `completedAt`. createdAt is the only
--  always-present sort key, so we pair it with status.)
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_delivery_status_created"
  ON "Delivery" ("status", "createdAt" DESC);

-- ───────────────────────────────────────────────────────────────────
-- Invoice: AR aging filters by status and sorts by dueDate
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_invoice_status_due"
  ON "Invoice" ("status", "dueDate");
