export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/migrate-manufacturing
 * Manufacturing system rebuild — InventoryAllocation table + indexes
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_MANUFACTURING', 'Database', undefined, { migration: 'RUN_MIGRATE_MANUFACTURING' }, 'CRITICAL').catch(() => {})

  const results: { step: string; status: string; error?: string }[] = []

  async function runStep(name: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step: name, status: 'OK' })
    } catch (e: any) {
      results.push({ step: name, status: 'ERROR', error: e.message?.slice(0, 200) })
    }
  }

  // ── 1. InventoryAllocation table ──────────────────────────────────────
  await runStep('InventoryAllocation table', `
    CREATE TABLE IF NOT EXISTS "InventoryAllocation" (
      "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "productId" TEXT NOT NULL,
      "orderId" TEXT,
      "jobId" TEXT,
      "orderItemId" TEXT,
      "quantity" INT NOT NULL DEFAULT 0,
      "allocationType" TEXT NOT NULL DEFAULT 'SOFT',
      "status" TEXT NOT NULL DEFAULT 'RESERVED',
      "allocatedBy" TEXT,
      "notes" TEXT,
      "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "releasedAt" TIMESTAMP(3),
      "fulfilledAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "InventoryAllocation_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('InventoryAllocation idx_productId', `
    CREATE INDEX IF NOT EXISTS "InventoryAllocation_productId_idx" ON "InventoryAllocation" ("productId")
  `)

  await runStep('InventoryAllocation idx_jobId', `
    CREATE INDEX IF NOT EXISTS "InventoryAllocation_jobId_idx" ON "InventoryAllocation" ("jobId")
  `)

  await runStep('InventoryAllocation idx_orderId', `
    CREATE INDEX IF NOT EXISTS "InventoryAllocation_orderId_idx" ON "InventoryAllocation" ("orderId")
  `)

  await runStep('InventoryAllocation idx_status', `
    CREATE INDEX IF NOT EXISTS "InventoryAllocation_status_idx" ON "InventoryAllocation" ("status")
  `)

  // ── 2. Add pickedById to MaterialPick for traceability ────────────────
  await runStep('MaterialPick add pickedById', `
    ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "pickedById" TEXT
  `)

  await runStep('MaterialPick add verifiedById', `
    ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "verifiedById" TEXT
  `)

  await runStep('MaterialPick add orderItemId', `
    ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT
  `)

  await runStep('MaterialPick add bomEntryId', `
    ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "bomEntryId" TEXT
  `)

  await runStep('MaterialPick add parentProductId', `
    ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "parentProductId" TEXT
  `)

  await runStep('MaterialPick add allocationId', `
    ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "allocationId" TEXT
  `)

  // ── 3. Add componentType uniqueness hint to BomEntry ──────────────────
  await runStep('BomEntry idx_parent_component', `
    CREATE UNIQUE INDEX IF NOT EXISTS "BomEntry_parentId_componentId_key"
    ON "BomEntry" ("parentId", "componentId")
  `)

  // ── 4. Add qcRequired flag to Job for gate enforcement ────────────────
  await runStep('Job add qcRequired', `
    ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "qcRequired" BOOLEAN DEFAULT true
  `)

  await runStep('Job add allMaterialsAllocated', `
    ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "allMaterialsAllocated" BOOLEAN DEFAULT false
  `)

  await runStep('Job add pickListGenerated', `
    ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "pickListGenerated" BOOLEAN DEFAULT false
  `)

  await runStep('Job add buildSheetNotes', `
    ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "buildSheetNotes" TEXT
  `)

  // ── 5. Add QualityCheck linkage to MaterialPick ───────────────────────
  await runStep('QualityCheck add materialPickId', `
    ALTER TABLE "QualityCheck" ADD COLUMN IF NOT EXISTS "materialPickId" TEXT
  `)

  // ── 6. Add InventoryItem reorder fields if missing ────────────────────
  await runStep('InventoryItem add minStockLevel', `
    ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "minStockLevel" INT DEFAULT 0
  `)

  // ── 7. Add PurchaseOrderItem jobId for job-linked POs ─────────────────
  await runStep('PurchaseOrderItem add jobId', `
    ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "jobId" TEXT
  `)

  await runStep('PurchaseOrderItem idx_jobId', `
    CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_jobId_idx" ON "PurchaseOrderItem" ("jobId")
  `)

  await runStep('PurchaseOrderItem idx_productId', `
    CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem" ("productId")
  `)

  // ── 8. Add laborCost and overheadCost to Product for BOM cost rollup ──
  await runStep('Product add laborCost', `
    ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "laborCost" FLOAT DEFAULT 0
  `)

  await runStep('Product add overheadCost', `
    ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "overheadCost" FLOAT DEFAULT 0
  `)

  // ── 9. Create bom_cost() function for dynamic cost calculation ────────
  await runStep('Create bom_cost function', `
    CREATE OR REPLACE FUNCTION bom_cost(pid TEXT)
    RETURNS FLOAT AS $$
    DECLARE
      comp_cost FLOAT;
      labor FLOAT;
      overhead FLOAT;
      has_bom BOOLEAN;
    BEGIN
      SELECT EXISTS(SELECT 1 FROM "BomEntry" WHERE "parentId" = pid) INTO has_bom;
      IF NOT has_bom THEN
        RETURN NULL;
      END IF;
      SELECT COALESCE(SUM(cp.cost * be.quantity), 0)
      INTO comp_cost
      FROM "BomEntry" be
      JOIN "Product" cp ON be."componentId" = cp.id
      WHERE be."parentId" = pid;
      SELECT COALESCE(p."laborCost", 0), COALESCE(p."overheadCost", 0)
      INTO labor, overhead
      FROM "Product" p WHERE p.id = pid;
      RETURN comp_cost + labor + overhead;
    END;
    $$ LANGUAGE plpgsql STABLE
  `)

  // ── 10. Backfill laborCost from stored cost vs component cost gap ──────
  await runStep('Backfill laborCost from cost gap', `
    UPDATE "Product" p
    SET "laborCost" = GREATEST(
      p.cost - COALESCE(bom.comp_cost, 0),
      0
    )
    FROM (
      SELECT be."parentId", SUM(cp.cost * be.quantity) as comp_cost
      FROM "BomEntry" be
      JOIN "Product" cp ON be."componentId" = cp.id
      GROUP BY be."parentId"
    ) bom
    WHERE bom."parentId" = p.id
      AND COALESCE(p."laborCost", 0) = 0
      AND p.cost > 0
      AND p.cost > COALESCE(bom.comp_cost, 0)
  `)

  const hasErrors = results.some(r => r.status === 'ERROR')

  return NextResponse.json({
    success: !hasErrors,
    results,
    summary: {
      total: results.length,
      ok: results.filter(r => r.status === 'OK').length,
      errors: results.filter(r => r.status === 'ERROR').length,
    },
  })
}
