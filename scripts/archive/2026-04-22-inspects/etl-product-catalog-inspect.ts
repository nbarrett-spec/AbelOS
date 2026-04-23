import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'

const SKUS_TO_INSPECT = ['BC004146', 'BC002682', 'BC002601', 'BC004149', 'BC004320']

async function main() {
  const prisma = new PrismaClient()
  const file = path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')
  const wb = XLSX.readFile(file)
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['Product Master'], { defval: null })
  const xlsxMap = new Map(rows.map((r) => [String(r.SKU ?? '').trim(), r]))

  const dbProducts = await prisma.product.findMany({
    where: { sku: { in: SKUS_TO_INSPECT } },
    select: { sku: true, name: true, cost: true, basePrice: true, category: true },
  })

  console.log('sku        | source | cost       | basePrice   | name / category')
  console.log('-----------|--------|------------|-------------|----------------------------------')
  for (const sku of SKUS_TO_INSPECT) {
    const db = dbProducts.find((p) => p.sku === sku)
    const x = xlsxMap.get(sku)
    const xname = x?.['Product Name'] ?? '(not in xlsx)'
    const xcat = x?.['Category'] ?? ''
    const xcost = x?.['Unit Cost'] ?? ''
    const xprice = x?.['Default Price'] ?? ''
    console.log(
      `${sku.padEnd(10)} | DB     | ${String(db?.cost ?? '(missing)').padStart(10)} | ${String(db?.basePrice ?? '').padStart(11)} | ${db?.name ?? '(not in db)'} [${db?.category ?? ''}]`
    )
    console.log(
      `${sku.padEnd(10)} | XLSX   | ${String(xcost).padStart(10)} | ${String(xprice).padStart(11)} | ${xname} [${xcat}]`
    )
    console.log('-----------|--------|------------|-------------|')
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
