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

    // 3. Check BT project mappings
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

    // 4. Check supplier price updates
    let supplierPriceStats: any = null
    try {
      const spStats: any[] = await prisma.$queryRawUnsafe(
        `SELECT "status", COUNT(*)::int as "count"
         FROM "SupplierPriceUpdate"
         GROUP BY "status"`
      )
      supplierPriceStats = spStats.reduce((acc: any, s: any) => { acc[s.status] = s.count; return acc }, {})
    } catch { supplierPriceStats = { error: 'SupplierPriceUpdate table not found' } }

    // 5. Check product sync fields
    const productSyncStats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*)::int as "totalProducts",
         COUNT(CASE WHEN "inflowId" IS NOT NULL THEN 1 END)::int as "inflowLinked",
         COUNT(CASE WHEN "lastSyncedAt" IS NOT NULL THEN 1 END)::int as "recentlySynced"
       FROM "Product"`
    )

    // 6. Check Curri delivery stats
    let curriStats: any = null
    try {
      const cs: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS "total",
          COUNT(CASE WHEN "provider" = 'CURRI' THEN 1 END)::int AS "curriBooked",
          COUNT(CASE WHEN "provider" = 'CURRI' AND "curriBookingId" NOT LIKE 'manual-%' THEN 1 END)::int AS "curriApiBooked"
        FROM "Delivery"
        WHERE "createdAt" > NOW() - INTERVAL '90 days'
      `)
      curriStats = cs[0] || { total: 0, curriBooked: 0, curriApiBooked: 0 }
    } catch { curriStats = { error: 'Curri columns not yet created' } }

    // 7. Check Stripe payment stats
    let stripeStats: any = null
    try {
      const ss: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS "totalPayments",
          COUNT(CASE WHEN "method" = 'STRIPE' OR "stripePaymentId" IS NOT NULL THEN 1 END)::int AS "stripePayments",
          SUM(CASE WHEN "method" = 'STRIPE' OR "stripePaymentId" IS NOT NULL THEN "amount" ELSE 0 END)::numeric(12,2) AS "stripeVolume"
        FROM "Payment"
        WHERE "createdAt" > NOW() - INTERVAL '90 days'
      `)
      stripeStats = ss[0] || { totalPayments: 0, stripePayments: 0, stripeVolume: 0 }
    } catch { stripeStats = { error: 'Stripe payment columns not available' } }

    // 8. Check Gmail comm log stats
    let gmailStats: any = null
    try {
      const gs: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS "totalLogs",
          COUNT(CASE WHEN "channel" = 'EMAIL' THEN 1 END)::int AS "emailLogs",
          COUNT(CASE WHEN "channel" = 'EMAIL' AND "direction" = 'INBOUND' THEN 1 END)::int AS "inbound",
          COUNT(CASE WHEN "channel" = 'EMAIL' AND "direction" = 'OUTBOUND' THEN 1 END)::int AS "outbound"
        FROM "CommunicationLog"
        WHERE "createdAt" > NOW() - INTERVAL '30 days'
      `)
      gmailStats = gs[0] || { totalLogs: 0, emailLogs: 0, inbound: 0, outbound: 0 }
    } catch { gmailStats = { error: 'CommunicationLog table not available' } }

    // 9. Check Hyphen schedule entries
    let hyphenStats: any = null
    try {
      const hs: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS "totalEntries",
          COUNT(CASE WHEN "source" = 'HYPHEN' OR "externalId" LIKE 'hyp-%' THEN 1 END)::int AS "hyphenEntries"
        FROM "ScheduleEntry"
        WHERE "createdAt" > NOW() - INTERVAL '90 days'
      `)
      hyphenStats = hs[0] || { totalEntries: 0, hyphenEntries: 0 }
    } catch { hyphenStats = { error: 'ScheduleEntry table not available' } }

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
      {
        integration: 'Bolt / ECI',
        provider: 'BOLT',
        routes: [
          {
            name: 'Customer Sync',
            direction: 'PULL',
            source: 'Bolt API',
            target: 'Builder table',
            endpoint: 'POST /api/ops/integrations { action: sync, provider: bolt, syncType: customers }',
            libFunction: 'syncBoltCustomers()',
            dataFields: 'customerNumber, companyName, contact, address, phone, email, terms',
            status: getRouteStatus(configs, 'BOLT'),
            stats: null,
          },
          {
            name: 'Order / Invoice Sync',
            direction: 'PULL',
            source: 'Bolt API',
            target: 'Order, Invoice tables',
            endpoint: 'POST /api/ops/integrations { action: sync, provider: bolt, syncType: orders }',
            libFunction: 'syncBoltOrders()',
            dataFields: 'orderNumber, items, totals, invoices, payment status',
            status: getRouteStatus(configs, 'BOLT'),
            stats: null,
          },
          {
            name: 'Work Order Sync',
            direction: 'PULL',
            source: 'Bolt API',
            target: 'Job / Task tables',
            endpoint: 'POST /api/ops/integrations { action: sync, provider: bolt, syncType: work-orders }',
            libFunction: 'syncBoltWorkOrders()',
            dataFields: 'workOrderNumber, jobId, items, scheduling, status',
            status: getRouteStatus(configs, 'BOLT'),
            stats: null,
          },
          {
            name: 'Hourly Cron Sync',
            direction: 'PULL',
            source: 'Bolt API (scheduled)',
            target: 'Multiple tables',
            endpoint: 'GET /api/cron/bolt-sync',
            libFunction: 'withCronRun("bolt-sync", ...)',
            dataFields: 'Full delta sync: customers, orders, invoices, work orders',
            status: getRouteStatus(configs, 'BOLT'),
            stats: null,
          },
        ],
      },
      {
        integration: 'BPW (Business Process Workflow)',
        provider: 'BPW',
        routes: [
          {
            name: 'Data Sync',
            direction: 'PULL',
            source: 'BPW API',
            target: 'Multiple tables',
            endpoint: 'POST /api/ops/integrations { action: sync, provider: bpw }',
            libFunction: 'syncBpwData()',
            dataFields: 'orders, scheduling, production data, delivery status',
            status: getRouteStatus(configs, 'BPW'),
            stats: null,
          },
          {
            name: 'Hourly Cron Sync',
            direction: 'PULL',
            source: 'BPW API (scheduled)',
            target: 'Multiple tables',
            endpoint: 'GET /api/cron/bpw-sync',
            libFunction: 'withCronRun("bpw-sync", ...)',
            dataFields: 'Full delta sync of BPW records',
            status: getRouteStatus(configs, 'BPW'),
            stats: null,
          },
        ],
      },
      {
        integration: 'Hyphen (BuildPro / SupplyPro)',
        provider: 'HYPHEN',
        routes: [
          {
            name: 'Schedule Sync (BuildPro)',
            direction: 'PULL',
            source: 'Hyphen BuildPro API',
            target: 'ScheduleEntry table',
            endpoint: 'POST /api/ops/integrations { action: sync, provider: hyphen, syncType: schedules }',
            libFunction: 'syncHyphenSchedules()',
            dataFields: 'scheduleId, projectId, phase, date, assignment, status',
            status: getRouteStatus(configs, 'HYPHEN'),
            stats: hyphenStats && !hyphenStats.error
              ? `${hyphenStats.hyphenEntries}/${hyphenStats.totalEntries} from Hyphen`
              : hyphenStats?.error || 'N/A',
          },
          {
            name: 'Supply Order Sync (SupplyPro)',
            direction: 'PULL',
            source: 'Hyphen SupplyPro API',
            target: 'PurchaseOrder / Product tables',
            endpoint: 'POST /api/ops/integrations { action: sync, provider: hyphen, syncType: supply-orders }',
            libFunction: 'syncHyphenSupplyOrders()',
            dataFields: 'poNumber, vendor, items, quantities, dates, costs',
            status: getRouteStatus(configs, 'HYPHEN'),
            stats: null,
          },
          {
            name: 'Webhook: Schedule / Order Events',
            direction: 'INBOUND',
            source: 'Hyphen Webhooks',
            target: 'ScheduleEntry, PurchaseOrder',
            endpoint: 'POST /api/webhooks/hyphen',
            libFunction: 'processHyphenWebhook()',
            dataFields: 'schedule.updated, order.created, order.updated (HMAC verified)',
            status: getRouteStatus(configs, 'HYPHEN'),
            stats: null,
          },
          {
            name: 'Hourly Cron Sync',
            direction: 'PULL',
            source: 'Hyphen API (scheduled)',
            target: 'Multiple tables',
            endpoint: 'GET /api/cron/hyphen-sync',
            libFunction: 'withCronRun("hyphen-sync", ...)',
            dataFields: 'Delta sync: schedules, supply orders, project mappings',
            status: getRouteStatus(configs, 'HYPHEN'),
            stats: null,
          },
        ],
      },
      {
        integration: 'Gmail (Communication Log)',
        provider: 'GMAIL',
        routes: [
          {
            name: 'Email Sync (Pub/Sub Push)',
            direction: 'INBOUND',
            source: 'Gmail Pub/Sub notification',
            target: 'CommunicationLog table',
            endpoint: 'POST /api/webhooks/gmail',
            libFunction: 'processGmailPush()',
            dataFields: 'messageId, from, to, subject, body, threadId, labels, date',
            status: getRouteStatus(configs, 'GMAIL'),
            stats: gmailStats && !gmailStats.error
              ? `${gmailStats.emailLogs} emails (${gmailStats.inbound} in / ${gmailStats.outbound} out) last 30d`
              : gmailStats?.error || 'N/A',
          },
          {
            name: 'Gmail Apps Script Sync',
            direction: 'PUSH',
            source: 'Gmail (Apps Script)',
            target: 'CommunicationLog table',
            endpoint: 'POST /api/ops/communication-logs/gmail-sync',
            libFunction: 'bulkImport()',
            dataFields: 'Batch email import via Apps Script triggers',
            status: getRouteStatus(configs, 'GMAIL'),
            stats: null,
          },
          {
            name: 'Builder Auto-Match',
            direction: 'INTERNAL',
            source: 'CommunicationLog (unmatched)',
            target: 'Builder link via email domain',
            endpoint: 'Internal: during import',
            libFunction: 'matchEmailToBuilder()',
            dataFields: 'Email domain → Builder.email / contact lookup',
            status: 'READY',
            stats: null,
          },
        ],
      },
      {
        integration: 'Curri (Third-Party Delivery)',
        provider: 'CURRI',
        routes: [
          {
            name: 'Book Delivery',
            direction: 'PUSH',
            source: 'Delivery table',
            target: 'Curri API',
            endpoint: 'POST /api/ops/delivery/curri',
            libFunction: 'Curri REST API (or manual booking fallback)',
            dataFields: 'pickup/dropoff address, vehicle type, contact, scheduled time',
            status: process.env.CURRI_API_KEY ? 'ACTIVE' : 'MANUAL_MODE',
            stats: curriStats && !curriStats.error
              ? `${curriStats.curriBooked} Curri / ${curriStats.total} total deliveries (${curriStats.curriApiBooked} via API)`
              : curriStats?.error || 'N/A',
          },
          {
            name: 'List & Compare Deliveries',
            direction: 'PULL',
            source: 'Delivery table',
            target: 'Dashboard',
            endpoint: 'GET /api/ops/delivery/curri',
            libFunction: 'In-house vs Curri comparison stats',
            dataFields: 'cost, count, delivered, active — 90-day window',
            status: 'READY',
            stats: null,
          },
        ],
      },
      {
        integration: 'Stripe (Payments)',
        provider: 'STRIPE',
        routes: [
          {
            name: 'Webhook: Payment Events',
            direction: 'INBOUND',
            source: 'Stripe Webhooks',
            target: 'Payment, Invoice tables',
            endpoint: 'POST /api/webhooks/stripe',
            libFunction: 'processStripeWebhook()',
            dataFields: 'payment_intent.succeeded, invoice.paid, charge.refunded (signature verified)',
            status: process.env.STRIPE_WEBHOOK_SECRET ? 'ACTIVE' : 'NOT_CONFIGURED',
            stats: stripeStats && !stripeStats.error
              ? `${stripeStats.stripePayments} Stripe payments ($${Number(stripeStats.stripeVolume || 0).toLocaleString()}) last 90d`
              : stripeStats?.error || 'N/A',
          },
          {
            name: 'Payment Processing',
            direction: 'PUSH',
            source: 'Payment form / Invoice',
            target: 'Stripe API',
            endpoint: 'POST /api/ops/payments { method: STRIPE }',
            libFunction: 'createStripePaymentIntent()',
            dataFields: 'amount, currency, customer, metadata, invoiceId',
            status: process.env.STRIPE_SECRET_KEY ? 'ACTIVE' : 'NOT_CONFIGURED',
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
      btMappingStats,
      supplierPriceStats,
      productSyncStats: productSyncStats[0],
      curriStats,
      stripeStats,
      gmailStats,
      hyphenStats,
    })
  } catch (error: any) {
    console.error('Integration health check error:', error)
    return safeJson({ error: 'Internal server error'}, { status: 500 })
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
