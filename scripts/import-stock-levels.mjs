#!/usr/bin/env node
/**
 * Abel Lumber — Import Current Stock Levels from InFlow
 *
 *   node scripts/import-stock-levels.mjs
 *
 * Reads:    ../In Flow Exports/inFlow_StockLevels (N).csv
 * Writes:   InventoryItem  (keyed by productId, upserted)
 *
 * The InFlow export is one row per (product, location). We sum quantities
 * across locations to get total on-hand per product.
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import { INFLOW_PATH, readCSV, findFile, parseFloatSafe } from './_brain-helpers.mjs';

const prisma = new PrismaClient();

async function main() {
  console.log('\n📊 IMPORTING STOCK LEVELS');
  console.log('━'.repeat(60));

  const fname = findFile(INFLOW_PATH, 'inFlow_StockLevels');
  if (!fname) { console.error('❌ No inFlow_StockLevels CSV found'); process.exit(1); }
  console.log(`📄 Reading ${fname}`);

  const { rows } = readCSV(path.join(INFLOW_PATH, fname));
  console.log(`   ${rows.length.toLocaleString()} stock rows`);

  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, category: true, cost: true },
  });
  const productBySku = new Map(products.map(p => [(p.sku || '').toUpperCase().trim(), p]));

  // Aggregate qty by SKU
  const totals = new Map();
  for (const r of rows) {
    const sku = (r.SKU || r.ProductSKU || '').trim();
    if (!sku) continue;
    const qty = parseFloatSafe(r.Quantity);
    totals.set(sku, (totals.get(sku) || 0) + qty);
  }
  console.log(`   ${totals.size.toLocaleString()} unique SKUs with stock`);

  let ok = 0, missing = 0;
  for (const [sku, qty] of totals) {
    const product = productBySku.get(sku.toUpperCase());
    if (!product) { missing++; continue; }
    const onHand = Math.max(0, Math.round(qty));
    try {
      await prisma.inventoryItem.upsert({
        where: { productId: product.id },
        update: {
          sku: product.sku,
          productName: product.name,
          category: product.category,
          onHand,
          available: onHand, // committed/onOrder will be set by order/PO sync
          unitCost: product.cost,
        },
        create: {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          category: product.category,
          onHand,
          committed: 0,
          onOrder: 0,
          available: onHand,
          reorderPoint: 0,
          unitCost: product.cost,
        },
      });
      ok++;
    } catch (e) {
      console.error(`   ⚠️  ${sku}: ${e.message}`);
    }
  }

  console.log('\n✅ STOCK LEVELS IMPORTED');
  console.log(`   InventoryItem rows: ${ok.toLocaleString()}`);
  console.log(`   SKUs with no Product match: ${missing.toLocaleString()}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
