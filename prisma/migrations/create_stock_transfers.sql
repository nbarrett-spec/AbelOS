-- =============================================================================
-- create_stock_transfers.sql
--
-- Adds StockTransfer + StockTransferItem tables for inter-location inventory
-- movement tracking.
--
-- Apply with:
--   psql $DATABASE_URL -f prisma/migrations/create_stock_transfers.sql
-- Then regenerate the Prisma client:
--   npx prisma generate
-- =============================================================================

CREATE TABLE IF NOT EXISTS "StockTransfer" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "transferNumber" TEXT NOT NULL,
  "fromLocation"   TEXT NOT NULL,
  "toLocation"     TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "notes"          TEXT,
  "createdById"    TEXT NOT NULL,
  "completedAt"    TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockTransfer_transferNumber_key"
  ON "StockTransfer" ("transferNumber");
CREATE INDEX IF NOT EXISTS "StockTransfer_status_idx"
  ON "StockTransfer" ("status");
CREATE INDEX IF NOT EXISTS "StockTransfer_createdById_idx"
  ON "StockTransfer" ("createdById");

CREATE TABLE IF NOT EXISTS "StockTransferItem" (
  "id"          TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "transferId"  TEXT NOT NULL,
  "productId"   TEXT NOT NULL,
  "sku"         TEXT,
  "productName" TEXT,
  "quantity"    INTEGER NOT NULL,
  "damagedQty"  INTEGER NOT NULL DEFAULT 0,
  "notes"       TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockTransferItem_transferId_fkey"
    FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "StockTransferItem_transferId_idx"
  ON "StockTransferItem" ("transferId");
CREATE INDEX IF NOT EXISTS "StockTransferItem_productId_idx"
  ON "StockTransferItem" ("productId");
