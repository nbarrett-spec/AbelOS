-- A-DATA-1..5 — Soft-delete columns + cascade-rule fixes (2026-05-05)
--
-- Idempotent. Safe to apply on a populated DB. Two parts:
--
-- (1) ADDITIVE — A-DATA-1
--     Adds nullable `deletedAt` + index to: Builder, Order, Quote, Invoice,
--     Job, Product. Also adds nullable `productSnapshot Json` to QuoteItem
--     (A-DATA-3) and OrderItem (A-DATA-4).
--     Existing queries are unchanged. Future code can opt-in to filter
--     `deletedAt IS NULL` and read `productSnapshot` when productId is NULL.
--
-- (2) CASCADE-RULE CHANGES — A-DATA-2, A-DATA-3, A-DATA-4, A-DATA-5
--     DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT pattern. Live data is not
--     touched (no row deletes). Order.builderId becomes NULLABLE.
--
--     Constraint name convention follows Prisma's default: <Table>_<col>_fkey.
--
--     • Order_builderId_fkey       Restrict → SetNull, builderId NULL allowed
--     • QuoteItem_productId_fkey   Restrict → SetNull
--     • OrderItem_productId_fkey   Restrict → SetNull, productId NULL allowed
--     • Takeoff_blueprintId_fkey   Cascade  → Restrict
--
-- Run with `psql $DATABASE_URL -f scripts/migrate-aegis-soft-delete-cascades-2026-05-05.sql`.
-- Then `npx prisma generate`.

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- (1a) Soft-delete columns on six top-level models — A-DATA-1
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Order"   ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Quote"   ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Job"     ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Builder_deletedAt_idx" ON "Builder" ("deletedAt");
CREATE INDEX IF NOT EXISTS "Order_deletedAt_idx"   ON "Order"   ("deletedAt");
CREATE INDEX IF NOT EXISTS "Quote_deletedAt_idx"   ON "Quote"   ("deletedAt");
CREATE INDEX IF NOT EXISTS "Invoice_deletedAt_idx" ON "Invoice" ("deletedAt");
CREATE INDEX IF NOT EXISTS "Job_deletedAt_idx"     ON "Job"     ("deletedAt");
CREATE INDEX IF NOT EXISTS "Product_deletedAt_idx" ON "Product" ("deletedAt");

-- ───────────────────────────────────────────────────────────────────
-- (1b) productSnapshot Json on QuoteItem / OrderItem — A-DATA-3 / A-DATA-4
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "productSnapshot" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "productSnapshot" JSONB;

-- ───────────────────────────────────────────────────────────────────
-- (2a) Order.builderId — A-DATA-2 — drop NOT NULL, swap Restrict→SetNull
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "Order" ALTER COLUMN "builderId" DROP NOT NULL;

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_builderId_fkey";
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────
-- (2b) QuoteItem.productId — A-DATA-3 — Restrict → SetNull
-- (column was already nullable in schema)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "QuoteItem" DROP CONSTRAINT IF EXISTS "QuoteItem_productId_fkey";
ALTER TABLE "QuoteItem"
  ADD CONSTRAINT "QuoteItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────
-- (2c) OrderItem.productId — A-DATA-4 — drop NOT NULL, Restrict→SetNull
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "OrderItem" ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE "OrderItem" DROP CONSTRAINT IF EXISTS "OrderItem_productId_fkey";
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────
-- (2d) Takeoff.blueprintId — A-DATA-5 — Cascade → Restrict
-- Protects the downstream Quote (which has Cascade on takeoffId) from
-- being silently destroyed when a Blueprint is deleted.
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "Takeoff" DROP CONSTRAINT IF EXISTS "Takeoff_blueprintId_fkey";
ALTER TABLE "Takeoff"
  ADD CONSTRAINT "Takeoff_blueprintId_fkey"
  FOREIGN KEY ("blueprintId") REFERENCES "Blueprint"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
