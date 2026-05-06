-- A-BIZ-9 — PriceChangeRequest table (2026-05-05)
--
-- Cost-change detector + auto-adjust review queue. When Product.cost
-- moves materially (>2% by default), a PriceChangeRequest row is
-- created with a suggested basePrice that preserves a target margin
-- (Product.minMargin if set, else 30%). Sales lead reviews + approves
-- before the price actually changes. Reject keeps the old price.
--
-- Additive only, idempotent. Safe to apply on a populated DB.
--
-- Pairs with prisma/schema.prisma model PriceChangeRequest. Run
-- `npx prisma generate` after schema changes so the client picks up
-- the new model.

-- ───────────────────────────────────────────────────────────────────
-- The review-queue table
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PriceChangeRequest" (
  "id"             TEXT PRIMARY KEY,
  "productId"      TEXT NOT NULL,
  "oldCost"        DOUBLE PRECISION NOT NULL,
  "newCost"        DOUBLE PRECISION NOT NULL,
  "oldPrice"       DOUBLE PRECISION NOT NULL,
  "suggestedPrice" DOUBLE PRECISION NOT NULL,
  "marginPct"      DOUBLE PRECISION NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "triggerSource"  TEXT,
  "reviewerId"     TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Find every change for a given product (audit trail per SKU).
CREATE INDEX IF NOT EXISTS "PriceChangeRequest_productId_idx"
  ON "PriceChangeRequest" ("productId");

-- The dominant query: PENDING queue, newest first.
CREATE INDEX IF NOT EXISTS "PriceChangeRequest_status_createdAt_idx"
  ON "PriceChangeRequest" ("status", "createdAt" DESC);
