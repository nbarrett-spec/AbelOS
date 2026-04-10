-- ============================================================
-- Abel Lumber Platform — Schema Migration V11
-- Creates tables that exist in Prisma schema but were never
-- deployed to the database via SQL migration.
-- Run this in your Neon SQL Editor
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE "ScheduleType" AS ENUM ('DELIVERY', 'INSTALLATION', 'PICKUP', 'RETURN', 'INSPECTION', 'RESTOCKING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ScheduleStatus" AS ENUM ('TENTATIVE', 'FIRM', 'IN_PROGRESS', 'COMPLETED', 'RESCHEDULED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DealStage" AS ENUM ('PROSPECT', 'DISCOVERY', 'WALKTHROUGH', 'BID_SUBMITTED', 'BID_REVIEW', 'NEGOTIATION', 'WON', 'LOST', 'ONBOARDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DealSource" AS ENUM ('OUTBOUND', 'REFERRAL', 'INBOUND', 'TRADE_SHOW', 'REACTIVATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DealActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'TEXT', 'NOTE', 'STAGE_CHANGE', 'BID_SENT', 'BID_REVISED', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'DOCUMENT_REQUESTED', 'DOCUMENT_RECEIVED', 'FOLLOW_UP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════
-- ScheduleEntry
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "ScheduleEntry" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId"         TEXT NOT NULL,
  "entryType"     "ScheduleType" NOT NULL,
  "title"         TEXT NOT NULL,
  "scheduledDate" TIMESTAMP(3) NOT NULL,
  "scheduledTime" TEXT,
  "crewId"        TEXT,
  "status"        "ScheduleStatus" NOT NULL DEFAULT 'TENTATIVE',
  "notes"         TEXT,
  "startedAt"     TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduleEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Only add crew FK if Crew table exists
DO $$ BEGIN
  ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN undefined_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ScheduleEntry_scheduledDate_idx" ON "ScheduleEntry"("scheduledDate");
CREATE INDEX IF NOT EXISTS "ScheduleEntry_crewId_idx" ON "ScheduleEntry"("crewId");
CREATE INDEX IF NOT EXISTS "ScheduleEntry_status_idx" ON "ScheduleEntry"("status");

-- ═══════════════════════════════════════════════════════════════
-- Vendor
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Vendor" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name"           TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "contactName"    TEXT,
  "email"          TEXT,
  "phone"          TEXT,
  "address"        TEXT,
  "website"        TEXT,
  "accountNumber"  TEXT,
  "avgLeadDays"    INTEGER,
  "onTimeRate"     DOUBLE PRECISION,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "inflowVendorId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_code_key" ON "Vendor"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_inflowVendorId_key" ON "Vendor"("inflowVendorId");
CREATE INDEX IF NOT EXISTS "Vendor_code_idx" ON "Vendor"("code");

-- ═══════════════════════════════════════════════════════════════
-- VendorProduct
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "VendorProduct" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "vendorId"     TEXT NOT NULL,
  "productId"    TEXT NOT NULL,
  "vendorSku"    TEXT NOT NULL,
  "vendorName"   TEXT,
  "vendorCost"   DOUBLE PRECISION,
  "minOrderQty"  INTEGER NOT NULL DEFAULT 1,
  "leadTimeDays" INTEGER,
  "preferred"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "VendorProduct_vendorId_productId_key" ON "VendorProduct"("vendorId", "productId");
CREATE INDEX IF NOT EXISTS "VendorProduct_productId_idx" ON "VendorProduct"("productId");

-- ═══════════════════════════════════════════════════════════════
-- PurchaseOrder
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "poNumber"       TEXT NOT NULL,
  "vendorId"       TEXT NOT NULL,
  "createdById"    TEXT NOT NULL,
  "approvedById"   TEXT,
  "status"         "POStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "shippingCost"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "orderedAt"      TIMESTAMP(3),
  "expectedDate"   TIMESTAMP(3),
  "receivedAt"     TIMESTAMP(3),
  "notes"          TEXT,
  "qbTxnId"        TEXT,
  "qbSyncedAt"     TIMESTAMP(3),
  "inflowId"       TEXT,
  "inflowVendorId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_inflowId_key" ON "PurchaseOrder"("inflowId");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_qbTxnId_idx" ON "PurchaseOrder"("qbTxnId");

-- ═══════════════════════════════════════════════════════════════
-- PurchaseOrderItem
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "PurchaseOrderItem" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "purchaseOrderId" TEXT NOT NULL,
  "productId"       TEXT,
  "vendorSku"       TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "quantity"        INTEGER NOT NULL,
  "unitCost"        DOUBLE PRECISION NOT NULL,
  "lineTotal"       DOUBLE PRECISION NOT NULL,
  "receivedQty"     INTEGER NOT NULL DEFAULT 0,
  "damagedQty"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- ═══════════════════════════════════════════════════════════════
-- InventoryItem
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "InventoryItem" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "productId"      TEXT NOT NULL,
  "sku"            TEXT,
  "productName"    TEXT,
  "category"       TEXT,
  "onHand"         INTEGER NOT NULL DEFAULT 0,
  "committed"      INTEGER NOT NULL DEFAULT 0,
  "onOrder"        INTEGER NOT NULL DEFAULT 0,
  "available"      INTEGER NOT NULL DEFAULT 0,
  "reorderPoint"   INTEGER NOT NULL DEFAULT 0,
  "reorderQty"     INTEGER NOT NULL DEFAULT 0,
  "safetyStock"    INTEGER NOT NULL DEFAULT 5,
  "maxStock"       INTEGER NOT NULL DEFAULT 200,
  "unitCost"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgDailyUsage"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "daysOfSupply"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "warehouseZone"  TEXT,
  "binLocation"    TEXT,
  "location"       TEXT NOT NULL DEFAULT 'MAIN_WAREHOUSE',
  "status"         TEXT NOT NULL DEFAULT 'IN_STOCK',
  "lastCountedAt"  TIMESTAMP(3),
  "lastReceivedAt" TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_productId_key" ON "InventoryItem"("productId");
CREATE INDEX IF NOT EXISTS "InventoryItem_productId_idx" ON "InventoryItem"("productId");
CREATE INDEX IF NOT EXISTS "InventoryItem_sku_idx" ON "InventoryItem"("sku");
CREATE INDEX IF NOT EXISTS "InventoryItem_category_idx" ON "InventoryItem"("category");
CREATE INDEX IF NOT EXISTS "InventoryItem_status_idx" ON "InventoryItem"("status");
CREATE INDEX IF NOT EXISTS "InventoryItem_warehouseZone_idx" ON "InventoryItem"("warehouseZone");
CREATE INDEX IF NOT EXISTS "InventoryItem_lastCountedAt_idx" ON "InventoryItem"("lastCountedAt");

-- ═══════════════════════════════════════════════════════════════
-- Deal
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "Deal" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "dealNumber"        TEXT NOT NULL,
  "companyName"       TEXT NOT NULL,
  "contactName"       TEXT NOT NULL,
  "contactEmail"      TEXT,
  "contactPhone"      TEXT,
  "address"           TEXT,
  "city"              TEXT,
  "state"             TEXT,
  "zip"               TEXT,
  "stage"             "DealStage" NOT NULL DEFAULT 'PROSPECT',
  "probability"       INTEGER NOT NULL DEFAULT 10,
  "dealValue"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source"            "DealSource" NOT NULL DEFAULT 'OUTBOUND',
  "expectedCloseDate" TIMESTAMP(3),
  "actualCloseDate"   TIMESTAMP(3),
  "lostDate"          TIMESTAMP(3),
  "lostReason"        TEXT,
  "ownerId"           TEXT NOT NULL,
  "builderId"         TEXT,
  "description"       TEXT,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Deal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Deal_dealNumber_key" ON "Deal"("dealNumber");
CREATE INDEX IF NOT EXISTS "Deal_ownerId_idx" ON "Deal"("ownerId");
CREATE INDEX IF NOT EXISTS "Deal_stage_idx" ON "Deal"("stage");
CREATE INDEX IF NOT EXISTS "Deal_builderId_idx" ON "Deal"("builderId");
CREATE INDEX IF NOT EXISTS "Deal_expectedCloseDate_idx" ON "Deal"("expectedCloseDate");

-- ═══════════════════════════════════════════════════════════════
-- DealActivity
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "DealActivity" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "dealId"       TEXT NOT NULL,
  "staffId"      TEXT NOT NULL,
  "type"         "DealActivityType" NOT NULL,
  "subject"      TEXT NOT NULL,
  "notes"        TEXT,
  "outcome"      TEXT,
  "followUpDate" TIMESTAMP(3),
  "followUpDone" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DealActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DealActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DealActivity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "DealActivity_dealId_idx" ON "DealActivity"("dealId");
CREATE INDEX IF NOT EXISTS "DealActivity_staffId_idx" ON "DealActivity"("staffId");
CREATE INDEX IF NOT EXISTS "DealActivity_type_idx" ON "DealActivity"("type");
CREATE INDEX IF NOT EXISTS "DealActivity_followUpDate_idx" ON "DealActivity"("followUpDate");

-- ═══════════════════════════════════════════════════════════════
-- Add Contract.dealId column if missing (Deal -> Contract relation)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "dealId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Contract_dealId_idx" ON "Contract"("dealId");

-- ═══════════════════════════════════════════════════════════════
-- Done
-- ═══════════════════════════════════════════════════════════════
