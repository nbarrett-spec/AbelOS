export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth';
import { audit } from '@/lib/audit'

// One-time migration: adds credit management columns to Vendor table
// and creates InventoryAllocation table for SO-specific inventory
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  audit(request, 'RUN_MIGRATE_VENDOR_CREDIT', 'Database', undefined, { migration: 'RUN_MIGRATE_VENDOR_CREDIT' }, 'CRITICAL').catch(() => {})

  const results: string[] = [];

  try {
    // ── Vendor credit management columns ───────────────────────
    const vendorColumns = [
      { name: 'creditLimit', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "creditLimit" FLOAT DEFAULT 0` },
      { name: 'creditUsed', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "creditUsed" FLOAT DEFAULT 0` },
      { name: 'creditHold', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "creditHold" BOOLEAN DEFAULT false` },
      { name: 'paymentTerms', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT DEFAULT 'NET_30'` },
      { name: 'paymentTermDays', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "paymentTermDays" INT DEFAULT 30` },
      { name: 'earlyPayDiscount', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "earlyPayDiscount" FLOAT DEFAULT 0` },
      { name: 'earlyPayDays', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "earlyPayDays" INT DEFAULT 0` },
      { name: 'taxId', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "taxId" TEXT` },
      { name: 'notes', sql: `ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "notes" TEXT` },
    ];

    for (const col of vendorColumns) {
      try {
        await prisma.$executeRawUnsafe(col.sql);
        results.push(`✓ Vendor.${col.name} added`);
      } catch (e: any) {
        results.push(`⚠ Vendor.${col.name}: ${e.message?.slice(0, 80)}`);
      }
    }

    // ── Inventory Allocation table (SO-specific reservations) ──
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "InventoryAllocation" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "productId" TEXT NOT NULL,
          "orderId" TEXT,
          "jobId" TEXT,
          "quantity" INT NOT NULL DEFAULT 0,
          "allocationType" TEXT NOT NULL DEFAULT 'SALES_ORDER',
          "status" TEXT NOT NULL DEFAULT 'RESERVED',
          "allocatedBy" TEXT,
          "notes" TEXT,
          "allocatedAt" TIMESTAMPTZ DEFAULT NOW(),
          "releasedAt" TIMESTAMPTZ,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      results.push('✓ InventoryAllocation table created');
    } catch (e: any) {
      results.push(`⚠ InventoryAllocation: ${e.message?.slice(0, 80)}`);
    }

    // Index for fast lookups
    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_inv_alloc_product" ON "InventoryAllocation" ("productId")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_inv_alloc_order" ON "InventoryAllocation" ("orderId")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_inv_alloc_status" ON "InventoryAllocation" ("status")`);
      results.push('✓ InventoryAllocation indexes created');
    } catch (e: any) {
      results.push(`⚠ Allocation indexes: ${e.message?.slice(0, 80)}`);
    }

    // ── Vendor Return / RMA table ──────────────────────────────
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "VendorReturn" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "returnNumber" TEXT UNIQUE NOT NULL,
          "purchaseOrderId" TEXT NOT NULL,
          "vendorId" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "reason" TEXT NOT NULL,
          "returnType" TEXT NOT NULL DEFAULT 'DEFECTIVE',
          "totalAmount" FLOAT DEFAULT 0,
          "creditReceived" FLOAT DEFAULT 0,
          "trackingNumber" TEXT,
          "rmaNumber" TEXT,
          "createdById" TEXT,
          "approvedById" TEXT,
          "shippedAt" TIMESTAMPTZ,
          "resolvedAt" TIMESTAMPTZ,
          "notes" TEXT,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      results.push('✓ VendorReturn table created');
    } catch (e: any) {
      results.push(`⚠ VendorReturn: ${e.message?.slice(0, 80)}`);
    }

    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "VendorReturnItem" (
          "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "vendorReturnId" TEXT NOT NULL REFERENCES "VendorReturn"("id") ON DELETE CASCADE,
          "purchaseOrderItemId" TEXT,
          "productId" TEXT,
          "description" TEXT NOT NULL,
          "quantity" INT NOT NULL,
          "unitCost" FLOAT NOT NULL DEFAULT 0,
          "lineTotal" FLOAT NOT NULL DEFAULT 0,
          "reason" TEXT NOT NULL DEFAULT 'DEFECTIVE',
          "condition" TEXT DEFAULT 'DAMAGED'
        )
      `);
      results.push('✓ VendorReturnItem table created');
    } catch (e: any) {
      results.push(`⚠ VendorReturnItem: ${e.message?.slice(0, 80)}`);
    }

    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_vendor_return_vendor" ON "VendorReturn" ("vendorId")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_vendor_return_po" ON "VendorReturn" ("purchaseOrderId")`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_vendor_return_status" ON "VendorReturn" ("status")`);
      results.push('✓ VendorReturn indexes created');
    } catch (e: any) {
      results.push(`⚠ VendorReturn indexes: ${e.message?.slice(0, 80)}`);
    }

    // ── Update existing vendor credit usage from open POs ──────
    try {
      await prisma.$executeRawUnsafe(`
        UPDATE "Vendor" v
        SET "creditUsed" = COALESCE(sub.used, 0)
        FROM (
          SELECT "vendorId", SUM("total") as used
          FROM "PurchaseOrder"
          WHERE "status"::text NOT IN ('RECEIVED', 'CANCELLED')
          GROUP BY "vendorId"
        ) sub
        WHERE v."id" = sub."vendorId"
      `);
      results.push('✓ Vendor credit usage synced from open POs');
    } catch (e: any) {
      results.push(`⚠ Credit sync: ${e.message?.slice(0, 80)}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json({ error: error.message, results }, { status: 500 });
  }
}
