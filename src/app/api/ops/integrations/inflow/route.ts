export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { testConnection } from '@/lib/integrations/inflow'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/inflow
//   Returns current InFlow connection config, sync mode, and recent sync history.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get config
    const configs: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "provider", "name", "status"::text as "status",
             "companyId", "syncEnabled", "syncInterval",
             "lastSyncAt", "lastSyncStatus", "metadata",
             "createdAt", "updatedAt",
             CASE WHEN "apiKey" IS NOT NULL AND "apiKey" != '' THEN true ELSE false END as "hasApiKey",
             CASE WHEN "webhookSecret" IS NOT NULL AND "webhookSecret" != '' THEN true ELSE false END as "hasWebhookSecret"
      FROM "IntegrationConfig"
      WHERE "provider" = 'INFLOW'
      LIMIT 1
    `)
    const config = configs[0] || null

    // Get sync mode from metadata
    const syncMode = config?.metadata?.syncMode || 'MIRROR'

    // Get recent sync logs
    const syncLogs: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "syncType", "direction", "status",
             "recordsProcessed", "recordsCreated", "recordsUpdated",
             "recordsSkipped", "recordsFailed", "errorMessage",
             "startedAt", "completedAt", "durationMs"
      FROM "SyncLog"
      WHERE "provider" = 'INFLOW'
      ORDER BY "startedAt" DESC
      LIMIT 20
    `)

    // Get counts per sync type (last successful)
    const lastSuccessful: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON ("syncType")
        "syncType", "recordsProcessed", "recordsCreated", "recordsUpdated",
        "completedAt", "status"
      FROM "SyncLog"
      WHERE "provider" = 'INFLOW' AND "status" IN ('SUCCESS', 'PARTIAL')
      ORDER BY "syncType", "completedAt" DESC
    `)

    // Get product/inventory counts for the status dashboard
    const productCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Product" WHERE "active" = true`
    )
    const inventoryCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "InventoryItem"`
    )
    const inflowLinkedCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Product" WHERE "inflowId" IS NOT NULL`
    )

    return NextResponse.json({
      config: config ? {
        id: config.id,
        status: config.status,
        companyId: config.companyId,
        hasApiKey: config.hasApiKey,
        hasWebhookSecret: config.hasWebhookSecret,
        syncEnabled: config.syncEnabled,
        syncInterval: config.syncInterval,
        lastSyncAt: config.lastSyncAt,
        lastSyncStatus: config.lastSyncStatus,
        syncMode,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      } : null,
      syncLogs,
      lastSuccessful: lastSuccessful.reduce((acc: any, row: any) => {
        acc[row.syncType] = row
        return acc
      }, {}),
      counts: {
        products: productCount[0]?.count || 0,
        inventory: inventoryCount[0]?.count || 0,
        inflowLinked: inflowLinkedCount[0]?.count || 0,
      },
    })
  } catch (error) {
    console.error('[InFlow Config] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/inflow
//   Connect or update InFlow credentials. Tests connection before saving.
//   Body: { apiKey, companyId, webhookSecret? }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { apiKey, companyId, webhookSecret } = body

    if (!apiKey || !companyId) {
      return NextResponse.json({ error: 'API key and company ID are required' }, { status: 400 })
    }

    // Test connection first
    const test = await testConnection(apiKey, companyId)
    if (!test.success) {
      return NextResponse.json({
        error: 'Connection test failed',
        detail: test.message,
      }, { status: 400 })
    }

    // Upsert the config
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "IntegrationConfig" WHERE "provider" = 'INFLOW' LIMIT 1`
    )

    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "IntegrationConfig" SET
          "apiKey" = $1,
          "companyId" = $2,
          "webhookSecret" = COALESCE($3, "webhookSecret"),
          "status" = 'CONNECTED'::"IntegrationStatus",
          "syncEnabled" = true,
          "metadata" = COALESCE("metadata", '{}'::jsonb) || '{"syncMode": "MIRROR"}'::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "provider" = 'INFLOW'`,
        apiKey, companyId, webhookSecret || null
      )
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "IntegrationConfig" (
          "id", "provider", "name", "apiKey", "companyId", "webhookSecret",
          "status", "syncEnabled", "syncInterval", "metadata",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, 'INFLOW'::"IntegrationProvider", 'InFlow Inventory',
          $1, $2, $3,
          'CONNECTED'::"IntegrationStatus", true, 3600,
          '{"syncMode": "MIRROR"}'::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        apiKey, companyId, webhookSecret || null
      )
    }

    const staffId = request.headers.get('x-staff-id')
    await audit(request, 'UPDATE', 'IntegrationConfig', existing[0]?.id || 'new', {
      action: 'inflow_connected',
      companyId,
      productCount: test.productCount,
    })

    return NextResponse.json({
      success: true,
      message: test.message,
      productCount: test.productCount,
    })
  } catch (error) {
    console.error('[InFlow Config] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/integrations/inflow
//   Update sync mode or settings.
//   Body: { syncMode?, syncEnabled?, syncInterval? }
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { syncMode, syncEnabled, syncInterval } = body

    const validModes = ['MIRROR', 'BIDIRECTIONAL', 'AEGIS_PRIMARY']
    if (syncMode && !validModes.includes(syncMode)) {
      return NextResponse.json({ error: `Invalid sync mode. Must be: ${validModes.join(', ')}` }, { status: 400 })
    }

    // Build dynamic update
    const sets: string[] = ['"updatedAt" = CURRENT_TIMESTAMP']
    const params: any[] = []
    let i = 1

    if (syncMode) {
      sets.push(`"metadata" = COALESCE("metadata", '{}'::jsonb) || $${i}::jsonb`)
      params.push(JSON.stringify({ syncMode }))
      i++
    }
    if (syncEnabled !== undefined) {
      sets.push(`"syncEnabled" = $${i}`)
      params.push(syncEnabled)
      i++
    }
    if (syncInterval !== undefined) {
      sets.push(`"syncInterval" = $${i}`)
      params.push(syncInterval)
      i++
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "IntegrationConfig" SET ${sets.join(', ')} WHERE "provider" = 'INFLOW'`,
      ...params
    )

    await audit(request, 'UPDATE', 'IntegrationConfig', 'inflow', {
      action: 'settings_updated',
      syncMode,
      syncEnabled,
      syncInterval,
    })

    return NextResponse.json({ success: true, syncMode, syncEnabled, syncInterval })
  } catch (error) {
    console.error('[InFlow Config] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ops/integrations/inflow
//   Disconnect InFlow (sets status to DISABLED, clears credentials).
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "IntegrationConfig" SET
        "status" = 'DISABLED'::"IntegrationStatus",
        "syncEnabled" = false,
        "apiKey" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "provider" = 'INFLOW'`
    )

    await audit(request, 'UPDATE', 'IntegrationConfig', 'inflow', {
      action: 'inflow_disconnected',
    })

    return NextResponse.json({ success: true, message: 'InFlow disconnected' })
  } catch (error) {
    console.error('[InFlow Config] DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
