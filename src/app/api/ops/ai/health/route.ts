export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth'

// BigInt serialization helper — Prisma raw COUNT() returns BigInt
function safeJson(data: any): NextResponse {
  const json = JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? Number(value) : value
  )
  return new NextResponse(json, {
    headers: { 'Content-Type': 'application/json' },
  })
}

// Business Health Monitor — AI Operations Brain
// Real-time business health score, KPI anomaly detection,
// department scorecards, and actionable alerts

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url);
    const report = searchParams.get('report') || 'dashboard';

    switch (report) {
      case 'dashboard': return await getDashboard();
      case 'scorecards': return await getDepartmentScorecards();
      case 'anomalies': return await getAnomalies();
      case 'kpi-trends': return await getKPITrends();
      case 'action-items': return await getActionItems();
      default: return NextResponse.json({ error: 'Unknown report' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Health monitor error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getDashboard() {
  // Composite business health score (0-100)
  // Based on: Revenue health, AR health, Inventory health, Operations health, Customer health

  // Revenue health (0-20)
  const revenue: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW()) THEN total ELSE 0 END), 0) as "thisMonth",
      COALESCE(SUM(CASE WHEN "createdAt" >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
        AND "createdAt" < DATE_TRUNC('month', NOW()) THEN total ELSE 0 END), 0) as "lastMonth"
    FROM "Order"
  `);
  const thisMonth = Number(revenue[0]?.thisMonth || 0);
  const lastMonth = Number(revenue[0]?.lastMonth || 0);
  const revenueGrowth = lastMonth > 0 ? (thisMonth - lastMonth) / lastMonth : 0;
  const revenueScore = Math.min(20, Math.max(0, 10 + revenueGrowth * 50));

  // AR health (0-20) — less overdue = better
  const ar: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "paymentStatus" != 'PAID' AND "dueDate" < CURRENT_DATE THEN 1 END)::int as "overdueInvoices",
      COUNT(CASE WHEN "paymentStatus" != 'PAID' THEN 1 END)::int as "totalUnpaid",
      COALESCE(SUM(CASE WHEN "paymentStatus" != 'PAID' AND "dueDate" < CURRENT_DATE THEN total ELSE 0 END), 0) as "overdueAmount",
      COALESCE(SUM(CASE WHEN "paymentStatus" != 'PAID' THEN total ELSE 0 END), 0) as "totalUnpaidAmount"
    FROM "Order"
  `);
  const overdueRatio = Number(ar[0]?.totalUnpaid || 0) > 0
    ? Number(ar[0]?.overdueInvoices || 0) / Number(ar[0]?.totalUnpaid || 1)
    : 0;
  const arScore = Math.min(20, Math.max(0, 20 - overdueRatio * 30));

  // Inventory health (0-20) — stock vs demand alignment
  const inv: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN available <= 0 THEN 1 END)::int as "outOfStock",
      COUNT(CASE WHEN available > 0 AND available <= "reorderPoint" THEN 1 END)::int as "lowStock",
      COUNT(*)::int as "totalTracked"
    FROM "InventoryItem"
  `);
  const stockOutRatio = Number(inv[0]?.totalTracked || 0) > 0
    ? Number(inv[0]?.outOfStock || 0) / Number(inv[0]?.totalTracked || 1)
    : 0;
  const invScore = Math.min(20, Math.max(0, 20 - stockOutRatio * 60 - (Number(inv[0]?.lowStock || 0) / Math.max(Number(inv[0]?.totalTracked || 1), 1)) * 20));

  // Operations health (0-20) — schedule adherence + delivery performance
  const ops: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN status = 'COMPLETED' AND "scheduledDate" >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END)::int as "completedRecent",
      COUNT(CASE WHEN "scheduledDate" >= CURRENT_DATE - INTERVAL '30 days' AND "scheduledDate" < CURRENT_DATE THEN 1 END)::int as "totalRecent",
      COUNT(CASE WHEN status IN ('TENTATIVE', 'FIRM') AND "scheduledDate" < CURRENT_DATE THEN 1 END)::int as "overdue"
    FROM "ScheduleEntry"
  `);
  const completionRate = Number(ops[0]?.totalRecent || 0) > 0
    ? Number(ops[0]?.completedRecent || 0) / Number(ops[0]?.totalRecent || 1)
    : 1;
  const opsScore = Math.min(20, Math.max(0, completionRate * 20));

  // Customer health (0-20) — new builders, active rate, quote conversion
  const cust: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "newBuilders",
      COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int as "activeBuilders",
      COUNT(*)::int as "totalBuilders"
    FROM "Builder"
  `);
  const quoteConv: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN status = 'APPROVED' THEN 1 END)::int as accepted,
      COUNT(CASE WHEN status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED') THEN 1 END)::int as decided
    FROM "Quote"
    WHERE "createdAt" > NOW() - INTERVAL '90 days'
  `);
  const convRate = Number(quoteConv[0]?.decided || 0) > 0
    ? Number(quoteConv[0]?.accepted || 0) / Number(quoteConv[0]?.decided || 1)
    : 0;
  const custScore = Math.min(20, Math.max(0, 5 + Number(cust[0]?.newBuilders || 0) * 2 + convRate * 10));

  const totalScore = Math.round(revenueScore + arScore + invScore + opsScore + custScore);
  const healthGrade = totalScore >= 80 ? 'A' : totalScore >= 65 ? 'B' : totalScore >= 50 ? 'C' : totalScore >= 35 ? 'D' : 'F';

  return safeJson({
    report: 'dashboard',
    generatedAt: new Date().toISOString(),
    healthScore: totalScore,
    healthGrade,
    components: {
      revenue: { score: Math.round(revenueScore * 10) / 10, max: 20, thisMonth, lastMonth, growth: Math.round(revenueGrowth * 10000) / 100 },
      accountsReceivable: { score: Math.round(arScore * 10) / 10, max: 20, ...ar[0] },
      inventory: { score: Math.round(invScore * 10) / 10, max: 20, ...inv[0] },
      operations: { score: Math.round(opsScore * 10) / 10, max: 20, completionRate: Math.round(completionRate * 100), overdue: Number(ops[0]?.overdue || 0) },
      customer: { score: Math.round(custScore * 10) / 10, max: 20, ...cust[0], conversionRate: Math.round(convRate * 100) },
    },
  });
}

