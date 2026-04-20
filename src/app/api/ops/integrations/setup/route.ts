export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

// POST /api/ops/integrations/setup — Add new integration providers & tables
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  const results: string[] = [];

  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    // 1. Add new provider values to IntegrationProvider enum
    // Whitelist of allowed enum values (ALTER TYPE ADD VALUE does not support $1 placeholders)
    const ALLOWED_PROVIDERS = new Set(['BUILDERTREND', 'BOISE_CASCADE']);
    const newProviders = ['BUILDERTREND', 'BOISE_CASCADE'];
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

    // 2. Create supplier price updates table
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

    // 3. Create BuilderTrend project mapping table
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

    // 4. Create indexes (one at a time — Prisma doesn't allow multi-statement)
    const indexes = [
      `CREATE INDEX IF NOT EXISTS "SupplierPriceUpdate_status_idx" ON "SupplierPriceUpdate"("status")`,
      `CREATE INDEX IF NOT EXISTS "SupplierPriceUpdate_supplier_idx" ON "SupplierPriceUpdate"("supplier")`,
      `CREATE INDEX IF NOT EXISTS "SupplierPriceUpdate_batchId_idx" ON "SupplierPriceUpdate"("batchId")`,
      `CREATE INDEX IF NOT EXISTS "BTProjectMapping_builderId_idx" ON "BTProjectMapping"("builderId")`,
    ];
    for (const idx of indexes) {
      await prisma.$executeRawUnsafe(idx);
    }
    results.push('Created indexes');

    // 5. Seed the integration configs
    for (const integration of [
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
