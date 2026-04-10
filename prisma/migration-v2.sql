-- ============================================================
-- Abel Lumber Platform — Schema Migration V2
-- New tables for builder hierarchy, integrations, comms, takeoffs
-- Run this in your Neon SQL Editor
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE "OrgType" AS ENUM ('NATIONAL', 'REGIONAL', 'LOCAL', 'CUSTOM_HOME', 'COMMERCIAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BuilderRole" AS ENUM ('PRIMARY', 'SUPERINTENDENT', 'PURCHASING', 'PROJECT_MANAGER', 'ESTIMATOR', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LeadSource" AS ENUM ('AI_TAKEOFF', 'REFERRAL', 'WEBSITE', 'TRADE_SHOW', 'COLD_CALL', 'HYPHEN', 'EXISTING', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PriceType" AS ENUM ('FIXED', 'DISCOUNT_PCT', 'COST_PLUS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CommChannel" AS ENUM ('EMAIL', 'PHONE', 'TEXT', 'IN_PERSON', 'VIDEO_CALL', 'HYPHEN_NOTIFICATION', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CommDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CommLogStatus" AS ENUM ('LOGGED', 'NEEDS_FOLLOW_UP', 'FOLLOWED_UP', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IntegrationProvider" AS ENUM ('INFLOW', 'ECI_BOLT', 'GMAIL', 'HYPHEN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'CONFIGURING', 'CONNECTED', 'ERROR', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SyncDirection" AS ENUM ('PULL', 'PUSH', 'BIDIRECTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'REVIEWING', 'ASSIGNED', 'TAKEOFF_IN_PROGRESS', 'TAKEOFF_COMPLETE', 'QUOTE_SENT', 'CONVERTED', 'DECLINED', 'STALE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "InquiryPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- BuilderOrganization
-- ============================================================
CREATE TABLE IF NOT EXISTS "BuilderOrganization" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" "OrgType" NOT NULL DEFAULT 'NATIONAL',
  "contactName" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,
  "website" TEXT,
  "boltCustomerId" TEXT,
  "inflowCustomerId" TEXT,
  "hyphenSupplierId" TEXT,
  "defaultPaymentTerm" "PaymentTerm" NOT NULL DEFAULT 'NET_30',
  "creditLimit" DOUBLE PRECISION,
  "taxExempt" BOOLEAN NOT NULL DEFAULT false,
  "taxId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuilderOrganization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BuilderOrganization_name_key" ON "BuilderOrganization"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "BuilderOrganization_code_key" ON "BuilderOrganization"("code");
CREATE INDEX IF NOT EXISTS "BuilderOrganization_name_idx" ON "BuilderOrganization"("name");
CREATE INDEX IF NOT EXISTS "BuilderOrganization_code_idx" ON "BuilderOrganization"("code");

-- ============================================================
-- Community
-- ============================================================
CREATE TABLE IF NOT EXISTS "Community" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,
  "address" TEXT,
  "hyphenProjectId" TEXT,
  "totalLots" INTEGER,
  "activeLots" INTEGER NOT NULL DEFAULT 0,
  "completedLots" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Community_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Community_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BuilderOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Community_organizationId_name_key" ON "Community"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "Community_organizationId_idx" ON "Community"("organizationId");

-- ============================================================
-- FloorPlan
-- ============================================================
CREATE TABLE IF NOT EXISTS "FloorPlan" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "communityId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sqFootage" INTEGER,
  "bedrooms" INTEGER,
  "bathrooms" DOUBLE PRECISION,
  "stories" INTEGER,
  "interiorDoorCount" INTEGER,
  "exteriorDoorCount" INTEGER,
  "standardPackageId" TEXT,
  "basePackagePrice" DOUBLE PRECISION,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FloorPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FloorPlan_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "FloorPlan_communityId_name_key" ON "FloorPlan"("communityId", "name");
CREATE INDEX IF NOT EXISTS "FloorPlan_communityId_idx" ON "FloorPlan"("communityId");

-- ============================================================
-- Contract
-- ============================================================
CREATE TABLE IF NOT EXISTS "Contract" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "paymentTerm" "PaymentTerm" NOT NULL,
  "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rebatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveDate" TIMESTAMP(3),
  "expirationDate" TIMESTAMP(3),
  "signedAt" TIMESTAMP(3),
  "signedBy" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Contract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BuilderOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Contract_contractNumber_key" ON "Contract"("contractNumber");
CREATE INDEX IF NOT EXISTS "Contract_organizationId_idx" ON "Contract"("organizationId");
CREATE INDEX IF NOT EXISTS "Contract_status_idx" ON "Contract"("status");

-- ============================================================
-- ContractPricingTier
-- ============================================================
CREATE TABLE IF NOT EXISTS "ContractPricingTier" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "contractId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "subcategory" TEXT,
  "priceType" "PriceType" NOT NULL DEFAULT 'FIXED',
  "fixedPrice" DOUBLE PRECISION,
  "discountPct" DOUBLE PRECISION,
  "costPlusPct" DOUBLE PRECISION,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ContractPricingTier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractPricingTier_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ContractPricingTier_contractId_idx" ON "ContractPricingTier"("contractId");

-- ============================================================
-- CommunicationLog
-- ============================================================
CREATE TABLE IF NOT EXISTS "CommunicationLog" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "builderId" TEXT,
  "organizationId" TEXT,
  "staffId" TEXT,
  "jobId" TEXT,
  "channel" "CommChannel" NOT NULL,
  "direction" "CommDirection" NOT NULL,
  "subject" TEXT,
  "body" TEXT,
  "bodyHtml" TEXT,
  "fromAddress" TEXT,
  "toAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "gmailMessageId" TEXT,
  "gmailThreadId" TEXT,
  "hyphenEventId" TEXT,
  "sentAt" TIMESTAMP(3),
  "duration" INTEGER,
  "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
  "attachmentCount" INTEGER NOT NULL DEFAULT 0,
  "aiSummary" TEXT,
  "aiSentiment" TEXT,
  "aiActionItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "CommLogStatus" NOT NULL DEFAULT 'LOGGED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunicationLog_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommunicationLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "BuilderOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommunicationLog_gmailMessageId_key" ON "CommunicationLog"("gmailMessageId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_builderId_idx" ON "CommunicationLog"("builderId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_organizationId_idx" ON "CommunicationLog"("organizationId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_staffId_idx" ON "CommunicationLog"("staffId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_jobId_idx" ON "CommunicationLog"("jobId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_channel_idx" ON "CommunicationLog"("channel");
CREATE INDEX IF NOT EXISTS "CommunicationLog_gmailThreadId_idx" ON "CommunicationLog"("gmailThreadId");
CREATE INDEX IF NOT EXISTS "CommunicationLog_sentAt_idx" ON "CommunicationLog"("sentAt");

-- ============================================================
-- CommAttachment
-- ============================================================
CREATE TABLE IF NOT EXISTS "CommAttachment" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "communicationLogId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "fileSize" INTEGER,
  "fileUrl" TEXT,
  "gmailAttachmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommAttachment_communicationLogId_fkey" FOREIGN KEY ("communicationLogId") REFERENCES "CommunicationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CommAttachment_communicationLogId_idx" ON "CommAttachment"("communicationLogId");

-- ============================================================
-- IntegrationConfig
-- ============================================================
CREATE TABLE IF NOT EXISTS "IntegrationConfig" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "provider" "IntegrationProvider" NOT NULL,
  "name" TEXT NOT NULL,
  "apiKey" TEXT,
  "apiSecret" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "baseUrl" TEXT,
  "companyId" TEXT,
  "webhookSecret" TEXT,
  "gmailWatchExpiry" TIMESTAMP(3),
  "gmailHistoryId" TEXT,
  "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "syncInterval" INTEGER NOT NULL DEFAULT 300,
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "lastSyncError" TEXT,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING',
  "configuredById" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationConfig_provider_key" ON "IntegrationConfig"("provider");
CREATE INDEX IF NOT EXISTS "IntegrationConfig_status_idx" ON "IntegrationConfig"("status");

-- ============================================================
-- SyncLog
-- ============================================================
CREATE TABLE IF NOT EXISTS "SyncLog" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "provider" "IntegrationProvider" NOT NULL,
  "syncType" TEXT NOT NULL,
  "direction" "SyncDirection" NOT NULL,
  "status" "SyncStatus" NOT NULL,
  "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
  "recordsCreated" INTEGER NOT NULL DEFAULT 0,
  "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
  "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
  "recordsFailed" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "errorDetails" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SyncLog_provider_idx" ON "SyncLog"("provider");
CREATE INDEX IF NOT EXISTS "SyncLog_syncType_idx" ON "SyncLog"("syncType");
CREATE INDEX IF NOT EXISTS "SyncLog_status_idx" ON "SyncLog"("status");
CREATE INDEX IF NOT EXISTS "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- ============================================================
-- TakeoffInquiry
-- ============================================================
CREATE TABLE IF NOT EXISTS "TakeoffInquiry" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "inquiryNumber" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "companyName" TEXT,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "blueprintUrl" TEXT,
  "blueprintPages" INTEGER,
  "projectAddress" TEXT,
  "projectCity" TEXT,
  "projectState" TEXT,
  "projectType" TEXT,
  "scopeNotes" TEXT,
  "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
  "priority" "InquiryPriority" NOT NULL DEFAULT 'NORMAL',
  "assignedToId" TEXT,
  "assignedAt" TIMESTAMP(3),
  "convertedBuilderId" TEXT,
  "convertedProjectId" TEXT,
  "convertedAt" TIMESTAMP(3),
  "aiEstimatedValue" DOUBLE PRECISION,
  "aiComplexity" TEXT,
  "aiNotes" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TakeoffInquiry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TakeoffInquiry_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TakeoffInquiry_inquiryNumber_key" ON "TakeoffInquiry"("inquiryNumber");
CREATE INDEX IF NOT EXISTS "TakeoffInquiry_status_idx" ON "TakeoffInquiry"("status");
CREATE INDEX IF NOT EXISTS "TakeoffInquiry_assignedToId_idx" ON "TakeoffInquiry"("assignedToId");
CREATE INDEX IF NOT EXISTS "TakeoffInquiry_email_idx" ON "TakeoffInquiry"("email");

-- ============================================================
-- Add new columns to Builder
-- ============================================================
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "role" "BuilderRole" NOT NULL DEFAULT 'PRIMARY';
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "source" "LeadSource";
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "sourceDetail" TEXT;

DO $$ BEGIN
  ALTER TABLE "Builder" ADD CONSTRAINT "Builder_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "BuilderOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Builder_organizationId_idx" ON "Builder"("organizationId");

-- ============================================================
-- Add new columns to Job
-- ============================================================
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "communityId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "hyphenJobId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "hyphenScheduleId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Job" ADD CONSTRAINT "Job_communityId_fkey"
    FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
