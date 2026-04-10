export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const invoices = await prisma.$queryRawUnsafe<Array<{ id: string; invoiceNumber: string; builderId: string; total: number; amountPaid: number; status: string; dueDate: Date | null; issuedAt: Date | null; createdAt: Date }>>(
      `SELECT id, "invoiceNumber", "builderId", total, "amountPaid", status, "dueDate", "issuedAt", "createdAt" FROM "Invoice"`
    )

    const now = new Date()

    // Calculate aging buckets
    const agingBuckets = {
      current: { count: 0, amount: 0 },
      days1to30: { count: 0, amount: 0 },
      days31to60: { count: 0, amount: 0 },
      days60plus: { count: 0, amount: 0 },
    }

    // Build builder map
    const builders = await prisma.$queryRawUnsafe<Array<{ id: string; companyName: string }>>(
      `SELECT id, "companyName" FROM "Builder"`
    )
    const builderMap: Record<string, string> = {}
    builders.forEach((b) => {
      builderMap[b.id] = b.companyName
    })

    const invoiceList: any[] = []
    const builderARMap: Record<string, any> = {}

    invoices.forEach((inv) => {
      if (inv.status === 'PAID' || inv.status === 'VOID') return

      const balance = inv.total - inv.amountPaid
      if (balance <= 0) return

      const issueDate = inv.issuedAt || inv.createdAt
      const daysOutstanding = Math.floor((now.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24))

      let bucket = 'current'
      if (daysOutstanding > 60) {
        agingBuckets.days60plus.count++
        agingBuckets.days60plus.amount += balance
        bucket = 'days60plus'
      } else if (daysOutstanding > 31) {
        agingBuckets.days31to60.count++
        agingBuckets.days31to60.amount += balance
        bucket = 'days31to60'
      } else if (daysOutstanding > 0) {
        agingBuckets.days1to30.count++
        agingBuckets.days1to30.amount += balance
        bucket = 'days1to30'
      } else {
        agingBuckets.current.count++
        agingBuckets.current.amount += balance
      }

      const builderName = builderMap[inv.builderId] || 'Unknown'

      // Add to builder AR summary
      if (!builderARMap[inv.builderId]) {
        builderARMap[inv.builderId] = {
          builderId: inv.builderId,
          builderName,
          totalOutstanding: 0,
          invoiceCount: 0,
        }
      }
      builderARMap[inv.builderId].totalOutstanding += balance
      builderARMap[inv.builderId].invoiceCount++

      // Add to invoice list
      invoiceList.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        builderId: inv.builderId,
        builderName,
        amount: Number(inv.total),
        status: inv.status,
        dueDate: inv.dueDate?.toISOString() || null,
        issuedAt: inv.issuedAt?.toISOString() || null,
        daysOutstanding,
        amountPaid: Number(inv.amountPaid),
        balanceDue: balance,
      })
    })

    const builderSummary = Object.values(builderARMap).sort((a: any, b: any) => b.totalOutstanding - a.totalOutstanding)

    return NextResponse.json(
      {
        agingBuckets,
        invoices: invoiceList,
        builderSummary,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('AR API error:', error)
    return NextResponse.json({ error: 'Failed to fetch AR data' }, { status: 500 })
  }
}
