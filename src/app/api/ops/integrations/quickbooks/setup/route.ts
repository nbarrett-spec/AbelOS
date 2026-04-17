export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/integrations/quickbooks/setup
//
// GET  — return current QB setup status and checklist
// POST — create or update QB Desktop integration config, validate setup
//
// QuickBooks Desktop uses QBWC (Web Connector) which is pull-based:
//   1. Admin configures credentials here
//   2. Downloads .qwc file from /api/ops/integrations/quickbooks/qwc
//   3. Opens .qwc in QuickBooks → QBWC starts polling our SOAP endpoint
//   4. Queue items (builders, invoices, POs) are synced on each poll
//
// No OAuth flow — QBWC uses hardcoded username/password from env vars.
// ──────────────────────────────────────────────────────────────────────────

interface SetupChecklist {
  credentialsConfigured: boolean
  integrationRecordExists: boolean
  integrationStatus: string | null
  qwcFileAvailable: boolean
  syncEnabled: boolean
  queueTableReady: boolean
  entitiesReadyToSync: {
    builders: number
    invoices: number
    purchaseOrders: number
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const checklist = await buildChecklist()

    const allGreen =
      checklist.credentialsConfigured &&
      checklist.integrationRecordExists &&
      checklist.syncEnabled &&
      checklist.queueTableReady

    const nextSteps: string[] = []
    if (!checklist.credentialsConfigured) {
      nextSteps.push(
        'Set QBWC_USERNAME and QBWC_PASSWORD environment variables in Vercel (Settings → Environment Variables) and redeploy'
      )
    }
    if (!checklist.integrationRecordExists) {
      nextSteps.push(
        'POST to this endpoint to create the QuickBooks integration record'
      )
    }
    if (checklist.integrationRecordExists && !checklist.syncEnabled) {
      nextSteps.push(
        'POST to this endpoint with { "syncEnabled": true } to enable syncing'
      )
    }
    if (checklist.credentialsConfigured && checklist.integrationRecordExists) {
      nextSteps.push(
        'Download the .qwc file from /api/ops/integrations/quickbooks/qwc'
      )
      nextSteps.push(
        'Open the .qwc file in QuickBooks Desktop to register the Web Connector'
      )
      nextSteps.push(
        'Click "Update Selected" in QBWC to start the first sync'
      )
    }

    return safeJson({
      ready: allGreen,
      checklist,
      nextSteps,
    })
  } catch (error: any) {
    return safeJson({ error: error.message || 'Failed to check setup status' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  let body: Record<string, any> = {}
  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    body = await request.json()
  } catch {
    // Empty body is fine — we'll use defaults
  }

  try {
    // ── Step 1: Check credentials ──────────────────────────────────────
    const hasCredentials = !!(process.env.QBWC_USERNAME && process.env.QBWC_PASSWORD)
    if (!hasCredentials) {
      return safeJson(
        {
          success: false,
          error: 'QBWC_USERNAME and QBWC_PASSWORD environment variables must be set before setup',
          help: 'Add these in Vercel Dashboard → Settings → Environment Variables, then redeploy',
        },
        { status: 400 }
      )
    }

    // ── Step 2: Upsert IntegrationConfig ───────────────────────────────
    const companyName =
      typeof body.companyName === 'string' ? body.companyName.trim() : null
    const syncInterval =
      typeof body.syncInterval === 'number' && body.syncInterval >= 5
        ? body.syncInterval
        : 15
    const syncEnabled = body.syncEnabled !== false

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "status" FROM "IntegrationConfig" WHERE "provider" = 'QUICKBOOKS_DESKTOP' LIMIT 1`
    )

    let configId: string
    let previousStatus: string | null = null

    if (existing.length > 0) {
      configId = existing[0].id
      previousStatus = existing[0].status
      await prisma.$executeRawUnsafe(
        `UPDATE "IntegrationConfig"
         SET "status" = 'CONFIGURING',
             "syncEnabled" = $1,
             "syncInterval" = $2,
             "companyId" = COALESCE($3, "companyId"),
             "updatedAt" = NOW()
         WHERE "provider" = 'QUICKBOOKS_DESKTOP'`,
        syncEnabled,
        syncInterval,
        companyName
      )
    } else {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "IntegrationConfig" ("id", "provider", "name", "syncEnabled", "syncInterval", "companyId", "status", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, 'QUICKBOOKS_DESKTOP', 'QuickBooks Desktop', $1, $2, $3, 'CONFIGURING', NOW(), NOW())
         RETURNING "id"`,
        syncEnabled,
        syncInterval,
        companyName
      )
      configId = rows[0].id
    }

    // ── Step 3: Ensure queue table exists ──────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "QBSyncQueue" (
        "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "qbTxnId" TEXT,
        "qbListId" TEXT,
        "requestXml" TEXT,
        "responseXml" TEXT,
        "payload" JSONB,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 3,
        "lastError" TEXT,
        "processedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_qbsyncqueue_status" ON "QBSyncQueue" ("status")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_qbsyncqueue_entity" ON "QBSyncQueue" ("entityType", "entityId")`
    )

