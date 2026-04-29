export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// FIX-2 — Payment Ledger / Check Register
// GET /api/ops/finance/payments?method=&dateFrom=&dateTo=&builderId=&q=

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  })
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const method = searchParams.get('method') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const builderId = searchParams.get('builderId') || ''
    const q = searchParams.get('q') || ''

    const conds: string[] = []
    const params: any[] = []
    let idx = 1
    if (method) {
      conds.push(`p."method"::text = $${idx}`)
      params.push(method)
      idx++
    }
    if (dateFrom) {
      conds.push(`p."receivedAt" >= $${idx}::timestamptz`)
      params.push(dateFrom)
      idx++
    }
    if (dateTo) {
      conds.push(`p."receivedAt" <= $${idx}::timestamptz`)
      params.push(dateTo)
      idx++
    }
    if (builderId) {
      conds.push(`i."builderId" = $${idx}`)
      params.push(builderId)
      idx++
    }
    if (q) {
      conds.push(`(p."reference" ILIKE $${idx} OR i."invoiceNumber" ILIKE $${idx})`)
      params.push(`%${q}%`)
      idx++
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

    const sql = `
      SELECT p."id", p."amount"::float AS amount, p."method"::text AS method,
             p."reference", p."receivedAt", p."notes",
             i."id" AS "invoiceId", i."invoiceNumber",
             b."id" AS "builderId", b."companyName" AS "builderName"
      FROM "Payment" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      ${where}
      ORDER BY p."receivedAt" DESC
      LIMIT 500
    `
    const payments: any[] = await prisma.$queryRawUnsafe(sql, ...params)

    // Summary
    const totalCount = payments.length
    const totalAmount = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const byMethod: Record<string, { count: number; total: number }> = {}
    for (const p of payments) {
      const m = p.method || 'OTHER'
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 }
      byMethod[m].count++
      byMethod[m].total += Number(p.amount || 0)
    }

    return NextResponse.json({
      payments,
      summary: { totalCount, totalAmount, byMethod },
    })
  } catch (e: any) {
    console.error('[GET /api/ops/finance/payments] error:', e?.message || e)
    return NextResponse.json({ error: 'failed to load payments' }, { status: 500 })
  }
}
