import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'

async function main() {
  const prisma = new PrismaClient()
  try {
    const [bomCount, productCount] = await Promise.all([
      prisma.bomEntry.count(),
      prisma.product.count(),
    ])
    console.log(`Aegis BomEntry rows: ${bomCount}`)
    console.log(`Aegis Product rows:  ${productCount}`)
    console.log()

    const wb = XLSX.readFile(path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx'))
    const ws = wb.Sheets['Bill of Materials']
    const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null })
    console.log(`XLSX BOM rows: ${rows.length}`)
    console.log('Sample:')
    rows.slice(0, 3).forEach((r) => console.log('  ', r))
    console.log()

    // How are parents/components named? By SKU or by Product Name?
    const firstParent = String(rows[0]?.['Finished Product'] ?? '')
    const firstComp = String(rows[0]?.['Component'] ?? '')
    console.log(`first parent: "${firstParent}"`)
    console.log(`first component: "${firstComp}"`)

    // Try matching by exact name, by sku, to see what identifier style the sheet uses
    const parentByName = await prisma.product.findFirst({
      where: { OR: [{ name: firstParent.trim() }, { displayName: firstParent.trim() }, { sku: firstParent.trim() }] },
      select: { id: true, sku: true, name: true },
    })
    console.log(`  → parent matched in Aegis by name/sku?`, parentByName ?? '(no)')
    const compByName = await prisma.product.findFirst({
      where: { OR: [{ name: firstComp.trim() }, { displayName: firstComp.trim() }, { sku: firstComp.trim() }] },
      select: { id: true, sku: true, name: true },
    })
    console.log(`  → component matched?`, compByName ?? '(no)')

    // Broader: how many unique parents + components does the sheet have, and
    // how many resolve by exact-name match to Aegis Product.name?
    const parents = new Set<string>()
    const components = new Set<string>()
    rows.forEach((r: any) => {
      const p = String(r['Finished Product'] ?? '').trim()
      const c = String(r['Component'] ?? '').trim()
      if (p) parents.add(p)
      if (c) components.add(c)
    })
    console.log(`\nUnique parents in sheet: ${parents.size}`)
    console.log(`Unique components in sheet: ${components.size}`)

    const productNames = await prisma.product.findMany({ select: { id: true, name: true, sku: true } })
    const nameMap = new Map(productNames.map((p) => [p.name.trim().toLowerCase(), p]))
    const parentResolved = [...parents].filter((n) => nameMap.has(n.toLowerCase())).length
    const compResolved = [...components].filter((n) => nameMap.has(n.toLowerCase())).length
    console.log(`  parents matched by name: ${parentResolved} / ${parents.size}`)
    console.log(`  components matched by name: ${compResolved} / ${components.size}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
