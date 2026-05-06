import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  const r = await p.$queryRawUnsafe<any[]>(`
    SELECT "builderName", COUNT(*)::bigint c
    FROM "Job"
    WHERE "jobAddress" IS NULL OR "jobAddress" = ''
    GROUP BY "builderName"
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `)
  console.log('Remaining jobs missing address by builder:')
  r.forEach(x => console.log(' ', (x.builderName || '?').padEnd(35), Number(x.c)))

  // Pattern: do they have orderId at all?
  const [s] = await p.$queryRawUnsafe<any>(`
    SELECT
      COUNT(*) FILTER (WHERE "orderId" IS NULL)::bigint as no_order,
      COUNT(*) FILTER (WHERE "orderId" IS NOT NULL)::bigint as has_order,
      COUNT(*)::bigint as total
    FROM "Job"
    WHERE "jobAddress" IS NULL OR "jobAddress" = ''
  `)
  console.log('\nLink status:')
  console.log('  total:', Number(s.total))
  console.log('  no orderId:', Number(s.no_order))
  console.log('  has orderId:', Number(s.has_order))

  // For ones with orderId — why didn't backfill catch them?
  const [s2] = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(*)::bigint c
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '')
      AND o."orderNumber" IS NULL
  `)
  console.log('  has orderId but Order.orderNumber NULL:', Number(s2.c))

  await p.$disconnect()
})().catch(e => { console.error(e); process.exit(1) })
