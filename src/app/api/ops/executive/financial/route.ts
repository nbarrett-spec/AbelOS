export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { parseRoles, type StaffRole } from '@/lib/permissions'

// Roles that can see sensitive financial details (margin, COGS, detailed AR)
const SENSITIVE_FINANCE_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTING']

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Determine if user can see sensitive financials
  const staffRolesStr = request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || ''
  const userRoles = parseRoles(staffRolesStr) as StaffRole[]
  const canSeeSensitiveFinance = userRoles.some(r => SENSITIVE_FINANCE_ROLES.includes(r))

  try {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekAgo = new Date(today)
    weekAgo.setDate(today.getDate() - 7)

    // AR Aging - get invoices with balance info
    const allInvoices = await prisma.$queryRawUnsafe<Array<{ id: string; invoiceNumber: string; status: string; dueDate: Date | null; total: number; amountPaid: number; balanceDue: number; issuedAt: Date | null; createdAt: Date }>>(
      `SELECT id, "invoiceNumber", status, "dueDate", total, "amountPaid", (total - "amountPaid") as "balanceDue", "issuedAt", "createdAt" FROM "Invoice"`
    )

    const overdueInvoices = allInvoices.filter(
      (inv) =>
        inv.status === 'OVERDUE' ||
        (inv.dueDate && inv.dueDate < today && inv.balanceDue > 0)
    )

    const currentAging = overdueInvoices.filter(
      (inv) => !inv.dueDate || inv.dueDate >= today
    )
    const aging30 = overdueInvoices.filter(
      (inv) =>
        inv.dueDate &&
        inv.dueDate < today &&
        inv.dueDate >= new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    )
    const aging60 = overdueInvoices.filter(
      (inv) =>
        inv.dueDate &&
        inv.dueDate < new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000) &&
        inv.dueDate >= new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)
    )
    const aging90 = overdueInvoices.filter(
      (inv) =>
        inv.dueDate &&
        inv.dueDate < new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)
    )

    // Collections this week vs outstanding
    const thisWeekPayments = await prisma.$queryRawUnsafe<Array<{ amount: number }>>(
      `SELECT amount FROM "Payment" WHERE "receivedAt" >= $1 AND "receivedAt" <= $2`,
      weekAgo, now
    )

    const thisWeekCollections = thisWeekPayments.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0
    )

    // Invoice status pipeline
    const invoiceByStatus = await prisma.$queryRawUnsafe<Array<{ status: string; count: bigint; total_sum: number }>>(
      `SELECT status, COUNT(*)::int as count, COALESCE(SUM(total), 0)::float as total_sum FROM "Invoice" GROUP BY status`
    )

    // Margin analysis — calculate actual margin from COGS
    const orders = await prisma.$queryRawUnsafe<Array<{ id: string; total: number }>>(
      `SELECT id, total FROM "Order" WHERE status != 'CANCELLED'::"OrderStatus"`
    )

    const cogsResult = await prisma.$queryRawUnsafe<Array<{ totalCOGS: number }>>(
      `SELECT ROUND(COALESCE(SUM(oi.quantity * COALESCE(bom_cost(p.id), p.cost)), 0)::numeric, 2) as "totalCOGS"
       FROM "OrderItem" oi
       JOIN "Product" p ON oi."productId" = p.id
       JOIN "Order" o ON oi."orderId" = o.id
       WHERE o.status != 'CANCELLED'::"OrderStatus"`
    )
    const totalCOGS = Number(cogsResult[0]?.totalCOGS || 0)
    const totalOrderValue = orders.reduce((sum, order) => sum + Number(order.total), 0)
    const calculatedAvgMargin = totalOrderValue > 0
      ? (totalOrderValue - totalCOGS) / totalOrderValue
      : 0

    // PO spending by vendor
    const poByVendor = await prisma.$queryRawUnsafe<Array<{ vendorId: string; total_sum: number; count: bigint }>>(
      `SELECT "vendorId", COALESCE(SUM("total"), 0)::float as total_sum, COUNT(*)::int as count FROM "PurchaseOrder" GROUP BY "vendorId"`
    )

    // Get vendor names
    const vendors = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `SELECT id, name FROM "Vendor"`
    )
    const vendorMap: Record<string, string> = {}
    vendors.forEach((v) => {
      vendorMap[v.id] = v.name
    })

    const poVendorDetails = poByVendor.map((po) => ({
      vendorId: po.vendorId,
      vendorName: vendorMap[po.vendorId] || 'Unknown',
      totalSpent: Number(po.total_sum) || 0,
      orderCount: Number(po.count),
    }))

    // Payment terms distribution
    const builderTerms = await prisma.$queryRawUnsafe<Array<{ paymentTerm: string | null; count: bigint }>>(
      `SELECT "paymentTerm", COUNT(*)::int as count FROM "Builder" GROUP BY "paymentTerm"`
    )

    // Summary aggregates
    const totalAR = allInvoices.reduce((sum, inv) => sum + inv.balanceDue, 0)
    const totalPOResult = await prisma.$queryRawUnsafe<Array<{ total_sum: number }>>(
      `SELECT COALESCE(SUM("total"), 0)::float as total_sum FROM "PurchaseOrder"`
    )
    const totalPOValue = Number(totalPOResult[0]?.total_sum || 0)

    return NextResponse.json(
      {
        arAging: {
          current: {
            count: currentAging.length,
            amount: currentAging.reduce((sum, inv) => sum + inv.balanceDue, 0),
          },
          days1to30: {
            count: aging30.length,
            amount: aging30.reduce((sum, inv) => sum + inv.balanceDue, 0),
          },
          days31to60: {
            count: aging60.length,
            amount: aging60.reduce((sum, inv) => sum + inv.balanceDue, 0),
          },
          days60plus: {
            count: aging90.length,
            amount: aging90.reduce((sum, inv) => sum + inv.balanceDue, 0),
          },
          totalAR,
        },
        cashFlow: {
          collectedThisWeek: thisWeekCollections,
          outstandingAmount: totalAR,
          invoicesThisWeek: allInvoices.filter(
            (inv) => inv.issuedAt && inv.issuedAt >= weekAgo
          ).length,
        },
        invoiceStatusPipeline: invoiceByStatus.map((item) => ({
          status: item.status,
          count: Number(item.count),
          totalValue: Number(item.total_sum) || 0,
        })),
        // Margin analysis — restricted to ADMIN, MANAGER, ACCOUNTING
        marginAnalysis: canSeeSensitiveFinance ? {
          totalOrders: orders.length,
          avgMargin: Math.round(calculatedAvgMargin * 10000) / 10000,
          totalOrderValue,
        } : { restricted: true },
        // PO spending by vendor — restricted to ADMIN, MANAGER, ACCOUNTING, PURCHASING
        poSpending: canSeeSensitiveFinance || userRoles.includes('PURCHASING') ? {
          byVendor: poVendorDetails.sort(
            (a, b) => b.totalSpent - a.totalSpent
          ),
          totalPOValue,
        } : { restricted: true },
        paymentTermsMix: builderTerms.map((item) => ({
          term: item.paymentTerm,
          count: Number(item.count),
        })),
      },
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Financial API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch financial data' },
      { status: 500 }
    )
  }
}
