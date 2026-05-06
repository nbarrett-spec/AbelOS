// Agent B flow-probe ROUND 4 — drill into root causes. READ-ONLY.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function q(label, sql, params = []) {
  try {
    const rows = await prisma.$queryRawUnsafe(sql, ...params)
    console.log(`\n=== ${label} ===`)
    console.log(JSON.stringify(rows, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2))
    return rows
  } catch (e) {
    console.log(`\n=== ${label} :: ERROR ===`)
    console.log(e.message.slice(0, 400))
    return []
  }
}

async function main() {
  // Confirm orders 2026-03-24+ that might have been Delivered via import vs actual path
  await q('Order.status=DELIVERED grouped by orderNumber prefix', `
    SELECT
      CASE
        WHEN "orderNumber" LIKE 'ORD-%' THEN 'ORD-native'
        WHEN "orderNumber" LIKE 'SO-%' THEN 'SO-imported'
        ELSE LEFT("orderNumber", 5)
      END AS prefix,
      COUNT(*)::int AS n
    FROM "Order" WHERE status::text='DELIVERED' AND (
      ("isForecast" IS DISTINCT FROM true) OR "isForecast" IS NULL
    )
    GROUP BY prefix ORDER BY n DESC`)

  // Which SO- orders are truly from imported Bolt/legacy vs created natively?
  await q('Order.quoteId NULL vs NOT NULL on DELIVERED', `
    SELECT
      CASE WHEN "quoteId" IS NULL THEN 'no_quote' ELSE 'has_quote' END AS link,
      COUNT(*)::int AS n,
      ROUND(SUM("total")::numeric, 0)::text AS dollars
    FROM "Order" WHERE status::text='DELIVERED'
    GROUP BY link`)

  // Which Orders have the paymentStatus=INVOICED flag set — should match invoices created
  await q('Order.paymentStatus buckets', `
    SELECT "paymentStatus"::text AS status, COUNT(*)::int AS n,
           ROUND(SUM("total")::numeric, 0)::text AS dollars
    FROM "Order" GROUP BY status ORDER BY n DESC`)

  // Verify: there's exactly ONE native ORD- order. Everything else is imported.
  await q('Native ORD-YYYY orders summary', `
    SELECT
      status::text AS status, COUNT(*)::int AS n,
      MIN("createdAt") AS first_seen, MAX("createdAt") AS last_seen
    FROM "Order" WHERE "orderNumber" LIKE 'ORD-2026-%'
    GROUP BY status ORDER BY n DESC`)

  // Confirm the claim: no Invoices created since 2026-03-23
  await q('Invoices createdAt in April 2026', `
    SELECT DATE_TRUNC('day', "createdAt")::date AS day, COUNT(*)::int AS n
    FROM "Invoice" WHERE "createdAt" >= '2026-04-01'
    GROUP BY day ORDER BY day DESC LIMIT 30`)

  await q('All invoices with issuedAt in April 2026', `
    SELECT COUNT(*)::int AS issued_in_april
    FROM "Invoice" WHERE "issuedAt" >= '2026-04-01'`)

  // Where do those 4020 April 23 rows come from? Seems like today's seed
  await q('Invoice createdAt 2026-04-23 breakdown', `
    SELECT status::text AS status, COUNT(*)::int AS n,
           MIN("invoiceNumber") AS first_inv, MAX("invoiceNumber") AS last_inv
    FROM "Invoice" WHERE "createdAt"::date = '2026-04-23'
    GROUP BY status`)

  // Who's listed as createdById on these 4020 rows?
  await q('Invoice createdBy distribution', `
    SELECT "createdById", COUNT(*)::int AS n
    FROM "Invoice" GROUP BY "createdById" ORDER BY n DESC LIMIT 10`)

  // Order-lifecycle cascade: does the PATCH actually get called?
  await q('AuditLog related to Order status transitions last 30d', `
    SELECT action, entity, COUNT(*)::int AS n
    FROM "AuditLog" WHERE "createdAt" > NOW() - INTERVAL '30 days'
      AND entity IN ('Order','Invoice','Job','Delivery')
    GROUP BY action, entity ORDER BY n DESC LIMIT 30`)

  // FLOW 5 confirm — Delivery status values
  await q('FLOW5 Delivery status enum values', `
    SELECT unnest(enum_range(NULL::"DeliveryStatus"))::text AS val`)

  await q('FLOW5 Recent Delivery without any cascade?', `
    SELECT "deliveryNumber", status::text, "completedAt",
           "signedBy", "sitePhotos" IS NOT NULL AS has_photos
    FROM "Delivery" WHERE "completedAt" > '2026-03-01'
    ORDER BY "completedAt" DESC LIMIT 5`)

  // FLOW 6 — any Payment rows with Stripe method
  await q('FLOW6 Payment methods breakdown', `
    SELECT method::text AS method, COUNT(*)::int AS n, SUM(amount)::numeric AS total
    FROM "Payment" GROUP BY method ORDER BY n DESC`)

  // Is there any cron/flow anywhere that would promote DRAFT → ISSUED?
  // Check the accounting/close page server file
  // Already read monthly-close. Does it flip invoices?

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
