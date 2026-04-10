export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// GET /api/ops/integrations/health — Comprehensive integration health & routing audit
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // 1. Check all integration configs
    const configs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "provider", "status", "syncEnabled", "lastSyncAt", "lastSyncStatus", "syncInterval",
              "apiKey" IS NOT NULL as "hasApiKey",
              "apiSecret" IS NOT NULL as "hasApiSecret",
              "accessToken" IS NOT NULL as "hasAccessToken",
              "baseUrl", "companyId", "webhookSecret" IS NOT NULL as "hasWebhookSecret"
       FROM "IntegrationConfig" ORDER BY "provider"`
    )

    // 2. Check recent sync logs (last 7 days)
    const recentSyncs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "provider", "syncType", "direction", "status",
              "recordsProcessed"::int, "recordsCreated"::int, "recordsUpdated"::int, "recordsFailed"::int,
              "durationMs"::int, "startedAt", "completedAt", "errorMessage"
       FROM "SyncLog"
       WHERE "startedAt" > NOW() - INTERVAL '7 days'
       ORDER BY "startedAt" DESC
       LIMIT 50`
    )

    // 3. Check QB sync queue status
    let qbQueueStats: any = null
    try {
      const qbStats: any[] = await prisma.$queryRawUnsafe(
        `SELECT "status", COUNT(*)::int as "count"
         FROM "QBSyncQueue"
         GROUP BY "status"`
      )
      qbQueueStats = qbStats.reduce((acc: any, s: any) => { acc[s.status] = s.count; return acc }, {})
    } catch { qbQueueStats = { error: 'QBSyncQueue table not found' } }

    // 4. Check BT project mappings
    let btMappingStats: any = null
    try {
      const btStats: any[] = await prisma.$queryRawUnsafe(
        `SELECT
           COUNT(*)::int as "total",
           COUNT(CASE WHEN "abelBuilderId" IS NOT NULL THEN 1 END)::int as "mapped",
           COUNT(CASE WHEN "abelBuilderId" IS NULL THEN 1 END)::int as "unmapped"
         FROM "BTProjectMapping"`
      )
      btMappingStats = btStats[0] || { total: 0, mapped: 0, unmapped: 0 }
    } catch { btMappingStats = { error: 'BTProjectMapping table not found' } }

    // 5. Check supplier price updates
    let supplierPriceStats: any = null
    try {
      const spStats: any[] = await prisma.$queryRawUnsafe(
        `SELECT "status", COUNT(*)::int as "count"
         FROM "SupplierPriceUpdate"
         GROUP BY "status"`
      )
      supplierPriceStats = spStats.reduce((acc: any, s: any) => { acc[s.status] = s.count; return acc }, {})
    } catch { supplierPriceStats = { error: 'SupplierPriceUpdate table not found' } }

    // 6. Check product sync fields
    const productSyncStats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int as "totalProducts",
         COUNT(CASE WHEN "inflowId" IS NOT NULL THEN 1 END)::int as "inflowLinked",
         COUNT(CASE WHEN "lastSyncedAt" IS NOT NULL THEN 1 END)::int as "recentlySynced"
       FROM "Product"`
    )

    // 7. Check builder QB sync fields
    const builderQbStats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int as "totalBuilders",
         COUNT(CASE WHEN "qbListId" IS NOT NULL THEN 1 END)::int as "qbLinked",
         COUNT(CASE WHEN "qbSyncedAt" IS NOT NULL THEN 1 END)::int as "qbSynced"
       FROM "Builder"`
    )

    // 8. Check invoice QB sync fields
    const invoiceQbStats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int as "totalInvoices",
         COUNT(CASE WHEN "qbTxnId" IS NOT NULL THEN 1 END)::int as "qbLinked",
         COUNT(CASE WHEN "qbSyncStatus" = 'SYNCED' THEN 1 END)::int as "qbSynced"
       FROM "Invoice"`
    )

    // Build the comprehensive routing map
    const routingMap = [
      {
        integration: 'InFlow Inventory',
        provider: 'INFLOW',
        routes: [
          {
            name: 'Product Catalog Sync',
            direction: 'PULL',
            source: 'InFlow Cloud API',
            target: 'Product table',
            endpoint: 'POST /api/ops/integrations { action: sync, syncType: products }',
            libFunction: 'syncProducts()',
            dataFields: 'SKU, name, description, cost, price, category, active',
            status: getRouteStatus(configs, 'INFLOW'),
            stats: productSyncStats[0] ? `${productSyncStats[0].inflowLinked}/${productSyncStats[0].totalProducts} linked` : 'N/A',
          },
          {
            name: 'Inventory Level Sync',
            direction: 'PULL',
            source: 'InFlow Cloud API',
            target: 'Product inventory fields',
            endpoint: 'POST /api/ops/integrations { action: sync, syncType: inventory }',
            libFunction: 'syncInventory()',
            dataFields: 'onHand, onOrder, committed, available',
            status: getRouteStatus(configs, 'INFLOW'),
            stats: null,
          },
          {
            name: 'Sales Order Push',
            direction: 'PUSH',
            source: 'Order table',
            target: 'InFlow Sales Orders',
            endpoint: 'Internal: pushOrderToInflow(orderId)',
            libFunction: 'pushOrderToInflow()',
            dataFields: 'orderNumber, customer, items, dates, totals',
            status: getRouteStatus(configs, 'INFLOW'),
            stats: null,
          },
          {
            name: 'Webhook: Product Changes',
            direction: 'INBOUND',
            source: 'InFlow Webhooks',
            target: 'Product table',
            endpoint: 'POST /api/webhooks/inflow',
            libFunction: 'handleInflowWebhook()',
            dataFields: 'product.created, product.updated, inventory.adjusted',
            status: getRouteStatus(configs, 'INFLOW'),
            stats: null,
          },
        ],
      },
      {
        integration: 'QuickBooks Desktop',
        provider: 'QUICKBOOKS_DESKTOP',
        routes: [
          {
            name: 'Customer Sync (Builders)',
            direction: 'PUSH',
            source: 'Builder table',
            target: 'QB Customer List',
            endpoint: 'POST /api/ops/integrations/quickbooks { action: queue-builders }',
            libFunction: 'buildCustomerAddRequest() → SOAP',
            dataFields: 'companyName, contact, address, phone, email, terms',
            status: getRouteStatus(configs, 'QUICKBOOKS_DESKTOP'),
            stats: builderQbStats[0] ? `${builderQbStats[0].qbLinked}/${builderQbStats[0].totalBuilders} synced` : 'N/A',
          },
          {
            name: 'Invoice Sync',
            direction: 'PUSH',
            source: 'Invoice table',
            target: 'QB Invoices',
            endpoint: 'POST /api/ops/integrations/quickbooks { action: queue-invoices }',
            libFunction: 'buildInvoiceAddRequest() → SOAP',
            dataFields: 'invoiceNumber, items, dates, terms, totals',
            status: getRouteStatus(configs, 'QUICKBOOKS_DESKTOP'),
            stats: invoiceQbStats[0] ? `${invoiceQbStats[0].qbLinked}/${invoiceQbStats[0].totalInvoices} synced` : 'N/A',
          },
          {
            name: 'Purchase Order / Bill Sync',
            direction: 'PUSH',
            source: 'PurchaseOrder table',
            target: 'QB Bills',
            endpoint: 'POST /api/ops/integrations/quickbooks { action: queue-pos }',
            libFunction: 'buildBillAddRequest() → SOAP',
            dataFields: 'vendor, items, dates, amounts',
            status: getRouteStatus(configs, 'QUICKBOOKS_DESKTOP'),
            stats: null,
          },
          {
            name: 'Payment Sync',
            direction: 'PUSH',
            source: 'Payment table',
            target: 'QB ReceivePayment',
            endpoint: 'Internal: queue on payment creation',
            libFunction: 'buildReceivePaymentAddRequest() → SOAP',
            dataFields: 'amount, method, invoice link, date',
            status: getRouteStatus(configs, 'QUICKBOOKS_DESKTOP'),
            stats: null,
          },
          {
            name: 'SOAP Web Connector',
            direction: 'BIDIRECTIONAL',
            source: 'QB Desktop (polling)',
            target: 'QBSyncQueue',
            endpoint: 'GET /api/ops/integrations/quickbooks/webconnector',
            libFunction: 'authenticate/sendRequest/receiveResponse/closeConnection',
            dataFields: 'qbXML requests and responses',
            status: getRouteStatus(configs, 'QUICKBOOKS_DESKTOP'),
            stats: qbQueueStats && !qbQueueStats.error
              ? `Queue: ${qbQueueStats.PENDING || 0} pending, ${qbQueueStats.COMPLETED || 0} done, ${qbQueueStats.FAILED || 0} failed`
              : qbQueueStats?.error || 'N/A',
          },
        ],
      },
      {
        integration: 'BuilderTrend',
        provider: 'BUILDERTREND',
        routes: [
          {
            name: 'Project Sync',
            direction: 'PULL',
            source: 'BuilderTrend API',
            target: 'BTProjectMapping table',
            endpoint: 'POST /api/ops/integrations/buildertrend { action: sync-projects }',
            libFunction: 'syncProjects()',
            dataFields: 'projectId, name, address, community, lot, builder, status',
            status: getRouteStatus(configs, 'BUILDERTREND'),
            stats: btMappingStats && !btMappingStats.error
              ? `${btMappingStats.mapped}/${btMappingStats.total} mapped`
              : btMappingStats?.error || 'N/A',
          },
          {
            name: 'Schedule Sync (Door/Trim)',
            direction: 'PULL',
            source: 'BuilderTrend API',
            target: 'ScheduleEntry table',
            endpoint: 'POST /api/ops/integrations/buildertrend { action: sync-schedules }',
            libFunction: 'syncSchedules()',
            dataFields: 'scheduleId, type, date, assignment, notes (door/trim filtered)',
            status: getRouteStatus(configs, 'BUILDERTREND'),
            stats: null,
          },
          {
            name: 'Material Selections Sync',
            direction: 'PULL',
            source: 'BuilderTrend API',
            target: 'DecisionNotes (for review)',
            endpoint: 'POST /api/ops/integrations/buildertrend { action: sync-materials }',
            libFunction: 'syncMaterialSelections()',
            dataFields: 'category, product, specification, quantity (Doors/Trim/Hardware)',
            status: getRouteStatus(configs, 'BUILDERTREND'),
            stats: null,
          },
          {
            name: 'Webhook: Schedule/Selection/Project',
            direction: 'INBOUND',
            source: 'BuilderTrend Webhooks',
            target: 'ScheduleEntry, Activity',
            endpoint: 'POST /api/ops/integrations/buildertrend/webhook',
            libFunction: 'processWebhookPayload()',
            dataFields: 'schedule.*, selection.*, project.* events (HMAC-SHA256 verified)',
            status: getRouteStatus(configs, 'BUILDERTREND'),
            stats: null,
          },
          {
            name: 'Project Mapping CRUD',
            direction: 'CONFIG',
            source: 'Ops UI',
            target: 'BTProjectMapping table',
            endpoint: 'GET/POST/PUT/DELETE /api/ops/integrations/buildertrend/projects',
            libFunction: 'Manual mapping management',
            dataFields: 'BT project ↔ Abel builder/project/job',
            status: 'READY',
            stats: null,
          },
        ],
      },
      {
        integration: 'Boise Cascade / BlueLinx',
        provider: 'BOISE_CASCADE',
        routes: [
          {
            name: 'Price Sheet Import (CSV)',
            direction: 'PULL',
            source: 'CSV Upload (local file)',
            target: 'SupplierPriceUpdate table',
            endpoint: 'POST /api/ops/integrations/supplier-pricing',
            libFunction: 'batchImport()',
            dataFields: 'itemNumber, description, UOM, listPrice, netPrice, cost, effectiveDate',
            status: 'READY',
            stats: supplierPriceStats && !supplierPriceStats.error
              ? `${supplierPriceStats.PENDING || 0} pending, ${supplierPriceStats.APPROVED || 0} approved`
              : supplierPriceStats?.error || 'N/A',
          },
          {
            name: 'SKU Auto-Match',
            direction: 'INTERNAL',
            source: 'SupplierPriceUpdate',
            target: 'Product table (match)',
            endpoint: 'Internal: during import',
            libFunction: 'SKU matching (exact → fuzzy → partial)',
            dataFields: 'SKU match, name similarity (PG SIMILARITY function)',
            status: 'READY',
            stats: null,
          },
          {
            name: 'Price Approval & Apply',
            direction: 'PUSH',
            source: 'SupplierPriceUpdate (PENDING)',
            target: 'Product.cost',
            endpoint: 'POST /api/ops/integrations/supplier-pricing/apply { action: approve }',
            libFunction: 'batchApply()',
            dataFields: 'cost update, margin recalculation, below-min alerts',
            status: 'READY',
            stats: null,
          },
          {
            name: 'Margin Impact Alerts',
            direction: 'INTERNAL',
            source: 'Price change calculation',
            target: 'Dashboard alerts',
            endpoint: 'GET /api/ops/integrations/supplier-pricing',
            libFunction: 'getPriceAlerts()',
            dataFields: 'Items below minMargin threshold with suggested prices',
            status: 'READY',
            stats: null,
          },
        ],
      },
    ]

    // Sync failure summary
    const failedSyncs = recentSyncs.filter((s: any) => s.status === 'FAILED')
    const partialSyncs = recentSyncs.filter((s: any) => s.status === 'PARTIAL')

    return safeJson({
      auditTimestamp: new Date().toISOString(),
      summary: {
        totalRoutes: routingMap.reduce((sum, i) => sum + i.routes.length, 0),
        integrations: routingMap.length,
        configuredCount: configs.filter(c => c.status === 'CONNECTED').length,
        pendingCount: configs.filter(c => c.status === 'PENDING').length,
        errorCount: configs.filter(c => c.status === 'ERROR').length,
        recentSyncCount: recentSyncs.length,
        failedSyncCount: failedSyncs.length,
        partialSyncCount: partialSyncs.length,
      },
      routingMap,
      configs: configs.map(c => ({
        provider: c.provider,
        status: c.status,
        syncEnabled: c.syncEnabled,
        hasCredentials: c.hasApiKey || c.hasAccessToken,
        hasWebhookSecret: c.hasWebhookSecret,
        lastSyncAt: c.lastSyncAt,
        lastSyncStatus: c.lastSyncStatus,
      })),
      recentSyncs,
      qbQueueStats,
      btMappingStats,
      supplierPriceStats,
      productSyncStats: productSyncStats[0],
      builderQbStats: builderQbStats[0],
      invoiceQbStats: invoiceQbStats[0],
    })
  } catch (error: any) {
    console.error('Integration health check error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}

function getRouteStatus(configs: any[], provider: string): string {
  const config = configs.find(c => c.provider === provider)
  if (!config) return 'NOT_CONFIGURED'
  if (config.status === 'CONNECTED') return 'ACTIVE'
  if (config.status === 'CONFIGURING') return 'CONFIGURING'
  if (config.status === 'ERROR') return 'ERROR'
  return 'PENDING'
}
