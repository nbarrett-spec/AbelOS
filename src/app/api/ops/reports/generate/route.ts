export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { toCsv, csvFilename } from '@/lib/csv'

// POST /api/ops/reports/generate
//
// Body: { templateId: string, params?: { from?, to?, format?, builderId?, ... } }
//
// Templates:
//   ar-aging              — AR aging buckets snapshot
//   revenue-by-builder    — Orders/revenue per builder, optional date window
//   po-by-vendor          — Open POs grouped by vendor
//   deliveries-by-driver  — Delivery counts per crew (driver proxy)
//   profit-by-family      — Revenue + estimated margin by product category
//
// Returns a CSV download (format='csv') or JSON rows (format='json').
export async function POST(request: NextRequest) {
  const authErr = checkStaffAuth(request)
  if (authErr) return authErr

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const templateId = String(body.templateId || '').toLowerCase()
  const params = body.params || {}
  const format = String(params.format || 'csv').toLowerCase()

  if (!templateId) {
    return NextResponse.json({ error: 'templateId required' }, { status: 400 })
  }

  try {
    const result = await runTemplate(templateId, params)

    if (format === 'json') {
      return NextResponse.json({
        templateId,
        generatedAt: new Date().toISOString(),
        rowCount: result.rows.length,
        rows: result.rows,
        columns: result.columns,
      })
    }

    const csv = toCsv(result.rows, result.columns)
    const filename = csvFilename(`abel-report_${templateId}`)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('Report generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate report', templateId, detail: err?.message },
      { status: 500 },
    )
  }
}

type ReportParams = {
  from?: string
  to?: string
  format?: string
  builderId?: string
  vendorId?: string
}

type ReportResult = {
  rows: Array<Record<string, unknown>>
  columns: Array<{ key: string; label: string }>
}

async function runTemplate(templateId: string, params: ReportParams): Promise<ReportResult> {
  const to = params.to ? new Date(params.to) : new Date()
  const from = params.from
    ? new Date(params.from)
    : new Date(to.getTime() - 30 * 86400000)
  const fromIso = from.toISOString()
  const toIso = to.toISOString()

  switch (templateId) {
    case 'ar-aging': {
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
        toIso,
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

    case 'revenue-by-builder': {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT b."companyName" AS "companyName",
               COUNT(o."id")::int AS "orderCount",
               COALESCE(SUM(o."total"),0)::float AS "totalRevenue",
               COALESCE(AVG(o."total"),0)::float AS "avgOrder"
        FROM "Order" o
        JOIN "Builder" b ON b."id" = o."builderId"
        WHERE o."createdAt" >= $1::timestamp
          AND o."createdAt" <= $2::timestamp
          AND o."status"::text NOT IN ('CANCELLED')
        GROUP BY b."id", b."companyName"
        ORDER BY "totalRevenue" DESC
        `,
        fromIso,
        toIso,
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

    case 'po-by-vendor': {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT v."name" AS vendor,
               COUNT(p."id")::int AS "poCount",
               COALESCE(SUM(p."total"),0)::float AS "totalValue",
               COUNT(p."id") FILTER (WHERE p."status"::text IN ('DRAFT','SUBMITTED','CONFIRMED','PARTIAL_RECEIVED'))::int AS "openCount",
               COALESCE(SUM(CASE WHEN p."status"::text IN ('DRAFT','SUBMITTED','CONFIRMED','PARTIAL_RECEIVED') THEN p."total" ELSE 0 END),0)::float AS "openValue"
        FROM "PurchaseOrder" p
        JOIN "Vendor" v ON v."id" = p."vendorId"
        WHERE p."createdAt" >= $1::timestamp
          AND p."createdAt" <= $2::timestamp
        GROUP BY v."id", v."name"
        ORDER BY "openValue" DESC
        `,
        fromIso,
        toIso,
      )
      return {
        rows,
        columns: [
          { key: 'vendor', label: 'Vendor' },
          { key: 'poCount', label: 'Total POs' },
          { key: 'totalValue', label: 'Total Value (USD)' },
          { key: 'openCount', label: 'Open POs' },
          { key: 'openValue', label: 'Open Value (USD)' },
        ],
      }
    }

    case 'deliveries-by-driver': {
      // "Driver" in our data model is the delivery Crew — most crews have one
      // primary driver. We report by crew for now.
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT COALESCE(c."name", 'Unassigned') AS crew,
               COUNT(d."id")::int AS total,
               COUNT(d."id") FILTER (WHERE d."status"::text = 'COMPLETE')::int AS completed,
               COUNT(d."id") FILTER (WHERE d."status"::text IN ('SCHEDULED','IN_TRANSIT'))::int AS "inFlight",
               COUNT(d."id") FILTER (
                 WHERE d."completedAt" IS NOT NULL
                   AND d."completedAt" <= d."updatedAt" + interval '1 day'
               )::int AS "onTime"
        FROM "Delivery" d
        LEFT JOIN "Crew" c ON c."id" = d."crewId"
        WHERE d."createdAt" >= $1::timestamp
          AND d."createdAt" <= $2::timestamp
        GROUP BY c."id", c."name"
        ORDER BY total DESC
        `,
        fromIso,
        toIso,
      )
      return {
        rows,
        columns: [
          { key: 'crew', label: 'Driver/Crew' },
          { key: 'total', label: 'Total Deliveries' },
          { key: 'completed', label: 'Completed' },
          { key: 'inFlight', label: 'In-Flight' },
          { key: 'onTime', label: 'On-Time' },
        ],
      }
    }

    case 'profit-by-family': {
      // Revenue and estimated margin by product category. Margin is inferred
      // from Product.cost when available — if not, margin columns are blank.
      const rows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT COALESCE(p."category",'Uncategorized') AS category,
               COUNT(oi."id")::int AS "lineCount",
               COALESCE(SUM(oi."lineTotal"),0)::float AS revenue,
               COALESCE(SUM(oi."quantity" * COALESCE(p."cost",0)),0)::float AS cost,
               COALESCE(SUM(oi."lineTotal") - SUM(oi."quantity" * COALESCE(p."cost",0)),0)::float AS margin
        FROM "OrderItem" oi
        LEFT JOIN "Product" p ON p."id" = oi."productId"
        JOIN "Order" o ON o."id" = oi."orderId"
        WHERE o."createdAt" >= $1::timestamp
          AND o."createdAt" <= $2::timestamp
          AND o."status"::text NOT IN ('CANCELLED')
        GROUP BY p."category"
        ORDER BY revenue DESC
        `,
        fromIso,
        toIso,
      )
      const withPct = rows.map((r: any) => ({
        ...r,
        marginPct: r.revenue > 0 ? Math.round((r.margin / r.revenue) * 1000) / 10 : 0,
      }))
      return {
        rows: withPct,
        columns: [
          { key: 'category', label: 'Product Family' },
          { key: 'lineCount', label: 'Line Items' },
          { key: 'revenue', label: 'Revenue (USD)' },
          { key: 'cost', label: 'Est. Cost (USD)' },
          { key: 'margin', label: 'Est. Margin (USD)' },
          { key: 'marginPct', label: 'Margin %' },
        ],
      }
    }

    default:
      throw new Error(`Unknown templateId: ${templateId}`)
  }
}