    // ── Step 4: Count entities ready to sync ───────────────────────────
    const builderCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS count FROM "Builder" WHERE "qbListId" IS NULL AND "status" = 'ACTIVE'`
    )
    const invoiceCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS count FROM "Invoice" WHERE "qbTxnId" IS NULL AND "status" != 'DRAFT'`
    )
    const poCount = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS count FROM "PurchaseOrder" WHERE "qbTxnId" IS NULL AND "status" != 'DRAFT'`
    )

    // ── Step 5: Build response ─────────────────────────────────────────
    const entitiesReady = {
      builders: builderCount[0]?.count || 0,
      invoices: invoiceCount[0]?.count || 0,
      purchaseOrders: poCount[0]?.count || 0,
    }
    const totalReady =
      entitiesReady.builders + entitiesReady.invoices + entitiesReady.purchaseOrders

    return safeJson({
      success: true,
      message: previousStatus
        ? `QuickBooks integration updated (was: ${previousStatus}, now: CONFIGURING)`
        : 'QuickBooks integration created successfully',
      config: {
        id: configId,
        provider: 'QUICKBOOKS_DESKTOP',
        status: 'CONFIGURING',
        syncEnabled,
        syncInterval,
        companyName: companyName || null,
      },
      entitiesReadyToSync: entitiesReady,
      nextSteps: [
        `Download the .qwc configuration file from /api/ops/integrations/quickbooks/qwc`,
        `Open QuickBooks Desktop and go to File → Update Web Services`,
        `Add the .qwc file — when prompted, enter the username and password you configured`,
        `Click "Update Selected" to start the initial sync`,
        totalReady > 0
          ? `${totalReady} records are ready to sync (${entitiesReady.builders} builders, ${entitiesReady.invoices} invoices, ${entitiesReady.purchaseOrders} POs)`
          : `No unsynced records found — new records will sync automatically once QBWC is connected`,
      ],
    })
  } catch (error: any) {
    return safeJson(
      { success: false, error: error.message || 'Setup failed' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function buildChecklist(): Promise<SetupChecklist> {
  const hasCredentials = !!(process.env.QBWC_USERNAME && process.env.QBWC_PASSWORD)

  // Check IntegrationConfig
  let integrationExists = false
  let integrationStatus: string | null = null
  let syncEnabled = false
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "status", "syncEnabled" FROM "IntegrationConfig" WHERE "provider" = 'QUICKBOOKS_DESKTOP' LIMIT 1`
    )
    if (rows.length > 0) {
      integrationExists = true
      integrationStatus = rows[0].status
      syncEnabled = rows[0].syncEnabled === true
    }
  } catch {
    // Table might not exist yet
  }

  // Check queue table
  let queueReady = false
  try {
    await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "QBSyncQueue" LIMIT 0`
    )
    queueReady = true
  } catch {
    // Table doesn't exist
  }

  // Count unsynced entities
  let builders = 0
  let invoices = 0
  let purchaseOrders = 0
  try {
    const b = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS c FROM "Builder" WHERE "qbListId" IS NULL AND "status" = 'ACTIVE'`
    )
    builders = b[0]?.c || 0
  } catch {}
  try {
    const i = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS c FROM "Invoice" WHERE "qbTxnId" IS NULL AND "status" != 'DRAFT'`
    )
    invoices = i[0]?.c || 0
  } catch {}
  try {
    const p = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::int AS c FROM "PurchaseOrder" WHERE "qbTxnId" IS NULL AND "status" != 'DRAFT'`
    )
    purchaseOrders = p[0]?.c || 0
  } catch {}

  return {
    credentialsConfigured: hasCredentials,
    integrationRecordExists: integrationExists,
    integrationStatus,
    qwcFileAvailable: hasCredentials,
    syncEnabled,
    queueTableReady: queueReady,
    entitiesReadyToSync: { builders, invoices, purchaseOrders },
  }
}
