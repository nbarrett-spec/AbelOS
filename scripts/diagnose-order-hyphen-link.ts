import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  // Sample of Brookfield Jobs missing address WITH Order link
  const sample = await p.$queryRawUnsafe<any>(`
    SELECT j."jobNumber", j."orderId", o."orderNumber", o."poNumber", o."inflowOrderId"
    FROM "Job" j
    LEFT JOIN "Order" o ON o.id = j."orderId"
    WHERE j."builderName" ILIKE '%brookfield%'
      AND (j."jobAddress" IS NULL OR j."jobAddress" = '')
    LIMIT 10
  `)
  console.log('Brookfield Jobs missing address — with Order detail:')
  sample.forEach((r:any) => console.log(' ', JSON.stringify(r)))

  // Sample HyphenOrder again
  const ho = await p.$queryRawUnsafe<any>(`SELECT "hyphId","refOrderId","builderOrderNum","supplierOrderNum",address,subdivision,"lotBlockPlan" FROM "HyphenOrder" LIMIT 5`)
  console.log('\nHyphenOrder samples:')
  ho.forEach((r:any) => console.log(' ', JSON.stringify(r)))

  // Try linking Order.orderNumber or Order.poNumber to HyphenOrder.refOrderId
  const m1 = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(DISTINCT o.id)::bigint c FROM "Order" o
    INNER JOIN "HyphenOrder" ho ON ho."refOrderId" = o."orderNumber"
  `)
  console.log('\nOrders matching HyphenOrder.refOrderId by Order.orderNumber: ' + Number(m1[0].c))

  const m2 = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(DISTINCT o.id)::bigint c FROM "Order" o
    INNER JOIN "HyphenOrder" ho ON ho."builderOrderNum" = o."poNumber"
  `)
  console.log('Orders matching HyphenOrder.builderOrderNum by Order.poNumber: ' + Number(m2[0].c))

  const m3 = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(DISTINCT o.id)::bigint c FROM "Order" o
    INNER JOIN "HyphenOrder" ho ON ho."supplierOrderNum" = o."orderNumber"
  `)
  console.log('Orders matching HyphenOrder.supplierOrderNum by Order.orderNumber: ' + Number(m3[0].c))

  // Walk the join all the way — Job.orderId → Order → HyphenOrder
  const m4 = await p.$queryRawUnsafe<any>(`
    SELECT
      COUNT(DISTINCT j.id) FILTER (WHERE ho.address IS NOT NULL)::bigint as fillable_via_orderNum,
      COUNT(DISTINCT j.id) FILTER (WHERE ho.id IS NOT NULL)::bigint as linkable
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    INNER JOIN "HyphenOrder" ho ON
      ho."refOrderId" = o."orderNumber"
      OR ho."builderOrderNum" = o."poNumber"
      OR ho."supplierOrderNum" = o."orderNumber"
    WHERE j."jobAddress" IS NULL OR j."jobAddress" = ''
  `)
  console.log('\nJobs missing addr fillable via Order → HyphenOrder: ' + Number(m4[0].fillable_via_orderNum))

  await p.$disconnect()
})().catch(e=>{console.error(e); process.exit(1)})
