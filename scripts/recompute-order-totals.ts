/**
 * Recompute Order.subtotal and Order.total from OrderItem.lineTotal sums.
 * Only updates Orders where total is NULL or 0.
 *
 * Usage:
 *   npx tsx scripts/recompute-order-totals.ts            # DRY-RUN
 *   npx tsx scripts/recompute-order-totals.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

async function main() {
  console.log(`RECOMPUTE ORDER TOTALS — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // Find orders with NULL or 0 total that have line items
  const candidates = await prisma.$queryRawUnsafe<Array<{
    id: string;
    orderNumber: string;
    currentTotal: number | null;
    lineSum: number;
    lineCount: number;
  }>>(`
    SELECT
      o.id,
      o."orderNumber",
      o.total::float8 as "currentTotal",
      COALESCE(SUM(oi."lineTotal"), 0)::float8 as "lineSum",
      COUNT(oi.id)::int as "lineCount"
    FROM "Order" o
    INNER JOIN "OrderItem" oi ON oi."orderId" = o.id
    WHERE (o.total IS NULL OR o.total = 0)
    GROUP BY o.id, o."orderNumber", o.total
    HAVING COALESCE(SUM(oi."lineTotal"), 0) > 0
  `)

  console.log(`\nOrders to update: ${candidates.length}`)
  if (candidates.length > 0) {
    let totalSum = 0
    candidates.forEach(c => totalSum += Number(c.lineSum))
    console.log(`  total $ being added: $${totalSum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)
    console.log(`\nFirst 10:`)
    candidates.slice(0, 10).forEach(c => {
      console.log(`  ${c.orderNumber.padEnd(15)}  ${c.lineCount} items  $${Number(c.lineSum).toFixed(2)}`)
    })
  }

  if (!COMMIT) {
    console.log(`\n(dry-run — no writes)`)
    await prisma.$disconnect()
    return
  }

  // Apply in batches
  let updated = 0
  for (const c of candidates) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Order" SET subtotal = $1, total = $1, "updatedAt" = NOW() WHERE id = $2`,
      Number(c.lineSum), c.id
    )
    updated++
  }
  console.log(`\nUpdated ${updated} orders`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
