export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Match cron — full product sync pages through ~154 pages

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import {
  syncProducts,
  syncInventory,
  syncPurchaseOrders,
  syncSalesOrders,
  pushOrderToInflow,
} from '@/lib/integrations/inflow'

type SyncType = 'products' | 'inventory' | 'purchaseOrders' | 'salesOrders' | 'all'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/inflow/sync
//   Trigger an InFlow sync.
//   Body: { syncType: 'products' | 'inventory' | 'purchaseOrders' | 'salesOrders' | 'all' }
//
//   Sync behavior depends on current sync mode (from IntegrationConfig.metadata.syncMode):
//     MIRROR          → Pull from InFlow only (InFlow is source of truth)
//     BIDIRECTIONAL   → Pull from InFlow + push Aegis changes back
//     AEGIS_PRIMARY   → Push Aegis data to InFlow (Aegis is source of truth)
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const syncType: SyncType = body.syncType || 'all'
    const validTypes: SyncType[] = ['products', 'inventory', 'purchaseOrders', 'salesOrders', 'all']

    if (!validTypes.includes(syncType)) {
      return NextResponse.json({ error: `Invalid sync type. Must be: ${validTypes.join(', ')}` }, { status: 400 })
    }

    // Check InFlow is connected
    const configs: any[] = await prisma.$queryRawUnsafe(`
      SELECT "status"::text as "status", "metadata"
      FROM "IntegrationConfig"
      WHERE "provider" = 'INFLOW'
      LIMIT 1
    `)

    if (!configs.length || configs[0].status !== 'CONNECTED') {
      return NextResponse.json({ error: 'InFlow is not connected. Configure credentials first.' }, { status: 400 })
    }

    const syncMode = configs[0].metadata?.syncMode || 'MIRROR'
    const staffId = request.headers.get('x-staff-id')
    const results: Record<string, any> = {}
    const errors: string[] = []

    // Determine which syncs to run based on type + mode
    const pullTypes: string[] = []
    if (syncType === 'all' || syncType === 'products') pullTypes.push('products')
    if (syncType === 'all' || syncType === 'inventory') pullTypes.push('inventory')
    if (syncType === 'all' || syncType === 'purchaseOrders') pullTypes.push('purchaseOrders')
    if (syncType === 'all' || syncType === 'salesOrders') pullTypes.push('salesOrders')

    // ── PULL from InFlow (MIRROR or BIDIRECTIONAL) ──
    if (syncMode !== 'AEGIS_PRIMARY') {
      for (const type of pullTypes) {
        try {
          let result
          switch (type) {
            case 'products':
              result = await syncProducts()
              break
            case 'inventory':
              result = await syncInventory()
              break
            case 'purchaseOrders':
              result = await syncPurchaseOrders()
              break
            case 'salesOrders':
              result = await syncSalesOrders()
              break
          }
          results[type] = result
        } catch (err: any) {
          errors.push(`${type}: ${err.message}`)
          results[type] = { status: 'FAILED', errorMessage: err.message }
        }
      }
    }

    // ── PUSH to InFlow (BIDIRECTIONAL only) ──
    if (syncMode === 'BIDIRECTIONAL') {
      try {
        const pushResult = await pushAegisChangesToInflow()
        results.aegisPush = pushResult
      } catch (err: any) {
        errors.push(`aegisPush: ${err.message}`)
        results.aegisPush = { status: 'FAILED', errorMessage: err.message }
      }
    }

    // ── AEGIS_PRIMARY — push everything to InFlow ──
    if (syncMode === 'AEGIS_PRIMARY') {
      results.info = 'Aegis is primary. InFlow sync disabled — changes flow from Aegis only.'
      // In AEGIS_PRIMARY mode, we could still push Aegis changes to InFlow
      // for record-keeping, but no pulls happen.
      try {
        const pushResult = await pushAegisChangesToInflow()
        results.aegisPush = pushResult
      } catch (err: any) {
        errors.push(`aegisPush: ${err.message}`)
      }
    }

    // Update last sync timestamp
    await prisma.$executeRawUnsafe(
      `UPDATE "IntegrationConfig" SET
        "lastSyncAt" = CURRENT_TIMESTAMP,
        "lastSyncStatus" = $1,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "provider" = 'INFLOW'`,
      errors.length > 0 ? 'partial' : 'success'
    )

    await audit(request, 'CREATE', 'SyncLog', 'inflow-manual', {
      syncType,
      syncMode,
      triggeredBy: staffId,
      resultSummary: Object.entries(results).map(([k, v]) => `${k}: ${v?.status || 'unknown'}`).join(', '),
    })

    return NextResponse.json({
      syncMode,
      syncType,
      results,
      errors: errors.length > 0 ? errors : undefined,
      completedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[InFlow Sync] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── Push Aegis changes to InFlow ────────────────────────────────────────
// Finds orders/products modified in Aegis since the last push and sends them.
async function pushAegisChangesToInflow(): Promise<{
  status: string
  ordersPushed: number
  errors: string[]
}> {
  const errors: string[] = []
  let ordersPushed = 0

  try {
    // Find orders created in Aegis that haven't been pushed to InFlow
    const unpushedOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "orderNumber"
      FROM "Order"
      WHERE "inflowOrderId" IS NULL
        AND "status"::text NOT IN ('CANCELLED', 'DRAFT')
        AND "createdAt" > NOW() - INTERVAL '7 days'
      ORDER BY "createdAt" DESC
      LIMIT 50
    `)

    for (const order of unpushedOrders) {
      try {
        const result = await pushOrderToInflow(order.id)
        if (result.success) {
          ordersPushed++
        } else {
          errors.push(`${order.orderNumber}: ${result.message}`)
        }
      } catch (err: any) {
        errors.push(`${order.orderNumber}: ${err.message}`)
      }
    }

    return {
      status: errors.length > 0 ? (ordersPushed > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
      ordersPushed,
      errors,
    }
  } catch (err: any) {
    return { status: 'FAILED', ordersPushed: 0, errors: [err.message] }
  }
}
