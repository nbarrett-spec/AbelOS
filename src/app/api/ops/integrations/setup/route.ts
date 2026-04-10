export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';

// POST /api/ops/integrations/setup — Add new integration providers & tables
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  const results: string[] = [];

  try {
    // 1. Add new provider values to IntegrationProvider enum
    // Whitelist of allowed enum values (ALTER TYPE ADD VALUE does not support $1 placeholders)
    const ALLOWED_PROVIDERS = new Set(['QUICKBOOKS_DESKTOP', 'BUILDERTREND', 'BOISE_CASCADE']);
    const newProviders = ['QUICKBOOKS_DESKTOP', 'BUILDERTREND', 'BOISE_CASCADE'];
    for (const p of newProviders) {
      if (!ALLOWED_PROVIDERS.has(p)) continue;
      try {
        // Safe: p is validated against ALLOWED_PROVIDERS whitelist above
        await prisma.$executeRawUnsafe(`ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS '${p}'`);
        results.push(`Added enum value: ${p}`);
      } catch (e: any) {
        if (e.message?.includes('already exists')) {
          results.push(`Enum value already exists: ${p}`);
        } else {
          results.push(`Error adding ${p}: ${e.message}`);
        }
      }
    }

    // 2. Create QB Desktop sync queue table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "QBSyncQueue" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "qbTxnId" TEXT,
        "qbListId" TEXT,
        "requestXml" TEXT,
        "responseXml" TEXT,
        "payload" JSONB NOT NULL DEFAULT '{}',
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 3,
        "lastError" TEXT,
        "processedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "QBSyncQueue_pkey" PRIMARY KEY ("id")
      );
    `);
    results.push('Created QBSyncQueue table');

    // 3. Create supplier price updates table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupplierPriceUpdate" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "supplier" TEXT NOT NULL,
        "batchId" TEXT NOT NULL,
        "productId" TEXT,
        "supplierSku" TEXT NOT NULL,
        "productName" TEXT,
        "previousCost" DOUBLE PRECISION,
        "newCost" DOUBLE PRECISION NOT NULL,
        "costChange" DOUBLE PRECISION,
        "costChangePct" DOUBLE PRECISION,
        "currentPrice" DOUBLE PRECISION,
        "suggestedPrice" DOUBLE PRECISION,
        "currentMarginPct" DOUBLE PRECISION,
        "newMarginPct" DOUBLE PRECISION,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "appliedAt" TIMESTAMP(3),
        "appliedById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "SupplierPriceUpdate_pkey" PRIMARY KEY ("id")
      );
    `);
    results.push('Created SupplierPriceUpdate table');

    // 4. Create BuilderTrend project mapping table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BTProjectMapping" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "btProjectId" TEXT NOT NULL,
        "btProjectName" TEXT,
        "btBuilderName" TEXT,
        "btCommunity" TEXT,
        "btLot" TEXT,
        "btStatus" TEXT,
        "btScheduleData" JSONB DEFAULT '{}',
        "builderId" TEXT,
        "projectId" TEXT,
        "jobId" TEXT,
        "lastSyncedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BTProjectMapping_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BTProjectMapping_btProjectId_unique" UNIQUE ("btProjectId")
      );
    `);
    results.push('Created BTProjectMapping table');

    // 5. Add QB tracking columns to Invoice table if not present
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "qbTxnId" TEXT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "qbSyncedAt" TIMESTAMP(3)`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "qbSyncStatus" TEXT DEFAULT 'PENDING'`);
      results.push('Added QB columns to Invoice');
    } catch (e: any) { results.push(`Invoice columns: ${e.message}`); }

    // 6. Add QB tracking columns to Order table
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "qbTxnId" TEXT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "qbSyncedAt" TIMESTAMP(3)`);
      results.push('Added QB columns to Order');
    } catch (e: any) { results.push(`Order columns: ${e.message}`); }

    // 7. Add QB tracking columns to Builder (as QB Customer)
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "qbListId" TEXT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "qbSyncedAt" TIMESTAMP(3)`);
      results.push('Added QB columns to Builder');
    } catch (e: any) { results.push(`Builder columns: ${e.message}`); }

    // 8. Add QB tracking to PurchaseOrder (as QB Bill)
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "qbTxnId" TEXT`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "qbSyncedAt" TIMESTAMP(3)`);
      results.push('Added QB columns to PurchaseOrder');
    } catch (e: any) { results.push(`PurchaseOrder columns: ${e.message}`); }

    // 9. Create indexes (one at a time — Prisma doesn't allow multi-statement)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS "QBSyncQueue_status_idx" ON "QBSyncQueue"("status")`,
      `CREATE INDEX IF NOT EXISTS "QBSyncQueue_entityType_idx" ON "QBSyncQueue"("entityType", "status")`,
      `CREATE INDEX IF NOT EXISTS "SupplierPriceUpdate_status_idx" ON "SupplierPriceUpdate"("status")`,
      `CREATE INDEX IF NOT EXISTS "SupplierPriceUpdate_supplier_idx" ON "SupplierPriceUpdate"("supplier")`,
      `CREATE INDEX IF NOT EXISTS "SupplierPriceUpdate_batchId_idx" ON "SupplierPriceUpdate"("batchId")`,
      `CREATE INDEX IF NOT EXISTS "BTProjectMapping_builderId_idx" ON "BTProjectMapping"("builderId")`,
    ];
    for (const idx of indexes) {
      await prisma.$executeRawUnsafe(idx);
    }
    results.push('Created indexes');

    // 10. Seed the three new integration configs
    for (const integration of [
      { provider: 'QUICKBOOKS_DESKTOP', name: 'QuickBooks Desktop', syncInterval: 15 },
      { provider: 'BUILDERTREND', name: 'BuilderTrend', syncInterval: 60 },
      { provider: 'BOISE_CASCADE', name: 'Boise Cascade / BlueLinx', syncInterval: 1440 },
    ]) {
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "IntegrationConfig" ("provider", "name", "syncEnabled", "syncInterval", "status")
          VALUES ($1::"IntegrationProvider", $2, false, $3, 'PENDING'::"IntegrationStatus")
          ON CONFLICT ("provider") DO NOTHING
        `, integration.provider, integration.name, integration.syncInterval);
        results.push(`Seeded config: ${integration.provider}`);
      } catch (e: any) { results.push(`Seed ${integration.provider}: ${e.message}`); }
    }

    return safeJson({ success: true, results });
  } catch (error) {
    console.error('Integration setup error:', error);
    return safeJson({ error: 'Setup failed', detail: (error as any)?.message, results }, { status: 500 });
  }
}
