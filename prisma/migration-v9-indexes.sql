-- Migration: Add Comprehensive Database Indexes
-- Version: v9
-- Purpose: Optimize query performance across Abel Lumber platform
--
-- This migration adds strategic indexes to frequently queried fields across the database.
-- Indexes improve SELECT, JOIN, and WHERE clause performance at the cost of slightly slower
-- writes and increased storage usage.
--
-- Safety: All indexes use CREATE INDEX IF NOT EXISTS to prevent errors if already created.
-- Run Time: Should complete in <5 seconds on typical database
-- Rollback: Manual index deletion if needed (DROP INDEX IF EXISTS "index_name")
--
-- To run this migration:
-- 1. Backup your database
-- 2. Connect to your Abel database
-- 3. Execute this file
-- 4. Run: npx prisma db push (or manual verification)

-- ═════════════════════════════════════════════════════════════════════════════════
-- BUILDER & STAFF INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Builder_createdAt_idx" ON "Builder" ("createdAt");
CREATE INDEX IF NOT EXISTS "Staff_createdAt_idx" ON "Staff" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- PROJECT, BLUEPRINT & TAKEOFF INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Project_createdAt_idx" ON "Project" ("createdAt");
CREATE INDEX IF NOT EXISTS "Blueprint_processingStatus_idx" ON "Blueprint" ("processingStatus");
CREATE INDEX IF NOT EXISTS "Takeoff_blueprintId_idx" ON "Takeoff" ("blueprintId");

-- ═════════════════════════════════════════════════════════════════════════════════
-- QUOTE & ORDER INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Quote_status_idx" ON "Quote" ("status");
CREATE INDEX IF NOT EXISTS "Quote_validUntil_idx" ON "Quote" ("validUntil");
CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order" ("paymentStatus");
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- JOB & TASK INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Job_orderId_idx" ON "Job" ("orderId");
CREATE INDEX IF NOT EXISTS "Job_projectId_idx" ON "Job" ("projectId");
CREATE INDEX IF NOT EXISTS "Task_creatorId_idx" ON "Task" ("creatorId");
CREATE INDEX IF NOT EXISTS "Task_category_idx" ON "Task" ("category");
CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- SCHEDULE & CREW INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "ScheduleEntry_jobId_idx" ON "ScheduleEntry" ("jobId");
CREATE INDEX IF NOT EXISTS "ScheduleEntry_crewId_idx" ON "ScheduleEntry" ("crewId");
CREATE INDEX IF NOT EXISTS "ScheduleEntry_entryType_idx" ON "ScheduleEntry" ("entryType");

-- ═════════════════════════════════════════════════════════════════════════════════
-- DELIVERY & INSTALLATION INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Delivery_crewId_idx" ON "Delivery" ("crewId");
CREATE INDEX IF NOT EXISTS "Delivery_createdAt_idx" ON "Delivery" ("createdAt");
CREATE INDEX IF NOT EXISTS "Installation_crewId_idx" ON "Installation" ("crewId");
CREATE INDEX IF NOT EXISTS "Installation_createdAt_idx" ON "Installation" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- VENDOR & PURCHASE ORDER INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Vendor_active_idx" ON "Vendor" ("active");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_createdById_idx" ON "PurchaseOrder" ("createdById");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_createdAt_idx" ON "PurchaseOrder" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- INVENTORY INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "InventoryItem_warehouseZone_idx" ON "InventoryItem" ("warehouseZone");
CREATE INDEX IF NOT EXISTS "InventoryItem_lastCountedAt_idx" ON "InventoryItem" ("lastCountedAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- INVOICE & PAYMENT INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Invoice_orderId_idx" ON "Invoice" ("orderId");
CREATE INDEX IF NOT EXISTS "Invoice_issuedAt_idx" ON "Invoice" ("issuedAt");
CREATE INDEX IF NOT EXISTS "Invoice_createdById_idx" ON "Invoice" ("createdById");

-- ═════════════════════════════════════════════════════════════════════════════════
-- MESSAGING & CONVERSATION INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message" ("createdAt");
CREATE INDEX IF NOT EXISTS "Conversation_createdAt_idx" ON "Conversation" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- SALES & DEAL INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Deal_createdAt_idx" ON "Deal" ("createdAt");
CREATE INDEX IF NOT EXISTS "Deal_source_idx" ON "Deal" ("source");
CREATE INDEX IF NOT EXISTS "Contract_builderId_idx" ON "Contract" ("builderId");
CREATE INDEX IF NOT EXISTS "Contract_startDate_idx" ON "Contract" ("startDate");

-- ═════════════════════════════════════════════════════════════════════════════════
-- DOCUMENT & COLLECTION INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "DocumentRequest_dueDate_idx" ON "DocumentRequest" ("dueDate");
CREATE INDEX IF NOT EXISTS "CollectionAction_createdAt_idx" ON "CollectionAction" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- PRODUCT & MATERIAL PICK INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Product_lastSyncedAt_idx" ON "Product" ("lastSyncedAt");
CREATE INDEX IF NOT EXISTS "MaterialPick_productId_idx" ON "MaterialPick" ("productId");
CREATE INDEX IF NOT EXISTS "MaterialPick_createdAt_idx" ON "MaterialPick" ("createdAt");

-- ═════════════════════════════════════════════════════════════════════════════════
-- ACTIVITY & DECISION NOTE INDEXES
-- ═════════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Activity_createdAt_idx" ON "Activity" ("createdAt");
CREATE INDEX IF NOT EXISTS "DecisionNote_authorId_idx" ON "DecisionNote" ("authorId");
CREATE INDEX IF NOT EXISTS "DecisionNote_priority_idx" ON "DecisionNote" ("priority");
CREATE INDEX IF NOT EXISTS "DecisionNote_createdAt_idx" ON "DecisionNote" ("createdAt");