async function getDepartmentScorecards() {
  // Sales department
  const sales: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(DISTINCT d.id)::int as "activeDeals",
      ROUND(COALESCE(SUM(CASE WHEN d."stage"::text NOT IN ('WON', 'LOST') THEN d."dealValue" ELSE 0 END), 0)::numeric, 2) as "pipelineValue",
      COUNT(CASE WHEN d."stage"::text = 'WON' AND d."updatedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "wonThisMonth",
      COUNT(CASE WHEN d."stage"::text = 'LOST' AND d."updatedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "lostThisMonth",
      (SELECT COUNT(*)::int FROM "Quote" WHERE "createdAt" > NOW() - INTERVAL '30 days') as "quotesThisMonth",
      (SELECT COUNT(*)::int FROM "Quote" WHERE status = 'SENT' AND "createdAt" > NOW() - INTERVAL '30 days') as "quotesSent"
    FROM "Deal" d
  `);

  // Operations department
  const operations: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN status = 'COMPLETED' AND "scheduledDate" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "jobsCompleted",
      COUNT(CASE WHEN "scheduledDate" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' THEN 1 END)::int as "jobsThisWeek",
      (SELECT COUNT(*)::int FROM "Delivery" WHERE status = 'COMPLETE' AND "completedAt" > NOW() - INTERVAL '30 days') as "deliveriesCompleted",
      (SELECT COUNT(*)::int FROM "Delivery" WHERE status = 'REFUSED') as "deliveriesFailed"
    FROM "ScheduleEntry"
  `);

  // Purchasing department
  const purchasing: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as "activePOs",
      ROUND(COALESCE(SUM(total), 0)::numeric, 2) as "poValue",
      COUNT(CASE WHEN status = 'RECEIVED' AND "receivedAt" > NOW() - INTERVAL '30 days' THEN 1 END)::int as "receivedThisMonth",
      COUNT(CASE WHEN "expectedDate" < CURRENT_DATE AND status IN ('SUBMITTED', 'APPROVED', 'ORDERED') THEN 1 END)::int as "latePOs"
    FROM "PurchaseOrder"
    WHERE status NOT IN ('CANCELLED')
  `);

  // Finance department
  const finance: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(COALESCE(SUM(CASE WHEN "paymentStatus" = 'PAID' AND "paidAt" > NOW() - INTERVAL '30 days' THEN total ELSE 0 END), 0)::numeric, 2) as "collectedThisMonth",
      ROUND(COALESCE(SUM(CASE WHEN "paymentStatus" != 'PAID' AND "dueDate" < CURRENT_DATE THEN total ELSE 0 END), 0)::numeric, 2) as "overdueAR",
      COUNT(CASE WHEN "paymentStatus" != 'PAID' AND "dueDate" < CURRENT_DATE - INTERVAL '90 days' THEN 1 END)::int as "severe90dOverdue"
    FROM "Order"
  `);

  return safeJson({
    report: 'scorecards',
    generatedAt: new Date().toISOString(),
    departments: {
      sales: sales[0] || {},
      operations: operations[0] || {},
      purchasing: purchasing[0] || {},
      finance: finance[0] || {},
    },
  });
}

