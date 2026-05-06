import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  // Sample bwpPoNumber from Job
  const j = await p.$queryRawUnsafe<any>(`
    SELECT DISTINCT "bwpPoNumber" FROM "Job" WHERE "bwpPoNumber" IS NOT NULL LIMIT 10
  `)
  console.log('Job.bwpPoNumber samples:')
  j.forEach((r:any) => console.log(' ', JSON.stringify(r.bwpPoNumber)))

  // Sample poNumber from BwpFieldPOLine
  const l = await p.$queryRawUnsafe<any>(`
    SELECT DISTINCT "poNumber" FROM "BwpFieldPOLine" LIMIT 10
  `)
  console.log('\nBwpFieldPOLine.poNumber samples:')
  l.forEach((r:any) => console.log(' ', JSON.stringify(r.poNumber)))

  // Try matching Order.poNumber to BwpFieldPOLine.poNumber
  const m = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(DISTINCT j.id)::bigint c
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    INNER JOIN "BwpFieldPOLine" line ON line."poNumber" = o."poNumber"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '')
      AND line."lotAddress" IS NOT NULL AND line."lotAddress" != ''
  `)
  console.log('\nJobs fillable via Order.poNumber → BwpFieldPOLine.poNumber: ' + Number(m[0].c))

  // Sample Order.poNumber values with 5+ chars
  const op = await p.$queryRawUnsafe<any>(`
    SELECT DISTINCT "poNumber" FROM "Order"
    WHERE "poNumber" IS NOT NULL AND LENGTH("poNumber") > 4
    LIMIT 15
  `)
  console.log('\nOrder.poNumber samples:')
  op.forEach((r:any) => console.log(' ', JSON.stringify(r.poNumber)))

  // Try matching with leading-zero stripped
  const m2 = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(DISTINCT j.id)::bigint c
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    INNER JOIN "BwpFieldPOLine" line ON
      LTRIM(line."poNumber", '0') = LTRIM(o."poNumber", '0')
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '')
      AND line."lotAddress" IS NOT NULL
      AND o."poNumber" IS NOT NULL
  `)
  console.log('Same with leading-zero stripped: ' + Number(m2[0].c))

  await p.$disconnect()
})().catch(e=>{console.error(e); process.exit(1)})
