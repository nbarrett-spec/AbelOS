export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/brain-sync-staff
// Pulls staff, deal, and financial data from the NUC Brain API and syncs into Aegis tables:
//   • Staff        → from Brain team/staff entries
//   • Deal         → from Brain opportunity/deal entries
//   • FinancialSnapshot → from Brain financial findings
//   • CollectionRule    → bootstrap 4 default rules if missing
//
// The Brain API lives at brain.abellumber.com/brain/* behind CF Access.
// This cron calls it directly (not via proxy) using CF service token.
// ──────────────────────────────────────────────────────────────────────────

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function brainFetch(path: string, timeout = 25000): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainSync/1.0',
  }

  const cfClientId = process.env.CF_ACCESS_CLIENT_ID
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfClientId && cfClientSecret) {
    headers['CF-Access-Client-Id'] = cfClientId
    headers['CF-Access-Client-Secret'] = cfClientSecret
  }
  const brainApiKey = process.env.BRAIN_API_KEY
  if (brainApiKey) headers['X-API-Key'] = brainApiKey

  const response = await fetch(`${BRAIN_BASE_URL}/brain/${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Brain API ${response.status}: ${text.substring(0, 200)}`)
  }

  return response.json()
}

// ──────────────────────────────────────────────────────────────────────────
// Entity sync logic
// ──────────────────────────────────────────────────────────────────────────

interface SyncStats {
  staffCreated: number
  staffUpdated: number
  dealsCreated: number
  dealsUpdated: number
  financialSnapshotCreated: number
  financialSnapshotUpdated: number
  collectionRulesCreated: number
  errors: string[]
}

// Map brain role names to Staff role enum
function mapBrainRoleToStaffRole(brainRole: string): string {
  const roleMap: { [key: string]: string } = {
    admin: 'ADMIN',
    manager: 'MANAGER',
    pm: 'PROJECT_MANAGER',
    project_manager: 'PROJECT_MANAGER',
    estimator: 'ESTIMATOR',
    warehouse: 'WAREHOUSE_TECH',
    warehouse_lead: 'WAREHOUSE_LEAD',
    driver: 'DRIVER',
    installer: 'INSTALLER',
    sales: 'SALES_REP',
    sales_rep: 'SALES_REP',
    purchasing: 'PURCHASING',
    accounting: 'ACCOUNTING',
    qc: 'QC_INSPECTOR',
    qc_inspector: 'QC_INSPECTOR',
    viewer: 'VIEWER',
  }
  return roleMap[brainRole?.toLowerCase()] || 'PROJECT_MANAGER'
}

// Map brain department to Department enum
function mapBrainDepartment(dept: string): string {
  const deptMap: { [key: string]: string } = {
    executive: 'EXECUTIVE',
    sales: 'SALES',
    business_development: 'BUSINESS_DEVELOPMENT',
    estimating: 'ESTIMATING',
    project_management: 'PROJECT_MANAGEMENT',
    operations: 'OPERATIONS',
    manufacturing: 'MANUFACTURING',
    production: 'PRODUCTION',
    warehouse: 'WAREHOUSE',
    logistics: 'LOGISTICS',
    delivery: 'DELIVERY',
    installation: 'INSTALLATION',
    accounting: 'ACCOUNTING',
    purchasing: 'PURCHASING',
  }
  return deptMap[dept?.toLowerCase()] || 'OPERATIONS'
}

// Map brain deal stage to Deal stage enum
function mapBrainStageToDealStage(brainStage: string): string {
  const stageMap: { [key: string]: string } = {
    prospect: 'PROSPECT',
    discovery: 'DISCOVERY',
    walkthrough: 'WALKTHROUGH',
    bid_submitted: 'BID_SUBMITTED',
    bid_review: 'BID_REVIEW',
    negotiation: 'NEGOTIATION',
    won: 'WON',
    closed_won: 'WON',
    lost: 'LOST',
    closed_lost: 'LOST',
    onboarded: 'ONBOARDED',
  }
  return stageMap[brainStage?.toLowerCase()] || 'PROSPECT'
}

