export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.seedKey !== 'abel-lumber-seed-2024') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results: { query: string; status: string; error?: string; rows?: number }[] = []

    const test = async (name: string, sql: string) => {
      try {
        const r: any[] = await prisma.$queryRawUnsafe(sql)
        results.push({ query: name, status: 'OK', rows: r.length })
      } catch (e: any) {
        results.push({ query: name, status: 'ERROR', error: e.message?.slice(0, 500) })
      }
    }

    // Test every table the dashboards use
    await test('Delivery count', `SELECT COUNT(*)::int as c FROM "Delivery"`)
    await test('Delivery completedAt', `SELECT "completedAt" FROM "Delivery" LIMIT 1`)
    await test('Order count', `SELECT COUNT(*)::int as c FROM "Order"`)
    await test('Order total', `SELECT total FROM "Order" LIMIT 1`)
    await test('Job count', `SELECT COUNT(*)::int as c FROM "Job"`)
    await test('Job status cast', `SELECT status::text FROM "Job" LIMIT 1`)
    await test('Invoice count', `SELECT COUNT(*)::int as c FROM "Invoice"`)
    await test('Invoice dueDate', `SELECT "dueDate" FROM "Invoice" LIMIT 1`)
    await test('Invoice amountPaid', `SELECT "amountPaid" FROM "Invoice" LIMIT 1`)
    await test('Invoice balanceDue', `SELECT "balanceDue" FROM "Invoice" LIMIT 1`)
    await test('Quote count', `SELECT COUNT(*)::int as c FROM "Quote"`)
    await test('ScheduleEntry count', `SELECT COUNT(*)::int as c FROM "ScheduleEntry"`)
    await test('ScheduleEntry scheduledDate', `SELECT "scheduledDate" FROM "ScheduleEntry" LIMIT 1`)
    await test('InventoryItem count', `SELECT COUNT(*)::int as c FROM "InventoryItem"`)
    await test('InventoryItem onHand', `SELECT "onHand", "reorderPoint" FROM "InventoryItem" LIMIT 1`)
    await test('Builder count', `SELECT COUNT(*)::int as c FROM "Builder"`)
    await test('Builder creditLimit', `SELECT "creditLimit" FROM "Builder" LIMIT 1`)
    await test('Product count', `SELECT COUNT(*)::int as c FROM "Product"`)
    await test('Product basePrice', `SELECT "basePrice" FROM "Product" LIMIT 1`)
    await test('Product laborCost', `SELECT "laborCost" FROM "Product" LIMIT 1`)
    await test('PurchaseOrder count', `SELECT COUNT(*)::int as c FROM "PurchaseOrder"`)
    await test('PurchaseOrder expectedDate', `SELECT "expectedDate" FROM "PurchaseOrder" LIMIT 1`)
    await test('Crew count', `SELECT COUNT(*)::int as c FROM "Crew"`)
    await test('Staff count', `SELECT COUNT(*)::int as c FROM "Staff"`)
    await test('StaffRoles count', `SELECT COUNT(*)::int as c FROM "StaffRoles"`)
    await test('SubcontractorPricing count', `SELECT COUNT(*)::int as c FROM "SubcontractorPricing"`)
    await test('InventoryAllocation count', `SELECT COUNT(*)::int as c FROM "InventoryAllocation"`)
    await test('BomEntry count', `SELECT COUNT(*)::int as c FROM "BomEntry"`)
    await test('bom_cost function', `SELECT bom_cost('nonexistent') as cost`)
    await test('Deal count', `SELECT COUNT(*)::int as c FROM "Deal"`)
    await test('Contract count', `SELECT COUNT(*)::int as c FROM "Contract"`)
    await test('Activity count', `SELECT COUNT(*)::int as c FROM "Activity"`)

    // KPIs specific query test
    await test('KPI: Delivery this month', `
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status::text = 'COMPLETE')::int as completed
      FROM "Delivery"
      WHERE "createdAt" >= date_trunc('month', NOW())
    `)
    await test('KPI: Revenue', `
      SELECT COALESCE(SUM(CASE WHEN "createdAt" >= date_trunc('month', NOW()) THEN total ELSE 0 END), 0)::float as this_month
      FROM "Order" WHERE status::text NOT IN ('CANCELLED')
    `)
    await test('KPI: AR', `
      SELECT COUNT(*)::int as unpaid FROM "Invoice" WHERE status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')
    `)

    // Executive dashboard query
    await test('Exec: COGS with bom_cost', `
      SELECT p.id, p.cost, COALESCE(bom_cost(p.id), p.cost) as effective_cost
      FROM "Product" p LIMIT 3
    `)

    const errors = results.filter(r => r.status === 'ERROR')

    return NextResponse.json({
      totalTests: results.length,
      passed: results.filter(r => r.status === 'OK').length,
      failed: errors.length,
      errors,
      allResults: results,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
