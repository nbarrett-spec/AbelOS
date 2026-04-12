#!/usr/bin/env node
/**
 * Abel Lumber — Import Bills of Materials from InFlow
 *
 *   node scripts/import-bom.mjs
 *
 * Reads:    ../In Flow Exports/inFlow_BOM (N).csv
 * Writes:   BomEntry  (parentId → componentId, quantity)
 *
 * BOM rows reference products by NAME. We match against Product.name
 * (case-insensitive, trimmed). Unmatched rows are logged.
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import { INFLOW_PATH, readCSV, findFile, parseFloatSafe } from './_brain-helpers.mjs';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🧩 IMPORTING BILLS OF MATERIALS');
  console.log('━'.repeat(60));

  const fname = findFile(INFLOW_PATH, 'inFlow_BOM');
  if (!fname) { console.error('❌ No inFlow_BOM CSV found'); process.exit(1); }
  console.log(`📄 Reading ${fname}`);

  const { rows } = readCSV(path.join(INFLOW_PATH, fname));
  console.log(`   ${rows.length.toLocaleString()} BOM rows`);

  const products = await prisma.product.findMany({ select: { id: true, name: true } });
  const byName = new Map(products.map(p => [p.name.toUpperCase().trim().replace(/\s+/g, ' '), p.id]));
  const norm = s => (s || '').toUpperCase().trim().replace(/\s+/g, ' ');

  // Wipe existing BOM entries for a clean rebuild (idempotent).
  const deleted = await prisma.bomEntry.deleteMany({});
  console.log(`   Cleared ${deleted.count} prior BomEntry rows`);

  const unmatched = new Set();
  let ok = 0, skipped = 0;
  const payload = [];

  for (const r of rows) {
    const parentId = byName.get(norm(r.FinishedProduct));
    const componentId = byName.get(norm(r.ComponentProduct));
    if (!parentId || !componentId) {
      if (!parentId) unmatched.add(r.FinishedProduct);
      if (!componentId) unmatched.add(r.ComponentProduct);
      skipped++;
      continue;
    }
    const qty = parseFloatSafe(r.Quantity) || 1;
    payload.push({ parentId, componentId, quantity: qty, componentType: r.QuantityUom || null });
    ok++;
  }

  // createMany in chunks
  const CHUNK = 1000;
  for (let i = 0; i < payload.length; i += CHUNK) {
    await prisma.bomEntry.createMany({ data: payload.slice(i, i + CHUNK), skipDuplicates: true });
  }

  console.log('\n✅ BOM IMPORT COMPLETE');
  console.log(`   Rows written:  ${ok.toLocaleString()}`);
  console.log(`   Rows skipped:  ${skipped.toLocaleString()}`);
  console.log(`   Unique unmatched product names: ${unmatched.size}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
