export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// NFC Door Identity & Warehouse Bay System — Database Migration
// Creates: DoorIdentity, DoorEvent, WarehouseBay, BayMovement, WarrantyPolicy

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { step: string; status: string }[] = []

  async function runStep(name: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step: name, status: 'OK' })
    } catch (e: any) {
      if (e.message?.includes('already exists') || e.code === '42710' || e.code === '42P07') {
        results.push({ step: name, status: 'OK (already exists)' })
      } else {
        results.push({ step: name, status: `ERROR: ${e.message}` })
      }
    }
  }

  // ─── Warranty Policy table ───
  await runStep('WarrantyPolicy table', `
    CREATE TABLE IF NOT EXISTS "WarrantyPolicy" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      "durationMonths" INT NOT NULL DEFAULT 12,
      "coverageType" TEXT NOT NULL DEFAULT 'STANDARD',
      "appliesToCategory" TEXT,
      "careInstructions" TEXT,
      "isDefault" BOOLEAN DEFAULT false,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── Warehouse Bay table ───
  await runStep('WarehouseBay table', `
    CREATE TABLE IF NOT EXISTS "WarehouseBay" (
      id TEXT PRIMARY KEY,
      "bayNumber" TEXT NOT NULL UNIQUE,
      zone TEXT NOT NULL DEFAULT 'MAIN',
      aisle TEXT,
      "position" TEXT,
      "nfcTagId" TEXT UNIQUE,
      capacity INT DEFAULT 20,
      "currentCount" INT DEFAULT 0,
      description TEXT,
      active BOOLEAN DEFAULT true,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── Door Identity table ───
  await runStep('DoorIdentity table', `
    CREATE TABLE IF NOT EXISTS "DoorIdentity" (
      id TEXT PRIMARY KEY,
      "serialNumber" TEXT NOT NULL UNIQUE,
      "nfcTagId" TEXT UNIQUE,
      "nfcUrl" TEXT,
      status TEXT NOT NULL DEFAULT 'PRODUCTION',
      "productId" TEXT REFERENCES "Product"(id),
      "orderId" TEXT,
      "orderItemId" TEXT,
      "jobId" TEXT,
      "bayId" TEXT REFERENCES "WarehouseBay"(id),
      "warrantyPolicyId" TEXT REFERENCES "WarrantyPolicy"(id),
      "builderId" TEXT,
      "builderName" TEXT,
      "manufacturedAt" TIMESTAMP,
      "manufacturedBy" TEXT,
      "qcPassedAt" TIMESTAMP,
      "qcPassedBy" TEXT,
      "qcNotes" TEXT,
      "stagedAt" TIMESTAMP,
      "stagedBy" TEXT,
      "deliveredAt" TIMESTAMP,
      "deliveredBy" TEXT,
      "deliveryNotes" TEXT,
      "installedAt" TIMESTAMP,
      "installedBy" TEXT,
      "installAddress" TEXT,
      "installCity" TEXT,
      "installState" TEXT DEFAULT 'TX',
      "installZip" TEXT,
      "installNotes" TEXT,
      "homeownerName" TEXT,
      "homeownerEmail" TEXT,
      "homeownerPhone" TEXT,
      "warrantyStartDate" TIMESTAMP,
      "warrantyEndDate" TIMESTAMP,
      "bomSnapshot" JSONB,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── Door Event audit log ───
  await runStep('DoorEvent table', `
    CREATE TABLE IF NOT EXISTS "DoorEvent" (
      id TEXT PRIMARY KEY,
      "doorId" TEXT NOT NULL REFERENCES "DoorIdentity"(id),
      "eventType" TEXT NOT NULL,
      "previousStatus" TEXT,
      "newStatus" TEXT,
      "performedBy" TEXT,
      "performedByName" TEXT,
      "bayId" TEXT,
      "notes" TEXT,
      metadata JSONB,
      "createdAt" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── Bay Movement log ───
  await runStep('BayMovement table', `
    CREATE TABLE IF NOT EXISTS "BayMovement" (
      id TEXT PRIMARY KEY,
      "doorId" TEXT NOT NULL REFERENCES "DoorIdentity"(id),
      "fromBayId" TEXT REFERENCES "WarehouseBay"(id),
      "toBayId" TEXT NOT NULL REFERENCES "WarehouseBay"(id),
      "movedBy" TEXT,
      "movedByName" TEXT,
      reason TEXT,
      "createdAt" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── Service Request table (homeowner-initiated) ───
  await runStep('ServiceRequest table', `
    CREATE TABLE IF NOT EXISTS "ServiceRequest" (
      id TEXT PRIMARY KEY,
      "doorId" TEXT NOT NULL REFERENCES "DoorIdentity"(id),
      "requestedBy" TEXT,
      "requestedByName" TEXT,
      "requestedByEmail" TEXT,
      "requestedByPhone" TEXT,
      "issueType" TEXT NOT NULL DEFAULT 'GENERAL',
      description TEXT NOT NULL,
      "photoUrls" JSONB,
      status TEXT NOT NULL DEFAULT 'NEW',
      "assignedTo" TEXT,
      resolution TEXT,
      "resolvedAt" TIMESTAMP,
      "isWarrantyClaim" BOOLEAN DEFAULT false,
      "warrantyApproved" BOOLEAN,
      "createdAt" TIMESTAMP DEFAULT NOW(),
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ─── Indexes ───
  await runStep('DoorIdentity idx_status', `CREATE INDEX IF NOT EXISTS "idx_door_identity_status" ON "DoorIdentity"(status)`)
  await runStep('DoorIdentity idx_productId', `CREATE INDEX IF NOT EXISTS "idx_door_identity_productId" ON "DoorIdentity"("productId")`)
  await runStep('DoorIdentity idx_orderId', `CREATE INDEX IF NOT EXISTS "idx_door_identity_orderId" ON "DoorIdentity"("orderId")`)
  await runStep('DoorIdentity idx_jobId', `CREATE INDEX IF NOT EXISTS "idx_door_identity_jobId" ON "DoorIdentity"("jobId")`)
  await runStep('DoorIdentity idx_bayId', `CREATE INDEX IF NOT EXISTS "idx_door_identity_bayId" ON "DoorIdentity"("bayId")`)
  await runStep('DoorIdentity idx_nfcTagId', `CREATE INDEX IF NOT EXISTS "idx_door_identity_nfcTagId" ON "DoorIdentity"("nfcTagId")`)
  await runStep('DoorIdentity idx_serialNumber', `CREATE INDEX IF NOT EXISTS "idx_door_identity_serial" ON "DoorIdentity"("serialNumber")`)
  await runStep('DoorEvent idx_doorId', `CREATE INDEX IF NOT EXISTS "idx_door_event_doorId" ON "DoorEvent"("doorId")`)
  await runStep('DoorEvent idx_type', `CREATE INDEX IF NOT EXISTS "idx_door_event_type" ON "DoorEvent"("eventType")`)
  await runStep('BayMovement idx_doorId', `CREATE INDEX IF NOT EXISTS "idx_bay_movement_doorId" ON "BayMovement"("doorId")`)
  await runStep('BayMovement idx_toBayId', `CREATE INDEX IF NOT EXISTS "idx_bay_movement_toBayId" ON "BayMovement"("toBayId")`)
  await runStep('ServiceRequest idx_doorId', `CREATE INDEX IF NOT EXISTS "idx_service_request_doorId" ON "ServiceRequest"("doorId")`)
  await runStep('ServiceRequest idx_status', `CREATE INDEX IF NOT EXISTS "idx_service_request_status" ON "ServiceRequest"(status)`)
  await runStep('WarehouseBay idx_zone', `CREATE INDEX IF NOT EXISTS "idx_warehouse_bay_zone" ON "WarehouseBay"(zone)`)
  await runStep('WarehouseBay idx_nfcTagId', `CREATE INDEX IF NOT EXISTS "idx_warehouse_bay_nfcTagId" ON "WarehouseBay"("nfcTagId")`)

  // ─── Seed default warranty policies ───
  await runStep('Seed default warranty - Standard', `
    INSERT INTO "WarrantyPolicy" (id, name, description, "durationMonths", "coverageType", "isDefault", "careInstructions")
    VALUES (
      'wp_standard',
      'Standard Door Warranty',
      'Covers manufacturing defects in materials and workmanship under normal residential use.',
      12,
      'STANDARD',
      true,
      'Clean with mild soap and water. Avoid harsh chemicals or abrasive cleaners. Inspect weatherstripping annually. Lubricate hinges with silicone spray every 6 months. Do not pressure wash. Touch up paint chips promptly to prevent moisture damage. For exterior doors, reapply finish as needed based on sun exposure.'
    )
    ON CONFLICT (id) DO NOTHING
  `)

  await runStep('Seed default warranty - Exterior', `
    INSERT INTO "WarrantyPolicy" (id, name, description, "durationMonths", "coverageType", "appliesToCategory", "isDefault", "careInstructions")
    VALUES (
      'wp_exterior',
      'Exterior Door Warranty',
      'Extended coverage for exterior doors including weatherstripping, threshold, and finish against peeling, cracking, or warping.',
      24,
      'EXTENDED',
      'ADT Exterior Doors',
      false,
      'Exterior doors require seasonal maintenance. Inspect and replace weatherstripping if worn. Check threshold seal before winter. Refinish or repaint every 2-3 years depending on exposure. Clean glass lites with glass cleaner, not abrasives. Keep bottom of door clear of standing water. Lubricate lock mechanism annually.'
    )
    ON CONFLICT (id) DO NOTHING
  `)

  await runStep('Seed default warranty - Fiberglass', `
    INSERT INTO "WarrantyPolicy" (id, name, description, "durationMonths", "coverageType", "appliesToCategory", "isDefault", "careInstructions")
    VALUES (
      'wp_fiberglass',
      'Fiberglass Door Warranty',
      'Premium warranty for fiberglass door units covering delamination, bowing, and finish degradation.',
      60,
      'PREMIUM',
      'ADT Pulte EXT',
      false,
      'Fiberglass doors are low-maintenance but still benefit from care. Clean with mild detergent and soft cloth. Do not use steel wool or abrasive pads. Apply automotive wax annually for UV protection. Inspect hinges and lock hardware seasonally. Fiberglass will not rot or warp but the finish can degrade with extended UV exposure if not maintained.'
    )
    ON CONFLICT (id) DO NOTHING
  `)

  return safeJson({ success: true, results })
}
