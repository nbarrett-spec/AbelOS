import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  const rows = await p.$queryRaw<Array<{ builder: string; n: bigint; linked: bigint }>>`
    SELECT b."companyName" AS builder,
           COUNT(j.id)::bigint AS n,
           SUM(CASE WHEN j."hyphenJobId" IS NOT NULL THEN 1 ELSE 0 END)::bigint AS linked
    FROM "Builder" b JOIN "Job" j ON j."builderId" = b.id
    WHERE b."companyName" ILIKE 'brookfield%' OR b."companyName" ILIKE 'toll%' OR b."companyName" ILIKE 'shaddock%'
    GROUP BY b."companyName" ORDER BY n DESC`
  console.log('Jobs by Hyphen-linked builder (3-way scope):')
  for (const r of rows) console.log(`  ${r.builder.padEnd(22)} ${Number(r.n).toString().padStart(5)} jobs  /  ${Number(r.linked)} linked`)
  const ho = await p.$queryRawUnsafe<Array<{ n: bigint; distinct_subs: bigint }>>(
    `SELECT COUNT(*)::bigint AS n, COUNT(DISTINCT subdivision)::bigint AS distinct_subs FROM "HyphenOrder"`)
  console.log(`\nHyphenOrder rows: ${Number(ho[0].n)} across ${Number(ho[0].distinct_subs)} distinct subdivisions`)
  const sampleSubs = await p.$queryRawUnsafe<Array<{ subdivision: string; n: bigint }>>(
    `SELECT subdivision, COUNT(*)::bigint AS n FROM "HyphenOrder" GROUP BY subdivision ORDER BY n DESC LIMIT 10`)
  console.log('\nTop 10 HyphenOrder subdivisions:')
  for (const r of sampleSubs) console.log(`  ${r.subdivision?.padEnd(40) ?? '(null)'} ${Number(r.n)}`)
  await p.$disconnect()
})()
