import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withCronRun } from '@/lib/cron'

// ────────────────────────────────────────────────────────────────────────────
// Data Quality Watchdog Cron
// Runs nightly at 2am (UTC). Evaluates rules, detects violations, auto-fixes issues.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_RULES = [
  {
    name: 'Jobs missing scheduled date',
    description: 'Active jobs without a scheduled delivery/install date',
    entity: 'Job',
    severity: 'CRITICAL',
    query: `SELECT id, "jobNumber" FROM "Job" WHERE "scheduledDate" IS NULL AND status NOT IN ('CANCELLED', 'COMPLETED')`,
    fixUrl: '/ops/jobs/{id}',
  },
  {
    name: 'Jobs missing builder assignment',
    description: 'Active jobs not assigned to a PM',
    entity: 'Job',
    severity: 'WARNING',
    query: `SELECT id, "jobNumber" FROM "Job" WHERE "builderId" IS NULL AND status NOT IN ('CANCELLED')`,
    fixUrl: '/ops/jobs/{id}',
  },
  {
    name: 'Products missing preferred vendor',
    description: 'Active products without a preferred vendor selected',
    entity: 'Product',
    severity: 'WARNING',
    query: `SELECT id, name FROM "Product" WHERE id NOT IN (SELECT "productId" FROM "VendorProduct" WHERE preferred = true) AND active = true`,
    fixUrl: '/ops/catalog/{id}',
  },
  {
    name: 'Builders missing credit terms',
    description: 'Active builders without payment terms configured',
    entity: 'Builder',
    severity: 'WARNING',
    query: `SELECT id, "companyName" FROM "Builder" WHERE ("paymentTermDays" IS NULL OR "paymentTermDays" = 0) AND status = 'ACTIVE'`,
    fixUrl: '/ops/accounts/{id}',
  },
  {
    name: 'Builders missing contact email',
    description: 'Active builders without a contact email',
    entity: 'Builder',
    severity: 'CRITICAL',
    query: `SELECT id, "companyName" FROM "Builder" WHERE (email IS NULL OR email = '') AND status = 'ACTIVE'`,
    fixUrl: '/ops/accounts/{id}',
  },
  {
    name: 'Invoices overdue 90+ days',
    description: 'Invoices unpaid for 90+ days',
    entity: 'Invoice',
    severity: 'CRITICAL',
    query: `SELECT id, "invoiceNumber" FROM "Invoice" WHERE "dueDate" < NOW() - INTERVAL '90 days' AND status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')`,
    fixUrl: '/ops/finance/invoices/{id}',
  },
  {
    name: 'POs stuck in DRAFT >7 days',
    description: 'Purchase orders in draft status for more than 7 days',
    entity: 'PurchaseOrder',
    severity: 'INFO',
    query: `SELECT id, "poNumber" FROM "PurchaseOrder" WHERE status = 'DRAFT' AND "createdAt" < NOW() - INTERVAL '7 days'`,
    fixUrl: '/ops/purchasing/po/{id}',
  },
  {
    name: 'Open jobs with no recent activity',
    description: 'Active jobs not updated in 30+ days',
    entity: 'Job',
    severity: 'WARNING',
    query: `SELECT id, "jobNumber" FROM "Job" WHERE "updatedAt" < NOW() - INTERVAL '30 days' AND status NOT IN ('CANCELLED', 'COMPLETED')`,
    fixUrl: '/ops/jobs/{id}',
  },
  {
    name: 'Products with zero cost',
    description: 'Active products without a cost set',
    entity: 'Product',
    severity: 'WARNING',
    query: `SELECT id, name FROM "Product" WHERE (cost IS NULL OR cost = 0) AND active = true`,
    fixUrl: '/ops/catalog/{id}',
  },
]

async function seedDefaultRules() {
  const countResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM "DataQualityRule"`
  )
  if ((countResult[0]?.count || 0) > 0) return

  logger.info('data_quality_seeding_rules', { count: DEFAULT_RULES.length })
  const now = new Date().toISOString()
  for (const rule of DEFAULT_RULES) {
    const id = `dqr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DataQualityRule" (id, name, description, entity, severity, query, "fixUrl", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8)`,
      id, rule.name, rule.description, rule.entity, rule.severity, rule.query, rule.fixUrl, now
    )
  }
}

async function evaluateRule(rule: any) {
  try {
    const violatingRows = await prisma.$queryRawUnsafe<Array<{ id: string; [key: string]: any }>>(rule.query)

    const existingIssues = await prisma.$queryRawUnsafe<Array<{ id: string; entityId: string }>>(
      `SELECT id, "entityId" FROM "DataQualityIssue" WHERE "ruleId" = $1 AND status != 'FIXED'`,
      rule.id
    )

    const existingEntityIds = new Set(existingIssues.map((i: any) => i.entityId))
    const currentEntityIds = new Set(violatingRows.map((r: any) => r.id))

    let newIssuesCount = 0
    let fixedIssuesCount = 0
    const now = new Date().toISOString()

    // Create issues for new violations
    for (const row of violatingRows) {
      if (!existingEntityIds.has(row.id)) {
        const label = row.jobNumber || row.name || row.companyName || row.invoiceNumber || row.poNumber || null
        const issueId = `dqi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(
          `INSERT INTO "DataQualityIssue" (id, "ruleId", "entityType", "entityId", "entityLabel", status, "createdAt")
           VALUES ($1, $2, $3, $4, $5, 'OPEN', $6)`,
          issueId, rule.id, rule.entity, row.id, label, now
        )
        newIssuesCount++
      }
    }

    // Auto-close fixed issues
    for (const issue of existingIssues) {
      if (!currentEntityIds.has(issue.entityId)) {
        await prisma.$executeRawUnsafe(
          `UPDATE "DataQualityIssue" SET status = 'FIXED', "fixedAt" = $1 WHERE id = $2`,
          now, issue.id
        )
        fixedIssuesCount++
      }
    }

    return { newIssues: newIssuesCount, fixedIssues: fixedIssuesCount }
  } catch (error: any) {
    logger.error('data_quality_rule_eval_failed', error, { ruleId: rule.id, ruleName: rule.name })
    return { newIssues: 0, fixedIssues: 0, error: error.message }
  }
}

async function runDataQualityWatchdog() {
  await seedDefaultRules()

  const rules = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "DataQualityRule" WHERE "isActive" = true`
  )

  let totalNewIssues = 0
  let totalAutoFixed = 0
  const results: any[] = []

  for (const rule of rules) {
    const result = await evaluateRule(rule)
    totalNewIssues += result.newIssues
    totalAutoFixed += result.fixedIssues
    results.push({ rule: rule.name, ...result })
  }

  const totalOpenResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count FROM "DataQualityIssue" WHERE status = 'OPEN'`
  )

  return {
    rulesEvaluated: rules.length,
    newIssues: totalNewIssues,
    autoFixed: totalAutoFixed,
    totalOpen: totalOpenResult[0]?.count || 0,
    bySeverity: results,
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || !authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  if (token !== cronSecret) {
    return NextResponse.json({ error: 'Invalid cron secret' }, { status: 401 })
  }

  return withCronRun('data-quality', async () => {
    const result = await runDataQualityWatchdog()
    logger.info('data_quality_watchdog_complete', result)
    return NextResponse.json(result)
  })
}
