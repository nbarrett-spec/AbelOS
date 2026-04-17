export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { testConnection as testInflowConnection, syncProducts as syncInflowProducts, syncInventory as syncInflowInventory, syncPurchaseOrders as syncInflowPurchaseOrders, syncSalesOrders as syncInflowSalesOrders } from '@/lib/integrations/inflow'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/integrations — List all integration configs and status
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const configs: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "IntegrationConfig" ORDER BY "provider" ASC`
    )

    const recentSyncs: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "SyncLog" ORDER BY "startedAt" DESC LIMIT 20`
    )

    // Ensure all 4 providers have a config entry
    const providers = ['QUICKBOOKS_DESKTOP', 'BUILDERTREND', 'BOISE_CASCADE', 'INFLOW', 'ECI_BOLT', 'GMAIL', 'HYPHEN', 'BPW_PULTE']
    const configMap: Record<string, any> = {}
    for (const c of configs) configMap[c.provider] = c

    const integrations = providers.map(p => ({
      provider: p,
      name: providerName(p),
      description: providerDescription(p),
      config: configMap[p] || null,
      status: configMap[p]?.status || 'PENDING',
      lastSync: configMap[p]?.lastSyncAt,
      lastSyncStatus: configMap[p]?.lastSyncStatus,
      recentSyncs: recentSyncs.filter((s: any) => s.provider === p),
    }))

    return NextResponse.json({ integrations })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/integrations — Configure or update an integration
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { provider, action, ...config } = body

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }

    // Test connection
    if (action === 'test') {
      if (provider === 'INFLOW') {
        const { apiKey, companyId } = config
        if (!apiKey || !companyId) {
          return NextResponse.json({ success: false, message: 'API Key and Company ID are required' })
        }
        const result = await testInflowConnection(apiKey, companyId)
        // If successful, update status to CONNECTED
        if (result.success) {
          await prisma.$queryRawUnsafe(
            `UPDATE "IntegrationConfig" SET "status" = 'CONNECTED'::"IntegrationStatus", "updatedAt" = CURRENT_TIMESTAMP WHERE "provider" = 'INFLOW'::"IntegrationProvider"`
          )
        }
        return NextResponse.json(result)
      }
      return NextResponse.json({ success: true, message: `${providerName(provider)} — configure API credentials to enable live testing` })
    }

    // Trigger sync
    if (action === 'sync') {
      if (provider === 'INFLOW') {
        const syncType = config.syncType || 'products'
        try {
          let result
          switch (syncType) {
            case 'inventory': result = await syncInflowInventory(); break
            case 'purchaseOrders': result = await syncInflowPurchaseOrders(); break
            case 'salesOrders': result = await syncInflowSalesOrders(); break
            default: result = await syncInflowProducts(); break
          }
          return NextResponse.json({ success: result.status !== 'FAILED', result })
        } catch (err: any) {
          return NextResponse.json({ success: false, message: err.message }, { status: 500 })
        }
      }
      return NextResponse.json({ success: false, message: `${providerName(provider)} sync not yet implemented` })
    }

    // Save configuration
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "IntegrationConfig" WHERE "provider" = $1::"IntegrationProvider" LIMIT 1`,
      provider
    )

    let integration
    if (existing.length > 0) {
      const result: any[] = await prisma.$queryRawUnsafe(
        `UPDATE "IntegrationConfig" SET
          "name" = $2, "apiKey" = COALESCE($3, "apiKey"), "apiSecret" = COALESCE($4, "apiSecret"),
          "baseUrl" = COALESCE($5, "baseUrl"), "companyId" = COALESCE($6, "companyId"),
          "webhookSecret" = COALESCE($7, "webhookSecret"), "syncEnabled" = $8, "syncInterval" = $9,
          "status" = 'CONFIGURING'::"IntegrationStatus", "updatedAt" = CURRENT_TIMESTAMP
         WHERE "provider" = $1::"IntegrationProvider" RETURNING *`,
        provider,
        config.name || providerName(provider),
        config.apiKey || null, config.apiSecret || null,
        config.baseUrl || null, config.companyId || null,
        config.webhookSecret || null,
        config.syncEnabled ?? true,
        config.syncInterval || 300
      )
      integration = result[0]
    } else {
      const result: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "IntegrationConfig" ("provider", "name", "apiKey", "apiSecret", "baseUrl", "companyId", "webhookSecret", "syncEnabled", "syncInterval", "status")
         VALUES ($1::"IntegrationProvider", $2, $3, $4, $5, $6, $7, $8, $9, 'CONFIGURING'::"IntegrationStatus") RETURNING *`,
        provider,
        config.name || providerName(provider),
        config.apiKey || null, config.apiSecret || null,
        config.baseUrl || null, config.companyId || null,
        config.webhookSecret || null,
        config.syncEnabled ?? true,
        config.syncInterval || 300
      )
      integration = result[0]
    }

    return NextResponse.json(integration)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function providerName(provider: string): string {
  const map: Record<string, string> = {
    QUICKBOOKS_DESKTOP: 'QuickBooks Desktop',
    BUILDERTREND: 'BuilderTrend',
    BOISE_CASCADE: 'Boise Cascade / BlueLinx',
    INFLOW: 'InFlow Inventory',
    ECI_BOLT: 'ECI Bolt / Spruce',
    GMAIL: 'Gmail / Google Workspace',
    HYPHEN: 'Hyphen BuildPro / SupplyPro',
    BPW_PULTE: 'BPW / Pulte Builder Portal',
  }
  return map[provider] || provider
}

function providerDescription(provider: string): string {
  const map: Record<string, string> = {
    QUICKBOOKS_DESKTOP: 'Two-way sync of invoices, payments, customers, and bills with QuickBooks Desktop via Web Connector',
    BUILDERTREND: 'Pull builder project schedules, material selections, and push quote/order status to BuilderTrend',
    BOISE_CASCADE: 'Import supplier price sheets, auto-update product costs, and track margin impact from Boise Cascade / BlueLinx',
    INFLOW: 'Real-time product catalog and inventory sync during Bolt transition',
    ECI_BOLT: 'Customer, order, invoice, and pricing sync with ECI Bolt ERP',
    GMAIL: 'Automatic email logging — all builder & supplier communication feeds into CRM',
    HYPHEN: 'Builder schedule, PO, and payment sync from national builders (Pulte, Toll, Brookfield)',
    BPW_PULTE: 'Job, community, and schedule sync from BPW / Pulte builder portal',
  }
  return map[provider] || ''
}
