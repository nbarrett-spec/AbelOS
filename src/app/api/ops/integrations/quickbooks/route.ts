export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { queueSyncItem, getQueueStats, clearCompletedQueue } from '@/lib/integrations/quickbooks-desktop'
import { audit } from '@/lib/audit'

// GET /api/ops/integrations/quickbooks — Return QuickBooks Desktop Web Connector status
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get queue statistics
    const queueStats = await getQueueStats()

    // Get latest sync from SyncLog
    const latestSyncResult = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM "SyncLog"
      WHERE "provider" = 'QUICKBOOKS_DESKTOP'
      ORDER BY "startedAt" DESC
      LIMIT 1
      `
    )
    const latestSync = (latestSyncResult as any[])?.[0] || null

    // Get recent sync history
    const syncHistoryResult = await prisma.$queryRawUnsafe(
      `
      SELECT id, "syncType", status, "recordsProcessed", "recordsCreated", "recordsFailed", "startedAt", "completedAt"
      FROM "SyncLog"
      WHERE "provider" = 'QUICKBOOKS_DESKTOP'
      ORDER BY "startedAt" DESC
      LIMIT 10
      `
    )
    const syncHistory = (syncHistoryResult as any[]) || []

    // Count unsynced builders (those with QB credentials but not yet synced)
    const unsyncedBuildersResult = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) as count
      FROM "Builder"
      WHERE "qbListId" IS NULL AND status = 'ACTIVE'
      `
    )
    const unsyncedBuilders = Number((unsyncedBuildersResult as any[])[0]?.count || 0)

    // Count synced builders
    const syncedBuildersResult = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) as count
      FROM "Builder"
      WHERE "qbListId" IS NOT NULL
      `
    )
    const syncedBuilders = Number((syncedBuildersResult as any[])[0]?.count || 0)

    // Count unsynced invoices
    const unsyncedInvoicesResult = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) as count
      FROM "Invoice"
      WHERE "qbTxnId" IS NULL AND status != 'DRAFT'
      `
    )
    const unsyncedInvoices = Number((unsyncedInvoicesResult as any[])[0]?.count || 0)

    // Count synced invoices
    const syncedInvoicesResult = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) as count
      FROM "Invoice"
      WHERE "qbTxnId" IS NOT NULL
      `
    )
    const syncedInvoices = Number((syncedInvoicesResult as any[])[0]?.count || 0)

    // Count unsynced POs
    const unsyncedPosResult = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) as count
      FROM "PurchaseOrder"
      WHERE "qbTxnId" IS NULL AND status != 'DRAFT'
      `
    )
    const unsyncedPos = Number((unsyncedPosResult as any[])[0]?.count || 0)

    // Count synced POs
    const syncedPosResult = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*) as count
      FROM "PurchaseOrder"
      WHERE "qbTxnId" IS NOT NULL
      `
    )
    const syncedPos = Number((syncedPosResult as any[])[0]?.count || 0)

    // Check if Web Connector credentials are configured
    const hasCredentials = !!process.env.QBWC_USERNAME && !!process.env.QBWC_PASSWORD

    return safeJson({
      connected: hasCredentials,
      webConnectorConfigured: hasCredentials,
      lastSync: latestSync?.startedAt || null,
      syncStatus: latestSync?.status || 'NEVER_RUN',
      queue: {
        pending: queueStats.pending,
        processing: queueStats.processing,
        completed: queueStats.completed,
        failed: queueStats.failed,
        totalAttempts: queueStats.totalAttempts,
      },
      entities: {
        builders: {
          synced: syncedBuilders,
          unsynced: unsyncedBuilders,
          total: syncedBuilders + unsyncedBuilders,
        },
        invoices: {
          synced: syncedInvoices,
          unsynced: unsyncedInvoices,
          total: syncedInvoices + unsyncedInvoices,
        },
        purchaseOrders: {
          synced: syncedPos,
          unsynced: unsyncedPos,
          total: syncedPos + unsyncedPos,
        },
      },
      lastSyncDetails: latestSync
        ? {
            syncType: latestSync.syncType,
            status: latestSync.status,
            recordsProcessed: latestSync.recordsProcessed,
            recordsCreated: latestSync.recordsCreated,
            recordsFailed: latestSync.recordsFailed,
            startedAt: latestSync.startedAt,
            completedAt: latestSync.completedAt,
            durationMs: latestSync.durationMs,
          }
        : null,
      syncHistory,
      setupInstructions: hasCredentials
        ? null
        : {
            message: 'QB Desktop Web Connector integration requires configuration',
            requiredEnvVars: ['QBWC_USERNAME', 'QBWC_PASSWORD'],
            steps: [
              '1. Set QBWC_USERNAME and QBWC_PASSWORD in environment variables',
              '2. Download the .qwc configuration file from /api/ops/integrations/quickbooks/qwc',
              '3. Open the .qwc file in QuickBooks Web Connector',
              '4. Web Connector will poll the sync endpoint automatically',
            ],
          },
    })
  } catch (error) {
    console.error('QuickBooks status retrieval error:', error)
    return safeJson(
      {
        connected: false,
        webConnectorConfigured: false,
        syncStatus: 'ERROR',
        message: String(error),
        queue: { pending: 0, processing: 0, completed: 0, failed: 0, totalAttempts: 0 },
        entities: {
          builders: { synced: 0, unsynced: 0, total: 0 },
          invoices: { synced: 0, unsynced: 0, total: 0 },
          purchaseOrders: { synced: 0, unsynced: 0, total: 0 },
        },
      },
      { status: 500 }
    )
  }
}

// POST /api/ops/integrations/quickbooks — Queue items for sync
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { action } = body

    let queued = 0
    let errorMsg = ''

    try {
      switch (action) {
        case 'queue-builders': {
          // Queue all unsynced builders
          const builders = await prisma.$queryRawUnsafe(
            `
            SELECT id FROM "Builder"
            WHERE "qbListId" IS NULL AND status = 'ACTIVE'
            `
          )
          for (const builder of builders as any[]) {
            await queueSyncItem('CUSTOMER_ADD', 'BUILDER', builder.id, {})
            queued++
          }
          break
        }

        case 'queue-invoices': {
          // Queue all unsynced invoices (only if customer is synced)
          const invoices = await prisma.$queryRawUnsafe(
            `
            SELECT i.id, i."builderId"
            FROM "Invoice" i
            JOIN "Builder" b ON i."builderId" = b.id
            WHERE i."qbTxnId" IS NULL AND i.status != 'DRAFT' AND b."qbListId" IS NOT NULL
            `
          )
          for (const invoice of invoices as any[]) {
            await queueSyncItem('INVOICE_ADD', 'INVOICE', invoice.id, {})
            queued++
          }
          break
        }

        case 'queue-pos': {
          // Queue all unsynced purchase orders
          const pos = await prisma.$queryRawUnsafe(
            `
            SELECT id, "vendorId" FROM "PurchaseOrder"
            WHERE "qbTxnId" IS NULL AND status != 'DRAFT'
            `
          )
          for (const po of pos as any[]) {
            await queueSyncItem('PO_ADD', 'PO', po.id, { vendorId: po.vendorId })
            queued++
          }
          break
        }

        case 'retry-failed': {
          // Re-queue failed items
          const failed = await prisma.$queryRawUnsafe(
            `
            SELECT id FROM "QBSyncQueue"
            WHERE status = 'failed' AND attempts < "maxAttempts"
            `
          )
          for (const item of failed as any[]) {
            await prisma.$executeRawUnsafe(
              `UPDATE "QBSyncQueue" SET status = 'pending' WHERE id = $1`,
              item.id
            )
            queued++
          }
          break
        }

        case 'clear-queue': {
          // Clear completed items
          queued = await clearCompletedQueue()
          break
        }

        default:
          return safeJson({ error: `Unknown action: ${action}` }, { status: 400 })
      }

      const stats = await getQueueStats()

      return safeJson({
        success: true,
        action,
        itemsQueued: queued,
        queueStats: stats,
      })
    } catch (error) {
      errorMsg = String(error)
      throw error
    }
  } catch (error) {
    console.error('QuickBooks sync trigger error:', error)
    return safeJson(
      { error: 'Failed to process QuickBooks sync action', details: String(error) },
      { status: 500 }
    )
  }
}
