// verify-product-matrix.ts
//
// READ-ONLY verification of Abel_Product_Matrix_April2026.xlsx against the Aegis
// Product catalog.
//
// Classification (confirmed on inspection):
//   - Master Product Matrix : 226 family rows. Columns: Family ID, Category,
//                             Family Name, Vendor(s), Panel Style, Core,
//                             Material, Product Count, Handings, Sizes, Jamb,
//                             Cost Range, Selling Range, In Stock, Has Image.
//   - By Vendor  : 51 vendors, roll-up stats.
//   - By Category: 11 categories, roll-up stats.
//
// Verdict: PIVOTED ROLL-UP of catalog data already in Product. The file is an
// analytical view (family-level ranges), not a per-SKU feed. There is nothing
// new to load into Product. We only verify that the category totals in the
// matrix approximately line up with active Product rows in Aegis so Nate can
// trust the report.
//
// This script:
//   - NEVER writes anywhere (no --apply flag, no DB mutation).
//   - Matches By Category sheet against SELECT category, COUNT(*) FROM Product.
//   - Flags categories where the matrix family-count and Aegis SKU counts look
//     wildly out of sync (note: matrix rows are families not SKUs, so counts
//     will legitimately differ; we compare "Product Count" column instead).
//
// Usage:  pnpm tsx scripts/verify-product-matrix.ts

import path from 'path';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ABEL_FOLDER = path.resolve(__dirname, '..', '..');
const MATRIX_FILE = path.join(
  ABEL_FOLDER,
  'Abel_Product_Matrix_April2026.xlsx',
);

type Row = Record<string, unknown>;

function readSheet(filePath: string, sheetName: string): Row[] {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`);
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }) as Row[];
}

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  console.log('\n=== Product Matrix verification (READ-ONLY) ===\n');
  console.log('File:', MATRIX_FILE);

  const master = readSheet(MATRIX_FILE, 'Master Product Matrix');
  const byVendor = readSheet(MATRIX_FILE, 'By Vendor');
  const byCategory = readSheet(MATRIX_FILE, 'By Category');

  console.log(`  Master Product Matrix rows (families) : ${master.length}`);
  console.log(`  By Vendor rows                        : ${byVendor.length}`);
  console.log(`  By Category rows                      : ${byCategory.length}`);

  // Sum "Product Count" from master to get implied SKU total.
  const impliedSkuTotalFromMaster = master.reduce(
    (acc, r) => acc + num(r['Product Count']),
    0,
  );
  console.log(
    `  Master: sum(Product Count) across families = ${impliedSkuTotalFromMaster}`,
  );

  // Get actual Aegis product counts, by category.
  const dbCountsByCategory = await prisma.product.groupBy({
    by: ['category'],
    _count: { _all: true },
    where: { active: true },
  });
  const dbTotal = dbCountsByCategory.reduce((a, c) => a + c._count._all, 0);
  console.log(`  Aegis Product(active=true) total           = ${dbTotal}\n`);

  // Compare By Category against DB.
  console.log('--- By Category cross-check (matrix vs Aegis DB) ---');
  const dbMap = new Map(
    dbCountsByCategory.map((r) => [r.category, r._count._all]),
  );
  const mismatches: Array<{
    category: string;
    matrixFamilies: number;
    aegisSkus: number;
    matrixSkusImplied: number;
  }> = [];

  for (const row of byCategory) {
    const cat = String(row['Category'] ?? '').trim();
    if (!cat) continue;
    const matrixFamilies = num(row['# Families']);
    const aegisSkus = dbMap.get(cat) ?? 0;
    // Re-sum Master "Product Count" filtered by this category for a SKU-level
    // expectation.
    const matrixSkusImplied = master
      .filter(
        (r) => String(r['Category'] ?? '').trim().toLowerCase() === cat.toLowerCase(),
      )
      .reduce((a, r) => a + num(r['Product Count']), 0);
    const diff = Math.abs(matrixSkusImplied - aegisSkus);
    const pctDiff = matrixSkusImplied ? (diff / matrixSkusImplied) * 100 : 0;
    const flag = pctDiff > 25 && diff >= 5 ? ' *** drift' : '';
    console.log(
      `  ${cat.padEnd(22)} matrix families=${String(matrixFamilies).padStart(3)}  ` +
        `matrix SKUs≈${String(matrixSkusImplied).padStart(4)}  ` +
        `Aegis SKUs=${String(aegisSkus).padStart(4)}${flag}`,
    );
    if (flag) mismatches.push({ category: cat, matrixFamilies, aegisSkus, matrixSkusImplied });
  }

  // Final verdict.
  console.log('\n--- Verdict ---');
  console.log(
    'Product Matrix is a pivoted analytical rollup of the Aegis catalog; ' +
      'no per-SKU data to load. This script made ZERO writes.',
  );
  if (mismatches.length === 0) {
    console.log('Matrix category counts line up with Aegis Product table within tolerance.');
  } else {
    console.log(`Categories flagged for manual review (>25% drift): ${mismatches.length}`);
    for (const m of mismatches) {
      console.log(
        `  - ${m.category}: matrix≈${m.matrixSkusImplied} vs Aegis=${m.aegisSkus}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
