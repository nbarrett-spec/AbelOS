import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
;(async () => {
  for (const t of ['BwpFieldPOLine','BwpInvoice']) {
    const cols = await p.$queryRawUnsafe<any>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, t)
    console.log(`\n=== ${t} ===`)
    console.log(cols.map((c:any) => c.column_name).join(', '))
    const sample = await p.$queryRawUnsafe<any>(`SELECT * FROM "${t}" LIMIT 1`)
    if (sample[0]) {
      const safe: any = {}
      for (const k of Object.keys(sample[0])) {
        const v = sample[0][k]
        safe[k] = typeof v === 'string' && v.length > 80 ? v.slice(0,80)+'...' : v
      }
      console.log(JSON.stringify(safe, null, 2))
    }
  }
  await p.$disconnect()
})().catch(e=>{console.error(e); process.exit(1)})
