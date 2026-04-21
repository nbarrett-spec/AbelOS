export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/migrate/manufacturing-tables
 *
 * Creates the DoorIdentity, DoorEvent, WarehouseBay, and WarrantyPolicy
 * tables + enums that the NFC tag-program API relies on.
 * Safe to re-run — uses IF NOT EXISTS throughout.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_MANUFACTURING_TABLES', 'Database', undefined, { migration: 'RUN_MIGRATE_MANUFACTURING_TABLES' }, 'CRITICAL').catch(() => {})

  const results: { step: string; status: string }[] = []

  async function run(step: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step, status: 'OK' })
    } catch (e: any) {
      const msg = e?.message || ''
      if (msg.includes('already exists')) {
        results.push({ step, status: 'SKIPPED (already exists)' })
      } else {
        results.push({ step, status: `ERROR: ${msg.slice(0, 200)}` })
      }
    }
  }

  // 1. Door lifecycle status enum
  await run('DoorStatus enum', `
    DO $$ BEGIN
      CREATE TYPE "DoorStatus" AS ENUM (
        'PRODUCTION', 'QC_PASSED', 'QC_FAILED',
        'STORED', 'STAGED', 'LOADED',
        'DELIVERED', 'INSTALLED', 'WARRANTY_CLAIM', 'RETURNED'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // 2. DoorEvent type enum
  await run('DoorEventType enum', `
    DO $$ BEGIN
      CREATE TYPE "DoorEventType" AS ENUM (
        'CREATED', 'QC_PASS', 'QC_FAIL', 'NFC_LINKED',
        'STORED', 'STAGED', 'LOADED', 'DELIVERED', 'INSTALLED',
        'WARRANTY_CLAIMED', 'WARRANTY_RESOLVED', 'RETURNED', 'NOTE'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // 3. WarehouseBay table
  await run('WarehouseBay table', `
    CREATE TABLE IF NOT EXISTS "WarehouseBay" (
      "id" TEXT PRIMARY KEY,
      "bayNumber" TEXT NOT NULL UNIQUE,
      "zone" TEXT,
      "aisle" TEXT,
      "level" TEXT,
      "capacity" INTEGER DEFAULT 50,
      "currentCount" INTEGER DEFAULT 0,
      "isActive" BOOLEAN DEFAULT true,
      "notes" TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // 4. WarrantyPolicy table
  await run('WarrantyPolicy table', `
    CREATE TABLE IF NOT EXISTS "WarrantyPolicy" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "appliesToCategory" TEXT,
      "durationMonths" INTEGER NOT NULL DEFAULT 12,
      "description" TEXT,
      "isDefault" BOOLEAN DEFAULT false,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // 5. DoorIdentity table
  await run('DoorIdentity table', `
    CREATE TABLE IF NOT EXISTS "DoorIdentity" (
      "id" TEXT PRIMARY KEY,
      "serialNumber" TEXT NOT NULL UNIQUE,
      "nfcTagId" TEXT UNIQUE,
      "nfcUrl" TEXT,
      "status" "DoorStatus" NOT NULL DEFAULT 'PRODUCTION',

      "productId" TEXT REFERENCES "Product"("id") ON DELETE SET NULL,
      "orderId" TEXT REFERENCES "Order"("id") ON DELETE SET NULL,
      "orderItemId" TEXT,
      "jobId" TEXT REFERENCES "Job"("id") ON DELETE SET NULL,
      "bayId" TEXT REFERENCES "WarehouseBay"("id") ON DELETE SET NULL,

      "manufacturedAt" TIMESTAMPTZ,
      "manufacturedBy" TEXT,
      "qcPassedAt" TIMESTAMPTZ,
      "qcPassedBy" TEXT,
      "qcNotes" TEXT,
      "stagedAt" TIMESTAMPTZ,
      "deliveredAt" TIMESTAMPTZ,
      "installedAt" TIMESTAMPTZ,
      "installedBy" TEXT,

      "installAddress" TEXT,
      "installCity" TEXT,
      "installState" TEXT DEFAULT 'TX',
      "installZip" TEXT,
      "homeownerName" TEXT,
      "homeownerEmail" TEXT,
      "homeownerPhone" TEXT,

      "warrantyPolicyId" TEXT REFERENCES "WarrantyPolicy"("id") ON DELETE SET NULL,
      "warrantyStart" TIMESTAMPTZ,
      "warrantyEnd" TIMESTAMPTZ,

      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // 6. DoorEvent table
  await run('DoorEvent table', `
    CREATE TABLE IF NOT EXISTS "DoorEvent" (
      "id" TEXT PRIMARY KEY,
      "doorId" TEXT NOT NULL REFERENCES "DoorIdentity"("id") ON DELETE CASCADE,
      "eventType" "DoorEventType" NOT NULL,
      "previousStatus" TEXT,
      "newStatus" TEXT,
      "performedBy" TEXT,
      "notes" TEXT,
      "metadata" JSONB,
      "createdAt" TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // 7. Indexes
  const indexes = [
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_serial" ON "DoorIdentity" ("serialNumber")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_nfc" ON "DoorIdentity" ("nfcTagId")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_status" ON "DoorIdentity" ("status")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_order" ON "DoorIdentity" ("orderId")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_job" ON "DoorIdentity" ("jobId")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_bay" ON "DoorIdentity" ("bayId")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_identity_product" ON "DoorIdentity" ("productId")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_event_door" ON "DoorEvent" ("doorId")`,
    `CREATE INDEX IF NOT EXISTS "idx_door_event_type" ON "DoorEvent" ("eventType")`,
    `CREATE INDEX IF NOT EXISTS "idx_warehouse_bay_number" ON "WarehouseBay" ("bayNumber")`,
    `CREATE INDEX IF NOT EXISTS "idx_warranty_policy_category" ON "WarrantyPolicy" ("appliesToCategory")`,
  ]

  // 7b. Ensure WarrantyPolicy has appliesToCategory column (may be missing if table pre-existed)
  await run('ALTER WarrantyPolicy add appliesToCategory', `
    ALTER TABLE "WarrantyPolicy" ADD COLUMN IF NOT EXISTS "appliesToCategory" TEXT;
  `)

  for (const idx of indexes) {
    await run(`Index: ${idx.match(/idx_\w+/)?.[0] || 'unknown'}`, idx)
  }

  // 8. Seed default warehouse bays (A1-A10, B1-B10)
  await run('Seed warehouse bays', `
    INSERT INTO "WarehouseBay" ("id", "bayNumber", "zone", "aisle", "capacity")
    SELECT
      'bay_' || z || n,
      z || n::text,
      z,
      z,
      50
    FROM (VALUES ('A'), ('B')) AS zones(z),
         generate_series(1, 10) AS n
    ON CONFLICT ("bayNumber") DO NOTHING;
  `)

  // 9. Seed default warranty policies
  await run('Seed warranty policies', `
    INSERT INTO "WarrantyPolicy" ("id", "name", "appliesToCategory", "durationMonths", "description", "isDefault")
    VALUES
      ('wp_default', 'Standard Door Warranty', NULL, 12, 'Standard 1-year warranty on all doors', true),
      ('wp_premium', 'Premium Entry Door', 'ENTRY_DOOR', 36, '3-year warranty on premium entry doors', false),
      ('wp_interior', 'Interior Door', 'INTERIOR_DOOR', 12, '1-year warranty on interior doors', false),
      ('wp_hardware', 'Hardware Warranty', 'HARDWARE', 24, '2-year warranty on hardware components', false)
    ON CONFLICT DO NOTHING;
  `)

  const passed = results.filter(r => r.status === 'OK').length
  const skipped = results.filter(r => r.status.startsWith('SKIPPED')).length
  const failed = results.filter(r => r.status.startsWith('ERROR')).length

  return NextResponse.json({
    success: failed === 0,
    summary: { passed, skipped, failed, total: results.length },
    results,
  })
}
