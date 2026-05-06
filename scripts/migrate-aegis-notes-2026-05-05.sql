-- B-UX-7 — Generic per-entity Note table.
--
-- Timestamped, append-only activity log of notes on Order / Job / Builder /
-- Invoice / PurchaseOrder / Quote / Delivery / etc. Distinct from the
-- existing `notes` text columns on those entities (which remain a single
-- editable summary field).
--
-- Additive + idempotent. Safe to re-apply. No data backfill — the table is
-- empty until the <NotesSection> component starts writing to it.
--
-- Owns: model Note in prisma/schema.prisma. Index names mirror the Prisma
-- defaults so `prisma migrate diff` / `prisma db pull` stay clean.

CREATE TABLE IF NOT EXISTS "Note" (
  "id"            TEXT PRIMARY KEY,
  "entityType"    TEXT NOT NULL,
  "entityId"      TEXT NOT NULL,
  "body"          TEXT NOT NULL,
  "authorStaffId" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- List the most-recent notes for a given entity (the dominant query).
CREATE INDEX IF NOT EXISTS "Note_entityType_entityId_createdAt_idx"
  ON "Note" ("entityType", "entityId", "createdAt" DESC);

-- "Notes I authored" — for staff activity views.
CREATE INDEX IF NOT EXISTS "Note_authorStaffId_idx"
  ON "Note" ("authorStaffId");