async function syncStaffEntities(entities: any[], stats: SyncStats) {
  const staffEntities = entities.filter(
    (e: any) => e.type === 'staff' || e.type === 'team' || e.type === 'person'
  )

  for (const entity of staffEntities) {
    try {
      const firstName = entity.firstName || entity.first_name || ''
      const lastName = entity.lastName || entity.last_name || ''
      const email = entity.email || entity.contactEmail || null

      if (!email || !firstName || !lastName) continue

      // Check if staff already exists by email
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Staff" WHERE "email" ILIKE $1 LIMIT 1`,
        email
      )

      const role = mapBrainRoleToStaffRole(entity.role || entity.position || 'PROJECT_MANAGER')
      const department = mapBrainDepartment(entity.department || entity.dept || 'OPERATIONS')
      const title = entity.title || entity.position || null
      const phone = entity.phone || entity.contactPhone || null
      const salary = entity.salary ? Number(entity.salary) : null
      const active = entity.active !== false

      if (existing.length > 0) {
        // Update existing staff
        await prisma.$executeRawUnsafe(
          `UPDATE "Staff" SET
            "firstName" = COALESCE(NULLIF($1, ''), "firstName"),
            "lastName" = COALESCE(NULLIF($2, ''), "lastName"),
            "phone" = COALESCE($3, "phone"),
            "title" = COALESCE($4, "title"),
            "department" = COALESCE($5::"Department", "department"),
            "role" = COALESCE($6::"StaffRole", "role"),
            "salary" = CASE WHEN $7 > 0 THEN $7 ELSE "salary" END,
            "active" = CASE WHEN $8::boolean IS NOT NULL THEN $8 ELSE "active" END,
            "updatedAt" = NOW()
          WHERE "id" = $9`,
          firstName,
          lastName,
          phone,
          title,
          department,
          role,
          salary || 0,
          active,
          existing[0].id
        )
        stats.staffUpdated++
      } else {
        // Create new staff record
        // Note: passwordHash is required but we'll set a placeholder
        const placeholderHash = '[brain-sync-placeholder]'
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Staff" (
            "id", "firstName", "lastName", "email", "passwordHash",
            "phone", "title", "department", "role",
            "salary", "active", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"Department", $9::"StaffRole", $10, $11, NOW(), NOW())
          ON CONFLICT DO NOTHING`,
          generateId('stf'),
          firstName,
          lastName,
          email,
          placeholderHash,
          phone,
          title,
          department,
          role,
          salary,
          active
        )
        stats.staffCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Staff "${entity.email}": ${err.message}`)
    }
  }
}

