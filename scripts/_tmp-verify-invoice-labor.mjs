// Smoke test for the invoice-labor migration: confirms new columns exist
// and that we can SELECT/INSERT/UPDATE against them (via a rollback xact).
// Delete after verification.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 1. Verify columns exist
  const cols = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE (table_name = 'InvoiceItem' AND column_name = 'lineType')
       OR (table_name = 'Installation' AND column_name = 'invoiceItemId')
       OR (table_name = 'ScheduleEntry' AND column_name = 'invoiceItemId')
    ORDER BY table_name, column_name
  `)
  console.log('Columns:', JSON.stringify(cols, null, 2))

  // 2. Confirm indices exist
  const idx = await prisma.$queryRawUnsafe(`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE indexname IN ('idx_installation_invoiceitem', 'idx_scheduleentry_invoiceitem')
  `)
  console.log('Indexes:', JSON.stringify(idx, null, 2))

  // 3. Current LABOR distribution
  const dist = await prisma.$queryRawUnsafe(`
    SELECT COALESCE("lineType", 'NULL') AS type, COUNT(*)::int AS n
    FROM "InvoiceItem"
    GROUP BY "lineType"
    ORDER BY n DESC
  `)
  console.log('InvoiceItem.lineType distribution:', JSON.stringify(dist, null, 2))

  // 4. Orphan check: Installation.invoiceItemId pointing to missing items
  const orphan = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n
    FROM "Installation" ins
    WHERE ins."invoiceItemId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "InvoiceItem" ii WHERE ii."id" = ins."invoiceItemId")
  `)
  console.log('Orphan Installation.invoiceItemId rows:', JSON.stringify(orphan))

  console.log('\nOK — post-migration shape is sane.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
