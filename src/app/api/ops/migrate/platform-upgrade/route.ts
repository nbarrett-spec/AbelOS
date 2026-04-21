/**
 * Platform Upgrade Migration — Phase 1
 *
 * Adds schema foundations for:
 * 1. Multi-location support (Location model)
 * 2. Inspection checklists (InspectionChecklist, InspectionItem)
 * 3. Lien release tracking (LienRelease)
 * 4. Trade finder / subcontractor network (Trade, TradeReview)
 * 5. Enhanced warranty (SLA fields, photo uploads, homeowner self-service token)
 * 6. Enhanced communications (@mentions, read receipts, threading)
 * 7. Enhanced eCommerce (saved carts, reorder suggestions, builder catalogs)
 * 8. Enhanced scheduling (Gantt milestones, builder-facing schedule sharing)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const migrations: { name: string; sql: string }[] = [
  // ═══════════════════════════════════════════════════════════════════
  // 1. MULTI-LOCATION FOUNDATION
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create Location table',
    sql: `CREATE TABLE IF NOT EXISTS "Location" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL UNIQUE,
      "type" TEXT NOT NULL DEFAULT 'WAREHOUSE',
      "address" TEXT,
      "city" TEXT,
      "state" TEXT,
      "zip" TEXT,
      "phone" TEXT,
      "managerId" TEXT REFERENCES "Staff"("id"),
      "active" BOOLEAN NOT NULL DEFAULT true,
      "isPrimary" BOOLEAN NOT NULL DEFAULT false,
      "timezone" TEXT DEFAULT 'America/Chicago',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Seed primary location',
    sql: `INSERT INTO "Location" ("id", "name", "code", "type", "isPrimary", "address", "city", "state", "zip")
          VALUES ('loc_abel_dfw', 'Abel Lumber — DFW', 'DFW', 'WAREHOUSE', true,
                  '1234 Industrial Blvd', 'Dallas', 'TX', '75201')
          ON CONFLICT DO NOTHING`,
  },
  {
    name: 'Add locationId to Staff',
    sql: `ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "locationId" TEXT DEFAULT 'loc_abel_dfw' REFERENCES "Location"("id")`,
  },
  {
    name: 'Add locationId to Product (inventory partitioning)',
    sql: `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "locationId" TEXT DEFAULT 'loc_abel_dfw'`,
  },
  {
    name: 'Add locationId to Job',
    sql: `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "locationId" TEXT DEFAULT 'loc_abel_dfw'`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 2. INSPECTION CHECKLISTS
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create InspectionTemplate table',
    sql: `CREATE TABLE IF NOT EXISTS "InspectionTemplate" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL UNIQUE,
      "description" TEXT,
      "category" TEXT NOT NULL DEFAULT 'GENERAL',
      "items" JSONB NOT NULL DEFAULT '[]',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Create Inspection table',
    sql: `CREATE TABLE IF NOT EXISTS "Inspection" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "templateId" TEXT REFERENCES "InspectionTemplate"("id"),
      "jobId" TEXT REFERENCES "Job"("id"),
      "inspectorId" TEXT REFERENCES "Staff"("id"),
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "scheduledDate" TIMESTAMPTZ,
      "completedDate" TIMESTAMPTZ,
      "results" JSONB DEFAULT '{}',
      "passRate" DOUBLE PRECISION,
      "notes" TEXT,
      "photos" JSONB DEFAULT '[]',
      "signatureData" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Seed default inspection templates',
    sql: `INSERT INTO "InspectionTemplate" ("id", "name", "code", "category", "description", "items") VALUES
      ('tpl_pre_install', 'Pre-Installation Inspection', 'PRE_INSTALL', 'INSTALLATION',
       'Verify door openings, framing, and materials before installation',
       '[{"label":"Opening width matches order specs","required":true},{"label":"Opening height matches order specs","required":true},{"label":"Framing is plumb and square","required":true},{"label":"Subfloor is level within 1/4 inch","required":true},{"label":"All ordered doors/hardware present on site","required":true},{"label":"No visible damage to doors or frames","required":true},{"label":"Hinges and hardware match specifications","required":true},{"label":"Builder has approved layout/placement","required":false}]'),
      ('tpl_post_install', 'Post-Installation Inspection', 'POST_INSTALL', 'INSTALLATION',
       'Verify proper installation, operation, and finish quality',
       '[{"label":"All doors swing freely without binding","required":true},{"label":"Door gaps are uniform (1/8 inch)","required":true},{"label":"Locksets operate smoothly","required":true},{"label":"Strike plates aligned properly","required":true},{"label":"No visible damage, scratches, or dents","required":true},{"label":"Casing/trim installed and caulked","required":true},{"label":"Door stops installed","required":true},{"label":"Astragal/weatherstrip intact (if applicable)","required":false}]'),
      ('tpl_qc_manufacturing', 'Manufacturing QC', 'MFG_QC', 'MANUFACTURING',
       'Quality control checkpoint during door assembly',
       '[{"label":"Core type matches BOM specification","required":true},{"label":"Panel style matches order","required":true},{"label":"Dimensions within tolerance (+/- 1/16)","required":true},{"label":"Hinge prep correct (size, location, hand)","required":true},{"label":"Lock bore correct (height, backset)","required":true},{"label":"Finish quality passes visual inspection","required":true},{"label":"Label/sticker applied with job info","required":true}]'),
      ('tpl_delivery_receipt', 'Delivery Receipt Inspection', 'DELIVERY_RECEIPT', 'DELIVERY',
       'Inspection at delivery/drop point',
       '[{"label":"Correct number of units delivered","required":true},{"label":"All items match packing list","required":true},{"label":"No visible shipping damage","required":true},{"label":"Delivered to correct lot/address","required":true},{"label":"Builder/site contact signed off","required":false},{"label":"Photos taken of delivery location","required":true}]')
    ON CONFLICT DO NOTHING`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 3. LIEN RELEASE TRACKING
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create LienRelease table',
    sql: `CREATE TABLE IF NOT EXISTS "LienRelease" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "jobId" TEXT REFERENCES "Job"("id"),
      "builderId" TEXT REFERENCES "Builder"("id"),
      "invoiceId" TEXT,
      "type" TEXT NOT NULL DEFAULT 'CONDITIONAL',
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "throughDate" DATE,
      "issuedDate" DATE,
      "signedDate" DATE,
      "signedBy" TEXT,
      "signatureData" TEXT,
      "documentUrl" TEXT,
      "notes" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 4. TRADE FINDER / SUBCONTRACTOR NETWORK
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create Trade table',
    sql: `CREATE TABLE IF NOT EXISTS "Trade" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "companyName" TEXT NOT NULL,
      "tradeType" TEXT NOT NULL,
      "contactName" TEXT,
      "email" TEXT,
      "phone" TEXT,
      "website" TEXT,
      "address" TEXT,
      "city" TEXT,
      "state" TEXT,
      "zip" TEXT,
      "serviceArea" TEXT[] DEFAULT '{}',
      "description" TEXT,
      "licenses" JSONB DEFAULT '[]',
      "insurance" JSONB DEFAULT '{}',
      "insuranceExpiry" DATE,
      "rating" DOUBLE PRECISION DEFAULT 0,
      "reviewCount" INT DEFAULT 0,
      "verified" BOOLEAN DEFAULT false,
      "active" BOOLEAN DEFAULT true,
      "addedById" TEXT REFERENCES "Staff"("id"),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Create TradeReview table',
    sql: `CREATE TABLE IF NOT EXISTS "TradeReview" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "tradeId" TEXT NOT NULL REFERENCES "Trade"("id") ON DELETE CASCADE,
      "reviewerId" TEXT REFERENCES "Staff"("id"),
      "builderReviewerId" TEXT REFERENCES "Builder"("id"),
      "jobId" TEXT REFERENCES "Job"("id"),
      "rating" INT NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
      "quality" INT CHECK ("quality" BETWEEN 1 AND 5),
      "reliability" INT CHECK ("reliability" BETWEEN 1 AND 5),
      "communication" INT CHECK ("communication" BETWEEN 1 AND 5),
      "comment" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 5. ENHANCED WARRANTY (SLA + self-service)
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Add SLA fields to WarrantyClaim',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "slaResponseDue" TIMESTAMPTZ`,
  },
  {
    name: 'Add SLA resolution due to WarrantyClaim',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "slaResolutionDue" TIMESTAMPTZ`,
  },
  {
    name: 'Add SLA breach flag to WarrantyClaim',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "slaBreached" BOOLEAN DEFAULT false`,
  },
  {
    name: 'Add photos JSONB to WarrantyClaim',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "photos" JSONB DEFAULT '[]'`,
  },
  {
    name: 'Add homeowner self-service token',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "selfServiceToken" TEXT`,
  },
  {
    name: 'Add homeowner email to WarrantyClaim',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "homeownerEmail" TEXT`,
  },
  {
    name: 'Add homeowner phone to WarrantyClaim',
    sql: `ALTER TABLE "WarrantyClaim" ADD COLUMN IF NOT EXISTS "homeownerPhone" TEXT`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 6. ENHANCED COMMUNICATIONS
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Add threadId to Message for threading',
    sql: `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "threadId" TEXT`,
  },
  {
    name: 'Add mentions JSONB to Message',
    sql: `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mentions" JSONB DEFAULT '[]'`,
  },
  {
    name: 'Add reactions JSONB to Message',
    sql: `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "reactions" JSONB DEFAULT '[]'`,
  },
  {
    name: 'Add isEdited flag to Message',
    sql: `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "isEdited" BOOLEAN DEFAULT false`,
  },
  {
    name: 'Add editedAt to Message',
    sql: `ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMPTZ`,
  },
  {
    name: 'Create MessageReadReceipt table',
    sql: `CREATE TABLE IF NOT EXISTS "MessageReadReceipt" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "messageId" TEXT NOT NULL,
      "staffId" TEXT REFERENCES "Staff"("id"),
      "builderId" TEXT REFERENCES "Builder"("id"),
      "readAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 7. ENHANCED ECOMMERCE
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create SavedCart table',
    sql: `CREATE TABLE IF NOT EXISTS "SavedCart" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderId" TEXT NOT NULL REFERENCES "Builder"("id"),
      "name" TEXT NOT NULL DEFAULT 'My Cart',
      "items" JSONB NOT NULL DEFAULT '[]',
      "subtotal" DOUBLE PRECISION DEFAULT 0,
      "isDefault" BOOLEAN DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Create BuilderCatalog table for custom catalogs',
    sql: `CREATE TABLE IF NOT EXISTS "BuilderCatalog" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderId" TEXT NOT NULL REFERENCES "Builder"("id"),
      "name" TEXT NOT NULL,
      "description" TEXT,
      "productIds" TEXT[] DEFAULT '{}',
      "isDefault" BOOLEAN DEFAULT false,
      "active" BOOLEAN DEFAULT true,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Create ReorderSuggestion table',
    sql: `CREATE TABLE IF NOT EXISTS "ReorderSuggestion" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderId" TEXT NOT NULL REFERENCES "Builder"("id"),
      "productId" TEXT NOT NULL,
      "productName" TEXT NOT NULL,
      "lastOrderedAt" TIMESTAMPTZ,
      "avgQuantity" INT DEFAULT 1,
      "avgIntervalDays" INT,
      "suggestedDate" DATE,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "dismissed" BOOLEAN DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // 8. ENHANCED SCHEDULING (Gantt milestones, builder-facing)
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Create ScheduleMilestone table',
    sql: `CREATE TABLE IF NOT EXISTS "ScheduleMilestone" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "jobId" TEXT NOT NULL REFERENCES "Job"("id"),
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "plannedDate" TIMESTAMPTZ,
      "actualDate" TIMESTAMPTZ,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "dependsOn" TEXT[],
      "durationDays" INT DEFAULT 1,
      "sortOrder" INT DEFAULT 0,
      "notes" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: 'Create BuilderScheduleShare table',
    sql: `CREATE TABLE IF NOT EXISTS "BuilderScheduleShare" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderId" TEXT NOT NULL REFERENCES "Builder"("id"),
      "jobId" TEXT NOT NULL REFERENCES "Job"("id"),
      "shareToken" TEXT NOT NULL UNIQUE,
      "showMilestones" BOOLEAN DEFAULT true,
      "showDeliveryETA" BOOLEAN DEFAULT true,
      "showPhotos" BOOLEAN DEFAULT true,
      "active" BOOLEAN DEFAULT true,
      "lastViewedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },

  // ═══════════════════════════════════════════════════════════════════
  // INDEXES
  // ═══════════════════════════════════════════════════════════════════
  {
    name: 'Index: Inspection by jobId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_inspection_jobId" ON "Inspection"("jobId")`,
  },
  {
    name: 'Index: LienRelease by jobId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_lien_release_jobId" ON "LienRelease"("jobId")`,
  },
  {
    name: 'Index: Trade by tradeType',
    sql: `CREATE INDEX IF NOT EXISTS "idx_trade_type" ON "Trade"("tradeType")`,
  },
  {
    name: 'Index: ScheduleMilestone by jobId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_schedule_milestone_jobId" ON "ScheduleMilestone"("jobId")`,
  },
  {
    name: 'Index: BuilderScheduleShare token',
    sql: `CREATE INDEX IF NOT EXISTS "idx_builder_schedule_token" ON "BuilderScheduleShare"("shareToken")`,
  },
  {
    name: 'Index: MessageReadReceipt by messageId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_message_read_receipt" ON "MessageReadReceipt"("messageId")`,
  },
  {
    name: 'Index: ReorderSuggestion by builderId',
    sql: `CREATE INDEX IF NOT EXISTS "idx_reorder_suggestion_builder" ON "ReorderSuggestion"("builderId")`,
  },
  {
    name: 'Index: Location active',
    sql: `CREATE INDEX IF NOT EXISTS "idx_location_active" ON "Location"("active")`,
  },
]

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_PLATFORM_UPGRADE', 'Database', undefined, { migration: 'RUN_MIGRATE_PLATFORM_UPGRADE' }, 'CRITICAL').catch(() => {})

  const results: { name: string; status: 'ok' | 'error'; error?: string }[] = []

  for (const migration of migrations) {
    try {
      await prisma.$executeRawUnsafe(migration.sql)
      results.push({ name: migration.name, status: 'ok' })
    } catch (e: any) {
      const msg = e?.message || String(e)
      // Schema drift: column/table already exists is fine
      if (msg.includes('already exists') || msg.includes('duplicate key')) {
        results.push({ name: migration.name, status: 'ok', error: 'Already exists (skipped)' })
      } else {
        results.push({ name: migration.name, status: 'error', error: msg })
        console.error(`[Migration] ${migration.name} FAILED:`, msg)
      }
    }
  }

  const succeeded = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status === 'error').length

  return NextResponse.json({
    success: failed === 0,
    message: `Platform upgrade: ${succeeded} succeeded, ${failed} failed out of ${migrations.length} migrations`,
    results,
    timestamp: new Date().toISOString(),
  })
}
