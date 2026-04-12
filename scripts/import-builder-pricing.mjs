#!/usr/bin/env node
/**
 * Abel Lumber — Import Per-Builder Pricing from InFlow ProductDetails
 *
 *   node scripts/import-builder-pricing.mjs
 *
 * The InFlow ProductDetails CSV has per-builder columns:
 *   AGD, BROOKFIELD, CROSS CUSTOM, Country Road Homebuilders,
 *   FIG TREE HOMES, Imagination Homes, JOSEPH PAUL HOMES, Pulte,
 *   RDR Developement, Shaddock Homes, TOLL BROTHERS
 *
 * For each cell with a non-empty price, we create/update a BuilderPricing
 * row linking that builder to that product at that price. Margin is
 * computed against Product.cost.
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import { INFLOW_PATH, readCSV, findFile, parseMoney } from './_brain-helpers.mjs';

const prisma = new PrismaClient();

// Map CSV column name → canonical builder name matcher (case-insensitive, contains)
const BUILDER_COLS = {
  'AGD': ['AGD'],
  'BROOKFIELD': ['BROOKFIELD'],
  'CROSS CUSTOM': ['CROSS CUSTOM', 'CROSS'],
  'Country Road Homebuilders': ['COUNTRY ROAD'],
  'FIG TREE HOMES': ['FIG TREE', 'FIGTREE'],
  'Imagination Homes': ['IMAGINATION'],
  'JOSEPH PAUL HOMES': ['JOSEPH PAUL'],
  'Pulte': ['PULTE', 'BUILD WITH PULTE', 'BWP'],
  'Pulte ': ['PULTE', 'BUILD WITH PULTE', 'BWP'], // trailing space in CSV header
  'RDR Developement': ['RDR'],
  'Shaddock Homes': ['SHADDOCK'],
  'TOLL BROTHERS': ['TOLL'],
};

async function main() {
  console.log('\n💲 IMPORTING PER-BUILDER PRICING');
  console.log('━'.repeat(60));

  const fname = findFile(INFLOW_PATH, 'inFlow_ProductDetails');
  if (!fname) { console.error('❌ No inFlow_ProductDetails CSV found'); process.exit(1); }
  console.log(`📄 Reading ${fname}`);

  const { headers, rows } = readCSV(path.join(INFLOW_PATH, fname));
  console.log(`   ${rows.length.toLocaleString()} product rows`);

  const products = await prisma.product.findMany({ select: { id: true, sku: true, cost: true } });
  const productBySku = new Map(products.map(p => [(p.sku || '').toUpperCase().trim(), p]));

  const builders = await prisma.builder.findMany({ select: { id: true, companyName: true } });
  // Match each CSV column to a real Builder
  const colToBuilder = new Map();
  for (const col of Object.keys(BUILDER_COLS)) {
    if (!headers.includes(col)) continue;
    const needles = BUILDER_COLS[col];
    const match = builders.find(b => {
      const cn = (b.companyName || '').toUpperCase();
      return needles.some(n => cn.includes(n));
    });
    if (match) colToBuilder.set(col, match.id);
    else console.log(`   ⚠️  no Builder match for column "${col}"`);
  }
  console.log(`   Matched ${colToBuilder.size} builder columns → Builder rows`);

  let ok = 0, noProduct = 0, emptyCells = 0;
  for (const r of rows) {
    const sku = (r.SKU || '').trim();
    if (!sku) continue;
    const product = productBySku.get(sku.toUpperCase());
    if (!product) { noProduct++; continue; }

    for (const [col, builderId] of colToBuilder) {
      const raw = r[col];
      if (!raw || !raw.trim()) { emptyCells++; continue; }
      const price = parseMoney(raw);
      if (price <= 0) { emptyCells++; continue; }
      const margin = product.cost > 0 ? (price - product.cost) / price : null;
      try {
        await prisma.builderPricing.upsert({
          where: { builderId_productId: { builderId, productId: product.id } },
          update: { customPrice: price, margin },
          create: { builderId, productId: product.id, customPrice: price, margin },
        });
        ok++;
        if (ok % 2000 === 0) console.log(`   …${ok.toLocaleString()} pricing rows written`);
      } catch (e) {
        // keep going
      }
    }
  }

  console.log('\n✅ BUILDER PRICING IMPORT COMPLETE');
  console.log(`   BuilderPricing rows written: ${ok.toLocaleString()}`);
  console.log(`   Products not in DB:          ${noProduct}`);
  console.log(`   Empty/zero price cells:      ${emptyCells.toLocaleString()}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
