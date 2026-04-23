import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
try {
  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'Product' ORDER BY ordinal_position
  `)
  console.log('Product columns:')
  cols.forEach(c => console.log(`  ${c.column_name}  ${c.data_type}`))

  const total = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "Product"`)
  console.log('\nTotal Product rows:', total[0].c)

  const activeCount = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "Product" WHERE active = true`)
  console.log('Active = true:', activeCount[0].c)

  const costStats = await p.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as total,
      COUNT(cost)::int as cost_not_null,
      COUNT(CASE WHEN cost > 0 THEN 1 END)::int as cost_gt_zero,
      COUNT(CASE WHEN "basePrice" > 0 THEN 1 END)::int as baseprice_gt_zero
    FROM "Product"
  `)
  console.log('\nCost stats:', costStats[0])

  const orderItemCount = await p.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "OrderItem"`)
  console.log('\nOrderItem rows:', orderItemCount[0].c)

  const orderIn90 = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int as c FROM "Order" WHERE "createdAt" >= NOW() - INTERVAL '90 days'
  `)
  console.log('Orders in last 90d:', orderIn90[0].c)

  const orderInventory = await p.$queryRawUnsafe(`SELECT COUNT(*)::int as c FROM "InventoryItem"`)
  console.log('InventoryItem rows:', orderInventory[0].c)

  // Sample product names for display check
  const sample = await p.$queryRawUnsafe(`
    SELECT sku, name, "basePrice", cost, active, category
    FROM "Product" WHERE active = true ORDER BY "basePrice" DESC NULLS LAST LIMIT 5
  `)
  console.log('\nSample products:')
  sample.forEach(s => console.log(`  ${s.sku}  basePrice=${s.basePrice} cost=${s.cost} cat=${s.category}`))
} catch (e) {
  console.error('ERR:', e.message)
} finally {
  await p.$disconnect()
}
