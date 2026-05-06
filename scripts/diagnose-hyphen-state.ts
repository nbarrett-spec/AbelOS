/**
 * Diagnose what Hyphen data we have in Aegis right now and what's missing.
 */
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function tableCount(t: string): Promise<number | string> {
  try {
    const r = await p.$queryRawUnsafe<any>(`SELECT COUNT(*)::bigint c FROM "${t}"`)
    return Number(r[0].c)
  } catch (e: any) { return 'MISSING' }
}

async function tableCols(t: string): Promise<string[]> {
  try {
    const r = await p.$queryRawUnsafe<any>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, t)
    return r.map((x: any) => x.column_name)
  } catch (e) { return [] }
}

async function main() {
  console.log(`══ HYPHEN DATA STATE — ${new Date().toISOString()} ══\n`)

  const tables = ['HyphenTenant','HyphenOrder','HyphenOrderEvent','BwpFieldPOLine','BwpInvoice','BpwInvoice','IntegrationConfig']
  for (const t of tables) {
    const c = await tableCount(t)
    console.log(`  ${t.padEnd(22)} ${c}`)
  }

  // HyphenTenant detail
  console.log(`\nHyphenTenant rows:`)
  try {
    const tenants = await p.$queryRawUnsafe<any[]>(`SELECT * FROM "HyphenTenant"`)
    tenants.forEach(t => {
      const safe: any = {}
      for (const k of Object.keys(t)) {
        if (k.toLowerCase().includes('password') || k.toLowerCase().includes('token')) safe[k] = t[k] ? '***' : null
        else safe[k] = t[k]
      }
      console.log(' ', JSON.stringify(safe).slice(0, 300))
    })
  } catch (e:any) { console.log('  (table missing)') }

  // HyphenOrder schema and a sample row
  console.log(`\nHyphenOrder columns:`)
  const cols = await tableCols('HyphenOrder')
  console.log(' ', cols.join(', '))

  console.log(`\nHyphenOrder sample (first 3 rows, address/community fields if any):`)
  try {
    const interesting = cols.filter(c => /addr|comm|lot|street|city|zip|state|builder|customer|hyphen|status|jobnumber|jobaddr|orderid/i.test(c))
    if (interesting.length) {
      const sample = await p.$queryRawUnsafe<any[]>(`SELECT ${interesting.map(c=>'"'+c+'"').join(',')} FROM "HyphenOrder" LIMIT 3`)
      sample.forEach(r => console.log(' ', JSON.stringify(r).slice(0, 400)))
    }
  } catch (e:any) { console.log('  ', e.message) }

  // Job fields by source
  console.log(`\nJobs in Aegis by builder + presence of address:`)
  try {
    const r = await p.$queryRawUnsafe<any[]>(`
      SELECT "builderName",
        COUNT(*)::bigint as total,
        SUM(CASE WHEN "jobAddress" IS NOT NULL AND "jobAddress" != '' THEN 1 ELSE 0 END)::bigint as has_addr,
        SUM(CASE WHEN "hyphenJobId" IS NOT NULL THEN 1 ELSE 0 END)::bigint as has_hyphen
      FROM "Job"
      GROUP BY "builderName"
      HAVING COUNT(*) > 5
      ORDER BY COUNT(*) DESC
      LIMIT 15
    `)
    r.forEach(x => console.log(`  ${(x.builderName||'?').slice(0,30).padEnd(30)} total=${String(Number(x.total)).padStart(5)} addr=${String(Number(x.has_addr)).padStart(5)} hyphen=${String(Number(x.has_hyphen)).padStart(4)}`))
  } catch (e:any) { console.log('  ', e.message) }

  await p.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