async function getAnomalies() {
  const anomalies: any[] = [];

  // Revenue anomaly: current month significantly differs from recent trend
  const monthlyRev: any[] = await prisma.$queryRawUnsafe(`
    SELECT DATE_TRUNC('month', "createdAt") as month, SUM(total) as revenue
    FROM "Order" WHERE "createdAt" > NOW() - INTERVAL '6 months'
    GROUP BY DATE_TRUNC('month', "createdAt")
    ORDER BY month ASC
  `);
  if (monthlyRev.length >= 3) {
    const avg = monthlyRev.slice(0, -1).reduce((s, m) => s + Number(m.revenue), 0) / (monthlyRev.length - 1);
    const current = Number(monthlyRev[monthlyRev.length - 1]?.revenue || 0);
    const dayOfMonth = new Date().getDate();
    const projected = current * (30 / Math.max(1, dayOfMonth));
    if (projected < avg * 0.7) {
      anomalies.push({ type: 'REVENUE_LOW', severity: 'WARNING', message: `Revenue trending ${Math.round((1 - projected/avg) * 100)}% below recent average`, value: projected, expected: avg });
    } else if (projected > avg * 1.3) {
      anomalies.push({ type: 'REVENUE_HIGH', severity: 'INFO', message: `Revenue trending ${Math.round((projected/avg - 1) * 100)}% above recent average`, value: projected, expected: avg });
    }
  }

  // Order volume anomaly
  const weeklyOrders: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '7 days' THEN 1 END)::int as "thisWeek",
      ROUND(COUNT(CASE WHEN "createdAt" > NOW() - INTERVAL '28 days' THEN 1 END)::numeric / 4, 1) as "weeklyAvg"
    FROM "Order" WHERE status != 'CANCELLED'
  `);
  const thisWeek = Number(weeklyOrders[0]?.thisWeek || 0);
  const weeklyAvg = Number(weeklyOrders[0]?.weeklyAvg || 0);
  if (weeklyAvg > 0 && thisWeek < weeklyAvg * 0.5) {
    anomalies.push({ type: 'ORDER_VOLUME_LOW', severity: 'WARNING', message: `Order volume down ${Math.round((1 - thisWeek/weeklyAvg) * 100)}% vs 4-week average`, value: thisWeek, expected: weeklyAvg });
  }

  // AR aging spike
  const arSpike: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(CASE WHEN "dueDate" < CURRENT_DATE - INTERVAL '60 days' AND "paymentStatus" != 'PAID' THEN 1 END)::int as "over60",
      ROUND(COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE - INTERVAL '60 days' AND "paymentStatus" != 'PAID' THEN total ELSE 0 END), 0)::numeric, 2) as "over60Amount"
    FROM "Order"
  `);
  if (Number(arSpike[0]?.over60 || 0) > 5) {
    anomalies.push({ type: 'AR_AGING', severity: 'CRITICAL', message: `${arSpike[0].over60} invoices over 60 days overdue totaling $${Number(arSpike[0].over60Amount).toLocaleString()}`, value: arSpike[0].over60Amount });
  }

  // Inventory stockouts
  const stockouts: any[] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int as cnt FROM "InventoryItem" WHERE available <= 0
  `);
  if (Number(stockouts[0]?.cnt || 0) > 3) {
    anomalies.push({ type: 'STOCKOUT', severity: 'WARNING', message: `${stockouts[0].cnt} products out of stock`, value: stockouts[0].cnt });
  }

  // Quote conversion drop
  const recentConv: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      ROUND(COUNT(CASE WHEN status = 'APPROVED' AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 END)::numeric /
        NULLIF(COUNT(CASE WHEN status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED') AND "createdAt" > NOW() - INTERVAL '30 days' THEN 1 END), 0) * 100, 1) as "recent30d",
      ROUND(COUNT(CASE WHEN status = 'APPROVED' AND "createdAt" BETWEEN NOW() - INTERVAL '90 days' AND NOW() - INTERVAL '30 days' THEN 1 END)::numeric /
        NULLIF(COUNT(CASE WHEN status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED') AND "createdAt" BETWEEN NOW() - INTERVAL '90 days' AND NOW() - INTERVAL '30 days' THEN 1 END), 0) * 100, 1) as "prior60d"
    FROM "Quote"
  `);
  const recent = Number(recentConv[0]?.recent30d || 0);
  const prior = Number(recentConv[0]?.prior60d || 0);
  if (prior > 0 && recent < prior * 0.7) {
    anomalies.push({ type: 'CONVERSION_DROP', severity: 'WARNING', message: `Quote conversion dropped from ${prior}% to ${recent}% (30d vs prior 60d)`, value: recent, expected: prior });
  }

  return safeJson({
    report: 'anomalies',
    generatedAt: new Date().toISOString(),
    anomalies,
    summary: {
      critical: anomalies.filter(a => a.severity === 'CRITICAL').length,
      warning: anomalies.filter(a => a.severity === 'WARNING').length,
      info: anomalies.filter(a => a.severity === 'INFO').length,
    },
  });
}

