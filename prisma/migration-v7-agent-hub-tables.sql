-- Migration V7: Agent Hub Tables
-- Creates missing tables required by agent-hub API endpoints
-- Run with: psql $DATABASE_URL -f prisma/migration-v7-agent-hub-tables.sql

BEGIN;

-- ─── AGENT TASK ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentTask" (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agentRole"        TEXT NOT NULL,          -- SALES, MARKETING, OPS, CUSTOMER_SUCCESS, INTEL, COORDINATOR
  "taskType"         TEXT NOT NULL,          -- FOLLOW_UP, REORDER_CHECK, PRICING_REVIEW, etc.
  "priority"         TEXT NOT NULL DEFAULT 'NORMAL',  -- URGENT, HIGH, NORMAL, LOW
  "status"           TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, CLAIMED, IN_PROGRESS, COMPLETED, FAILED, CANCELLED
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "payload"          JSONB,
  "result"           JSONB,
  "createdBy"        TEXT NOT NULL,
  "assignedTo"       TEXT,
  "parentTaskId"     TEXT REFERENCES "AgentTask"("id") ON DELETE SET NULL,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "approvedBy"       TEXT,
  "approvedAt"       TIMESTAMP(3),
  "claimedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "failedAt"         TIMESTAMP(3),
  "failReason"       TEXT,
  "dueBy"            TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agenttask_role_status ON "AgentTask" ("agentRole", "status");
CREATE INDEX IF NOT EXISTS idx_agenttask_priority    ON "AgentTask" ("priority", "createdAt");
CREATE INDEX IF NOT EXISTS idx_agenttask_assignedto  ON "AgentTask" ("assignedTo", "status");
CREATE INDEX IF NOT EXISTS idx_agenttask_parent      ON "AgentTask" ("parentTaskId");
CREATE INDEX IF NOT EXISTS idx_agenttask_type        ON "AgentTask" ("taskType", "status");

-- ─── AGENT MESSAGE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentMessage" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "fromAgent"     TEXT NOT NULL,
  "toAgent"       TEXT NOT NULL,
  "messageType"   TEXT NOT NULL DEFAULT 'INFO',    -- INFO, REQUEST, ALERT, HANDOFF, REPORT, DIRECTIVE
  "subject"       TEXT NOT NULL,
  "body"          JSONB,
  "priority"      TEXT NOT NULL DEFAULT 'NORMAL',
  "relatedTaskId" TEXT REFERENCES "AgentTask"("id") ON DELETE SET NULL,
  "readAt"        TIMESTAMP(3),
  "respondedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agentmsg_to   ON "AgentMessage" ("toAgent", "readAt");
CREATE INDEX IF NOT EXISTS idx_agentmsg_from ON "AgentMessage" ("fromAgent", "createdAt");
CREATE INDEX IF NOT EXISTS idx_agentmsg_type ON "AgentMessage" ("messageType");

-- ─── AGENT CONVERSATION ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentConversation" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "builderId"     TEXT NOT NULL,
  "channel"       TEXT NOT NULL DEFAULT 'PORTAL', -- PORTAL, SMS, EMAIL
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, ESCALATED, RESOLVED, CLOSED
  "subject"       TEXT,
  "lastMessageAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "escalatedTo"   TEXT,
  "escalatedAt"   TIMESTAMP(3),
  "resolvedAt"    TIMESTAMP(3),
  "metadata"      JSONB DEFAULT '{}',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_conv_builder ON "AgentConversation" ("builderId");
CREATE INDEX IF NOT EXISTS idx_agent_conv_status  ON "AgentConversation" ("status");
CREATE INDEX IF NOT EXISTS idx_agent_conv_channel ON "AgentConversation" ("channel");

-- ─── BUILDER INTELLIGENCE ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BuilderIntelligence" (
  "id"                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "builderId"                TEXT NOT NULL UNIQUE,
  "avgOrderValue"            DECIMAL(12,2) DEFAULT 0,
  "orderFrequencyDays"       INTEGER DEFAULT 0,
  "lastOrderDate"            TIMESTAMP(3),
  "totalLifetimeValue"       DECIMAL(12,2) DEFAULT 0,
  "totalOrders"              INTEGER DEFAULT 0,
  "topProductCategories"     JSONB DEFAULT '[]',
  "seasonalPattern"          JSONB DEFAULT '{}',
  "avgDaysToPayment"         INTEGER DEFAULT 0,
  "onTimePaymentRate"        DECIMAL(5,2) DEFAULT 0,
  "currentBalance"           DECIMAL(12,2) DEFAULT 0,
  "creditRiskScore"          INTEGER DEFAULT 50,
  "paymentTrend"             TEXT DEFAULT 'STABLE',    -- STABLE, IMPROVING, DECLINING
  "healthScore"              INTEGER DEFAULT 50,
  "orderTrend"               TEXT DEFAULT 'STABLE',    -- STABLE, GROWING, DECLINING, CHURNING
  "daysSinceLastOrder"       INTEGER DEFAULT 0,
  "daysSinceLastCommunication" INTEGER DEFAULT 0,
  "complaintCount"           INTEGER DEFAULT 0,
  "npsScore"                 INTEGER,
  "priceElasticity"          TEXT DEFAULT 'MEDIUM',
  "acceptsStandardPricing"   BOOLEAN DEFAULT true,
  "negotiatedCategories"     JSONB DEFAULT '[]',
  "missingCategories"        JSONB DEFAULT '[]',
  "estimatedWalletShare"     DECIMAL(5,2) DEFAULT 0,
  "crossSellScore"           INTEGER DEFAULT 0,
  "nextOrderEstimate"        TIMESTAMP(3),
  "estimatedNextOrderValue"  DECIMAL(12,2) DEFAULT 0,
  "activeProjectCount"       INTEGER DEFAULT 0,
  "pipelineValue"            DECIMAL(12,2) DEFAULT 0,
  "dataQualityScore"         INTEGER DEFAULT 0,
  "lastUpdated"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bi_builder    ON "BuilderIntelligence" ("builderId");
