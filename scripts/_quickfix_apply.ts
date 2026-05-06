import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  // FIX 1: delete the 5 phantom-price BuilderPricing rows (labor SKUs with $0 basePrice and $0.5x customPrice)
  const deleted = await p.$executeRawUnsafe(`
    DELETE FROM "BuilderPricing"
    WHERE id IN (
      SELECT bp.id FROM "BuilderPricing" bp
      JOIN "Product" pr ON pr.id = bp."productId"
      WHERE bp."customPrice" < 1.00 AND pr."cost" > 10
    )`)
  console.log(`Deleted ${deleted} bad-price BuilderPricing rows`)

  // FIX 2: resolve PO-slug entityIds to real cuid IDs
  const orphans = await p.$queryRawUnsafe<Array<{ id: string; entityId: string }>>(`
    SELECT id, "entityId" FROM "InboxItem"
    WHERE "entityType" = 'PurchaseOrder' AND "entityId" LIKE 'PO-%'`)
  let fixed = 0, couldnt = 0
  for (const o of orphans) {
    const po = await p.purchaseOrder.findFirst({ where: { poNumber: o.entityId }, select: { id: true } })
    if (po) {
      await p.inboxItem.update({ where: { id: o.id }, data: { entityId: po.id } })
      fixed++
    } else { couldnt++ }
  }
  console.log(`Orphan entityIds: fixed ${fixed}, could not resolve ${couldnt}`)
  await p.$disconnect()
})()
