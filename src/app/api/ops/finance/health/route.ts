export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { parseRoles, type StaffRole } from '@/lib/permissions'

const SENSITIVE_FINANCE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffRolesStr = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles = parseRoles(staffRolesStr) as StaffRole[]
  const canSeeSensitiveFinance = userRoles.some(r => SENSITIVE_FINANCE_ROLES.includes(r))

  try {
    const orders = await prisma.$queryRawUnsafe<Array<{ builderId: string; total: number; createdAt: Date }>>(
      `SELECT "builderId", total, "createdAt" FROM "Order"`
    )

    const invoices = await prisma.$queryRawUnsafe<Array<{ builderId: string; total: number; amountPaid: number; status: string; dueDate: Date | null; issuedAt: Date | null; createdAt: Date }>>(
      `SELECT "builderId", total, "amountPaid", status, "dueDate", "issuedAt", "createdAt" FROM "Invoice"`
    )

    const purchaseOrders = await prisma.$queryRawUnsafe<Array<{ total: number; status: string; expectedDate: Date | null }>>(
      `SELECT "total", status, "expectedDate" FROM "PurchaseOrder"`
    )

    const products = await prisma.$queryRawUnsafe<Array<{ cost: number; basePrice: number }>>(
      `SELECT cost, "basePrice" FROM "Product"`
    )

    const builders = await prisma.$queryRawUnsafe<Array<{ id: string; companyName: string; creditLimit: number | null }>>(
      `SELECT id, "companyName", "creditLimit" FROM "Builder"`
    )
    const builderMap: Record<string, any> = {}
    builders.forEach((b) => {
      builderMap[b.id] = b
    })

    const jobs = await prisma.$queryRawUnsafe<Array<{ scopeType: string; orderId: string }>>(
      `SELECT "scopeType", "orderId" FROM "Job"`
    )

    const now = new Date()

    // Calculate gross margin from ACTUAL order line items vs product cost
    let marginData: any[] = []
    try {
      marginData = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(SUM(oi."lineTotal"), 0)::float as "totalRevenue",
          COALESCE(SUM(oi.quantity * COALESCE(bom_cost(p.id), p.cost)), 0)::float as "totalCost"
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productId" = p.sku
        JOIN "Order" o ON oi."orderId" = o.id
      `)
    } catch { marginData = [{ totalRevenue: 0, totalCost: 0 }] }
    const totalProductRevenue = Number(marginData[0]?.totalRevenue || 0)
    const totalProductCost = Number(marginData[0]?.totalCost || 0)
    const grossMarginPercent = totalProductRevenue > 0 ? (totalProductRevenue - totalProductCost) / totalProductRevenue : 0

    // Revenue per job — aggregate from ALL sources (Orders + BPW + Hyphen)
    let totalRevenue = orders.reduce((sum, o) => sum + Number(o.total), 0)

    // Add BPW invoice revenue (Pulte)
    try {
      const bpwRev: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(ABS("amount")), 0)::float as total FROM "BpwInvoice" WHERE "amount" IS NOT NULL`
      )
      totalRevenue += Number(bpwRev[0]?.total || 0)
    } catch { /* BpwInvoice table may not exist yet */ }

    // Add Hyphen payment revenue (Toll/Brookfield/Shaddock)
    try {
      const hypRev: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(ABS("amount")), 0)::float as total FROM "HyphenPayment" WHERE "amount" IS NOT NULL`
      )
      totalRevenue += Number(hypRev[0]?.total || 0)
    } catch { /* HyphenPayment table may not exist yet */ }

    const totalJobs = orders.length || 1
    const revenuePerJob = totalRevenue / totalJobs

    // AR Collection rate
    const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.total), 0)
    const totalCollected = invoices.reduce((sum, i) => sum + Number(i.amountPaid), 0)
    const arCollectionRate = totalInvoiced > 0 ? totalCollected / totalInvoiced : 0

    // DSO (Days Sales Outstanding)
    const totalOutstanding = invoices.reduce((sum, i) => sum + (Number(i.total) - Number(i.amountPaid)), 0)
    const dailyRevenue = totalCollected > 0 ? totalCollected / 365 : 1
    const dso = dailyRevenue > 0 ? totalOutstanding / dailyRevenue : 0

    // Vendor payment timeliness — calculate from actual PO data
    const totalPOs = purchaseOrders.length
    const paidOnTimePOs = purchaseOrders.filter(po => po.status === 'RECEIVED').length
    const vendorPaymentTimeliness = totalPOs > 0 ? paidOnTimePOs / totalPOs : 1.0

    // Cash flow projection
    const upcomingInvoices = invoices.filter((i) => {
      const dueDate = i.dueDate || new Date(i.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      return dueDate > now && i.status !== 'PAID'
    })

    const next30Days = {
      expectedInflows: upcomingInvoices
        .filter((i) => {
          const dueDate = i.dueDate || new Date(i.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          return dueDate <= new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        })
        .reduce((sum, i) => sum + (Number(i.total) - Number(i.amountPaid)), 0),
      expectedOutflows: purchaseOrders
        .filter((po) => {
          const expectedDate = po.expectedDate || new Date()
          return expectedDate <= new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) && po.status !== 'RECEIVED'
        })
        .reduce((sum, po) => sum + Number(po.total), 0),
    }

    const next60Days = {
      expectedInflows: upcomingInvoices
        .filter((i) => {
          const dueDate = i.dueDate || new Date(i.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          return dueDate <= new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
        })
        .reduce((sum, i) => sum + (Number(i.total) - Number(i.amountPaid)), 0),
      expectedOutflows: purchaseOrders
        .filter((po) => {
          const expectedDate = po.expectedDate || new Date()
          return expectedDate <= new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000) && po.status !== 'RECEIVED'
        })
        .reduce((sum, po) => sum + Number(po.total), 0),
    }

    const next90Days = {
      expectedInflows: upcomingInvoices
        .filter((i) => {
          const dueDate = i.dueDate || new Date(i.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
          return dueDate <= new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
        })
        .reduce((sum, i) => sum + (Number(i.total) - Number(i.amountPaid)), 0),
      expectedOutflows: purchaseOrders
        .filter((po) => {
          const expectedDate = po.expectedDate || new Date()
          return expectedDate <= new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000) && po.status !== 'RECEIVED'
        })
        .reduce((sum, po) => sum + Number(po.total), 0),
    }

    next30Days.expectedInflows = next30Days.expectedInflows || next60Days.expectedInflows / 2
    next30Days.expectedOutflows = next30Days.expectedOutflows || next60Days.expectedOutflows / 2

    // Builder health - deduplicate by builderId
    const builderHealthMap: Record<string, any> = {}
    orders.forEach((order) => {
      if (builderHealthMap[order.builderId]) return

      const builderInvoices = invoices.filter((i) => i.builderId === order.builderId)
      const totalBilled = builderInvoices.reduce((sum, i) => sum + Number(i.total), 0)
      const totalPaid = builderInvoices.reduce((sum, i) => sum + Number(i.amountPaid), 0)
      const balance = totalBilled - totalPaid

      const builderInfo = builderMap[order.builderId]
      const creditLimit = builderInfo?.creditLimit || 50000
      const utilization = (balance / creditLimit) * 100
      const paymentHistoryScore = (totalPaid / Math.max(totalBilled, 1)) * 100

      let riskFlag = null
      if (utilization > 80) riskFlag = 'High Balance'
      if (paymentHistoryScore < 70) riskFlag = 'Slow Pay'
      if (utilization > 80 && paymentHistoryScore < 70) riskFlag = 'Critical'

      builderHealthMap[order.builderId] = {
        builderId: order.builderId,
        builderName: builderInfo?.companyName || 'Unknown',
        creditLimit,
        currentBalance: balance,
        utilizationPercent: utilization,
        paymentHistoryScore,
        riskFlag,
      }
    })

    const builderHealth = Object.values(builderHealthMap)
      .sort((a: any, b: any) => b.utilizationPercent - a.utilizationPercent)

    // Revenue by scope type
    const jobsByScope: Record<string, any> = {}
    const orderMap: Record<string, number> = {}
    orders.forEach((o) => {
      orderMap[o.builderId] = Number(o.total)
    })

    jobs.forEach((job) => {
      if (!jobsByScope[job.scopeType]) {
        jobsByScope[job.scopeType] = {
          scopeType: job.scopeType,
          amount: 0,
          jobCount: 0,
        }
      }
      jobsByScope[job.scopeType].amount += orderMap[job.orderId] || 0
      jobsByScope[job.scopeType].jobCount++
    })

    const totalScopeAmount = Object.values(jobsByScope).reduce((sum: any, s: any) => sum + s.amount, 0)
    const revenueByScope = Object.values(jobsByScope)
      .map((s: any) => ({
        ...s,
        percent: totalScopeAmount > 0 ? (s.amount / totalScopeAmount) * 100 : 0,
      }))
      .sort((a: any, b: any) => b.amount - a.amount)

    return NextResponse.json(
      {
        keyMetrics: {
          // Margin hidden from non-finance roles
          grossMarginPercent: canSeeSensitiveFinance ? grossMarginPercent : undefined,
          revenuePerJob,
          arCollectionRate: canSeeSensitiveFinance ? arCollectionRate : undefined,
          dso: canSeeSensitiveFinance ? dso : undefined,
          vendorPaymentTimeliness,
        },
        // Cash flow projections restricted to finance roles
        cashFlowProjection: canSeeSensitiveFinance ? {
          next30Days: {
            expectedInflows: next30Days.expectedInflows,
            expectedOutflows: next30Days.expectedOutflows,
            netProjection: next30Days.expectedInflows - next30Days.expectedOutflows,
          },
          next60Days: {
            expectedInflows: next60Days.expectedInflows,
            expectedOutflows: next60Days.expectedOutflows,
            netProjection: next60Days.expectedInflows - next60Days.expectedOutflows,
          },
          next90Days: {
            expectedInflows: next90Days.expectedInflows,
            expectedOutflows: next90Days.expectedOutflows,
            netProjection: next90Days.expectedInflows - next90Days.expectedOutflows,
          },
        } : { restricted: true },
        // Builder credit health — restrict credit limits to finance roles
        builderHealth: canSeeSensitiveFinance ? builderHealth : builderHealth.map((b: any) => ({
          builderId: b.builderId,
          builderName: b.builderName,
          riskFlag: b.riskFlag,
          // Hide exact balance and credit limit from non-finance roles
        })),
        revenueByScope,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Health API error:', error)
    return NextResponse.json({ error: 'Failed to fetch health data' }, { status: 500 })
  }
}
