#!/usr/bin/env node
/**
 * Installs the SQL function `recompute_inventory_committed(TEXT DEFAULT NULL)`.
 *
 * This is idempotent (CREATE OR REPLACE). Can be re-run safely.
 *
 * The allocation ledger (InventoryAllocation) is the source of truth for
 * committed / available. This function pushes the current ledger state into
 * InventoryItem.committed and .available so the rest of the platform — MRP
 * projection, sales order availability check, PO dashboard — reads consistent
 * numbers without having to re-derive.
 *
 * Usage:
 *   node scripts/install-allocation-sql.mjs
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SQL_CREATE_FN = `
CREATE OR REPLACE FUNCTION recompute_inventory_committed(product_id_filter TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rows_touched INTEGER := 0;
BEGIN
  WITH alloc AS (
    SELECT "productId", COALESCE(SUM("quantity"), 0)::int AS committed_qty
    FROM "InventoryAllocation"
    WHERE "status" IN ('RESERVED', 'PICKED')
      AND (product_id_filter IS NULL OR "productId" = product_id_filter)
    GROUP BY "productId"
  ),
  upd AS (
    UPDATE "InventoryItem" ii
    SET
      "committed" = COALESCE(a.committed_qty, 0),
      "available" = GREATEST(COALESCE(ii."onHand", 0) - COALESCE(a.committed_qty, 0), 0),
      "updatedAt" = NOW()
    FROM (
      SELECT ii2."productId", COALESCE(a.committed_qty, 0) AS committed_qty
      FROM "InventoryItem" ii2
      LEFT JOIN alloc a ON a."productId" = ii2."productId"
      WHERE product_id_filter IS NULL OR ii2."productId" = product_id_filter
    ) a
    WHERE ii."productId" = a."productId"
    RETURNING ii."productId"
  )
  SELECT COUNT(*) INTO rows_touched FROM upd;
  RETURN rows_touched;
END;
$$;
`.trim()

try {
  console.log('[install] creating recompute_inventory_committed()...')
  await prisma.$executeRawUnsafe(SQL_CREATE_FN)

  // Ensure a unique index on (jobId, productId) for our allocation idempotency
  // (keeps backfill + allocate idempotent via ON CONFLICT). Partial — we allow
  // multiple historic RELEASED rows per (jobId, productId) but at most one
  // active (non-released) row. That way we can release and re-allocate later
  // without losing history.
  console.log('[install] ensuring partial unique idx idx_alloc_active_job_product...')
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_alloc_active_job_product"
       ON "InventoryAllocation" ("jobId", "productId")
       WHERE "status" IN ('RESERVED', 'PICKED', 'BACKORDERED')`
  )

  console.log('[install] ok')
} catch (e) {
  console.error('[install] FAILED:', e?.message || e)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
