export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { toCsv, csvFilename } from '@/lib/csv'

// GET /api/ops/kpis/export?section=<section>&format=csv
//
// Sections: ar-aging | pipeline | revenue | summary | hw-pitch | builders |
//           deliveries | lowstock
//
// `format=csv` (default) returns text/csv with a download filename.
// `format=json` returns the raw rows — useful for copy-to-clipboard flows that
// want to format client-side.
//
// `?at=YYYY-MM-DD` pins the export to a historical snapshot. For sections we
// can recompute cleanly (ar-aging, revenue, summary, hw-pitch) we compute as-of
// that date. For sections tied to now (pipeline, builders, deliveries,
// lowstock) the value is the best available live read — the UI labels it.
export async function GET(request: NextRequest) {
  const authErr = checkStaffAuth(request)
  if (authErr) return authErr

  const sp = request.nextUrl.searchParams
  const section = (sp.get('section') || 'ar-aging').toLowerCase()
  const format = (sp.get('format') || 'csv').toLowerCase()
  const from = sp.get('from')
  const to = sp.get('to')
  const at = sp.get('at')

  try {
    const data = await buildSection(section, { from, to, at })

    if (format === 'json') {
      return NextResponse.json(data)
    }

    const csv = toCsv(data.rows, data.columns)
    const filename = csvFilename(`abel-kpis_${section}`, at ? new Date(at) : new Date())
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('KPI export error:', err)
    return NextResponse.json(
      { error: 'Failed to build KPI export', detail: err?.message },
      { status: 500 },
    )
  }
}

type SectionOpts = { from: string | null; to: string | null; at: string | null }

