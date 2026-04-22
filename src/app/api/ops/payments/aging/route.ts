export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get all invoices with outstanding balances
    const invoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        i."id",
        i."invoiceNumber",
        i."builderId",
        b."companyName",
        (i."total" - COALESCE(i."amountPaid", 0))::FLOAT as "balanceDue",
        i."dueDate",
        i."status"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      WHERE (i."total" - COALESCE(i."amountPaid", 0)) > 0
        AND i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
      ORDER BY i."dueDate" ASC NULLS FIRST
    `)

    const now = new Date()
    let current = 0, past30 = 0, past60 = 0, past90 = 0, past120 = 0
    const builderMap: Record<string, any> = {}

    for (const inv of invoices) {
      const bal = parseFloat(inv.balanceDue) || 0
      const due = inv.dueDate ? new Date(inv.dueDate) : null
      const daysOverdue = due ? Math.floor((now.getTime() - due.getTime()) / 86400000) : 0

      let bucket: string
      if (!due || daysOverdue <= 0) { current += bal; bucket = 'current' }
      else if (daysOverdue <= 30) { past30 += bal; bucket = 'past30' }
      else if (daysOverdue <= 60) { past60 += bal; bucket = 'past60' }
      else if (daysOverdue <= 90) { past90 += bal; bucket = 'past90' }
      else { past120 += bal; bucket = 'past120' }

      const bId = inv.builderId || 'unknown'
      if (!builderMap[bId]) {
        builderMap[bId] = {
          builderId: bId,
          companyName: inv.companyName || 'Unknown',
          current: 0, past30: 0, past60: 0, past90: 0, past120: 0, total: 0
        }
      }
      builderMap[bId][bucket] += bal
      builderMap[bId].total += bal
    }

    const total = current + past30 + past60 + past90 + past120

    const byBuilder = Object.values(builderMap)
      .sort((a: any, b: any) => b.total - a.total)
      .map((b: any) => ({
        ...b,
        percentCurrent: b.total > 0 ? Math.round((b.current / b.total) * 100) : 0,
      }))

    return NextResponse.json({
      success: true,
      summary: { current, past30, past60, past90, past120, total },
      byBuilder,
      generatedAt: new Date(),
    })
  } catch (error: any) {
    console.error('Aging report error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
