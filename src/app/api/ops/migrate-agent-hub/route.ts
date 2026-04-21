export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_AGENT_HUB', 'Database', undefined, { migration: 'RUN_MIGRATE_AGENT_HUB' }, 'CRITICAL').catch(() => {})

  const results: { table: string; status: string; error?: string }[] = []

  const tables = [
    {
      name: 'AgentTask',
      sql: `CREATE TABLE IF NOT EXISTS "AgentTask" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "agentRole" TEXT NOT NULL,
        "taskType" TEXT NOT NULL,
        "priority" TEXT NOT NULL DEFAULT 'NORMAL',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "title" TEXT NOT NULL,
        "description" TEXT,
        "payload" JSONB,
        "result" JSONB,
        "createdBy" TEXT NOT NULL,
        "assignedTo" TEXT,
        "parentTaskId" TEXT,
        "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
        "approvedBy" TEXT,
        "approvedAt" TIMESTAMP(3),
        "claimedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "failedAt" TIMESTAMP(3),
        "failReason" TEXT,
        "dueBy" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
      )`
    },
    {
      name: 'AgentTask_indexes',
      sqls: [
        `CREATE INDEX IF NOT EXISTS "idx_agenttask_role_status" ON "AgentTask"("agentRole", "status")`,
        `CREATE INDEX IF NOT EXISTS "idx_agenttask_priority" ON "AgentTask"("priority", "createdAt")`,
        `CREATE INDEX IF NOT EXISTS "idx_agenttask_assignedto" ON "AgentTask"("assignedTo", "status")`,
        `CREATE INDEX IF NOT EXISTS "idx_agenttask_parent" ON "AgentTask"("parentTaskId")`,
        `CREATE INDEX IF NOT EXISTS "idx_agenttask_type" ON "AgentTask"("taskType", "status")`,
        `CREATE INDEX IF NOT EXISTS "idx_agenttask_approval" ON "AgentTask"("requiresApproval", "status") WHERE "requiresApproval" = true`
      ]
    },
    {
      name: 'AgentMessage_drop',
      sql: `DROP TABLE IF EXISTS "AgentMessage" CASCADE`
    },
    {
      name: 'AgentMessage',
      sql: `CREATE TABLE IF NOT EXISTS "AgentMessage" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "fromAgent" TEXT NOT NULL,
        "toAgent" TEXT NOT NULL,
        "messageType" TEXT NOT NULL DEFAULT 'INFO',
        "subject" TEXT NOT NULL,
        "body" JSONB,
        "priority" TEXT NOT NULL DEFAULT 'NORMAL',
        "relatedTaskId" TEXT,
        "readAt" TIMESTAMP(3),
        "respondedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "AgentMessage_relatedTaskId_fkey" FOREIGN KEY ("relatedTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`
    },
    {
      name: 'AgentMessage_indexes',
      sqls: [
        `CREATE INDEX IF NOT EXISTS "idx_agentmsg_to" ON "AgentMessage"("toAgent", "readAt")`,
        `CREATE INDEX IF NOT EXISTS "idx_agentmsg_from" ON "AgentMessage"("fromAgent", "createdAt")`,
        `CREATE INDEX IF NOT EXISTS "idx_agentmsg_type" ON "AgentMessage"("messageType")`
      ]
    },
    {
      name: 'AgentSession',
      sql: `CREATE TABLE IF NOT EXISTS "AgentSession" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "agentRole" TEXT NOT NULL UNIQUE,
        "status" TEXT NOT NULL DEFAULT 'OFFLINE',
        "currentTaskId" TEXT,
        "lastHeartbeat" TIMESTAMP(3),
        "tasksCompletedToday" INTEGER NOT NULL DEFAULT 0,
        "tasksFailedToday" INTEGER NOT NULL DEFAULT 0,
        "errorsToday" INTEGER NOT NULL DEFAULT 0,
        "startedAt" TIMESTAMP(3),
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "AgentSession_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`
    },
    {
      name: 'AgentConfig',
      sql: `CREATE TABLE IF NOT EXISTS "AgentConfig" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "agentRole" TEXT NOT NULL,
        "configKey" TEXT NOT NULL,
        "configValue" JSONB NOT NULL,
        "description" TEXT,
        "updatedBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "AgentConfig_role_key_unique" UNIQUE ("agentRole", "configKey")
      )`
    },
    {
      name: 'AgentConfig_index',
      sqls: [
        `CREATE INDEX IF NOT EXISTS "idx_agentconfig_role" ON "AgentConfig"("agentRole")`
      ]
    },
    {
      name: 'BuilderIntelligence',
      sql: `CREATE TABLE IF NOT EXISTS "BuilderIntelligence" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "builderId" TEXT NOT NULL UNIQUE,
        "avgOrderValue" DECIMAL(12,2) DEFAULT 0,
        "orderFrequencyDays" INTEGER DEFAULT 0,
        "lastOrderDate" TIMESTAMP(3),
        "totalLifetimeValue" DECIMAL(12,2) DEFAULT 0,
        "totalOrders" INTEGER DEFAULT 0,
        "topProductCategories" JSONB DEFAULT '[]'::jsonb,
        "seasonalPattern" JSONB DEFAULT '{}'::jsonb,
        "avgDaysToPayment" INTEGER DEFAULT 0,
        "onTimePaymentRate" DECIMAL(5,2) DEFAULT 0,
        "currentBalance" DECIMAL(12,2) DEFAULT 0,
        "creditRiskScore" INTEGER DEFAULT 50,
        "paymentTrend" TEXT DEFAULT 'STABLE',
        "healthScore" INTEGER DEFAULT 50,
        "orderTrend" TEXT DEFAULT 'STABLE',
        "daysSinceLastOrder" INTEGER DEFAULT 0,
        "daysSinceLastCommunication" INTEGER DEFAULT 0,
        "complaintCount" INTEGER DEFAULT 0,
        "npsScore" INTEGER,
        "priceElasticity" TEXT DEFAULT 'MEDIUM',
        "acceptsStandardPricing" BOOLEAN DEFAULT true,
        "negotiatedCategories" JSONB DEFAULT '[]'::jsonb,
        "missingCategories" JSONB DEFAULT '[]'::jsonb,
        "estimatedWalletShare" DECIMAL(5,2) DEFAULT 0,
        "crossSellScore" INTEGER DEFAULT 0,
        "nextOrderEstimate" TIMESTAMP(3),
        "estimatedNextOrderValue" DECIMAL(12,2) DEFAULT 0,
        "activeProjectCount" INTEGER DEFAULT 0,
        "pipelineValue" DECIMAL(12,2) DEFAULT 0,
        "dataQualityScore" INTEGER DEFAULT 0,
        "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BuilderIntelligence_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BuilderIntelligence_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`
    },
    {
      name: 'BuilderIntelligence_indexes',
      sqls: [
        `CREATE INDEX IF NOT EXISTS "idx_bi_builder" ON "BuilderIntelligence"("builderId")`,
        `CREATE INDEX IF NOT EXISTS "idx_bi_health" ON "BuilderIntelligence"("healthScore")`,
        `CREATE INDEX IF NOT EXISTS "idx_bi_trend" ON "BuilderIntelligence"("orderTrend")`,
        `CREATE INDEX IF NOT EXISTS "idx_bi_risk" ON "BuilderIntelligence"("creditRiskScore")`,
        `CREATE INDEX IF NOT EXISTS "idx_bi_crosssell" ON "BuilderIntelligence"("crossSellScore" DESC)`
      ]
    }
  ]

  // Seed initial agent sessions and default configs
  const seeds = [
    {
      name: 'AgentSession_seeds',
      sqls: [
        `INSERT INTO "AgentSession" ("id", "agentRole", "status") VALUES (gen_random_uuid()::text, 'SALES', 'OFFLINE') ON CONFLICT ("agentRole") DO NOTHING`,
        `INSERT INTO "AgentSession" ("id", "agentRole", "status") VALUES (gen_random_uuid()::text, 'MARKETING', 'OFFLINE') ON CONFLICT ("agentRole") DO NOTHING`,
        `INSERT INTO "AgentSession" ("id", "agentRole", "status") VALUES (gen_random_uuid()::text, 'OPS', 'OFFLINE') ON CONFLICT ("agentRole") DO NOTHING`,
        `INSERT INTO "AgentSession" ("id", "agentRole", "status") VALUES (gen_random_uuid()::text, 'CUSTOMER_SUCCESS', 'OFFLINE') ON CONFLICT ("agentRole") DO NOTHING`,
        `INSERT INTO "AgentSession" ("id", "agentRole", "status") VALUES (gen_random_uuid()::text, 'INTEL', 'OFFLINE') ON CONFLICT ("agentRole") DO NOTHING`,
        `INSERT INTO "AgentSession" ("id", "agentRole", "status") VALUES (gen_random_uuid()::text, 'COORDINATOR', 'OFFLINE') ON CONFLICT ("agentRole") DO NOTHING`
      ]
    },
    {
      name: 'AgentConfig_defaults',
      sqls: [
        // Work hours for all agents
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'COORDINATOR', 'work_hours', '{"start": "06:00", "end": "22:00", "timezone": "America/Chicago"}'::jsonb, 'Coordinator work hours') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'SALES', 'work_hours', '{"start": "07:00", "end": "18:00", "timezone": "America/Chicago"}'::jsonb, 'Sales agent work hours') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'MARKETING', 'work_hours', '{"start": "06:00", "end": "20:00", "timezone": "America/Chicago"}'::jsonb, 'Marketing agent work hours') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'OPS', 'work_hours', '{"start": "05:00", "end": "20:00", "timezone": "America/Chicago"}'::jsonb, 'Ops agent work hours') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'CUSTOMER_SUCCESS', 'work_hours', '{"start": "07:00", "end": "19:00", "timezone": "America/Chicago"}'::jsonb, 'Customer success agent work hours') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'INTEL', 'work_hours', '{"start": "02:00", "end": "06:00", "timezone": "America/Chicago"}'::jsonb, 'Intel agent runs in off-hours') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        // Approval thresholds
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'SALES', 'approval_threshold', '{"max_discount_pct": 10, "max_outreach_per_day": 25, "requires_approval_for": ["ACCOUNT_HOLD", "PRICE_OVERRIDE"]}'::jsonb, 'Sales agent approval thresholds') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'OPS', 'approval_threshold', '{"max_auto_schedule": 20, "requires_approval_for": ["ACCOUNT_HOLD", "REFUND", "CREDIT_MEMO"]}'::jsonb, 'Ops agent approval thresholds') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        // Task limits
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'SALES', 'task_limits', '{"max_tasks_per_hour": 15, "max_concurrent": 3}'::jsonb, 'Sales agent task rate limits') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'MARKETING', 'task_limits', '{"max_tasks_per_hour": 10, "max_concurrent": 2}'::jsonb, 'Marketing agent task rate limits') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'OPS', 'task_limits', '{"max_tasks_per_hour": 30, "max_concurrent": 5}'::jsonb, 'Ops agent task rate limits') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'CUSTOMER_SUCCESS', 'task_limits', '{"max_tasks_per_hour": 20, "max_concurrent": 3}'::jsonb, 'Customer success task rate limits') ON CONFLICT ("agentRole", "configKey") DO NOTHING`,
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description") VALUES (gen_random_uuid()::text, 'INTEL', 'task_limits', '{"max_tasks_per_hour": 50, "max_concurrent": 10}'::jsonb, 'Intel agent task rate limits') ON CONFLICT ("agentRole", "configKey") DO NOTHING`
      ]
    },
    {
      name: 'AgentStaffAccounts',
      sqls: [
        // Agent staff accounts — each agent gets its own staff login
        // Password: AgentAccess2026! (bcrypt hash below)
        // Include createdAt + updatedAt since Prisma schema requires them
        "INSERT INTO \"Staff\" (\"id\", \"firstName\", \"lastName\", \"email\", \"passwordHash\", \"role\", \"department\", \"title\", \"active\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid()::text, 'Abel', 'Sales AI', 'sales.agent@abellumber.com', '$2a$12$giKjeHevNlb8CKLTV/w6tegG9nwlzbgR0X53creZpgNkihXiZrsg.', 'SALES_REP'::\"StaffRole\", 'SALES'::\"Department\", 'AI Sales Agent', true, NOW(), NOW()) ON CONFLICT (\"email\") DO NOTHING",
        "INSERT INTO \"Staff\" (\"id\", \"firstName\", \"lastName\", \"email\", \"passwordHash\", \"role\", \"department\", \"title\", \"active\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid()::text, 'Abel', 'Marketing AI', 'marketing.agent@abellumber.com', '$2a$12$giKjeHevNlb8CKLTV/w6tegG9nwlzbgR0X53creZpgNkihXiZrsg.', 'MANAGER'::\"StaffRole\", 'SALES'::\"Department\", 'AI Marketing Agent', true, NOW(), NOW()) ON CONFLICT (\"email\") DO NOTHING",
        "INSERT INTO \"Staff\" (\"id\", \"firstName\", \"lastName\", \"email\", \"passwordHash\", \"role\", \"department\", \"title\", \"active\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid()::text, 'Abel', 'Ops AI', 'ops.agent@abellumber.com', '$2a$12$giKjeHevNlb8CKLTV/w6tegG9nwlzbgR0X53creZpgNkihXiZrsg.', 'MANAGER'::\"StaffRole\", 'OPERATIONS'::\"Department\", 'AI Operations Agent', true, NOW(), NOW()) ON CONFLICT (\"email\") DO NOTHING",
        "INSERT INTO \"Staff\" (\"id\", \"firstName\", \"lastName\", \"email\", \"passwordHash\", \"role\", \"department\", \"title\", \"active\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid()::text, 'Abel', 'Success AI', 'success.agent@abellumber.com', '$2a$12$giKjeHevNlb8CKLTV/w6tegG9nwlzbgR0X53creZpgNkihXiZrsg.', 'PROJECT_MANAGER'::\"StaffRole\", 'OPERATIONS'::\"Department\", 'AI Customer Success Agent', true, NOW(), NOW()) ON CONFLICT (\"email\") DO NOTHING",
        "INSERT INTO \"Staff\" (\"id\", \"firstName\", \"lastName\", \"email\", \"passwordHash\", \"role\", \"department\", \"title\", \"active\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid()::text, 'Abel', 'Intel AI', 'intel.agent@abellumber.com', '$2a$12$giKjeHevNlb8CKLTV/w6tegG9nwlzbgR0X53creZpgNkihXiZrsg.', 'ADMIN'::\"StaffRole\", 'EXECUTIVE'::\"Department\", 'AI Intelligence Agent', true, NOW(), NOW()) ON CONFLICT (\"email\") DO NOTHING",
        "INSERT INTO \"Staff\" (\"id\", \"firstName\", \"lastName\", \"email\", \"passwordHash\", \"role\", \"department\", \"title\", \"active\", \"createdAt\", \"updatedAt\") VALUES (gen_random_uuid()::text, 'Abel', 'Coordinator', 'coordinator@abellumber.com', '$2a$12$giKjeHevNlb8CKLTV/w6tegG9nwlzbgR0X53creZpgNkihXiZrsg.', 'ADMIN'::\"StaffRole\", 'EXECUTIVE'::\"Department\", 'AI Coordinator Agent', true, NOW(), NOW()) ON CONFLICT (\"email\") DO NOTHING"
      ]
    }
  ]

  // Run table creation
  for (const table of tables) {
    try {
      if ('sqls' in table && table.sqls) {
        for (const stmt of table.sqls as string[]) {
          await prisma.$executeRawUnsafe(stmt)
        }
      } else {
        await prisma.$executeRawUnsafe(table.sql)
      }
      results.push({ table: table.name, status: 'OK' })
    } catch (err: any) {
      results.push({ table: table.name, status: 'ERROR', error: err.message?.slice(0, 300) })
    }
  }

  // Run seeds
  for (const seed of seeds) {
    try {
      for (const stmt of seed.sqls) {
        await prisma.$executeRawUnsafe(stmt)
      }
      results.push({ table: seed.name, status: 'OK' })
    } catch (err: any) {
      results.push({ table: seed.name, status: 'ERROR', error: err.message?.slice(0, 300) })
    }
  }

  return NextResponse.json({
    success: results.every(r => r.status === 'OK'),
    results
  })
}
