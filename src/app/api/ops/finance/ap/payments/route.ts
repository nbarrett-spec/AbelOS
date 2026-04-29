export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { requireStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/finance/ap/payments
//
// Vendor Payment History — flat, read-only list of every Purchase Order
// that has been paid. Closes the gap Dawn flagged: "I can't see all
// payments we've made to Boise Cascade this year without bouncing between
// PO detail pages."
//
// Dedicated payment columns on PurchaseOrder (paidAt/paidMethod/
// paidReference/paidAmount) were proposed in FIX-10 but have not landed
// yet. Until they do, we infer payment history from the existing
// "mark paid" path used by ap-waterfall:
//   - status moves to RECEIVED (and PARTIALLY_RECEIVED counts as a partial)
//   - receivedAt is stamped with the paid timestamp
//   - notes gets a "PAID <iso> amt=<n> method=<m> ref=<r>" line
//
// We parse the freshest PAID line out of notes for method/reference/amount.
// If the columns ever land, the SELECT can switch over without breaking
// the page.
//
// Query params (all optional):
//   vendorId   — filter to one vendor
//   dateFrom   — ISO yyyy-mm-dd; payment date >= dateFrom 00:00 UTC
//   dateTo     — ISO yyyy-mm-dd; payment date < dateTo + 1 day (inclusive)
//   q          — case-insensitive search on poNumber + payment reference
//   limit      — default 100, max 500
//
// Returns:
//   payments — list (newest first)
//   summary  — totals + count + top vendor
//   vendors  — distinct {id,name} list for the filter dropdown
// ──────────────────────────────────────────────────────────────────────────

interface RawPaidPORow {
  id: string
  poNumber: string
  amount: number
  status: string
  receivedAt: Date | null
  updatedAt: Date
  createdAt: Date
  notes: string | null
  vendorId: string | null
  vendorName: string | null
}

interface VendorOption {
  id: string
  name: string
}

// Parse the freshest "PAID <iso> amt=<n> method=<m> ref=<r>" line from
// notes. ap-waterfall appends new lines on the bottom, so the last match
// wins.
function parsePaymentFromNotes(notes: string | null): {
  paidAt: string | null
  amount: number | null
  method: string | null
  reference: string | null
} {
  if (!notes) return { paidAt: null, amount: null, method: null, reference: null }
  const re =
    /PAID\s+(\S+)(?:\s+amt=([\d.]+))?(?:\s+method=([A-Z_]+))?(?:\s+ref=(\S+))?/g
  let last: RegExpExecArray | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(notes)) !== null) last = m
  if (!last) return { paidAt: null, amount: null, method: null, reference: null }
  return {
    paidAt: last[1] ?? null,
    amount: last[2] ? parseFloat(last[2]) : null,
    method: last[3] ?? null,
    reference: last[4] ?? null,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  })
  if (auth.error) return auth.error

  try {
    const url = new URL(request.url)
    const vendorId = url.searchParams.get('vendorId')
    const dateFromRaw = url.searchParams.get('dateFrom')
    const dateToRaw = url.searchParams.get('dateTo')
    const q = url.searchParams.get('q')?.trim()
    const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500)

    // ── Build WHERE with positional params ────────────────────────────────
    const where: string[] = ['1=1']
    const params: unknown[] = []
    let pidx = 1

    // "Paid" PO definition. PAID/COMPLETE statuses don't exist in the enum
    // today — RECEIVED + PARTIALLY_RECEIVED are the current proxies. The
    // PAID/COMPLETE clauses are forward-compatible no-ops.
    where.push(
      `(po."status"::text IN ('PAID', 'COMPLETE', 'RECEIVED', 'PARTIALLY_RECEIVED'))`,
    )

    if (vendorId) {
      where.push(`po."vendorId" = $${pidx++}`)
      params.push(vendorId)
    }

    // Date filters use receivedAt (paid timestamp) when present, else
    // updatedAt as a fallback so partial / pre-receivedAt rows still
    // filter cleanly.
    if (dateFromRaw) {
      const d = new Date(dateFromRaw)
      if (!isNaN(d.getTime())) {
        const start = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
        )
        where.push(`COALESCE(po."receivedAt", po."updatedAt") >= $${pidx++}`)
        params.push(start)
      }
    }

    if (dateToRaw) {
      const d = new Date(dateToRaw)
      if (!isNaN(d.getTime())) {
        const end = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
        )
        where.push(`COALESCE(po."receivedAt", po."updatedAt") < $${pidx++}`)
        params.push(end)
      }
    }

    if (q && q.length > 0) {
      where.push(
        `(po."poNumber" ILIKE $${pidx} OR COALESCE(po."notes", '') ILIKE $${pidx})`,
      )
      params.push(`%${q}%`)
      pidx++
    }

    const whereClause = `WHERE ${where.join(' AND ')}`

    const sql = `
      SELECT
        po."id",
        po."poNumber",
        po."total"::float AS amount,
        po."status"::text AS status,
        po."receivedAt",
        po."updatedAt",
        po."createdAt",
        po."notes",
        v."id" AS "vendorId",
        v."name" AS "vendorName"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
      ${whereClause}
      ORDER BY COALESCE(po."receivedAt", po."updatedAt") DESC, po."id" DESC
      LIMIT $${pidx++}
    `
    const rows = await prisma.$queryRawUnsafe<RawPaidPORow[]>(
      sql,
      ...params,
      limit,
    )

    // Map to API shape with parsed payment metadata.
    const payments = rows.map((r) => {
      const parsed = parsePaymentFromNotes(r.notes)
      const paidAtISO =
        parsed.paidAt ||
        (r.receivedAt
          ? new Date(r.receivedAt).toISOString()
          : new Date(r.updatedAt).toISOString())
      return {
        id: r.id,
        poNumber: r.poNumber,
        amount: parsed.amount ?? Number(r.amount) ?? 0,
        status: r.status,
        method: parsed.method,
        reference: parsed.reference,
        paidAt: paidAtISO,
        vendorId: r.vendorId,
        vendorName: r.vendorName,
      }
    })

    // Summary KPIs over the filtered set.
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0)
    const byVendor: Record<
      string,
      { vendorId: string; vendorName: string; total: number; count: number }
    > = {}
    for (const p of payments) {
      if (!p.vendorId) continue
      const k = p.vendorId
      if (!byVendor[k]) {
        byVendor[k] = {
          vendorId: p.vendorId,
          vendorName: p.vendorName || 'Unknown',
          total: 0,
          count: 0,
        }
      }
      byVendor[k].total += p.amount || 0
      byVendor[k].count += 1
    }
    const topVendor =
      Object.values(byVendor).sort((a, b) => b.total - a.total)[0] || null

    // Distinct vendor list across ALL paid POs (independent of filters)
    // so the dropdown stays stable as the user narrows.
    const vendorRows = await prisma.$queryRawUnsafe<VendorOption[]>(
      `
      SELECT DISTINCT v."id" AS id, v."name" AS name
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status"::text IN ('PAID', 'COMPLETE', 'RECEIVED', 'PARTIALLY_RECEIVED')
      ORDER BY v."name" ASC
      `,
    )

    return NextResponse.json({
      payments,
      summary: {
        totalPaid,
        count: payments.length,
        topVendor,
      },
      vendors: vendorRows,
      filters: {
        vendorId: vendorId || null,
        dateFrom: dateFromRaw || null,
        dateTo: dateToRaw || null,
        q: q || null,
      },
    })
  } catch (error) {
    console.error('GET /api/ops/finance/ap/payments error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch AP payments' },
      { status: 500 },
    )
  }
}
