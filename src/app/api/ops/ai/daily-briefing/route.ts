export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/ai/daily-briefing — AI-powered role-specific daily briefing
// Returns structured data for the AI assistant to summarize
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffRole = request.headers.get('x-staff-role') || 'VIEWER'
    const staffId = request.headers.get('x-staff-id')
    const roles = staffRole.split(',').map(r => r.trim())

    const briefing: any = {
      generatedAt: new Date().toISOString(),
      role: staffRole,
      sections: [],
    }

    // ── SECTION: Orders Overview (PM, Sales, Manager, Admin) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'WAREHOUSE_LEAD'].includes(r))) {
      const orderStats = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int as "totalActive",
          COUNT(*) FILTER (WHERE status = 'RECEIVED'::"OrderStatus")::int as "newOrders",
          COUNT(*) FILTER (WHERE status = 'IN_PRODUCTION'::"OrderStatus")::int as "inProduction",
          COUNT(*) FILTER (WHERE status = 'READY_TO_SHIP'::"OrderStatus")::int as "readyToShip",
          COUNT(*) FILTER (WHERE status = 'SHIPPED'::"OrderStatus")::int as "shipped",
          COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '24 hours')::int as "last24h"
        FROM "Order"
        WHERE status NOT IN ('COMPLETE'::"OrderStatus", 'CANCELLED'::"OrderStatus")
      `) as any[]

      const recentOrders = await prisma.$queryRawUnsafe(`
        SELECT o."orderNumber", o.status, o.total, o."createdAt",
               b."companyName"
        FROM "Order" o
        LEFT JOIN "Builder" b ON o."builderId" = b.id
        WHERE o."createdAt" > NOW() - INTERVAL '48 hours'
        ORDER BY o."createdAt" DESC
        LIMIT 5
      `) as any[]

      briefing.sections.push({
        title: 'Orders Overview',
        icon: '📦',
        priority: 'high',
        stats: orderStats[0],
        highlights: recentOrders.map((o: any) => ({
          text: `${o.orderNumber} — ${o.companyName} — $${Number(o.total || 0).toLocaleString()} — ${o.status}`,
        })),
      })
    }

    // ── SECTION: Quotes Pipeline (Sales, PM, Estimator) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'].includes(r))) {
      const quoteStats = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'DRAFT'::"QuoteStatus")::int as "drafts",
          COUNT(*) FILTER (WHERE status = 'SENT'::"QuoteStatus")::int as "sent",
          COUNT(*) FILTER (WHERE status = 'APPROVED'::"QuoteStatus")::int as "approved",
          COALESCE(SUM(total) FILTER (WHERE status = 'SENT'::"QuoteStatus"), 0) as "sentValue",
          COUNT(*) FILTER (WHERE status = 'SENT'::"QuoteStatus" AND "validUntil" < NOW() + INTERVAL '3 days')::int as "expiringSoon"
        FROM "Quote"
      `) as any[]

      briefing.sections.push({
        title: 'Quotes Pipeline',
        icon: '📋',
        priority: quoteStats[0]?.expiringSoon > 0 ? 'high' : 'normal',
        stats: {
          ...quoteStats[0],
          sentValue: Number(quoteStats[0]?.sentValue || 0),
        },
        alerts: quoteStats[0]?.expiringSoon > 0
          ? [{ type: 'warning', text: `${quoteStats[0].expiringSoon} quotes expiring in the next 3 days — follow up needed` }]
          : [],
      })
    }

    // ── SECTION: Financials (PM, Accounting, Manager, Admin) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ACCOUNTING', 'SALES_REP'].includes(r))) {
      const finStats = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(SUM("total" - COALESCE("amountPaid",0)), 0) as "totalAR",
          COUNT(*) FILTER (WHERE status = 'OVERDUE'::"InvoiceStatus")::int as "overdueCount",
          COALESCE(SUM("total" - COALESCE("amountPaid",0)) FILTER (WHERE status = 'OVERDUE'::"InvoiceStatus"), 0) as "overdueAmount",
          COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '7 days')::int as "newInvoices"
        FROM "Invoice"
        WHERE status NOT IN ('VOID'::"InvoiceStatus", 'WRITE_OFF'::"InvoiceStatus", 'PAID'::"InvoiceStatus")
          AND ("total" - COALESCE("amountPaid",0)) > 0
      `) as any[]

      briefing.sections.push({
        title: 'Accounts Receivable',
        icon: '💰',
        priority: finStats[0]?.overdueCount > 0 ? 'high' : 'normal',
        stats: {
          totalAR: Number(finStats[0]?.totalAR || 0),
          overdueCount: finStats[0]?.overdueCount || 0,
          overdueAmount: Number(finStats[0]?.overdueAmount || 0),
          newInvoices: finStats[0]?.newInvoices || 0,
        },
        alerts: finStats[0]?.overdueCount > 0
          ? [{ type: 'urgent', text: `${finStats[0].overdueCount} overdue invoices totaling $${Number(finStats[0].overdueAmount || 0).toLocaleString()}` }]
          : [],
      })
    }

    // ── SECTION: Inventory Alerts (Purchasing, Warehouse, PM) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'].includes(r))) {
      try {
        const invStats = await prisma.$queryRawUnsafe(`
          SELECT
            COUNT(*)::int as "totalItems",
            COUNT(*) FILTER (WHERE "onHand" = 0)::int as "outOfStock",
            COUNT(*) FILTER (WHERE "onHand" <= "reorderPoint" AND "onHand" > 0)::int as "lowStock",
            COUNT(*) FILTER (WHERE "onHand" <= "safetyStock" AND "onHand" > 0)::int as "critical"
          FROM "InventoryItem"
        `) as any[]

        const criticalItems = await prisma.$queryRawUnsafe(`
          SELECT "productName", "sku", "onHand", "reorderPoint", "daysOfSupply"
          FROM "InventoryItem"
          WHERE "onHand" <= "reorderPoint"
          ORDER BY "daysOfSupply" ASC
          LIMIT 5
        `) as any[]

        briefing.sections.push({
          title: 'Inventory Alerts',
          icon: '📊',
          priority: (invStats[0]?.outOfStock > 0 || invStats[0]?.critical > 0) ? 'urgent' : invStats[0]?.lowStock > 0 ? 'high' : 'normal',
          stats: invStats[0],
          items: criticalItems.map((item: any) => ({
            name: item.productName,
            sku: item.sku,
            onHand: item.onHand,
            reorderPoint: item.reorderPoint,
            daysOfSupply: Number(item.daysOfSupply || 0),
          })),
          alerts: [
            ...(invStats[0]?.outOfStock > 0 ? [{ type: 'urgent', text: `${invStats[0].outOfStock} items OUT OF STOCK` }] : []),
            ...(invStats[0]?.critical > 0 ? [{ type: 'warning', text: `${invStats[0].critical} items at CRITICAL stock levels` }] : []),
            ...(invStats[0]?.lowStock > 0 ? [{ type: 'info', text: `${invStats[0].lowStock} items below reorder point` }] : []),
          ],
        })
      } catch {
        // InventoryItem table may not exist yet
      }
    }

    // ── SECTION: Purchase Orders (Purchasing, Manager) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PURCHASING', 'PROJECT_MANAGER'].includes(r))) {
      try {
        const poStats = await prisma.$queryRawUnsafe(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'DRAFT')::int as "drafts",
            COUNT(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int as "pendingApproval",
            COUNT(*) FILTER (WHERE status IN ('SENT', 'IN_TRANSIT'))::int as "open",
            COUNT(*) FILTER (WHERE "expectedDate" < NOW() AND status IN ('SENT', 'IN_TRANSIT'))::int as "overdue",
            COALESCE(SUM("totalCost") FILTER (WHERE status IN ('SENT', 'IN_TRANSIT', 'APPROVED')), 0) as "openValue"
          FROM "PurchaseOrder"
        `) as any[]

        briefing.sections.push({
          title: 'Purchase Orders',
          icon: '🛒',
          priority: poStats[0]?.overdue > 0 ? 'high' : poStats[0]?.pendingApproval > 0 ? 'normal' : 'low',
          stats: {
            ...poStats[0],
            openValue: Number(poStats[0]?.openValue || 0),
          },
          alerts: [
            ...(poStats[0]?.overdue > 0 ? [{ type: 'warning', text: `${poStats[0].overdue} POs past expected delivery date` }] : []),
            ...(poStats[0]?.pendingApproval > 0 ? [{ type: 'info', text: `${poStats[0].pendingApproval} POs awaiting approval` }] : []),
          ],
        })
      } catch {
        // PO tables may not exist yet
      }
    }

    // ── SECTION: Delivery Schedule (PM, Driver, Warehouse) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'].includes(r))) {
      const upcomingOrders = await prisma.$queryRawUnsafe(`
        SELECT o."orderNumber", o."deliveryDate", o.status,
               b."companyName"
        FROM "Order" o
        LEFT JOIN "Builder" b ON o."builderId" = b.id
        WHERE o."deliveryDate" IS NOT NULL
          AND o."deliveryDate" >= NOW()
          AND o."deliveryDate" <= NOW() + INTERVAL '7 days'
          AND o.status NOT IN ('COMPLETE'::"OrderStatus", 'CANCELLED'::"OrderStatus", 'DELIVERED'::"OrderStatus")
        ORDER BY o."deliveryDate" ASC
        LIMIT 10
      `) as any[]

      if (upcomingOrders.length > 0) {
        briefing.sections.push({
          title: 'Upcoming Deliveries (7 Days)',
          icon: '🚚',
          priority: 'normal',
          items: upcomingOrders.map((o: any) => ({
            orderNumber: o.orderNumber,
            builder: o.companyName,
            deliveryDate: o.deliveryDate,
            status: o.status,
          })),
        })
      }
    }

    // ── SECTION: Supplier Scorecards (Purchasing) ──
    if (roles.some(r => ['ADMIN', 'MANAGER', 'PURCHASING'].includes(r))) {
      try {
        const supplierCount = await prisma.$queryRawUnsafe(`
          SELECT COUNT(*)::int as count FROM "Supplier" WHERE status = 'ACTIVE'
        `) as any[]

        if (supplierCount[0]?.count > 0) {
          briefing.sections.push({
            title: 'Supplier Overview',
            icon: '🏭',
            priority: 'low',
            stats: { activeSuppliers: supplierCount[0].count },
          })
        }
      } catch {
        // Supplier table may not exist
      }
    }

    // ── SECTION: Action Items ──
    // Generate recommended actions based on the data
    const actionItems: any[] = []

    for (const section of briefing.sections) {
      if (section.alerts) {
        for (const alert of section.alerts) {
          if (alert.type === 'urgent') {
            actionItems.push({ priority: 'URGENT', text: alert.text, source: section.title })
          } else if (alert.type === 'warning') {
            actionItems.push({ priority: 'HIGH', text: alert.text, source: section.title })
          }
        }
      }
    }

    briefing.actionItems = actionItems
    briefing.summary = {
      urgentCount: actionItems.filter(a => a.priority === 'URGENT').length,
      highCount: actionItems.filter(a => a.priority === 'HIGH').length,
      totalSections: briefing.sections.length,
    }

    return NextResponse.json(briefing)
  } catch (error) {
    console.error('Daily briefing error:', error)
    return NextResponse.json({ error: 'Failed to generate daily briefing', details: String(error) }, { status: 500 })
  }
}
