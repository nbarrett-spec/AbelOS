export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

/**
 * GET /api/builders/warranty/lookups
 *
 * Lightweight lookup feed for the Builder Portal warranty form.  Returns
 * the builder's recent orders + active jobs so the form can offer typeahead
 * autocomplete on the optional Order # / Job # fields.
 *
 * Both lists are scoped by the authenticated builder's id (via the
 * abel_session cookie).  Capped + indexed so this is cheap to call on
 * every form open.
 *
 * Query string:
 *   q?   — case-insensitive filter (matches order number, PO number, job
 *          number, lot/block, community, address)
 *   limit? — max items per list, default 25, hard cap 50
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    const builderId = session?.builderId
    if (!builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sp = request.nextUrl.searchParams
    const q = (sp.get('q') || '').trim()
    const requestedLimit = parseInt(sp.get('limit') || '25', 10)
    const limit = Math.min(50, Math.max(1, isNaN(requestedLimit) ? 25 : requestedLimit))

    // ── Orders (most recent first) ──────────────────────────────────
    const orderParams: any[] = [builderId]
    let orderWhere = '"builderId" = $1'
    if (q) {
      orderParams.push(`%${q}%`)
      orderWhere += ` AND ("orderNumber" ILIKE $${orderParams.length} OR COALESCE("poNumber", '') ILIKE $${orderParams.length})`
    }
    orderParams.push(limit)
    const orders = (await prisma.$queryRawUnsafe(
      `SELECT "id", "orderNumber", "poNumber", "status"::text AS status, "createdAt", "total"
       FROM "Order"
       WHERE ${orderWhere}
       ORDER BY "createdAt" DESC
       LIMIT $${orderParams.length}`,
      ...orderParams,
    )) as any[]

    // ── Jobs (active, joined through Order to scope by builderId) ──
    const jobParams: any[] = [builderId]
    let jobWhere = `o."builderId" = $1 AND j.status NOT IN ('COMPLETE', 'CLOSED', 'INVOICED', 'CANCELLED')`
    if (q) {
      jobParams.push(`%${q}%`)
      const i = jobParams.length
      jobWhere += ` AND (
        j."jobNumber" ILIKE $${i}
        OR COALESCE(j."lotBlock", '') ILIKE $${i}
        OR COALESCE(j."community", '') ILIKE $${i}
        OR COALESCE(j."jobAddress", '') ILIKE $${i}
      )`
    }
    jobParams.push(limit)
    const jobs = (await prisma.$queryRawUnsafe(
      `SELECT j."id", j."jobNumber", j."lotBlock", j."community", j."jobAddress",
              j."status"::text AS status, j."scheduledDate", j."createdAt",
              o."orderNumber"
       FROM "Job" j
       JOIN "Order" o ON o."id" = j."orderId"
       WHERE ${jobWhere}
       ORDER BY COALESCE(j."scheduledDate", j."createdAt") DESC
       LIMIT $${jobParams.length}`,
      ...jobParams,
    )) as any[]

    return NextResponse.json({
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        poNumber: o.poNumber || null,
        status: o.status,
        total: o.total != null ? Number(o.total) : 0,
        createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : o.createdAt,
      })),
      jobs: jobs.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        lotBlock: j.lotBlock || null,
        community: j.community || null,
        address: j.jobAddress || null,
        status: j.status,
        scheduledDate:
          j.scheduledDate instanceof Date
            ? j.scheduledDate.toISOString()
            : j.scheduledDate || null,
        orderNumber: j.orderNumber || null,
      })),
    })
  } catch (error: any) {
    console.error('GET /api/builders/warranty/lookups error:', error)
    return NextResponse.json({ error: 'Failed to load lookups' }, { status: 500 })
  }
}
