// One-off: apply invoice-labor-line scheduling migration to prod Neon.
// Idempotent (IF NOT EXISTS + ILIKE filters). Safe to re-run.
// Canonical SQL lives at prisma/migrations/add_invoice_labor_lines.sql.
// Delete this script after the deploy lands.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Prisma's $executeRawUnsafe runs one statement per call (prepared-statement
// mode). Keep each DDL/DML on its own call.

const ADD_LINETYPE_SQL = `
ALTER TABLE "InvoiceItem"
  ADD COLUMN IF NOT EXISTS "lineType" TEXT DEFAULT 'MATERIAL'
`

const ADD_INSTALL_FK_SQL = `
ALTER TABLE "Installation"
  ADD COLUMN IF NOT EXISTS "invoiceItemId" TEXT
`

const INDEX_INSTALL_SQL = `
CREATE INDEX IF NOT EXISTS "idx_installation_invoiceitem"
  ON "Installation" ("invoiceItemId")
`

const ADD_SCHED_FK_SQL = `
ALTER TABLE "ScheduleEntry"
  ADD COLUMN IF NOT EXISTS "invoiceItemId" TEXT
`

const INDEX_SCHED_SQL = `
CREATE INDEX IF NOT EXISTS "idx_scheduleentry_invoiceitem"
  ON "ScheduleEntry" ("invoiceItemId")
`

// Backfill: only touches rows still at the 'MATERIAL' default, so re-running
// this is a no-op. Returns the row count so we can report how many flipped.
const BACKFILL_SQL = `
UPDATE "InvoiceItem"
  SET "lineType" = 'LABOR'
WHERE "lineType" = 'MATERIAL'
  AND "productId" IN (
    SELECT id FROM "Product"
    WHERE category ILIKE ANY (ARRAY['%labor%', '%service%', '%install%'])
  )
`

const VERIFY_INVOICEITEM = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'InvoiceItem' AND column_name = 'lineType'
`

const VERIFY_INSTALLATION = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'Installation' AND column_name = 'invoiceItemId'
`

const VERIFY_SCHEDULE = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ScheduleEntry' AND column_name = 'invoiceItemId'
`

const COUNT_LABOR = `
SELECT COUNT(*)::int AS c FROM "InvoiceItem" WHERE "lineType" = 'LABOR'
`

const COUNT_TOTAL = `
SELECT COUNT(*)::int AS c FROM "InvoiceItem"
`

async function main() {
  console.log('Applying invoice-labor migration...')

  console.log('  [1/5] ALTER InvoiceItem ADD COLUMN lineType...')
  await prisma.$executeRawUnsafe(ADD_LINETYPE_SQL)

  console.log('  [2/5] ALTER Installation ADD COLUMN invoiceItemId...')
  await prisma.$executeRawUnsafe(ADD_INSTALL_FK_SQL)

  console.log('  [3/5] CREATE INDEX on Installation.invoiceItemId...')
  await prisma.$executeRawUnsafe(INDEX_INSTALL_SQL)

  console.log('  [4/5] ALTER ScheduleEntry ADD COLUMN invoiceItemId...')
  await prisma.$executeRawUnsafe(ADD_SCHED_FK_SQL)

  console.log('  [5/5] CREATE INDEX on ScheduleEntry.invoiceItemId...')
  await prisma.$executeRawUnsafe(INDEX_SCHED_SQL)

  console.log('Applied DDL. Running backfill...')
  // $executeRawUnsafe returns affected-row count for DML statements.
  const rowsAffected = await prisma.$executeRawUnsafe(BACKFILL_SQL)
  console.log(`  Backfill flipped ${rowsAffected} InvoiceItem row(s) to LABOR.`)

  // Verify
  const iiCols = await prisma.$queryRawUnsafe(VERIFY_INVOICEITEM)
  const insCols = await prisma.$queryRawUnsafe(VERIFY_INSTALLATION)
  const schCols = await prisma.$queryRawUnsafe(VERIFY_SCHEDULE)
  const laborCount = await prisma.$queryRawUnsafe(COUNT_LABOR)
  const totalCount = await prisma.$queryRawUnsafe(COUNT_TOTAL)

  console.log('\nVerify — new columns:')
  console.log('  InvoiceItem.lineType:', JSON.stringify(iiCols))
  console.log('  Installation.invoiceItemId:', JSON.stringify(insCols))
  console.log('  ScheduleEntry.invoiceItemId:', JSON.stringify(schCols))

  if (!Array.isArray(iiCols) || iiCols.length === 0) {
    throw new Error('InvoiceItem.lineType not found after migration!')
  }
  if (!Array.isArray(insCols) || insCols.length === 0) {
    throw new Error('Installation.invoiceItemId not found after migration!')
  }
  if (!Array.isArray(schCols) || schCols.length === 0) {
    throw new Error('ScheduleEntry.invoiceItemId not found after migration!')
  }

  const lc = Array.isArray(laborCount) ? laborCount[0]?.c ?? 0 : 0
  const tc = Array.isArray(totalCount) ? totalCount[0]?.c ?? 0 : 0
  console.log(`\nRow counts:`)
  console.log(`  InvoiceItem total: ${tc}`)
  console.log(`  InvoiceItem where lineType='LABOR': ${lc}`)
  console.log(`\nOK — migration applied.`)
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
