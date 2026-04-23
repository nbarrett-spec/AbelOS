import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'

async function main() {
  const prisma = new PrismaClient()
  const products = await prisma.product.findMany({ select: { id: true, name: true } })
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]))

  const wb = XLSX.readFile(path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx'))
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['Bill of Materials'], { defval: null })

  // Sample: first 10 rows
  for (const r of rows.slice(0, 8)) {
    const pname = String(r['Finished Product'] ?? '').trim()
    const cname = String(r['Component'] ?? '').trim()
    const qty = Number(r.Quantity) || 0
    const ctype = String(r['Component Category'] ?? '').trim() || null
    const p = byName.get(pname.toLowerCase())
    const c = byName.get(cname.toLowerCase())
    if (!p || !c) continue
    const existing = await prisma.bomEntry.findFirst({
      where: { parentId: p.id, componentId: c.id },
      select: { quantity: true, componentType: true },
    })
    console.log(`parent=${p.name.slice(0,25)}... component=${c.name.slice(0,20)}...`)
    console.log(`  XLSX:    qty=${qty}, type="${ctype}"`)
    console.log(`  Aegis:   qty=${existing?.quantity ?? 'n/a'}, type="${existing?.componentType ?? 'n/a'}"`)
    console.log()
  }

  // Aggregate: group XLSX vs Aegis componentType distributions
  const xlsxTypes: Record<string, number> = {}
  const dbSample = await prisma.bomEntry.findMany({ select: { componentType: true }, take: 8000 })
  const dbTypes: Record<string, number> = {}
  for (const r of rows) {
    const t = String(r['Component Category'] ?? '').trim() || '(empty)'
    xlsxTypes[t] = (xlsxTypes[t] || 0) + 1
  }
  for (const r of dbSample) {
    const t = r.componentType ?? '(null)'
    dbTypes[t] = (dbTypes[t] || 0) + 1
  }
  console.log('componentType distribution:')
  console.log('  XLSX:', xlsxTypes)
  console.log('  Aegis:', dbTypes)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
