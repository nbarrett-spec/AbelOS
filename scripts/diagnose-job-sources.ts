import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  const r = await p.$queryRawUnsafe<any>(`
    SELECT
      COUNT(*)::bigint as total,
      SUM(CASE WHEN "hyphenJobId" IS NOT NULL THEN 1 ELSE 0 END)::bigint as hyphen,
      SUM(CASE WHEN "inflowJobId" IS NOT NULL THEN 1 ELSE 0 END)::bigint as inflow,
      SUM(CASE WHEN "boltJobId" IS NOT NULL THEN 1 ELSE 0 END)::bigint as bolt,
      SUM(CASE WHEN "orderId" IS NOT NULL THEN 1 ELSE 0 END)::bigint as order_linked,
      SUM(CASE WHEN "jobAddressRaw" IS NOT NULL AND "jobAddressRaw" != '' THEN 1 ELSE 0 END)::bigint as has_addr_raw
    FROM "Job"
    WHERE "jobAddress" IS NULL OR "jobAddress" = ''
  `)
  console.log('JOBS MISSING jobAddress — source breakdown:')
  Object.entries(r[0]).forEach(([k, v]) => console.log('  ' + k.padEnd(20) + ': ' + Number(v as any)))

  // Spot-check 5 random jobs missing address
  const samples = await p.$queryRawUnsafe<any[]>(`
    SELECT id, "jobNumber", "builderName", "jobAddress", "jobAddressRaw", "community",
           "hyphenJobId", "inflowJobId", "boltJobId", "orderId", "createdAt"
    FROM "Job"
    WHERE "jobAddress" IS NULL OR "jobAddress" = ''
    ORDER BY "createdAt" DESC
    LIMIT 10
  `)
  console.log('\nSample 10 jobs missing address:')
  samples.forEach(s => {
    console.log('  ' + s.jobNumber + ' | ' + (s.builderName || '?').slice(0, 25).padEnd(25) +
      ' | addrRaw=' + (s.jobAddressRaw || '-').slice(0, 30).padEnd(30) +
      ' | hyphen=' + (s.hyphenJobId ? 'Y' : '-') +
      ' inflow=' + (s.inflowJobId ? 'Y' : '-') +
      ' bolt=' + (s.boltJobId ? 'Y' : '-') +
      ' order=' + (s.orderId ? 'Y' : '-'))
  })

  // Check jobAddressRaw — is that source data we can copy?
  const [withRaw] = await p.$queryRawUnsafe<any>(`
    SELECT COUNT(*)::bigint c FROM "Job"
    WHERE ("jobAddress" IS NULL OR "jobAddress" = '')
      AND "jobAddressRaw" IS NOT NULL AND "jobAddressRaw" != ''
  `)
  console.log('\nJobs with jobAddressRaw but NULL jobAddress: ' + Number(withRaw.c))

  await p.$disconnect()
})().catch(e => { console.error(e); process.exit(1) })
