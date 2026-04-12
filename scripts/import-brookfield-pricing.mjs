// Import Brookfield pricing schedule → BuilderPricing table.
// Source: Brookfield/Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx
// Sheet:  "Pricing Schedule" (headers on row 3)
// Columns: SKU, Product, Category, Unit, Price, Change, Direction
//
// Rows without a Product (or with no SKU) are section headers (e.g. "1 LITE",
// "20 MIN FIRE DOOR") and are skipped but used to tag subsequent rows with
// `section` so the brain has category context.
//
// Links to Builder (builderName='Brookfield Residential') and Product (by sku).
// Creates Product row if missing so pricing always has a target.
// Idempotent via (builderId, productId) unique key on BuilderPricing.
//
// Usage: node scripts/import-brookfield-pricing.mjs
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { readXlsxSheet, parseMoney, bar, fileExistsOrDie, ABEL_FOLDER } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();

async function getOrCreateBrookfield() {
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Builder" WHERE LOWER("name") LIKE '%brookfield%' LIMIT 1`,
  );
  if (existing?.[0]?.id) return existing[0].id;
  const id = (await prisma.$queryRawUnsafe(
    `INSERT INTO "Builder" ("id","name","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text,'Brookfield Residential',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     RETURNING "id"`,
  ))[0].id;
  return id;
}

async function getOrCreateProduct(sku, name, category, unit) {
  if (!sku) return null;
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Product" WHERE "sku" = $1 LIMIT 1`, sku,
  );
  if (existing?.[0]?.id) return existing[0].id;
  try {
    const id = (await prisma.$queryRawUnsafe(
      `INSERT INTO "Product" ("id","sku","name","category","unit","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       ON CONFLICT ("sku") DO UPDATE SET "name" = EXCLUDED."name"
       RETURNING "id"`,
      sku, name || sku, category || null, unit || 'ea',
    ))[0].id;
    return id;
  } catch (e) {
    console.warn(`   product create fail (${sku}): ${e.message?.slice(0,100)}`);
    return null;
  }
}

async function ensurePricingUnique() {
  // Defensive: make sure BuilderPricing has a unique key for (builderId, productId)
  // so our ON CONFLICT upsert works. BuilderPricing already should have this
  // from Prisma schema, but brookfield-specific index as belt-and-suspenders.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_builderpricing_bld_prod"
      ON "BuilderPricing" ("builderId", "productId")
    `);
  } catch {}
}

async function main() {
  bar('BROOKFIELD PRICING SCHEDULE → BuilderPricing');
  const fp = path.join(ABEL_FOLDER, 'Brookfield', 'Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx');
  fileExistsOrDie(fp, 'Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx');

  const builderId = await getOrCreateBrookfield();
  console.log(`→ Builder id: ${builderId}`);
  await ensurePricingUnique();

  const { rows, rawMatrix } = readXlsxSheet(fp, 'Pricing Schedule', 3);
  console.log(`   ${rows.length} raw rows`);

  // Walk through the raw matrix to detect section headers. Headers have
  // SKU filled but no Product/Price.
  let section = null;
  let wrote = 0, skipped = 0, productsCreated = 0;
  // Recompute using rawMatrix directly so section rows are preserved in order.
  for (let i = 4; i < rawMatrix.length; i++) {
    const row = rawMatrix[i] || [];
    const sku = (row[0] || '').toString().trim();
    const product = (row[1] || '').toString().trim();
    const category = (row[2] || '').toString().trim();
    const unit = (row[3] || '').toString().trim();
    const price = parseMoney(row[4]);

    if (sku && !product && !unit && !price) {
      section = sku; // section header like "1 LITE" / "20 MIN FIRE DOOR"
      continue;
    }
    if (!sku || !product) { skipped++; continue; }

    const productId = await getOrCreateProduct(sku, product, category || section || null, unit || 'ea');
    if (!productId) { skipped++; continue; }
    productsCreated++;

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BuilderPricing" (
           "id","builderId","productId","price","unit","section","effectiveDate",
           "createdAt","updatedAt"
         ) VALUES (
           gen_random_uuid()::text,$1,$2,$3,$4,$5,CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
         )
         ON CONFLICT ("builderId","productId") DO UPDATE SET
           "price" = EXCLUDED."price",
           "unit" = EXCLUDED."unit",
           "section" = EXCLUDED."section",
           "updatedAt" = CURRENT_TIMESTAMP`,
        builderId, productId, price, unit || 'ea', section || category || null,
      );
      wrote++;
    } catch (e) {
      // "section" column might not exist on BuilderPricing — retry without it.
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BuilderPricing" (
             "id","builderId","productId","price","unit","createdAt","updatedAt"
           ) VALUES (
             gen_random_uuid()::text,$1,$2,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
           )
           ON CONFLICT ("builderId","productId") DO UPDATE SET
             "price" = EXCLUDED."price",
             "unit" = EXCLUDED."unit",
             "updatedAt" = CURRENT_TIMESTAMP`,
          builderId, productId, price, unit || 'ea',
        );
        wrote++;
      } catch (e2) {
        if (skipped < 5) console.warn(`   price skip (${sku}): ${e2.message?.slice(0,120)}`);
        skipped++;
      }
    }
  }

  console.log(`\n✅ BROOKFIELD PRICING IMPORT COMPLETE`);
  console.log(`   Products touched: ${productsCreated}`);
  console.log(`   BuilderPricing upserts: ${wrote}`);
  console.log(`   Skipped:                ${skipped}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