async function syncDealEntities(entities: any[], stats: SyncStats) {
  const dealEntities = entities.filter(
    (e: any) => e.type === 'deal' || e.type === 'opportunity' || e.type === 'prospect'
  )

  for (const entity of dealEntities) {
    try {
      const companyName = entity.companyName || entity.company || entity.name || null
      const contactName = entity.contactName || entity.contact || null

      if (!companyName || !contactName) continue

      // Find or default to Dalton as owner
      let ownerId: string | null = null
      const ownerName = entity.owner || entity.ownerId || 'Dalton'
      const ownerMatch: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Staff"
         WHERE "lastName" ILIKE $1 OR "firstName" ILIKE $1
         LIMIT 1`,
        `%${ownerName}%`
      )

      if (ownerMatch.length > 0) {
        ownerId = ownerMatch[0].id
      } else {
        // Default to first active staff member
        const defaultOwner: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Staff" WHERE "active" = true ORDER BY "createdAt" ASC LIMIT 1`
        )
        if (defaultOwner.length === 0) {
          stats.errors.push(`Deal "${companyName}": No staff members found for ownerId`)
          continue
        }
        ownerId = defaultOwner[0].id
      }

      const stage = mapBrainStageToDealStage(entity.stage || 'PROSPECT')
      const probability = Math.min(100, Math.max(0, Number(entity.probability || 10)))
      const estimatedValue = (entity.estimatedValue || entity.dealValue) ? Number(entity.estimatedValue || entity.dealValue) : 0
      const source = entity.source || 'OUTBOUND'
      const dealNumber = entity.dealNumber || `DEAL-${Date.now().toString(36).toUpperCase()}`

      // Check if deal already exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Deal"
         WHERE "dealNumber" = $1 OR ("companyName" ILIKE $2 AND "contactName" ILIKE $3)
         LIMIT 1`,
        dealNumber,
        `%${companyName}%`,
        `%${contactName}%`
      )

      if (existing.length > 0) {
        // Update existing deal
        await prisma.$executeRawUnsafe(
          `UPDATE "Deal" SET
            "contactName" = COALESCE(NULLIF($1, ''), "contactName"),
            "contactEmail" = COALESCE($2, "contactEmail"),
            "contactPhone" = COALESCE($3, "contactPhone"),
            "stage" = COALESCE($4::"DealStage", "stage"),
            "probability" = CASE WHEN $5 >= 0 THEN $5 ELSE "probability" END,
            "dealValue" = CASE WHEN $6 > 0 THEN $6 ELSE "dealValue" END,
            "source" = COALESCE($7::"DealSource", "source"),
            "ownerId" = COALESCE($8, "ownerId"),
            "description" = COALESCE($9, "description"),
            "notes" = CASE WHEN $10 IS NOT NULL THEN COALESCE("notes", '') || E'\n[Brain] ' || $10 ELSE "notes" END,
            "updatedAt" = NOW()
          WHERE "id" = $11`,
          contactName,
          entity.contactEmail || null,
          entity.contactPhone || null,
          stage,
          probability,
          estimatedValue,
          source,
          ownerId,
          entity.description || null,
          entity.summary || null,
          existing[0].id
        )
        stats.dealsUpdated++
      } else {
        // Create new deal
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Deal" (
            "id", "dealNumber", "companyName", "contactName", "contactEmail", "contactPhone",
            "stage", "probability", "dealValue", "source", "ownerId",
            "description", "notes", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::"DealStage", $8, $9, $10::"DealSource", $11,
            $12, $13, NOW(), NOW())
          ON CONFLICT DO NOTHING`,
          generateId('deal'),
          dealNumber,
          companyName,
          contactName,
          entity.contactEmail || null,
          entity.contactPhone || null,
          stage,
          probability,
          estimatedValue,
          source,
          ownerId,
          entity.description || null,
          entity.summary ? `[Brain] ${entity.summary}` : null
        )
        stats.dealsCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Deal "${entity.companyName}": ${err.message}`)
    }
  }
}

async function syncFinancialData(entities: any[], stats: SyncStats) {
  const financialEntities = entities.filter(
    (e: any) => e.type === 'financial' || e.type === 'metrics' || e.type === 'finding'
  )

  if (financialEntities.length === 0) return

  for (const entity of financialEntities) {
    try {
      const snapshotDate = (entity.snapshotDate || entity.date) ? new Date(entity.snapshotDate || entity.date) : new Date()
      const arTotal = (entity.arTotal || entity.ar_total) ? Number(entity.arTotal || entity.ar_total) : 0
      const dso = entity.dso ? Number(entity.dso) : 0
      const overdueARPct = (entity.overdueARPct || entity.overdue_ar_pct) ? Number(entity.overdueARPct || entity.overdue_ar_pct) : 0

      // Check if snapshot already exists for this date
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "FinancialSnapshot"
         WHERE DATE("snapshotDate") = DATE($1)
         LIMIT 1`,
        snapshotDate
      )

      if (existing.length > 0) {
        // Update existing snapshot
        await prisma.$executeRawUnsafe(
          `UPDATE "FinancialSnapshot" SET
            "arTotal" = CASE WHEN $1 > 0 THEN $1 ELSE "arTotal" END,
            "dso" = CASE WHEN $2 > 0 THEN $2 ELSE "dso" END,
            "overdueARPct" = CASE WHEN $3 >= 0 THEN $3 ELSE "overdueARPct" END
          WHERE "id" = $4`,
          arTotal,
          dso,
          overdueARPct,
          existing[0].id
        )
        stats.financialSnapshotUpdated++
      } else {
        // Create new snapshot
        await prisma.$executeRawUnsafe(
          `INSERT INTO "FinancialSnapshot" (
            "id", "snapshotDate", "arTotal", "dso", "overdueARPct", "createdAt"
          ) VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT DO NOTHING`,
          generateId('fsn'),
          snapshotDate,
          arTotal,
          dso,
          overdueARPct
        )
        stats.financialSnapshotCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Financial data: ${err.message}`)
    }
  }
}

async function bootstrapCollectionRules(stats: SyncStats) {
  try {
    // Check if any rules exist
    const existingRules: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM "CollectionRule"`
    )

    if (existingRules[0]?.count > 0) {
      return // Rules already exist
    }

    // Create 4 default collection rules
    const rules = [
      { daysOverdue: 15, actionType: 'REMINDER', name: 'Day 15 Reminder' },
      { daysOverdue: 30, actionType: 'PAST_DUE', name: 'Day 30 Past Due Notice' },
      { daysOverdue: 45, actionType: 'FINAL_NOTICE', name: 'Day 45 Final Notice' },
      { daysOverdue: 60, actionType: 'ACCOUNT_HOLD', name: 'Day 60 Account Hold' },
    ]

    for (const rule of rules) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "CollectionRule" (
          "id", "name", "daysOverdue", "actionType", "channel", "isActive",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, 'EMAIL', true, NOW(), NOW())
        ON CONFLICT DO NOTHING`,
        generateId('cr'),
        rule.name,
        rule.daysOverdue,
        rule.actionType
      )
      stats.collectionRulesCreated++
    }
  } catch (err: any) {
    stats.errors.push(`Collection rules bootstrap: ${err.message}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('brain-sync-staff', 'schedule')
  const started = Date.now()

  const stats: SyncStats = {
    staffCreated: 0,
    staffUpdated: 0,
    dealsCreated: 0,
    dealsUpdated: 0,
    financialSnapshotCreated: 0,
    financialSnapshotUpdated: 0,
    collectionRulesCreated: 0,
    errors: [],
  }

  try {
    // 1. Check brain health first
    let brainHealthy = false
    try {
      const health = await brainFetch('health', 10000)
      brainHealthy = health?.status === 'ok' || health?.status === 'healthy' || !!health
    } catch {
      // Brain might be offline — that's OK, we'll skip gracefully
    }

    if (!brainHealthy) {
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
        result: { skipped: true, reason: 'Brain engine unreachable or unhealthy' },
      })
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Brain engine unreachable — skipping sync',
      })
    }

    // 2. Pull all entities from brain
    let allEntities: any[] = []
    try {
      const entitiesData = await brainFetch('entities?limit=500')
      allEntities = Array.isArray(entitiesData)
        ? entitiesData
        : (entitiesData.entities || entitiesData.data || [])
    } catch (err: any) {
      stats.errors.push(`Entity fetch: ${err.message}`)
    }

    // 3. Sync each entity type
    if (allEntities.length > 0) {
      await syncStaffEntities(allEntities, stats)
      await syncDealEntities(allEntities, stats)
      await syncFinancialData(allEntities, stats)
    }

    // 4. Bootstrap collection rules if none exist
    await bootstrapCollectionRules(stats)

    // 5. Record last sync timestamp
    const syncTimestamp = new Date().toISOString()
    const existingTs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "AgentConfig" WHERE "agentRole" = 'brain' AND "configKey" = 'sync_staff_last' LIMIT 1`
    )

    if (existingTs.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AgentConfig" SET "configValue" = $1::jsonb, "updatedAt" = NOW() WHERE "agentRole" = 'brain' AND "configKey" = 'sync_staff_last'`,
        JSON.stringify({ lastSync: syncTimestamp, stats })
      )
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" ("id", "agentRole", "configKey", "configValue", "description", "updatedBy", "createdAt", "updatedAt")
         VALUES ($1, 'brain', 'sync_staff_last', $2::jsonb, 'Last brain-sync-staff run', 'brain-sync-staff', NOW(), NOW())`,
        generateId('ac'),
        JSON.stringify({ lastSync: syncTimestamp, stats })
      )
    }

    const allSuccess = stats.errors.length === 0
    const payload = {
      success: allSuccess,
      timestamp: syncTimestamp,
      entitiesFetched: allEntities.length,
      stats: {
        staffCreated: stats.staffCreated,
        staffUpdated: stats.staffUpdated,
        dealsCreated: stats.dealsCreated,
        dealsUpdated: stats.dealsUpdated,
        financialSnapshotCreated: stats.financialSnapshotCreated,
        financialSnapshotUpdated: stats.financialSnapshotUpdated,
        collectionRulesCreated: stats.collectionRulesCreated,
      },
      errors: stats.errors.length > 0 ? stats.errors.slice(0, 20) : undefined,
    }

    await finishCronRun(runId, allSuccess ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: payload,
      error: allSuccess ? undefined : `${stats.errors.length} errors during sync`,
    })

    return NextResponse.json(payload, { status: allSuccess ? 200 : 207 })
  } catch (error: any) {
    console.error('Brain sync staff cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error.message, stats },
      { status: 500 }
    )
  }
}

// Also support POST for manual trigger
export async function POST(request: NextRequest) {
  return GET(request)
}