async function getKPITrends() {
  // Monthly KPI tracking
  const kpis: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      months.month,
      COALESCE(orders.revenue, 0) as revenue,
      COALESCE(orders.count, 0) as "orderCount",
      COALESCE(orders."avgValue", 0) as "avgOrderValue",
      COALESCE(builders.new_count, 0) as "newBuilders",
      COALESCE(quotes.count, 0) as "quotesCreated",
      COALESCE(quotes."convRate", 0) as "conversionRate"
    FROM (
      SELECT generate_series(
        DATE_TRUNC('month', NOW() - INTERVAL '11 months'),
        DATE_TRUNC('month', NOW()),
        '1 month'::interval
      ) as month
    ) months
    LEFT JOIN (
      SELECT DATE_TRUNC('month', "createdAt") as month,
        ROUND(SUM(total)::numeric, 2) as revenue,
        COUNT(*) as count,
        ROUND(AVG(total)::numeric, 2) as "avgValue"
      FROM "Order" WHERE "createdAt" > NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
    ) orders ON months.month = orders.month
    LEFT JOIN (
      SELECT DATE_TRUNC('month', "createdAt") as month, COUNT(*) as new_count
      FROM "Builder" WHERE "createdAt" > NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
    ) builders ON months.month = builders.month
    LEFT JOIN (
      SELECT DATE_TRUNC('month', "createdAt") as month,
        COUNT(*) as count,
        ROUND(COUNT(CASE WHEN status = 'APPROVED' THEN 1 END)::numeric /
          NULLIF(COUNT(CASE WHEN status IN ('APPROVED', 'REJECTED', 'EXPIRED', 'ORDERED') THEN 1 END), 0) * 100, 1) as "convRate"
      FROM "Quote" WHERE "createdAt" > NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
    ) quotes ON months.month = quotes.month
    ORDER BY months.month ASC
  `);

  return safeJson({
    report: 'kpi-trends',
    generatedAt: new Date().toISOString(),
    kpis,
  });
}

async function getActionItems() {
  const actions: any[] = [];

  // Overdue payments to chase
  const overduePayments: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      o.id, o."orderNumber", o.total, o."dueDate",
      b."companyName", b.email, b.phone,
      EXTRACT(DAY FROM AGE(CURRENT_DATE, o."dueDate"))::integer as "daysOverdue"
    FROM "Order" o
    JOIN "Builder" b ON o."builderId" = b.id
    WHERE o."paymentStatus" != 'PAID' AND o."dueDate" < CURRENT_DATE AND o.status != 'CANCELLED'
    ORDER BY o.total DESC
    LIMIT 10
  `);
  for (const p of overduePayments) {
    actions.push({
      category: 'COLLECTIONS',
      priority: Number(p.daysOverdue) > 60 ? 'CRITICAL' : Number(p.daysOverdue) > 30 ? 'HIGH' : 'MEDIUM',
      action: `Collect $${Number(p.total).toLocaleString()} from ${p.companyName}`,
      detail: `Order #${p.orderNumber} is ${p.daysOverdue} days overdue`,
      contact: p.email,
    });
  }

  // Reorder needed
  const reorders: any[] = await prisma.$queryRawUnsafe(`
    SELECT p.name, p.sku, ii.available, ii."reorderPoint", ii."reorderQty"
    FROM "InventoryItem" ii
    JOIN "Product" p ON ii."productId" = p.id
    WHERE ii.available <= ii."reorderPoint" AND ii."reorderPoint" > 0
    ORDER BY ii.available ASC
    LIMIT 10
  `);
  for (const r of reorders) {
    actions.push({
      category: 'PURCHASING',
      priority: Number(r.available) <= 0 ? 'CRITICAL' : 'HIGH',
      action: `Reorder ${r.name} (${r.sku})`,
      detail: `${r.available} on hand, reorder point is ${r.reorderPoint}`,
    });
  }

  // Expiring quotes
  const expiringQuotes: any[] = await prisma.$queryRawUnsafe(`
    SELECT q.id, q."total", b."companyName", q."expiresAt"
    FROM "Quote" q
    JOIN "Project" p ON q."projectId" = p.id
    JOIN "Builder" b ON p."builderId" = b.id
    WHERE q.status = 'SENT' AND q."expiresAt" IS NOT NULL
      AND q."expiresAt" BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    ORDER BY q."total" DESC
    LIMIT 10
  `);
  for (const q of expiringQuotes) {
    actions.push({
      category: 'SALES',
      priority: 'MEDIUM',
      action: `Follow up on $${Number(q.totalAmount).toLocaleString()} quote for ${q.companyName}`,
      detail: `Expires ${new Date(q.expiresAt).toLocaleDateString()}`,
    });
  }

  // Late POs
  const latePOs: any[] = await prisma.$queryRawUnsafe(`
    SELECT po."poNumber", v.name as "vendorName", po.total, po."expectedDate"
    FROM "PurchaseOrder" po
    JOIN "Vendor" v ON po."vendorId" = v.id
    WHERE po.status IN ('SUBMITTED', 'APPROVED', 'ORDERED') AND po."expectedDate" < CURRENT_DATE
    ORDER BY po.total DESC
    LIMIT 5
  `);
  for (const po of latePOs) {
    actions.push({
      category: 'PURCHASING',
      priority: 'HIGH',
      action: `Follow up on late PO #${po.poNumber} from ${po.vendorName}`,
      detail: `$${Number(po.total).toLocaleString()} expected ${new Date(po.expectedDate).toLocaleDateString()}`,
    });
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  actions.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

  return safeJson({
    report: 'action-items',
    generatedAt: new Date().toISOString(),
    actions,
    summary: {
      critical: actions.filter(a => a.priority === 'CRITICAL').length,
      high: actions.filter(a => a.priority === 'HIGH').length,
      medium: actions.filter(a => a.priority === 'MEDIUM').length,
      total: actions.length,
    },
  });
}
