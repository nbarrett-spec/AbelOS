// One-off: apply Product.productType + TrimVendor migration. Idempotent. Delete after deploy.
//
// Adds:
//   1) Product.productType TEXT DEFAULT 'PHYSICAL'
//   2) "TrimVendor" table + active index
//   3) Backfill: existing labor/install/service products -> productType = 'LABOR'
//
// Safe to re-run: every DDL uses IF NOT EXISTS / DO ... EXCEPTION blocks.
// Prisma's $executeRawUnsafe runs one statement per call — each statement
// is its own const + its own await.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 1. Add productType column (idempotent — IF NOT EXISTS)
const ADD_PRODUCT_TYPE_SQL = `
ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "productType" TEXT NOT NULL DEFAULT 'PHYSICAL'
`

// 2. Create TrimVendor table
const CREATE_TRIM_VENDOR_SQL = `
CREATE TABLE IF NOT EXISTS "TrimVendor" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "rates"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrimVendor_pkey" PRIMARY KEY ("id")
)
`

const CREATE_TRIM_VENDOR_ACTIVE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS "TrimVendor_active_idx" ON "TrimVendor" ("active")
`

// 3. Backfill labor / install / service products
const BACKFILL_LABOR_SQL = `
UPDATE "Product"
SET "productType" = 'LABOR'
WHERE "productType" = 'PHYSICAL'
  AND (
    name ILIKE '%labor%'
    OR name ILIKE '%install%'
    OR category ILIKE '%labor%'
    OR category ILIKE '%install%'
    OR category ILIKE '%service%'
    OR subcategory ILIKE '%labor%'
  )
`

// Verify
const VERIFY_LABOR_COUNT_SQL = `SELECT COUNT(*)::int AS count FROM "Product" WHERE "productType" = 'LABOR'`
const VERIFY_PHYSICAL_COUNT_SQL = `SELECT COUNT(*)::int AS count FROM "Product" WHERE "productType" = 'PHYSICAL'`
const VERIFY_TRIM_VENDOR_COUNT_SQL = `SELECT COUNT(*)::int AS count FROM "TrimVendor"`
const VERIFY_PRODUCT_COLUMN_SQL = `
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'Product' AND column_name = 'productType'
`
const VERIFY_TRIM_VENDOR_COLUMNS_SQL = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'TrimVendor'
ORDER BY ordinal_position
`

async function main() {
  console.log('Applying bugfix migration (Product.productType + TrimVendor)...')

  console.log('  [1/4] ALTER TABLE "Product" ADD COLUMN "productType"...')
  await prisma.$executeRawUnsafe(ADD_PRODUCT_TYPE_SQL)

  console.log('  [2/4] CREATE TABLE "TrimVendor"...')
  await prisma.$executeRawUnsafe(CREATE_TRIM_VENDOR_SQL)

  console.log('  [3/4] CREATE INDEX "TrimVendor_active_idx"...')
  await prisma.$executeRawUnsafe(CREATE_TRIM_VENDOR_ACTIVE_INDEX_SQL)

  console.log('  [4/4] Backfill labor/install/service products -> productType=LABOR...')
  const updated = await prisma.$executeRawUnsafe(BACKFILL_LABOR_SQL)
  console.log(`        ${updated} rows updated to productType=LABOR`)

  console.log('Applied. Verifying...')

  const productCol = await prisma.$queryRawUnsafe(VERIFY_PRODUCT_COLUMN_SQL)
  console.log('Verify — Product.productType column:')
  console.log(JSON.stringify(productCol, null, 2))
  if (!Array.isArray(productCol) || productCol.length !== 1) {
    throw new Error('Expected exactly 1 row for Product.productType column metadata')
  }

  const trimVendorCols = await prisma.$queryRawUnsafe(VERIFY_TRIM_VENDOR_COLUMNS_SQL)
  console.log('Verify — TrimVendor columns:')
  console.log(JSON.stringify(trimVendorCols, null, 2))
  if (!Array.isArray(trimVendorCols) || trimVendorCols.length < 9) {
    throw new Error(
      `Expected at least 9 columns in TrimVendor, found ${
        Array.isArray(trimVendorCols) ? trimVendorCols.length : 'none'
      }`
    )
  }

  const [{ count: laborCount }] = await prisma.$queryRawUnsafe(VERIFY_LABOR_COUNT_SQL)
  const [{ count: physicalCount }] = await prisma.$queryRawUnsafe(VERIFY_PHYSICAL_COUNT_SQL)
  const [{ count: trimVendorCount }] = await prisma.$queryRawUnsafe(VERIFY_TRIM_VENDOR_COUNT_SQL)

  console.log('Row counts after migration:')
  console.log(`  Product.productType=LABOR    : ${laborCount}`)
  console.log(`  Product.productType=PHYSICAL : ${physicalCount}`)
  console.log(`  TrimVendor                   : ${trimVendorCount}`)
  console.log('OK — Product.productType + TrimVendor are ready.')
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
