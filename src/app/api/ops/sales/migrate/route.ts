import { audit } from '@/lib/audit'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDevAdmin } from '@/lib/api-auth'

// GET /api/ops/sales/migrate — Check existing table columns
export async function GET() {
  try {
    const cols: any[] = await prisma.$queryRawUnsafe(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name IN ('Contract', 'Deal', 'DealActivity', 'DocumentRequest', 'Payment', 'Invoice', 'Builder', 'QuoteRequest', 'BuilderApplication', 'AuditLog', 'EmailQueue', 'Task', 'SyncLog', 'Notification', 'WarrantyPolicy', 'WarrantyClaim', 'WarrantyInspection')
      ORDER BY table_name, ordinal_position
    `)
    return NextResponse.json({ columns: cols })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// POST /api/ops/sales/migrate — Create sales tables if they don't exist
export async function POST(request: NextRequest) {
  // R7 — DDL endpoint: ADMIN-only and prod-blocked.
  const authError = requireDevAdmin(request)
  if (authError) return authError

  const results: { step: string; status: string; error?: string }[] = []

  async function runStep(name: string, sql: string) {
    try {
    audit(request, 'RUN_SALES_MIGRATE', 'Database', undefined, { migration: 'RUN_SALES_MIGRATE' }, 'CRITICAL').catch(() => {})
      await prisma.$executeRawUnsafe(sql)
      results.push({ step: name, status: 'ok' })
    } catch (err: any) {
      results.push({ step: name, status: 'error', error: err.message?.slice(0, 200) })
    }
  }

  try {
    const staffRole = request.headers.get('x-staff-role')
    if (staffRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    // 1. Create enums
    await runStep('enum DealStage', `
      DO $$ BEGIN
        CREATE TYPE "DealStage" AS ENUM ('PROSPECT', 'DISCOVERY', 'WALKTHROUGH', 'BID_SUBMITTED', 'BID_REVIEW', 'NEGOTIATION', 'WON', 'LOST', 'ONBOARDED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('enum DealSource', `
      DO $$ BEGIN
        CREATE TYPE "DealSource" AS ENUM ('OUTBOUND', 'REFERRAL', 'INBOUND', 'TRADE_SHOW', 'REACTIVATION');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    // Add new DealSource values if they don't exist
    await runStep('add DealSource WEBSITE', `
      DO $$ BEGIN
        ALTER TYPE "DealSource" ADD VALUE IF NOT EXISTS 'WEBSITE';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)
    await runStep('add DealSource EXISTING_CUSTOMER', `
      DO $$ BEGIN
        ALTER TYPE "DealSource" ADD VALUE IF NOT EXISTS 'EXISTING_CUSTOMER';
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('enum DealActivityType', `
      DO $$ BEGIN
        CREATE TYPE "DealActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'TEXT', 'NOTE', 'STAGE_CHANGE', 'BID_SENT', 'BID_REVISED', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'DOCUMENT_REQUESTED', 'DOCUMENT_RECEIVED', 'FOLLOW_UP');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('enum ContractType', `
      DO $$ BEGIN
        CREATE TYPE "ContractType" AS ENUM ('SUPPLY_AGREEMENT', 'MASTER_SERVICE', 'PRICING_AGREEMENT', 'NDA', 'CREDIT_APPLICATION');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('enum ContractStatus', `
      DO $$ BEGIN
        CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'INTERNAL_REVIEW', 'SENT', 'BUILDER_REVIEW', 'REVISION_REQUESTED', 'SIGNED', 'ACTIVE', 'EXPIRED', 'TERMINATED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('enum DocumentType', `
      DO $$ BEGIN
        CREATE TYPE "DocumentType" AS ENUM ('COI', 'W9', 'CREDIT_APPLICATION', 'BUSINESS_LICENSE', 'TAX_EXEMPT_CERT', 'BOND', 'REFERENCES', 'FINANCIAL_STATEMENT', 'OTHER');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('enum DocumentRequestStatus', `
      DO $$ BEGIN
        CREATE TYPE "DocumentRequestStatus" AS ENUM ('PENDING', 'SENT', 'RECEIVED', 'APPROVED', 'REJECTED', 'EXPIRED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    // 2. Create Deal table
    await runStep('table Deal', `
      CREATE TABLE IF NOT EXISTS "Deal" (
        "id" TEXT NOT NULL,
        "dealNumber" TEXT NOT NULL,
        "companyName" TEXT NOT NULL,
        "contactName" TEXT NOT NULL,
        "contactEmail" TEXT,
        "contactPhone" TEXT,
        "address" TEXT,
        "city" TEXT,
        "state" TEXT,
        "zip" TEXT,
        "stage" "DealStage" NOT NULL DEFAULT 'PROSPECT',
        "probability" INTEGER NOT NULL DEFAULT 10,
        "dealValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "source" "DealSource" NOT NULL DEFAULT 'OUTBOUND',
        "expectedCloseDate" TIMESTAMP(3),
        "actualCloseDate" TIMESTAMP(3),
        "lostDate" TIMESTAMP(3),
        "lostReason" TEXT,
        "ownerId" TEXT NOT NULL,
        "builderId" TEXT,
        "description" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
      );
    `)

    await runStep('index Deal_dealNumber', `CREATE UNIQUE INDEX IF NOT EXISTS "Deal_dealNumber_key" ON "Deal"("dealNumber");`)
    await runStep('index Deal_ownerId', `CREATE INDEX IF NOT EXISTS "Deal_ownerId_idx" ON "Deal"("ownerId");`)
    await runStep('index Deal_stage', `CREATE INDEX IF NOT EXISTS "Deal_stage_idx" ON "Deal"("stage");`)
    await runStep('index Deal_builderId', `CREATE INDEX IF NOT EXISTS "Deal_builderId_idx" ON "Deal"("builderId");`)
    await runStep('index Deal_expectedCloseDate', `CREATE INDEX IF NOT EXISTS "Deal_expectedCloseDate_idx" ON "Deal"("expectedCloseDate");`)

    // 3. Create DealActivity table
    await runStep('table DealActivity', `
      CREATE TABLE IF NOT EXISTS "DealActivity" (
        "id" TEXT NOT NULL,
        "dealId" TEXT NOT NULL,
        "staffId" TEXT NOT NULL,
        "type" "DealActivityType" NOT NULL,
        "subject" TEXT NOT NULL,
        "notes" TEXT,
        "outcome" TEXT,
        "followUpDate" TIMESTAMP(3),
        "followUpDone" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DealActivity_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DealActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE
      );
    `)

    await runStep('index DealActivity_dealId', `CREATE INDEX IF NOT EXISTS "DealActivity_dealId_idx" ON "DealActivity"("dealId");`)
    await runStep('index DealActivity_staffId', `CREATE INDEX IF NOT EXISTS "DealActivity_staffId_idx" ON "DealActivity"("staffId");`)
    await runStep('index DealActivity_type', `CREATE INDEX IF NOT EXISTS "DealActivity_type_idx" ON "DealActivity"("type");`)
    await runStep('index DealActivity_followUpDate', `CREATE INDEX IF NOT EXISTS "DealActivity_followUpDate_idx" ON "DealActivity"("followUpDate");`)

    // 4. Contract table already exists from older migration — ALTER to add missing columns
    // Add columns needed by sales portal (IF NOT EXISTS via DO blocks)
    const contractAlterColumns = [
      { name: 'dealId', sql: `ALTER TABLE "Contract" ADD COLUMN "dealId" TEXT` },
      { name: 'builderId', sql: `ALTER TABLE "Contract" ADD COLUMN "builderId" TEXT` },
      { name: 'type', sql: `ALTER TABLE "Contract" ADD COLUMN "type" "ContractType" DEFAULT 'SUPPLY_AGREEMENT'` },
      { name: 'creditLimit', sql: `ALTER TABLE "Contract" ADD COLUMN "creditLimit" DOUBLE PRECISION` },
      { name: 'estimatedAnnual', sql: `ALTER TABLE "Contract" ADD COLUMN "estimatedAnnual" DOUBLE PRECISION` },
      { name: 'terms', sql: `ALTER TABLE "Contract" ADD COLUMN "terms" TEXT` },
      { name: 'specialClauses', sql: `ALTER TABLE "Contract" ADD COLUMN "specialClauses" TEXT` },
      { name: 'startDate', sql: `ALTER TABLE "Contract" ADD COLUMN "startDate" TIMESTAMP(3)` },
      { name: 'endDate', sql: `ALTER TABLE "Contract" ADD COLUMN "endDate" TIMESTAMP(3)` },
      { name: 'sentDate', sql: `ALTER TABLE "Contract" ADD COLUMN "sentDate" TIMESTAMP(3)` },
      { name: 'signedDate', sql: `ALTER TABLE "Contract" ADD COLUMN "signedDate" TIMESTAMP(3)` },
      { name: 'expiresDate', sql: `ALTER TABLE "Contract" ADD COLUMN "expiresDate" TIMESTAMP(3)` },
      { name: 'createdById', sql: `ALTER TABLE "Contract" ADD COLUMN "createdById" TEXT` },
      { name: 'documentUrl', sql: `ALTER TABLE "Contract" ADD COLUMN "documentUrl" TEXT` },
      { name: 'templateUsed', sql: `ALTER TABLE "Contract" ADD COLUMN "templateUsed" TEXT` },
    ]

    for (const col of contractAlterColumns) {
      await runStep(`alter Contract add ${col.name}`, `
        DO $$ BEGIN
          ${col.sql};
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
      `)
    }

    // Add FK constraint if not exists
    await runStep('fk Contract_dealId', `
      DO $$ BEGIN
        ALTER TABLE "Contract" ADD CONSTRAINT "Contract_dealId_fkey"
          FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)

    await runStep('index Contract_contractNumber', `CREATE UNIQUE INDEX IF NOT EXISTS "Contract_contractNumber_key" ON "Contract"("contractNumber");`)
    await runStep('index Contract_dealId', `CREATE INDEX IF NOT EXISTS "Contract_dealId_idx" ON "Contract"("dealId");`)
    await runStep('index Contract_builderId', `CREATE INDEX IF NOT EXISTS "Contract_builderId_idx" ON "Contract"("builderId");`)
    await runStep('index Contract_status', `CREATE INDEX IF NOT EXISTS "Contract_status_idx" ON "Contract"("status");`)
    await runStep('index Contract_createdById', `CREATE INDEX IF NOT EXISTS "Contract_createdById_idx" ON "Contract"("createdById");`)

    // 5. Create DocumentRequest table
    await runStep('table DocumentRequest', `
      CREATE TABLE IF NOT EXISTS "DocumentRequest" (
        "id" TEXT NOT NULL,
        "dealId" TEXT,
        "builderId" TEXT,
        "documentType" "DocumentType" NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "status" "DocumentRequestStatus" NOT NULL DEFAULT 'PENDING',
        "requestedById" TEXT NOT NULL,
        "fileUrl" TEXT,
        "fileName" TEXT,
        "dueDate" TIMESTAMP(3),
        "receivedDate" TIMESTAMP(3),
        "expiresDate" TIMESTAMP(3),
        "reminderSent" BOOLEAN NOT NULL DEFAULT false,
        "reminderDate" TIMESTAMP(3),
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DocumentRequest_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DocumentRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL
      );
    `)

    await runStep('index DocumentRequest_dealId', `CREATE INDEX IF NOT EXISTS "DocumentRequest_dealId_idx" ON "DocumentRequest"("dealId");`)
    await runStep('index DocumentRequest_builderId', `CREATE INDEX IF NOT EXISTS "DocumentRequest_builderId_idx" ON "DocumentRequest"("builderId");`)
    await runStep('index DocumentRequest_status', `CREATE INDEX IF NOT EXISTS "DocumentRequest_status_idx" ON "DocumentRequest"("status");`)
    await runStep('index DocumentRequest_documentType', `CREATE INDEX IF NOT EXISTS "DocumentRequest_documentType_idx" ON "DocumentRequest"("documentType");`)
    await runStep('index DocumentRequest_requestedById', `CREATE INDEX IF NOT EXISTS "DocumentRequest_requestedById_idx" ON "DocumentRequest"("requestedById");`)

    // 6. Create Notification table
    await runStep('table Notification', `
      CREATE TABLE IF NOT EXISTS "Notification" (
        "id" TEXT PRIMARY KEY,
        "staffId" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'INFO',
        "title" TEXT NOT NULL,
        "message" TEXT,
        "link" TEXT,
        "read" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)

    await runStep('index Notification_staffId', `CREATE INDEX IF NOT EXISTS "idx_notification_staff" ON "Notification" ("staffId", "read", "createdAt" DESC);`)

    // ── Phase 3: Audit Log ──
    await runStep('table AuditLog', `
      CREATE TABLE IF NOT EXISTS "AuditLog" (
        "id" TEXT PRIMARY KEY,
        "staffId" TEXT,
        "action" TEXT NOT NULL,
        "entity" TEXT NOT NULL,
        "entityId" TEXT,
        "details" JSONB,
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index AuditLog_staffId', `CREATE INDEX IF NOT EXISTS "idx_auditlog_staff" ON "AuditLog" ("staffId", "createdAt" DESC);`)
    await runStep('index AuditLog_entity', `CREATE INDEX IF NOT EXISTS "idx_auditlog_entity" ON "AuditLog" ("entity", "entityId");`)
    await runStep('index AuditLog_action', `CREATE INDEX IF NOT EXISTS "idx_auditlog_action" ON "AuditLog" ("action");`)
    await runStep('index AuditLog_createdAt', `CREATE INDEX IF NOT EXISTS "idx_auditlog_created" ON "AuditLog" ("createdAt" DESC);`)

    // ── Phase 3: Email Queue ──
    await runStep('table EmailQueue', `
      CREATE TABLE IF NOT EXISTS "EmailQueue" (
        "id" TEXT PRIMARY KEY,
        "to" TEXT NOT NULL,
        "subject" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "templateId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "attempts" INT NOT NULL DEFAULT 0,
        "lastError" TEXT,
        "scheduledFor" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
        "sentAt" TIMESTAMP(3),
        "dealId" TEXT,
        "staffId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index EmailQueue_status', `CREATE INDEX IF NOT EXISTS "idx_emailqueue_status" ON "EmailQueue" ("status", "scheduledFor");`)
    await runStep('index EmailQueue_dealId', `CREATE INDEX IF NOT EXISTS "idx_emailqueue_deal" ON "EmailQueue" ("dealId");`)

    // ── Phase 3: Task table (for workflow-generated tasks) ──
    await runStep('table Task', `
      CREATE TABLE IF NOT EXISTS "Task" (
        "id" TEXT PRIMARY KEY,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "assigneeId" TEXT,
        "dealId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
        "dueDate" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "createdById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    // Ensure Task columns exist (in case table pre-existed with different schema)
    const taskAlterCols = [
      { name: 'dealId', sql: `ALTER TABLE "Task" ADD COLUMN "dealId" TEXT` },
      { name: 'assigneeId', sql: `ALTER TABLE "Task" ADD COLUMN "assigneeId" TEXT` },
      { name: 'priority', sql: `ALTER TABLE "Task" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'MEDIUM'` },
      { name: 'dueDate', sql: `ALTER TABLE "Task" ADD COLUMN "dueDate" TIMESTAMP(3)` },
      { name: 'completedAt', sql: `ALTER TABLE "Task" ADD COLUMN "completedAt" TIMESTAMP(3)` },
      { name: 'createdById', sql: `ALTER TABLE "Task" ADD COLUMN "createdById" TEXT` },
    ]
    for (const col of taskAlterCols) {
      await runStep(`alter Task add ${col.name}`, `DO $$ BEGIN ${col.sql}; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`)
    }

    await runStep('index Task_assigneeId', `CREATE INDEX IF NOT EXISTS "idx_task_assignee" ON "Task" ("assigneeId", "status");`)
    await runStep('index Task_dealId', `CREATE INDEX IF NOT EXISTS "idx_task_deal" ON "Task" ("dealId");`)
    await runStep('index Task_status', `CREATE INDEX IF NOT EXISTS "idx_task_status" ON "Task" ("status", "dueDate");`)

    // ── Phase 3: Sync Log (for QuickBooks and future integrations) ──
    await runStep('table SyncLog', `
      CREATE TABLE IF NOT EXISTS "SyncLog" (
        "id" TEXT PRIMARY KEY,
        "integration" TEXT NOT NULL,
        "direction" TEXT NOT NULL DEFAULT 'PUSH',
        "entity" TEXT NOT NULL,
        "entityId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "details" JSONB,
        "error" TEXT,
        "syncedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    // Ensure SyncLog columns exist
    const syncLogAlterCols = [
      { name: 'integration', sql: `ALTER TABLE "SyncLog" ADD COLUMN "integration" TEXT NOT NULL DEFAULT 'QUICKBOOKS'` },
      { name: 'direction', sql: `ALTER TABLE "SyncLog" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'PUSH'` },
      { name: 'entity', sql: `ALTER TABLE "SyncLog" ADD COLUMN "entity" TEXT NOT NULL DEFAULT 'Invoice'` },
      { name: 'entityId', sql: `ALTER TABLE "SyncLog" ADD COLUMN "entityId" TEXT` },
      { name: 'details', sql: `ALTER TABLE "SyncLog" ADD COLUMN "details" JSONB` },
      { name: 'error', sql: `ALTER TABLE "SyncLog" ADD COLUMN "error" TEXT` },
      { name: 'syncedAt', sql: `ALTER TABLE "SyncLog" ADD COLUMN "syncedAt" TIMESTAMP(3)` },
    ]
    for (const col of syncLogAlterCols) {
      await runStep(`alter SyncLog add ${col.name}`, `DO $$ BEGIN ${col.sql}; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`)
    }

    await runStep('index SyncLog_integration', `CREATE INDEX IF NOT EXISTS "idx_synclog_integration" ON "SyncLog" ("integration", "status");`)

    // ── Phase 4: Builder Application table ──
    await runStep('table BuilderApplication', `
      CREATE TABLE IF NOT EXISTS "BuilderApplication" (
        "id" TEXT PRIMARY KEY,
        "builderId" TEXT,
        "companyName" TEXT NOT NULL,
        "contactName" TEXT NOT NULL,
        "contactEmail" TEXT NOT NULL,
        "contactPhone" TEXT,
        "address" TEXT,
        "city" TEXT,
        "state" TEXT,
        "zip" TEXT,
        "businessLicense" TEXT,
        "taxId" TEXT,
        "estimatedAnnualVolume" TEXT,
        "referralSource" TEXT,
        "notes" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
        "reviewedById" TEXT,
        "reviewNotes" TEXT,
        "reviewedAt" TIMESTAMP(3),
        "referenceNumber" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index BuilderApplication_status', `CREATE INDEX IF NOT EXISTS "idx_builderapplication_status" ON "BuilderApplication" ("status");`)
    await runStep('index BuilderApplication_email', `CREATE INDEX IF NOT EXISTS "idx_builderapplication_email" ON "BuilderApplication" ("contactEmail");`)

    // ── Phase 4: Payment table ──
    await runStep('table Payment', `
      CREATE TABLE IF NOT EXISTS "Payment" (
        "id" TEXT PRIMARY KEY,
        "invoiceId" TEXT,
        "builderId" TEXT,
        "amount" DOUBLE PRECISION NOT NULL,
        "method" TEXT NOT NULL DEFAULT 'CHECK',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "referenceNumber" TEXT,
        "notes" TEXT,
        "processedById" TEXT,
        "processedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    // Ensure Payment columns exist (table may pre-exist with different schema)
    const paymentAlterCols = [
      { name: 'builderId', sql: `ALTER TABLE "Payment" ADD COLUMN "builderId" TEXT` },
      { name: 'status', sql: `ALTER TABLE "Payment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING'` },
      { name: 'method', sql: `ALTER TABLE "Payment" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'CHECK'` },
      { name: 'referenceNumber', sql: `ALTER TABLE "Payment" ADD COLUMN "referenceNumber" TEXT` },
      { name: 'notes', sql: `ALTER TABLE "Payment" ADD COLUMN "notes" TEXT` },
      { name: 'processedById', sql: `ALTER TABLE "Payment" ADD COLUMN "processedById" TEXT` },
      { name: 'processedAt', sql: `ALTER TABLE "Payment" ADD COLUMN "processedAt" TIMESTAMP(3)` },
      { name: 'createdAt', sql: `ALTER TABLE "Payment" ADD COLUMN "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP` },
    ]
    for (const col of paymentAlterCols) {
      await runStep(`alter Payment add ${col.name}`, `DO $$ BEGIN ${col.sql}; EXCEPTION WHEN duplicate_column THEN NULL; END $$;`)
    }

    await runStep('index Payment_invoiceId', `CREATE INDEX IF NOT EXISTS "idx_payment_invoice" ON "Payment" ("invoiceId");`)
    await runStep('index Payment_builderId', `CREATE INDEX IF NOT EXISTS "idx_payment_builder" ON "Payment" ("builderId");`)
    await runStep('index Payment_status', `CREATE INDEX IF NOT EXISTS "idx_payment_status" ON "Payment" ("status");`)

    // ── Phase 4: Quote Request table ──
    await runStep('table QuoteRequest', `
      CREATE TABLE IF NOT EXISTS "QuoteRequest" (
        "id" TEXT PRIMARY KEY,
        "builderId" TEXT,
        "referenceNumber" TEXT,
        "projectName" TEXT NOT NULL,
        "projectAddress" TEXT,
        "city" TEXT,
        "state" TEXT,
        "zip" TEXT,
        "description" TEXT,
        "estimatedSquareFootage" DOUBLE PRECISION,
        "productCategories" JSONB DEFAULT '[]',
        "preferredDeliveryDate" TIMESTAMP(3),
        "attachmentUrls" JSONB DEFAULT '[]',
        "notes" TEXT,
        "status" TEXT NOT NULL DEFAULT 'NEW',
        "assignedTo" TEXT,
        "quoteId" TEXT,
        "staffNotes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index QuoteRequest_builderId', `CREATE INDEX IF NOT EXISTS "idx_quoterequest_builder" ON "QuoteRequest" ("builderId");`)
    await runStep('index QuoteRequest_status', `CREATE INDEX IF NOT EXISTS "idx_quoterequest_status" ON "QuoteRequest" ("status");`)

    // ── Phase 4: Ensure Builder table has approvalStatus column for approval workflow ──
    // Try both possible table names
    await runStep('alter Builder add approvalStatus', `
      DO $$ BEGIN
        ALTER TABLE "Builder" ADD COLUMN "approvalStatus" TEXT DEFAULT 'ACTIVE';
      EXCEPTION WHEN duplicate_column THEN NULL; WHEN undefined_table THEN NULL;
      END $$;
    `)
    await runStep('alter BuilderAccount add approvalStatus', `
      DO $$ BEGIN
        ALTER TABLE "BuilderAccount" ADD COLUMN "approvalStatus" TEXT DEFAULT 'ACTIVE';
      EXCEPTION WHEN duplicate_column THEN NULL; WHEN undefined_table THEN NULL;
      END $$;
    `)

    // ── Phase 5: Warranty Policy table ──
    await runStep('table WarrantyPolicy', `
      CREATE TABLE IF NOT EXISTS "WarrantyPolicy" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "type" TEXT NOT NULL DEFAULT 'PRODUCT',
        "category" TEXT,
        "description" TEXT,
        "durationMonths" INTEGER NOT NULL DEFAULT 12,
        "coverageDetails" TEXT,
        "exclusions" TEXT,
        "claimProcess" TEXT,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "appliesToProducts" JSONB DEFAULT '[]',
        "createdById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index WarrantyPolicy_type', `CREATE INDEX IF NOT EXISTS "idx_warrantypolicy_type" ON "WarrantyPolicy" ("type", "isActive");`)

    // ── Phase 5: Warranty Claim table ──
    await runStep('table WarrantyClaim', `
      CREATE TABLE IF NOT EXISTS "WarrantyClaim" (
        "id" TEXT PRIMARY KEY,
        "claimNumber" TEXT NOT NULL UNIQUE,
        "policyId" TEXT,
        "builderId" TEXT,
        "orderId" TEXT,
        "projectId" TEXT,
        "type" TEXT NOT NULL DEFAULT 'PRODUCT',
        "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
        "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
        "subject" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "productName" TEXT,
        "productSku" TEXT,
        "installDate" TIMESTAMP(3),
        "issueDate" TIMESTAMP(3),
        "photoUrls" JSONB DEFAULT '[]',
        "contactName" TEXT,
        "contactEmail" TEXT,
        "contactPhone" TEXT,
        "siteAddress" TEXT,
        "siteCity" TEXT,
        "siteState" TEXT,
        "siteZip" TEXT,
        "assignedTo" TEXT,
        "resolution" TEXT,
        "resolutionType" TEXT,
        "resolutionNotes" TEXT,
        "resolutionCost" DOUBLE PRECISION DEFAULT 0,
        "creditAmount" DOUBLE PRECISION DEFAULT 0,
        "replacementOrderId" TEXT,
        "resolvedAt" TIMESTAMP(3),
        "resolvedById" TEXT,
        "submittedById" TEXT,
        "internalNotes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index WarrantyClaim_status', `CREATE INDEX IF NOT EXISTS "idx_warrantyclaim_status" ON "WarrantyClaim" ("status");`)
    await runStep('index WarrantyClaim_builderId', `CREATE INDEX IF NOT EXISTS "idx_warrantyclaim_builder" ON "WarrantyClaim" ("builderId");`)
    await runStep('index WarrantyClaim_claimNumber', `CREATE INDEX IF NOT EXISTS "idx_warrantyclaim_number" ON "WarrantyClaim" ("claimNumber");`)
    await runStep('index WarrantyClaim_type', `CREATE INDEX IF NOT EXISTS "idx_warrantyclaim_type" ON "WarrantyClaim" ("type");`)
    await runStep('index WarrantyClaim_assignedTo', `CREATE INDEX IF NOT EXISTS "idx_warrantyclaim_assigned" ON "WarrantyClaim" ("assignedTo");`)

    // ── Phase 5: Warranty Inspection table ──
    await runStep('table WarrantyInspection', `
      CREATE TABLE IF NOT EXISTS "WarrantyInspection" (
        "id" TEXT PRIMARY KEY,
        "claimId" TEXT NOT NULL,
        "inspectorId" TEXT,
        "scheduledDate" TIMESTAMP(3),
        "completedDate" TIMESTAMP(3),
        "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
        "findings" TEXT,
        "recommendation" TEXT,
        "photoUrls" JSONB DEFAULT '[]',
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    await runStep('index WarrantyInspection_claimId', `CREATE INDEX IF NOT EXISTS "idx_warrantyinspection_claim" ON "WarrantyInspection" ("claimId");`)
    await runStep('index WarrantyInspection_status', `CREATE INDEX IF NOT EXISTS "idx_warrantyinspection_status" ON "WarrantyInspection" ("status");`)

    const errors = results.filter(r => r.status === 'error')
    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        message: `Migration completed with ${errors.length} errors`,
        results
      })
    }

    return NextResponse.json({ success: true, message: 'Sales tables created successfully', results })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json({ error: 'Migration failed', results }, { status: 500 })
  }
}