async function buildSection(
  section: string,
  opts: SectionOpts,
): Promise<{
  rows: Array<Record<string, unknown>>
  columns: Array<{ key: string; label: string }>
}> {
  const asOf = opts.at ? new Date(opts.at) : new Date()
  const asOfIso = asOf.toISOString()
  const periodDays = opts.from && opts.to
    ? Math.max(1, Math.round((new Date(opts.to).getTime() - new Date(opts.from).getTime()) / 86400000))
    : 30

  switch (section) {
    case 'ar-aging':
    case 'ar': {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT bucket, invoice_count::int AS "invoiceCount", amount::float AS amount FROM (
          SELECT 1 AS sort_order, 'Current' AS bucket,
            COUNT(*)::int AS invoice_count,
            COALESCE(SUM(total),0)::float AS amount
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
            AND ("dueDate" IS NULL OR "dueDate" >= $1::timestamp)
          UNION ALL
          SELECT 2, '1-30 Days',
            COUNT(*)::int,
            COALESCE(SUM(total),0)::float
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
            AND "dueDate" < $1::timestamp
            AND "dueDate" >= $1::timestamp - interval '30 days'
          UNION ALL
          SELECT 3, '31-60 Days',
            COUNT(*)::int,
            COALESCE(SUM(total),0)::float
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
            AND "dueDate" < $1::timestamp - interval '30 days'
            AND "dueDate" >= $1::timestamp - interval '60 days'
          UNION ALL
          SELECT 4, '60+ Days',
            COUNT(*)::int,
            COALESCE(SUM(total),0)::float
          FROM "Invoice"
          WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')
            AND "dueDate" < $1::timestamp - interval '60 days'
        ) agg ORDER BY sort_order
        `,
        asOfIso,
      )
      return {
        rows,
        columns: [
          { key: 'bucket', label: 'Bucket' },
          { key: 'invoiceCount', label: 'Invoices' },
          { key: 'amount', label: 'Amount (USD)' },
        ],
      }
    }

    case 'pipeline': {
      const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT status::text AS stage, COUNT(*)::int AS count
        FROM "Job" GROUP BY status::text ORDER BY count DESC
      `)
      return {
        rows,
        columns: [
          { key: 'stage', label: 'Stage' },
          { key: 'count', label: 'Count' },
        ],
      }
    }

    case 'revenue': {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT TO_CHAR("createdAt",'YYYY-MM') AS month,
               TO_CHAR("createdAt",'Mon YYYY') AS "monthLabel",
               COUNT(*)::int AS orders,
               COALESCE(SUM(total),0)::float AS revenue
        FROM "Order"
        WHERE "createdAt" <= $1::timestamp
          AND "createdAt" >= $1::timestamp - interval '12 months'
        GROUP BY 1, 2 ORDER BY 1 DESC
        `,
        asOfIso,
      )
      return {
        rows,
        columns: [
          { key: 'monthLabel', label: 'Month' },
          { key: 'orders', label: 'Orders' },
          { key: 'revenue', label: 'Revenue (USD)' },
        ],
      }
    }

    case 'builders': {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT b."companyName" AS "companyName",
               COUNT(o."id")::int AS "orderCount",
               COALESCE(SUM(o."total"),0)::float AS "totalRevenue",
               COALESCE(AVG(o."total"),0)::float AS "avgOrder"
        FROM "Order" o
        JOIN "Builder" b ON b."id" = o."builderId"
        WHERE o."createdAt" >= $1::timestamp - ($2::int * interval '1 day')
          AND o."createdAt" <= $1::timestamp
        GROUP BY b."id", b."companyName"
        ORDER BY "totalRevenue" DESC
        LIMIT 25
        `,
        asOfIso,
        periodDays,
      )
      return {
        rows,
        columns: [
          { key: 'companyName', label: 'Builder' },
          { key: 'orderCount', label: 'Orders' },
          { key: 'totalRevenue', label: 'Revenue (USD)' },
          { key: 'avgOrder', label: 'Avg Order (USD)' },
        ],
      }
    }

    case 'deliveries': {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT status::text AS status,
               COUNT(*)::int AS count
        FROM "Delivery"
        WHERE "createdAt" >= $1::timestamp - ($2::int * interval '1 day')
          AND "createdAt" <= $1::timestamp
        GROUP BY status::text
        ORDER BY count DESC
        `,
        asOfIso,
        periodDays,
      )
      return {
        rows,
        columns: [
          { key: 'status', label: 'Status' },
          { key: 'count', label: 'Count' },
        ],
      }
    }

    case 'lowstock': {
      // No user input, safe as-is.
      const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT p."sku" AS sku, p."name" AS name, p."category" AS category,
               i."onHand"::int AS "onHand", i."committed"::int AS committed,
               i."available"::int AS available
        FROM "InventoryItem" i
        JOIN "Product" p ON p."id" = i."productId"
        WHERE i."available" <= 5 AND p."active" = true
        ORDER BY i."available" ASC
        LIMIT 50
      `)
      return {
        rows,
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'name', label: 'Name' },
          { key: 'category', label: 'Category' },
          { key: 'onHand', label: 'On Hand' },
          { key: 'committed', label: 'Committed' },
          { key: 'available', label: 'Available' },
        ],
      }
    }

    case 'summary':
    case 'all': {
      // A flat list of every KPI with name + value — handy for pasting
      // into a status email or deck.
      const [revenue, ar, quotes, openOrders, onTime]: any[] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM(total),0)::float AS v FROM "Order"
           WHERE status::text NOT IN ('CANCELLED')
             AND "createdAt" >= date_trunc('month', $1::timestamp)
             AND "createdAt" <= $1::timestamp`,
          asOfIso,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM(total),0)::float AS v, COUNT(*)::int AS n
           FROM "Invoice" WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')`,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE status::text = 'APPROVED')::int AS conv
           FROM "Quote"
           WHERE "createdAt" >= $1::timestamp - interval '30 days'
             AND "createdAt" <= $1::timestamp`,
          asOfIso,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS n FROM "Order"
           WHERE status::text IN ('RECEIVED','CONFIRMED','IN_PRODUCTION','READY_TO_SHIP')`,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE "completedAt" <= "updatedAt" + interval '1 day')::int AS on_time
           FROM "Delivery" WHERE status::text = 'COMPLETE'
             AND "completedAt" >= $1::timestamp - interval '30 days'
             AND "completedAt" <= $1::timestamp`,
          asOfIso,
        ),
      ])
      const rev = revenue[0]?.v || 0
      const arRow = ar[0] || { v: 0, n: 0 }
      const qRow = quotes[0] || { total: 0, conv: 0 }
      const oRow = openOrders[0] || { n: 0 }
      const dRow = onTime[0] || { total: 0, on_time: 0 }
      const conv = qRow.total > 0 ? Math.round((qRow.conv / qRow.total) * 100) : 0
      const otd = dRow.total > 0 ? Math.round((dRow.on_time / dRow.total) * 100) : 0
      return {
        rows: [
          { metric: 'As of', value: asOf.toISOString().slice(0, 10) },
          { metric: 'Revenue (month-to-date)', value: Math.round(rev) },
          { metric: 'Outstanding AR', value: Math.round(arRow.v) },
          { metric: 'Unpaid invoices', value: arRow.n },
          { metric: 'Open orders', value: oRow.n },
          { metric: 'Quote conversion (30d)', value: `${conv}%` },
          { metric: 'On-time delivery (30d)', value: `${otd}%` },
        ],
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'value', label: 'Value' },
        ],
      }
    }

    case 'hw-pitch': {
      // "Copy for HW pitch" — the condensed Hancock-Whitney cash/AR packet.
      const [ar, rev, wip]: any[] = await Promise.all([
        prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM(total),0)::float AS total,
                  COALESCE(SUM(CASE WHEN "dueDate" < $1::timestamp THEN total ELSE 0 END),0)::float AS overdue,
                  COUNT(*)::int AS n
           FROM "Invoice"
           WHERE status::text NOT IN ('PAID','VOID','WRITE_OFF')`,
          asOfIso,
        ),
        prisma.$queryRawUnsafe(
          `SELECT
             COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('month',$1::timestamp) THEN total ELSE 0 END),0)::float AS mtd,
             COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('year',$1::timestamp) THEN total ELSE 0 END),0)::float AS ytd
           FROM "Order" WHERE status::text NOT IN ('CANCELLED')`,
          asOfIso,
        ),
        prisma.$queryRawUnsafe(
          `SELECT COALESCE(SUM(total),0)::float AS v, COUNT(*)::int AS n
           FROM "Order"
           WHERE status::text IN ('RECEIVED','CONFIRMED','IN_PRODUCTION','READY_TO_SHIP')`,
        ),
      ])
      return {
        rows: [
          { metric: 'Snapshot date', value: asOf.toISOString().slice(0, 10) },
          { metric: 'Revenue MTD', value: Math.round(rev[0]?.mtd || 0) },
          { metric: 'Revenue YTD', value: Math.round(rev[0]?.ytd || 0) },
          { metric: 'AR outstanding', value: Math.round(ar[0]?.total || 0) },
          { metric: 'AR overdue', value: Math.round(ar[0]?.overdue || 0) },
          { metric: 'Open invoices', value: ar[0]?.n || 0 },
          { metric: 'WIP order value', value: Math.round(wip[0]?.v || 0) },
          { metric: 'Open orders', value: wip[0]?.n || 0 },
        ],
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'value', label: 'Value' },
        ],
      }
    }

    default:
      throw new Error(`Unknown section: ${section}`)
  }
}