CREATE INDEX IF NOT EXISTS idx_bi_health     ON "BuilderIntelligence" ("healthScore");
CREATE INDEX IF NOT EXISTS idx_bi_trend      ON "BuilderIntelligence" ("orderTrend");
CREATE INDEX IF NOT EXISTS idx_bi_risk       ON "BuilderIntelligence" ("creditRiskScore");
CREATE INDEX IF NOT EXISTS idx_bi_crosssell  ON "BuilderIntelligence" ("crossSellScore" DESC);

-- ─── PRICING RULE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PricingRule" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "ruleType"      TEXT NOT NULL,            -- VOLUME_BREAK, LOYALTY_DISCOUNT, EARLY_PAYMENT, INVENTORY_CLEARANCE, BUNDLE
  "conditions"    JSONB NOT NULL DEFAULT '{}',
  "adjustment"    JSONB NOT NULL DEFAULT '{}',
  "priority"      INTEGER NOT NULL DEFAULT 50,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "effectiveDate" TIMESTAMP(3),
  "expiryDate"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pricingrule_type ON "PricingRule" ("ruleType");

-- ─── AUTO PURCHASE ORDER ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AutoPurchaseOrder" (
  "id"             TEXT PRIMARY KEY,
  "vendorName"     TEXT NOT NULL DEFAULT 'Unknown',
  "vendorId"       TEXT,
  "status"         TEXT NOT NULL DEFAULT 'RECOMMENDED', -- RECOMMENDED, APPROVED, SENT
  "items"          JSONB NOT NULL DEFAULT '[]',
  "estimatedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason"         TEXT,
  "approvedBy"     TEXT,
  "approvedAt"     TIMESTAMP(3),
  "sentAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_autopo_status ON "AutoPurchaseOrder" ("status");

-- ─── WARRANTY CLAIM ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WarrantyClaim" (
  "id"                  TEXT PRIMARY KEY,
  "claimNumber"         TEXT NOT NULL UNIQUE,
  "policyId"            TEXT,
  "builderId"           TEXT,
  "orderId"             TEXT,
  "projectId"           TEXT,
  "type"                TEXT NOT NULL DEFAULT 'PRODUCT',   -- PRODUCT, SERVICE, INSTALLATION
  "status"              TEXT NOT NULL DEFAULT 'SUBMITTED',  -- SUBMITTED, UNDER_REVIEW, INSPECTION_SCHEDULED, APPROVED, IN_PROGRESS, RESOLVED, DENIED, CLOSED
  "priority"            TEXT NOT NULL DEFAULT 'MEDIUM',     -- URGENT, HIGH, MEDIUM, LOW
  "subject"             TEXT NOT NULL,
  "description"         TEXT NOT NULL,
  "productName"         TEXT,
  "productSku"          TEXT,
  "installDate"         TIMESTAMP(3),
  "issueDate"           TIMESTAMP(3),
  "photoUrls"           JSONB DEFAULT '[]',
  "contactName"         TEXT,
  "contactEmail"        TEXT,
  "contactPhone"        TEXT,
  "siteAddress"         TEXT,
  "siteCity"            TEXT,
  "siteState"           TEXT,
  "siteZip"             TEXT,
  "assignedTo"          TEXT,
  "submittedById"       TEXT,
  "resolutionType"      TEXT,              -- REPAIR, REPLACEMENT, REFUND, CREDIT, PARTIAL_CREDIT
  "resolutionNotes"     TEXT,
  "resolutionCost"      DOUBLE PRECISION DEFAULT 0,
  "creditAmount"        DOUBLE PRECISION DEFAULT 0,
  "replacementOrderId"  TEXT,
  "resolvedAt"          TIMESTAMP(3),
  "resolvedById"        TEXT,
  "internalNotes"       TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warrantyclaim_status   ON "WarrantyClaim" ("status");
CREATE INDEX IF NOT EXISTS idx_warrantyclaim_builder  ON "WarrantyClaim" ("builderId");
CREATE INDEX IF NOT EXISTS idx_warrantyclaim_number   ON "WarrantyClaim" ("claimNumber");
CREATE INDEX IF NOT EXISTS idx_warrantyclaim_type     ON "WarrantyClaim" ("type");
CREATE INDEX IF NOT EXISTS idx_warrantyclaim_assigned ON "WarrantyClaim" ("assignedTo");

COMMIT;
