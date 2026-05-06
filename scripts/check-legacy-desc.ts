import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  const r = await p.$queryRawUnsafe<any>(`
    SELECT j."jobNumber", j."builderName", o."legacyDescription", o."legacySource", o."poNumber"
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '')
      AND o."legacyDescription" IS NOT NULL AND o."legacyDescription" != ''
    LIMIT 12
  `)
  console.log('Sample legacyDescription on jobs missing address:')
  r.forEach((x: any) => console.log(' ', JSON.stringify(x)))

  const [c] = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(*)::bigint c FROM "Job" j INNER JOIN "Order" o ON o.id=j."orderId"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress"='') AND o."legacyDescription" IS NOT NULL AND o."legacyDescription" != ''
  `)
  console.log('\nTotal jobs missing addr where Order has legacyDescription: ' + Number(c.c))

  // What if we look at ANY column on Order that might have addr text?
  const orderCols = await p.$queryRawUnsafe<any>(`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name='Order' AND table_schema='public'
  `)
  console.log('\nOrder text columns:')
  orderCols.filter((c:any)=>c.data_type === 'text').forEach((c:any)=>console.log(' ',c.column_name))

  // Sample any Order with legacyDescription
  const r2 = await p.$queryRawUnsafe<any>(`
    SELECT "orderNumber","legacyDescription","poNumber"
    FROM "Order"
    WHERE "legacyDescription" IS NOT NULL AND "legacyDescription" != ''
    LIMIT 8
  `)
  console.log('\nSample Order.legacyDescription:')
  r2.forEach((x:any) => console.log(' ', JSON.stringify(x)))

  await p.$disconnect()
})().catch(e=>{console.error(e); process.exit(1)})
