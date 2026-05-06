/**
 * Dedupe duplicate Builders by companyName.
 * Reassigns FK references in EVERY table that has builderId, then deletes the dropped row.
 * Tables with only builderName (denormalized) don't need updates — names are identical
 * by definition since that's how we identified duplicates.
 *
 * Usage:
 *   npx tsx scripts/dedupe-builders.ts            # DRY-RUN
 *   npx tsx scripts/dedupe-builders.ts --commit   # apply
 */

import { PrismaClient } from '@prisma/client'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

async function main() {
  console.log(`DEDUPE BUILDERS — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // 1. Find all tables with a builderId column
  const tablesWithFk = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='builderId'
    ORDER BY table_name
  `
  console.log(`\nTables with builderId FK: ${tablesWithFk.length}`)
  tablesWithFk.forEach(t => console.log('  ', t.table_name))

  // 2. Find duplicate Builder groups
  const groups = await prisma.$queryRaw<Array<{ companyName: string; ids: string[] }>>`
    SELECT "companyName", array_agg(id ORDER BY "createdAt" ASC) as ids
    FROM "Builder"
    WHERE "companyName" IS NOT NULL
    GROUP BY "companyName"
    HAVING COUNT(*) > 1
    ORDER BY "companyName"
  `
  console.log(`\nDuplicate groups: ${groups.length}`)

  let merged = 0
  let failed = 0
  const errors: string[] = []

  for (const g of groups) {
    const [keep, ...drop] = g.ids
    console.log(`\n  ${g.companyName}: keep ${keep.slice(0, 14)}…, drop ${drop.length}`)
    if (!COMMIT) continue

    for (const dropId of drop) {
      try {
        // Reassign every FK in one transaction
        const stmts = tablesWithFk.map(t =>
          prisma.$executeRawUnsafe(
            `UPDATE "${t.table_name}" SET "builderId" = $1 WHERE "builderId" = $2`,
            keep, dropId
          )
        )
        // Then delete
        stmts.push(prisma.$executeRawUnsafe(`DELETE FROM "Builder" WHERE id = $1`, dropId))
        await prisma.$transaction(stmts)
        merged++
      } catch (e: any) {
        failed++
        errors.push(`${g.companyName} (${dropId}): ${e.message?.slice(0, 200)}`)
        console.log(`    FAIL: ${e.message?.slice(0, 100)}`)
      }
    }
  }

  console.log(`\n═══ RESULT ═══`)
  console.log(`  groups: ${groups.length}`)
  console.log(`  merged: ${merged}`)
  console.log(`  failed: ${failed}`)
  if (errors.length) {
    console.log(`\nErrors:`)
    errors.slice(0, 10).forEach(e => console.log(`  ${e}`))
  }

  if (COMMIT) {
    const after = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) c FROM (
        SELECT "companyName" FROM "Builder" WHERE "companyName" IS NOT NULL
        GROUP BY "companyName" HAVING COUNT(*) > 1
      ) x
    `
    console.log(`\n  Remaining duplicate groups: ${Number(after[0].c)}`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
