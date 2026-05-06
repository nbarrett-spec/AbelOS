/**
 * Set sensible default leadTimeDays on all Product rows.
 * Policy:
 *   - inStock = true (we carry it):                          0 days
 *   - inStock = false, supplier = Boise Cascade:             7 days  (typical Boise)
 *   - inStock = false, supplier = JELD-WEN, Masonite, etc:  14 days  (door mfgrs)
 *   - inStock = false, supplier = Therma-Tru, Hyphen-spec:  21 days
 *   - inStock = false, no supplier:                          21 days
 *
 * Usage:
 *   npx tsx scripts/set-product-lead-times.ts            # DRY-RUN
 *   npx tsx scripts/set-product-lead-times.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

const SUPPLIER_LEAD_DAYS: Record<string, number> = {
  'boise cascade': 7,
  'boise': 7,
  'dw distribution': 10,
  'jeld-wen': 14,
  'jeldwen': 14,
  'masonite': 14,
  'therma-tru': 21,
  'thermatru': 21,
  'novo building products': 14,
  'bighorn iron doors': 35,
  'spacewall international': 21,
  'worldwide': 14,
  'resinart': 14,
  'stair solutions': 21,
  'abs': 21,
  'lp': 10,
  'metrie': 14,
  'weyerhaeuser': 10,
  'emtek': 14,
  'kwikset': 7,
  'schlage': 7,
}

async function main() {
  console.log(`SET PRODUCT LEAD TIMES — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  const products = await prisma.$queryRawUnsafe<Array<{
    id: string; supplierId: string | null; vendorName: string | null; inStock: boolean;
  }>>(`
    SELECT prod.id, prod."supplierId", prod."inStock", v.name as "vendorName"
    FROM "Product" prod
    LEFT JOIN "Vendor" v ON v.id = prod."supplierId"
    WHERE prod."leadTimeDays" IS NULL
  `)
  console.log(`Products with NULL leadTimeDays: ${products.length}`)

  // Bucket counts
  const buckets: Record<string, number> = {}
  const updates = new Map<number, string[]>()  // days -> ids

  for (const p of products) {
    let days: number
    if (p.vendorName) {
      const key = p.vendorName.trim().toLowerCase()
      days = SUPPLIER_LEAD_DAYS[key] ?? 14
    }
    else days = 21

    buckets[days] = (buckets[days] ?? 0) + 1
    if (!updates.has(days)) updates.set(days, [])
    updates.get(days)!.push(p.id)
  }

  console.log(`\nBucket distribution:`)
  Object.entries(buckets).sort(([a],[b])=>+a-+b).forEach(([d, n]) => {
    console.log(`  ${d.padStart(3)} days: ${n}`)
  })

  if (!COMMIT) {
    console.log(`\n(dry-run — no writes)`)
    await prisma.$disconnect()
    return
  }

  // Run a bulk UPDATE per bucket
  let total = 0
  for (const [days, ids] of updates) {
    if (ids.length === 0) continue
    // Process in chunks of 1000 to avoid huge IN clauses
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000)
      const placeholders = chunk.map((_, idx) => `$${idx + 2}`).join(',')
      await prisma.$executeRawUnsafe(
        `UPDATE "Product" SET "leadTimeDays" = $1, "updatedAt" = NOW() WHERE id IN (${placeholders})`,
        days, ...chunk
      )
    }
    total += ids.length
  }
  console.log(`\nUpdated ${total} products`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
