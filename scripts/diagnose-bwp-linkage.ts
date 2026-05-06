import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  // Job.bwpPoNumber linkage
  const [a] = await p.$queryRawUnsafe<any>(`
    SELECT
      COUNT(DISTINCT j.id)::bigint as jobs_with_bwppo,
      COUNT(DISTINCT j.id) FILTER (WHERE j."jobAddress" IS NULL OR j."jobAddress" = '')::bigint as missing_addr,
      COUNT(DISTINCT j."bwpPoNumber")::bigint as distinct_pos_in_jobs,
      COUNT(DISTINCT line."poNumber")::bigint as distinct_pos_in_bwpline
    FROM "Job" j
    FULL OUTER JOIN "BwpFieldPOLine" line ON line."poNumber" = j."bwpPoNumber"
    WHERE j."bwpPoNumber" IS NOT NULL OR line.id IS NOT NULL
  `)
  console.log('BwpFieldPOLine ↔ Job linkage:')
  Object.entries(a).forEach(([k,v]) => console.log('  '+k+': '+Number(v as any)))

  // Sample Jobs with bwpPoNumber + missing address but matching BwpLine has lotAddress
  const sample = await p.$queryRawUnsafe<any>(`
    SELECT j."jobNumber", j."builderName", j."bwpPoNumber",
           line."lotAddress", line."community", line."lotBlock"
    FROM "Job" j
    INNER JOIN "BwpFieldPOLine" line ON line."poNumber" = j."bwpPoNumber"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '')
      AND line."lotAddress" IS NOT NULL AND line."lotAddress" != ''
    LIMIT 10
  `)
  console.log('\nSample Jobs missing address that COULD be filled from BwpFieldPOLine:')
  sample.forEach((r: any) => console.log(' ', JSON.stringify(r)))

  // How many would get filled?
  const [b] = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(DISTINCT j.id)::bigint c
    FROM "Job" j
    INNER JOIN "BwpFieldPOLine" line ON line."poNumber" = j."bwpPoNumber"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = '')
      AND line."lotAddress" IS NOT NULL AND line."lotAddress" != ''
  `)
  console.log('\nFillable from BwpFieldPOLine: ' + Number(b.c))

  // HyphenOrder linkage — by builderOrderNum
  console.log('\n\nHyphenOrder ↔ Job linkage:')
  const [h1] = await p.$queryRawUnsafe<any>(`
    SELECT
      COUNT(DISTINCT j.id) FILTER (WHERE j."hyphenJobId" IS NOT NULL)::bigint as jobs_with_hyphenjobid,
      COUNT(DISTINCT ho.id)::bigint as hyphen_orders_total,
      COUNT(DISTINCT ho.id) FILTER (WHERE ho.address IS NOT NULL AND ho.address != '')::bigint as hyphen_orders_with_addr
    FROM "HyphenOrder" ho
    FULL OUTER JOIN "Job" j ON j."hyphenJobId" = ho."hyphId"
  `)
  Object.entries(h1).forEach(([k,v]) => console.log('  '+k+': '+Number(v as any)))

  // What are the join keys we could use?
  const sampleJob = await p.$queryRawUnsafe<any>(`SELECT "jobNumber","builderName","hyphenJobId","bwpPoNumber" FROM "Job" WHERE "builderName" ILIKE '%brookfield%' LIMIT 5`)
  console.log('\nSample Brookfield jobs:')
  sampleJob.forEach((r:any) => console.log(' ', JSON.stringify(r)))

  const sampleHyp = await p.$queryRawUnsafe<any>(`SELECT "hyphId","refOrderId","builderOrderNum","supplierOrderNum","jobId" FROM "HyphenOrder" LIMIT 5`)
  console.log('\nSample HyphenOrder:')
  sampleHyp.forEach((r:any) => console.log(' ', JSON.stringify(r)))

  await p.$disconnect()
})().catch(e=>{console.error(e); process.exit(1)})
