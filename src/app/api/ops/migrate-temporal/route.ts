export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { audit } from '@/lib/audit'

// Migration: Add createdAt/updatedAt columns to models that were missing them

const migrations = [
  // BomEntry
  `ALTER TABLE "BomEntry" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE "BomEntry" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

  // BuilderPricing
  `ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

  // UpgradePath
  `ALTER TABLE "UpgradePath" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE "UpgradePath" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

  // CrewMember
  `ALTER TABLE "CrewMember" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE "CrewMember" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

  // VendorProduct
  `ALTER TABLE "VendorProduct" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE "VendorProduct" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,

  // PurchaseOrderItem
  `ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
  `ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
];

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  audit(request, 'RUN_MIGRATE_TEMPORAL', 'Database', undefined, { migration: 'RUN_MIGRATE_TEMPORAL' }, 'CRITICAL').catch(() => {})

  try {
    const results: { table: string; column: string; status: string; error?: string }[] = [];

    for (const sql of migrations) {
      // Extract table and column from SQL for reporting
      const tableMatch = sql.match(/"(\w+)"/);
      const colMatch = sql.match(/IF NOT EXISTS "(\w+)"/);
      const table = tableMatch ? tableMatch[1] : 'unknown';
      const column = colMatch ? colMatch[1] : 'unknown';

      try {
        await prisma.$executeRawUnsafe(sql.replace(/;\s*$/, ''));
        results.push({ table, column, status: 'OK' });
      } catch (err: any) {
        results.push({ table, column, status: 'ERROR', error: err.message?.slice(0, 200) });
      }
    }

    const succeeded = results.filter(r => r.status === 'OK').length;
    const failed = results.filter(r => r.status === 'ERROR');

    return NextResponse.json({
      total: migrations.length,
      succeeded,
      failed: failed.length,
      errors: failed,
      results,
    });
  } catch (error: any) {
    console.error('Temporal migration failed:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: error.message },
      { status: 500 }
    );
  }
}
