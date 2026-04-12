export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/ops/auth/run-migrations
 * Runs all pending database migrations (v8, v9, v10, manufacturing)
 * TEMPORARY — delete after running
 */
export async function POST(request: NextRequest) {
  // SECURITY: Check authentication first
  const authCheck = checkStaffAuth(request)
  if (authCheck) return authCheck

  // SECURITY: Only ADMIN can run migrations
  const staffRole = request.headers.get('x-staff-role')
  if (staffRole !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { seedKey } = body
    if (seedKey !== 'abel-lumber-seed-2024') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results: { step: string; status: string; error?: string }[] = []

    const runStep = async (name: string, sql: string) => {
      try {
        await prisma.$executeRawUnsafe(sql)
        results.push({ step: name, status: 'OK' })
      } catch (e: any) {
        results.push({ step: name, status: 'ERROR', error: e.message?.slice(0, 300) })
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // MIGRATION V8: Password Reset + StaffRoles + Cleanup
    // ═══════════════════════════════════════════════════════════════════

    await runStep('v8: Builder resetToken columns', `
      ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
    `)
    await runStep('v8: Builder resetTokenExpiry', `
      ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);
    `)
    await runStep('v8: Builder_resetToken_idx', `
      CREATE INDEX IF NOT EXISTS "Builder_resetToken_idx" ON "Builder" ("resetToken") WHERE "resetToken" IS NOT NULL
    `)
    await runStep('v8: Staff resetToken columns', `
      ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "resetToken" TEXT;
    `)
    await runStep('v8: Staff resetTokenExpiry', `
      ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);
    `)
    await runStep('v8: Staff_resetToken_idx', `
      CREATE INDEX IF NOT EXISTS "Staff_resetToken_idx" ON "Staff" ("resetToken") WHERE "resetToken" IS NOT NULL
    `)
    await runStep('v8: StaffRoles table', `
      CREATE TABLE IF NOT EXISTS "StaffRoles" (
        "id" TEXT NOT NULL,
        "staffId" TEXT NOT NULL REFERENCES "Staff"("id") ON DELETE CASCADE,
        "role" "StaffRole" NOT NULL,
        "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "StaffRoles_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "StaffRoles_staffId_role_key" UNIQUE ("staffId", "role")
      )
    `)
    await runStep('v8: StaffRoles_staffId_idx', `
      CREATE INDEX IF NOT EXISTS "StaffRoles_staffId_idx" ON "StaffRoles" ("staffId")
    `)
    await runStep('v8: Backfill StaffRoles', `
      INSERT INTO "StaffRoles" ("id", "staffId", "role", "assignedAt")
      SELECT gen_random_uuid()::text, s."id", s."role", COALESCE(s."createdAt", NOW())
      FROM "Staff" s
      WHERE NOT EXISTS (
        SELECT 1 FROM "StaffRoles" sr WHERE sr."staffId" = s."id" AND sr."role" = s."role"
      )
    `)
    await runStep('v8: Remove demo builder', `
      DELETE FROM "Builder" WHERE email = 'demo@abelbuilder.com'
    `)
    await runStep('v8: Remove demo homeowner', `
      DELETE FROM "HomeownerAccess" WHERE "accessToken" = 'demo-homeowner-2026'
    `)

    // ═══════════════════════════════════════════════════════════════════
    // MIGRATION V9: Performance Indexes
    // ═══════════════════════════════════════════════════════════════════

    const v9Indexes = [
      ['Builder_createdAt_idx', '"Builder" ("createdAt")'],
      ['Staff_createdAt_idx', '"Staff" ("createdAt")'],
      ['Project_createdAt_idx', '"Project" ("createdAt")'],
      ['Blueprint_processingStatus_idx', '"Blueprint" ("processingStatus")'],
      ['Takeoff_blueprintId_idx', '"Takeoff" ("blueprintId")'],
      ['Quote_status_idx', '"Quote" ("status")'],
      ['Quote_validUntil_idx', '"Quote" ("validUntil")'],
      ['Order_paymentStatus_idx', '"Order" ("paymentStatus")'],
      ['Order_createdAt_idx', '"Order" ("createdAt")'],
      ['Job_orderId_idx', '"Job" ("orderId")'],
      ['Job_projectId_idx', '"Job" ("projectId")'],
      ['Task_creatorId_idx', '"Task" ("creatorId")'],
      ['Task_category_idx', '"Task" ("category")'],
      ['Task_createdAt_idx', '"Task" ("createdAt")'],
      ['ScheduleEntry_jobId_idx', '"ScheduleEntry" ("jobId")'],
      ['ScheduleEntry_crewId_idx', '"ScheduleEntry" ("crewId")'],
      ['ScheduleEntry_entryType_idx', '"ScheduleEntry" ("entryType")'],
      ['Delivery_crewId_idx', '"Delivery" ("crewId")'],
      ['Delivery_createdAt_idx', '"Delivery" ("createdAt")'],
      ['Installation_crewId_idx', '"Installation" ("crewId")'],
      ['Installation_createdAt_idx', '"Installation" ("createdAt")'],
      ['Vendor_active_idx', '"Vendor" ("active")'],
      ['PurchaseOrder_createdById_idx', '"PurchaseOrder" ("createdById")'],
      ['PurchaseOrder_createdAt_idx', '"PurchaseOrder" ("createdAt")'],
      ['InventoryItem_warehouseZone_idx', '"InventoryItem" ("warehouseZone")'],
      ['InventoryItem_lastCountedAt_idx', '"InventoryItem" ("lastCountedAt")'],
      ['Invoice_orderId_idx', '"Invoice" ("orderId")'],
      ['Invoice_issuedAt_idx', '"Invoice" ("issuedAt")'],
      ['Invoice_createdById_idx', '"Invoice" ("createdById")'],
      ['Message_createdAt_idx', '"Message" ("createdAt")'],
      ['Conversation_createdAt_idx', '"Conversation" ("createdAt")'],
      ['Deal_createdAt_idx', '"Deal" ("createdAt")'],
      ['Deal_source_idx', '"Deal" ("source")'],
      ['Contract_builderId_idx', '"Contract" ("builderId")'],
      ['Contract_startDate_idx', '"Contract" ("startDate")'],
      ['DocumentRequest_dueDate_idx', '"DocumentRequest" ("dueDate")'],
      ['CollectionAction_createdAt_idx', '"CollectionAction" ("createdAt")'],
      ['Product_lastSyncedAt_idx', '"Product" ("lastSyncedAt")'],
      ['MaterialPick_productId_idx', '"MaterialPick" ("productId")'],
      ['MaterialPick_createdAt_idx', '"MaterialPick" ("createdAt")'],
      ['Activity_createdAt_idx', '"Activity" ("createdAt")'],
      ['DecisionNote_authorId_idx', '"DecisionNote" ("authorId")'],
      ['DecisionNote_priority_idx', '"DecisionNote" ("priority")'],
      ['DecisionNote_createdAt_idx', '"DecisionNote" ("createdAt")'],
    ]

    for (const [name, def] of v9Indexes) {
      await runStep(`v9: ${name}`, `CREATE INDEX IF NOT EXISTS "${name}" ON ${def}`)
    }

    // ═══════════════════════════════════════════════════════════════════
    // MIGRATION V10: SubcontractorPricing + Crew Fields
    // ═══════════════════════════════════════════════════════════════════

    await runStep('v10: SubcontractorPricing table', `
      CREATE TABLE IF NOT EXISTS "SubcontractorPricing" (
        "id" TEXT NOT NULL,
        "crewId" TEXT NOT NULL REFERENCES "Crew"("id") ON DELETE CASCADE,
        "builderId" TEXT REFERENCES "Builder"("id") ON DELETE SET NULL,
        "pricePerDoor" FLOAT NOT NULL DEFAULT 0,
        "pricePerHardwareSet" FLOAT NOT NULL DEFAULT 0,
        "pricePerTrimPiece" FLOAT NOT NULL DEFAULT 0,
        "pricePerWindow" FLOAT NOT NULL DEFAULT 0,
        "flatRatePerUnit" FLOAT,
        "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expiresAt" TIMESTAMP(3),
        "notes" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SubcontractorPricing_pkey" PRIMARY KEY ("id")
      )
    `)
    await runStep('v10: SubcontractorPricing_crewId_idx', `
      CREATE INDEX IF NOT EXISTS "SubcontractorPricing_crewId_idx" ON "SubcontractorPricing" ("crewId")
    `)
    await runStep('v10: SubcontractorPricing_builderId_idx', `
      CREATE INDEX IF NOT EXISTS "SubcontractorPricing_builderId_idx" ON "SubcontractorPricing" ("builderId")
    `)
    await runStep('v10: SubcontractorPricing_effectiveDate_idx', `
      CREATE INDEX IF NOT EXISTS "SubcontractorPricing_effectiveDate_idx" ON "SubcontractorPricing" ("effectiveDate")
    `)
    await runStep('v10: Crew isSubcontractor', `
      ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "isSubcontractor" BOOLEAN NOT NULL DEFAULT false
    `)
    await runStep('v10: Crew companyName', `
      ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "companyName" TEXT
    `)
    await runStep('v10: Crew contactPhone', `
      ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT
    `)
    await runStep('v10: Crew contactEmail', `
      ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT
    `)
    await runStep('v10: SubcontractorPricing pricePerSqFt', `
      ALTER TABLE "SubcontractorPricing" ADD COLUMN IF NOT EXISTS "pricePerSqFt" FLOAT NOT NULL DEFAULT 0
    `)
    await runStep('v10: SubcontractorPricing pricingType', `
      ALTER TABLE "SubcontractorPricing" ADD COLUMN IF NOT EXISTS "pricingType" TEXT NOT NULL DEFAULT 'PER_SQFT'
    `)
    await runStep('v10: Crew_isSubcontractor_idx', `
      CREATE INDEX IF NOT EXISTS "Crew_isSubcontractor_idx" ON "Crew" ("isSubcontractor") WHERE "isSubcontractor" = true
    `)
    await runStep('v10: SubcontractorPricing_crewId_builderId_idx', `
      CREATE INDEX IF NOT EXISTS "SubcontractorPricing_crewId_builderId_idx" ON "SubcontractorPricing" ("crewId", "builderId")
    `)

    // ═══════════════════════════════════════════════════════════════════
    // MANUFACTURING MIGRATION: InventoryAllocation + bom_cost()
    // ═══════════════════════════════════════════════════════════════════

    await runStep('mfg: InventoryAllocation table', `
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
    await runStep('mfg: InventoryAllocation_productId_idx', `
      CREATE INDEX IF NOT EXISTS "InventoryAllocation_productId_idx" ON "InventoryAllocation" ("productId")
    `)
    await runStep('mfg: InventoryAllocation_jobId_idx', `
      CREATE INDEX IF NOT EXISTS "InventoryAllocation_jobId_idx" ON "InventoryAllocation" ("jobId")
    `)
    await runStep('mfg: InventoryAllocation_orderId_idx', `
      CREATE INDEX IF NOT EXISTS "InventoryAllocation_orderId_idx" ON "InventoryAllocation" ("orderId")
    `)
    await runStep('mfg: InventoryAllocation_status_idx', `
      CREATE INDEX IF NOT EXISTS "InventoryAllocation_status_idx" ON "InventoryAllocation" ("status")
    `)
    await runStep('mfg: MaterialPick pickedById', `
      ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "pickedById" TEXT
    `)
    await runStep('mfg: MaterialPick verifiedById', `
      ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "verifiedById" TEXT
    `)
    await runStep('mfg: MaterialPick orderItemId', `
      ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "orderItemId" TEXT
    `)
    await runStep('mfg: MaterialPick bomEntryId', `
      ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "bomEntryId" TEXT
    `)
    await runStep('mfg: MaterialPick parentProductId', `
      ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "parentProductId" TEXT
    `)
    await runStep('mfg: MaterialPick allocationId', `
      ALTER TABLE "MaterialPick" ADD COLUMN IF NOT EXISTS "allocationId" TEXT
    `)
    await runStep('mfg: BomEntry unique parent+component', `
      CREATE UNIQUE INDEX IF NOT EXISTS "BomEntry_parentId_componentId_key" ON "BomEntry" ("parentId", "componentId")
    `)
    await runStep('mfg: Job qcRequired', `
      ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "qcRequired" BOOLEAN DEFAULT true
    `)
    await runStep('mfg: Job allMaterialsAllocated', `
      ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "allMaterialsAllocated" BOOLEAN DEFAULT false
    `)
    await runStep('mfg: Job pickListGenerated', `
      ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "pickListGenerated" BOOLEAN DEFAULT false
    `)
    await runStep('mfg: Job buildSheetNotes', `
      ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "buildSheetNotes" TEXT
    `)
    await runStep('mfg: QualityCheck materialPickId', `
      ALTER TABLE "QualityCheck" ADD COLUMN IF NOT EXISTS "materialPickId" TEXT
    `)
    await runStep('mfg: InventoryItem minStockLevel', `
      ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "minStockLevel" INT DEFAULT 0
    `)
    await runStep('mfg: PurchaseOrderItem jobId', `
      ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "jobId" TEXT
    `)
    await runStep('mfg: PurchaseOrderItem_jobId_idx', `
      CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_jobId_idx" ON "PurchaseOrderItem" ("jobId")
    `)
    await runStep('mfg: PurchaseOrderItem_productId_idx', `
      CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem" ("productId")
    `)
    await runStep('mfg: Product laborCost', `
      ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "laborCost" FLOAT DEFAULT 0
    `)
    await runStep('mfg: Product overheadCost', `
      ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "overheadCost" FLOAT DEFAULT 0
    `)

    // ── bom_cost() function — critical for all cost dashboards ──
    await runStep('mfg: Create bom_cost function', `
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

    await runStep('mfg: Backfill laborCost', `
      UPDATE "Product" p
      SET "laborCost" = GREATEST(p.cost - COALESCE(bom.comp_cost, 0), 0)
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

    // ═══════════════════════════════════════════════════════════════════
    // MIGRATION V12: Backfill NULL paymentStatus on Orders
    // ═══════════════════════════════════════════════════════════════════
    // Prisma sets @default(PENDING) at ORM level but raw SQL inserts
    // left paymentStatus as NULL. This breaks dashboard raw SQL queries.

    await runStep('v12: Set DB default for Order.paymentStatus', `
      ALTER TABLE "Order" ALTER COLUMN "paymentStatus" SET DEFAULT 'PENDING'::"PaymentStatus"
    `)

    await runStep('v12: Backfill NULL paymentStatus to PENDING', `
      UPDATE "Order" SET "paymentStatus" = 'PENDING'::"PaymentStatus" WHERE "paymentStatus" IS NULL
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
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
