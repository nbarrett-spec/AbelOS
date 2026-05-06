-- A-BIZ-6 — OrderItem backorder queue (2026-05-05)
--
-- Today, when an order can't be fully fulfilled from stock, the shortfall
-- only lives as a BACKORDERED row on InventoryAllocation. The OrderItem
-- itself carries no signal — so the Order detail page, the builder's
-- portal view, and the assigned PM have no way to know "this line is
-- short, expected MM/DD" without walking the allocation ledger.
--
-- This migration adds four columns to OrderItem so each line carries its
-- own backorder state, plus the link to the incoming PO that will fulfill
-- it:
--
--   backorderedQty  — units still owed (0 = clean line)
--   backorderedAt   — when the shortfall was first detected
--   expectedDate    — ETA copied from the fulfilling PO at link time
--   fulfillingPoId  — id of the PurchaseOrder we expect to clear the gap
--
-- All additive, all nullable, safe on a populated prod table. Pairs with
-- prisma/schema.prisma model OrderItem and the new logic in
-- src/lib/allocation/reserve.ts that stamps these fields when reserveForOrder
-- detects a shortage.
--
-- Idempotent: every column add uses IF NOT EXISTS, every index uses
-- IF NOT EXISTS. Re-running this script after a partial apply is safe.
-- No FK on fulfillingPoId — same pattern InventoryAllocation.purchaseOrderId
-- uses elsewhere (loose ref, app-enforced) so a hard PO delete doesn't
-- block migration. Run `npx prisma generate` after applying so the client
-- picks up the new fields.

-- ───────────────────────────────────────────────────────────────────
-- 1. Add columns
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "backorderedQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "backorderedAt" TIMESTAMP(3);

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "expectedDate" TIMESTAMP(3);

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "fulfillingPoId" TEXT;

-- ───────────────────────────────────────────────────────────────────
-- 2. Indexes
-- backorderedAt — drives the /ops/backorders queue ("show me everything
--                 still short, oldest first"). Partial would be tighter
--                 but we keep a plain B-tree for Prisma compatibility.
-- fulfillingPoId — drives "what does this PO unblock?" reverse lookup
--                  when receiving lands.
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_orderitem_backordered"
  ON "OrderItem" ("backorderedAt");

CREATE INDEX IF NOT EXISTS "idx_orderitem_fulfilling_po"
  ON "OrderItem" ("fulfillingPoId");
