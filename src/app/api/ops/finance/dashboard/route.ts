export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get all invoices
    const invoices = await prisma.$queryRawUnsafe<Array<{ id: string; builderId: string; total: number; amountPaid: number; status: string; dueDate: Date | null; issuedAt: Date | null; createdAt: Date }>>(
      `SELECT id, "builderId", total, "amountPaid", status, "dueDate", "issuedAt", "createdAt" FROM "Invoice"`
    )

    // Get all purchase orders
    const purchaseOrders = await prisma.$queryRawUnsafe<Array<{ vendorId: string; status: string; total: number }>>(
      `SELECT "vendorId", status, "total" FROM "PurchaseOrder"`
    )

    // Get vendors
    const vendors = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; active: boolean }>>(
      `SELECT id, name, active FROM "Vendor"`
    )
    const vendorMap: Record<string, any> = {}
    vendors.forEach((v) => {
      vendorMap[v.id] = v
    })

    // Get all orders for revenue
    const orders = await prisma.$queryRawUnsafe<Array<{ builderId: string; total: number; createdAt: Date }>>(
      `SELECT "builderId", total, "createdAt" FROM "Order"`
    )

    // ── Also pull BPW and Hyphen revenue data for full picture ──
    // BPW invoices represent actual Pulte billed revenue
    let bpwRevenue: Array<{ builderName: string; total: number; invoiceDate: Date }> = []
    try {
      bpwRevenue = await prisma.$queryRawUnsafe(
        `SELECT 'Pulte' as "builderName", COALESCE("amount", 0)::float as total, "invoiceDate" as "invoiceDate"
         FROM "BpwInvoice" WHERE "amount" IS NOT NULL AND "amount" != 0`
      )
    } catch { /* BpwInvoice table may not exist yet */ }

    // Hyphen payments represent Toll/Brookfield/Shaddock actual payments received
    let hyphenRevenue: Array<{ builderName: string; total: number; paymentDate: Date }> = []
    try {
      hyphenRevenue = await prisma.$queryRawUnsafe(
        `SELECT "builderName", ABS("amount")::float as total, "paymentDate" as "paymentDate"
         FROM "HyphenPayment" WHERE "amount" IS NOT NULL AND "amount" != 0`
      )
    } catch { /* HyphenPayment table may not exist yet */ }

    // Get builders
    const builders = await prisma.$queryRawUnsafe<Array<{ id: string; companyName: string }>>(
      `SELECT id, "companyName" FROM "Builder"`
    )
    const builderMap: Record<string, string> = {}
    builders.forEach((b) => {
      builderMap[b.id] = b.companyName
    })

    // Calculate AR aging
    const now = new Date()
    const arAging = {
      current: { count: 0, amount: 0 },
      days1to30: { count: 0, amount: 0 },
      days31to60: { count: 0, amount: 0 },
      days60plus: { count: 0, amount: 0 },
    }

    invoices.forEach((inv) => {
      if (inv.status === 'PAID' || inv.status === 'VOID') return

      const balance = inv.total - inv.amountPaid
      if (balance <= 0) return

      const issueDate = inv.issuedAt || inv.createdAt
      const daysOutstanding = Math.floor((now.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24))

      if (daysOutstanding > 60) {
        arAging.days60plus.count++
        arAging.days60plus.amount += balance
      } else if (daysOutstanding > 30) {
        arAging.days31to60.count++
        arAging.days31to60.amount += balance
      } else if (daysOutstanding > 0) {
        arAging.days1to30.count++
        arAging.days1to30.amount += balance
      } else {
        arAging.current.count++
        arAging.current.amount += balance
      }
    })

    // Calculate AP (open POs)
    const openPOs = purchaseOrders.filter(
      (po) => po.status !== 'CANCELLED' && po.status !== 'RECEIVED'
    )
    const totalAP = openPOs.reduce((sum, po) => sum + Number(po.total), 0)

    // Group AP by vendor
    const apByVendor: Record<string, any> = {}
    openPOs.forEach((po) => {
      if (!apByVendor[po.vendorId]) {
        apByVendor[po.vendorId] = {
          vendorId: po.vendorId,
          vendorName: vendorMap[po.vendorId]?.name || 'Unknown',
          totalPOs: 0,
          total: 0,
          status: vendorMap[po.vendorId]?.active ? 'active' : 'inactive',
        }
      }
      apByVendor[po.vendorId].totalPOs++
      apByVendor[po.vendorId].total += Number(po.total)
    })

    // Calculate revenue this month/quarter/year
    // Combines: InFlow orders + BPW invoices (Pulte) + Hyphen payments (Toll/Brookfield/Shaddock)
    const currentDate = new Date()
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    const quarterStart = new Date(currentDate.getFullYear(), Math.floor(currentDate.getMonth() / 3) * 3, 1)
    const yearStart = new Date(currentDate.getFullYear(), 0, 1)

    // Helper to aggregate all revenue sources by date range
    const allRevItems: Array<{ date: Date; amount: number; builderName: string; builderId?: string }> = []

    // Add Order table revenue
    orders.forEach((o) => {
      if (o.total > 0) allRevItems.push({ date: o.createdAt, amount: Number(o.total), builderName: builderMap[o.builderId] || 'Unknown', builderId: o.builderId })
    })

    // Add BPW invoice revenue (Pulte) — use absolute values since invoices represent billed amounts
    const pulteBuilder = builders.find(b => b.companyName.toLowerCase().includes('pulte'))
    bpwRevenue.forEach((bpw) => {
      if (bpw.invoiceDate && bpw.total !== 0) {
        allRevItems.push({ date: new Date(bpw.invoiceDate), amount: Math.abs(Number(bpw.total)), builderName: 'Pulte', builderId: pulteBuilder?.id })
      }
    })

    // Add Hyphen payment revenue (Toll/Brookfield/Shaddock) — use absolute values since payments are shown as negatives
    hyphenRevenue.forEach((hp) => {
      if (hp.paymentDate && hp.total !== 0) {
        const matchBuilder = builders.find(b => b.companyName.toLowerCase().includes(hp.builderName.toLowerCase().split(' ')[0]))
        allRevItems.push({ date: new Date(hp.paymentDate), amount: Math.abs(Number(hp.total)), builderName: hp.builderName, builderId: matchBuilder?.id })
      }
    })

    const revenueThisMonth = allRevItems
      .filter((r) => r.date >= monthStart)
      .reduce((sum, r) => sum + r.amount, 0)

    const revenueThisQuarter = allRevItems
      .filter((r) => r.date >= quarterStart)
      .reduce((sum, r) => sum + r.amount, 0)

    const revenueThisYear = allRevItems
      .filter((r) => r.date >= yearStart)
      .reduce((sum, r) => sum + r.amount, 0)

    // Top builders by revenue — aggregate across ALL sources
    const builderRevenue: Record<string, any> = {}

    allRevItems.forEach((item) => {
      const key = item.builderId || item.builderName
      if (!builderRevenue[key]) {
        builderRevenue[key] = {
          builderId: item.builderId || key,
          builderName: item.builderName,
          totalBilled: 0,
          totalPaid: 0,
          balance: 0,
        }
      }
      builderRevenue[key].totalBilled += item.amount
    })

    // Get invoices for this builder to calculate balance
    invoices.forEach((inv) => {
      if (builderRevenue[inv.builderId]) {
        const balance = inv.total - inv.amountPaid
        builderRevenue[inv.builderId].balance += balance
        builderRevenue[inv.builderId].totalPaid += inv.amountPaid
      }
    })

    const topBuilders = Object.values(builderRevenue)
      .sort((a: any, b: any) => b.totalBilled - a.totalBilled)
      .slice(0, 10)

    // Monthly revenue (last 6 months) — using combined sources
    const monthlyRevenue = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1)
      const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - i + 1, 1)
      const monthRevenue = allRevItems
        .filter((r) => r.date >= date && r.date < nextMonth)
        .reduce((sum, r) => sum + r.amount, 0)
      monthlyRevenue.push({
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        amount: monthRevenue,
      })
    }

    // Calculate alerts
    const alerts = []

    // Overdue invoices
    const overdueInvoices = invoices.filter((inv) => {
      if (inv.status !== 'OVERDUE' && inv.status !== 'PAID') {
        const dueDate = inv.dueDate || new Date(inv.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000)
        return dueDate < now
      }
      return false
    })

    if (overdueInvoices.length > 0) {
      const overdueAmount = overdueInvoices.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0)
      alerts.push({
        type: 'overdue',
        message: `${overdueInvoices.length} overdue invoices`,
        value: overdueAmount,
        count: overdueInvoices.length,
      })
    }

    // Unpaid invoices over threshold
    const unpaidInvoices = invoices.filter(
      (inv) => (inv.total - inv.amountPaid) > 5000 && inv.status !== 'PAID'
    )
    if (unpaidInvoices.length > 0) {
      const unpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0)
      alerts.push({
        type: 'unpaid',
        message: `${unpaidInvoices.length} large unpaid invoices (>$5K)`,
        value: unpaidAmount,
        count: unpaidInvoices.length,
      })
    }

    // POs needing approval
    const posPendingApproval = purchaseOrders.filter((po) => po.status === 'PENDING_APPROVAL')
    if (posPendingApproval.length > 0) {
      const pendingAmount = posPendingApproval.reduce((sum, po) => sum + Number(po.total), 0)
      alerts.push({
        type: 'approval',
        message: `${posPendingApproval.length} POs awaiting approval`,
        value: pendingAmount,
        count: posPendingApproval.length,
      })
    }

    const totalAR = arAging.current.amount + arAging.days1to30.amount + arAging.days31to60.amount + arAging.days60plus.amount

    return NextResponse.json(
      {
        cashPosition: {
          totalAR,
          totalAP,
          netCashPosition: totalAR - totalAP,
          revenueThisMonth,
          revenueThisQuarter,
          revenueThisYear,
        },
        arAging,
        apSummary: Object.values(apByVendor).sort((a: any, b: any) => b.total - a.total),
        monthlyRevenue,
        topBuilders,
        alerts,
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}
