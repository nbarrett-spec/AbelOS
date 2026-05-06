/**
 * Data quality scoreboard for Aegis.
 * Run after a refresh to see all the gaps employees are hitting.
 *
 * Usage: npx tsx scripts/data-quality-scoreboard.ts
 */

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

type Row = { area: string; metric: string; value: number; total?: number; pct?: number }

async function q1(sql: string): Promise<number> {
  const r = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(sql)
  return Number(r[0]?.c ?? 0)
}

async function main() {
  const rows: Row[] = []
  const add = (area: string, metric: string, value: number, total?: number) => {
    const pct = total ? (value / total) * 100 : undefined
    rows.push({ area, metric, value, total, pct })
  }

  // ---- PRODUCTS ----
  const productTotal = await q1(`SELECT COUNT(*)::bigint c FROM "Product"`)
  add('Products', 'total', productTotal)
  add('Products', 'NULL supplierId', await q1(`SELECT COUNT(*)::bigint c FROM "Product" WHERE "supplierId" IS NULL`), productTotal)
  add('Products', 'NULL cost', await q1(`SELECT COUNT(*)::bigint c FROM "Product" WHERE "cost" IS NULL OR "cost" = 0`), productTotal)
  add('Products', 'NULL basePrice', await q1(`SELECT COUNT(*)::bigint c FROM "Product" WHERE "basePrice" IS NULL OR "basePrice" = 0`), productTotal)
  add('Products', 'NULL sku', await q1(`SELECT COUNT(*)::bigint c FROM "Product" WHERE "sku" IS NULL OR "sku" = ''`), productTotal)
  add('Products', 'NULL category', await q1(`SELECT COUNT(*)::bigint c FROM "Product" WHERE "categoryId" IS NULL`), productTotal)
  add('Products', 'NULL leadTimeDays', await q1(`SELECT COUNT(*)::bigint c FROM "Product" WHERE "leadTimeDays" IS NULL`), productTotal)

  // ---- BUILDERS ----
  const builderTotal = await q1(`SELECT COUNT(*)::bigint c FROM "Builder"`)
  add('Builders', 'total', builderTotal)
  add('Builders', 'NULL companyName', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "companyName" IS NULL OR "companyName" = ''`), builderTotal)
  add('Builders', 'NULL email', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "email" IS NULL OR "email" = ''`), builderTotal)
  add('Builders', 'NULL phone', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "phone" IS NULL OR "phone" = ''`), builderTotal)
  add('Builders', 'NULL address', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "address" IS NULL OR "address" = ''`), builderTotal)
  add('Builders', 'NULL city', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "city" IS NULL OR "city" = ''`), builderTotal)
  add('Builders', 'NULL salesOwner', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "salesOwnerId" IS NULL`), builderTotal)
  add('Builders', 'NULL pricingTier', await q1(`SELECT COUNT(*)::bigint c FROM "Builder" WHERE "pricingTier" IS NULL`), builderTotal)

  // duplicates by companyName
  const dupBuilders = await q1(`
    SELECT COUNT(*)::bigint c FROM (
      SELECT "companyName" FROM "Builder" WHERE "companyName" IS NOT NULL
      GROUP BY "companyName" HAVING COUNT(*) > 1
    ) x
  `)
  add('Builders', 'duplicate companyName groups', dupBuilders)

  // ---- VENDORS ----
  const vendorTotal = await q1(`SELECT COUNT(*)::bigint c FROM "Vendor"`)
  add('Vendors', 'total', vendorTotal)
  add('Vendors', 'NULL email', await q1(`SELECT COUNT(*)::bigint c FROM "Vendor" WHERE "email" IS NULL OR "email" = ''`), vendorTotal)
  add('Vendors', 'NULL phone', await q1(`SELECT COUNT(*)::bigint c FROM "Vendor" WHERE "phone" IS NULL OR "phone" = ''`), vendorTotal)

  // ---- JOBS ----
  const jobTotal = await q1(`SELECT COUNT(*)::bigint c FROM "Job"`)
  add('Jobs', 'total', jobTotal)
  add('Jobs', 'NULL builderName', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "builderName" IS NULL OR "builderName" = ''`), jobTotal)
  add('Jobs', 'NULL jobAddress', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "jobAddress" IS NULL OR "jobAddress" = ''`), jobTotal)
  add('Jobs', 'NULL community', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "community" IS NULL OR "community" = ''`), jobTotal)
  add('Jobs', 'no PM assigned', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "assignedPMId" IS NULL`), jobTotal)
  add('Jobs', 'NULL communityId', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "communityId" IS NULL`), jobTotal)
  add('Jobs', 'NULL projectId', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "projectId" IS NULL`), jobTotal)
  add('Jobs', 'NULL scheduledDate', await q1(`SELECT COUNT(*)::bigint c FROM "Job" WHERE "scheduledDate" IS NULL`), jobTotal)

  // ---- ORDERS ----
  const orderTotal = await q1(`SELECT COUNT(*)::bigint c FROM "Order"`)
  add('Orders', 'total', orderTotal)
  add('Orders', 'NULL total', await q1(`SELECT COUNT(*)::bigint c FROM "Order" WHERE "total" IS NULL OR "total" = 0`), orderTotal)
  add('Orders', 'NULL orderDate', await q1(`SELECT COUNT(*)::bigint c FROM "Order" WHERE "orderDate" IS NULL`), orderTotal)

  // ---- PURCHASE ORDERS ----
  const poTotal = await q1(`SELECT COUNT(*)::bigint c FROM "PurchaseOrder"`)
  add('Purchase Orders', 'total', poTotal)
  add('Purchase Orders', 'NULL vendorId', await q1(`SELECT COUNT(*)::bigint c FROM "PurchaseOrder" WHERE "vendorId" IS NULL`), poTotal)

  // ---- BUILDER PRICING ----
  const bpTotal = await q1(`SELECT COUNT(*)::bigint c FROM "BuilderPricing"`)
  add('Builder Pricing', 'total rules', bpTotal)
  add('Builder Pricing', 'NULL customPrice', await q1(`SELECT COUNT(*)::bigint c FROM "BuilderPricing" WHERE "customPrice" IS NULL OR "customPrice" = 0`), bpTotal)
  add('Builder Pricing', 'NULL margin', await q1(`SELECT COUNT(*)::bigint c FROM "BuilderPricing" WHERE "margin" IS NULL`), bpTotal)

  // ---- STAFF ----
  const staffTable = await prisma.$queryRawUnsafe<Array<{table_name:string}>>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('Staff','Employee','Users','Member')
  `)
  if (staffTable.length) {
    const t = staffTable[0].table_name
    const staffTotal = await q1(`SELECT COUNT(*)::bigint c FROM "${t}"`)
    add('Staff', 'total', staffTotal)
    add('Staff', 'NULL email', await q1(`SELECT COUNT(*)::bigint c FROM "${t}" WHERE "email" IS NULL OR "email" = ''`), staffTotal)
  }

  // ---- PRINT ----
  console.log(`\n══════════════════════════════════════════════════════════════════════`)
  console.log(`  AEGIS DATA QUALITY SCOREBOARD — ${new Date().toISOString().slice(0, 10)}`)
  console.log(`══════════════════════════════════════════════════════════════════════\n`)

  let currentArea = ''
  for (const r of rows) {
    if (r.area !== currentArea) {
      console.log(`\n  ─── ${r.area} ───`)
      currentArea = r.area
    }
    const valStr = r.value.toLocaleString().padStart(7)
    const totalStr = r.total ? `/ ${r.total.toLocaleString().padStart(7)}` : '         '
    const pctStr = r.pct !== undefined ? `(${r.pct.toFixed(1).padStart(5)}%)` : '         '
    const flag = r.metric === 'total' ? '  ' : (r.pct !== undefined && r.pct > 50 ? '🔴' : r.pct !== undefined && r.pct > 20 ? '🟡' : '✅')
    console.log(`  ${flag} ${r.metric.padEnd(32)} ${valStr} ${totalStr} ${pctStr}`)
  }

  console.log(`\n══════════════════════════════════════════════════════════════════════\n`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
