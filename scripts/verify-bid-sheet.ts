// verify-bid-sheet.ts
//
// READ-ONLY (by default) diff between the ADT Manufacturing Bid Sheet and the
// Aegis Product catalog.
//
// File: "Abel Cost - Bid Sheet - Pricing Template - ADT Manufacturing Prices (2).xlsx"
// Sheets (confirmed on inspection):
//   Cost                  : 156 items, cost -> margin waterfall (25/28/30/35/40/45/50).
//   FINAL FRONT DOORS     :  19 rows, same waterfall.
//   INTERIOR DOORS        : 120 rows, same waterfall.
//   INTERIOR DOORS 2      : 176 rows, columns are PRODUCT NAME / SLAB / MANUFACTURE / Cost + waterfall.
//   PATIO DOORS           :  24 rows, same waterfall.
//   METAL DOORS           :   7 rows, flat (no waterfall headers).
//   Western Sliders       :  18 rows, same waterfall.
//   Door Unit ADT Built   :  20 rows, sizing x door style component costs.
//   Labor Cost            :  sub-contractor rates (not SKU-level).
//   Door Dimensions       :  reference.
//   Margin vs Markup      :  empty.
//
// Classification: per-SKU Abel internal manufacturing cost + pricing waterfall
// used when bidding builder jobs. Same "Cost" column exists on Aegis Product,
// but Product.cost was just loaded authoritatively by another ETL and A19 is
// actively working on BuilderPricing. Policy: DO NOT overwrite Product.cost.
//
// What this script does:
//   1. Pulls "Material Description" + "Cost" from every SKU-style sheet above.
//   2. Attempts a fuzzy match against Aegis Product (name / displayName / sku)
//      using a simple normalized-token Jaccard score.
//   3. Reports top discrepancies (absolute $ and pct) between bid-sheet cost
//      and Aegis Product.cost. Never writes to Product.
//   4. With --apply, writes one InboxItem per materially-different match
//      (>= $5 AND >= 10% drift) tagged source="ADT_MFG_PRICING_REFERENCE" so
//      Nate sees them in the inbox. Default is DRY-RUN — no writes.
//
// Usage:
//   pnpm tsx scripts/verify-bid-sheet.ts            # dry-run
//   pnpm tsx scripts/verify-bid-sheet.ts --apply    # write InboxItems

import path from 'path';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const ABEL_FOLDER = path.resolve(__dirname, '..', '..');
const BID_FILE = path.join(
  ABEL_FOLDER,
  'Abel Cost - Bid Sheet - Pricing Template - ADT Manufacturing Prices (2).xlsx',
);

type BidRow = {
  sheet: string;
  description: string;
  cost: number;
  priceWaterfall: Record<string, number>; // margin label -> price
};

const MATERIAL_DIFF_ABS = 5.0; // $5
const MATERIAL_DIFF_PCT = 10.0; // 10%

function num(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[$,\s%]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normTokens(s: string): Set<string> {
  return new Set(
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s\/]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function readWaterfallSheet(sheet: string, descCol: string, costCol: string): BidRow[] {
  const wb = XLSX.readFile(BID_FILE, { cellDates: true });
  const ws = wb.Sheets[sheet];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, {
    defval: null,
    raw: true,
  }) as Record<string, unknown>[];
  const out: BidRow[] = [];
  for (const r of rows) {
    const desc = String(r[descCol] ?? '').trim();
    const cost = num(r[costCol]);
    if (!desc || cost <= 0) continue;
    // Capture margin waterfall where we can find it.
    const wf: Record<string, number> = {};
    for (const [k, v] of Object.entries(r)) {
      if (/margin/i.test(k)) wf[k] = num(v);
      if (/^price/i.test(k)) wf[k] = num(v);
    }
    out.push({ sheet, description: desc, cost, priceWaterfall: wf });
  }
  return out;
}

async function main() {
  console.log('\n=== ADT Bid Sheet verification vs Aegis Product ===');
  console.log(`Apply mode: ${APPLY ? 'APPLY (will write InboxItems)' : 'DRY-RUN'}`);
  console.log(`File: ${BID_FILE}\n`);

  // Collect SKU-like rows across the sheets that actually carry per-item cost.
  const bidRows: BidRow[] = [];
  bidRows.push(...readWaterfallSheet('Cost', 'Material Description', 'Cost'));
  bidRows.push(
    ...readWaterfallSheet('FINAL FRONT DOORS', 'Material Description - FINAL F', 'Cost'),
  );
  bidRows.push(...readWaterfallSheet('INTERIOR DOORS', 'Material Description', 'Cost'));
  bidRows.push(...readWaterfallSheet('INTERIOR DOORS 2', 'PRODUCT NAME', 'Cost'));
  bidRows.push(...readWaterfallSheet('PATIO DOORS', 'Material Description', 'Cost'));
  bidRows.push(...readWaterfallSheet('Western Sliders', 'Material Description', 'Cost'));

  // De-duplicate on (description, cost). Same SKU appears multiple times
  // across sheets (e.g., 2068 HC on Door Unit + INTERIOR DOORS 2).
  const seen = new Set<string>();
  const bid: BidRow[] = [];
  for (const r of bidRows) {
    const k = `${r.description.toLowerCase()}|${r.cost.toFixed(2)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    bid.push(r);
  }
  console.log(`  Bid sheet rows w/ cost (de-duped): ${bid.length}`);

  // Pull all active Products from Aegis to match against.
  const products = await prisma.product.findMany({
    where: { active: true },
    select: {
      id: true,
      sku: true,
      name: true,
      displayName: true,
      description: true,
      cost: true,
      category: true,
      doorSize: true,
      coreType: true,
      panelStyle: true,
    },
  });
  console.log(`  Aegis active Products: ${products.length}\n`);

  // Build fuzzy match token sets once.
  const productTokens = products.map((p) => ({
    p,
    tokens: normTokens(
      [p.sku, p.name, p.displayName ?? '', p.description ?? ''].join(' '),
    ),
  }));

  type Match = {
    bid: BidRow;
    product: (typeof products)[number];
    score: number;
    costDiffAbs: number;
    costDiffPct: number;
  };

  const matches: Match[] = [];
  const unmatched: BidRow[] = [];

  for (const b of bid) {
    const bt = normTokens(b.description);
    let best: { p: (typeof products)[number]; score: number } | null = null;
    for (const { p, tokens } of productTokens) {
      const s = jaccard(bt, tokens);
      if (!best || s > best.score) best = { p, score: s };
    }
    if (!best || best.score < 0.35) {
      unmatched.push(b);
      continue;
    }
    const aegisCost = best.p.cost ?? 0;
    const diffAbs = Math.abs(b.cost - aegisCost);
    const diffPct = aegisCost > 0 ? (diffAbs / aegisCost) * 100 : 0;
    matches.push({
      bid: b,
      product: best.p,
      score: best.score,
      costDiffAbs: diffAbs,
      costDiffPct: diffPct,
    });
  }

  console.log(`  Matched (jaccard >= 0.35): ${matches.length}`);
  console.log(`  Unmatched:                 ${unmatched.length}`);

  // Material discrepancies.
  const material = matches.filter(
    (m) => m.costDiffAbs >= MATERIAL_DIFF_ABS && m.costDiffPct >= MATERIAL_DIFF_PCT,
  );
  material.sort((a, b) => b.costDiffAbs - a.costDiffAbs);
  console.log(
    `  Material discrepancies (>=$${MATERIAL_DIFF_ABS} AND >=${MATERIAL_DIFF_PCT}%): ${material.length}\n`,
  );

  console.log('--- Top 20 cost discrepancies (bid sheet vs Aegis) ---');
  for (const m of material.slice(0, 20)) {
    console.log(
      `  ${m.product.sku.padEnd(22)} | Aegis=$${m.product.cost
        .toFixed(2)
        .padStart(9)}  Bid=$${m.bid.cost.toFixed(2).padStart(9)}  ` +
        `diff=$${m.costDiffAbs.toFixed(2).padStart(7)} (${m.costDiffPct.toFixed(1)}%)  ` +
        `score=${m.score.toFixed(2)}  [${m.bid.sheet}] ${m.bid.description.slice(0, 40)}`,
    );
  }

  // Apply: write one InboxItem per material discrepancy as reference only.
  // These are NOT auto-applied to Product — Nate reviews.
  if (APPLY) {
    console.log('\n--- Writing InboxItems (type=SYSTEM, source=ADT_MFG_PRICING_REFERENCE) ---');
    let written = 0;
    for (const m of material) {
      // Skip if an identical inbox item already exists (idempotent re-run).
      const existing = await prisma.inboxItem.findFirst({
        where: {
          source: 'ADT_MFG_PRICING_REFERENCE',
          entityType: 'Product',
          entityId: m.product.id,
          status: { in: ['PENDING', 'SNOOZED'] },
        },
      });
      if (existing) continue;
      await prisma.inboxItem.create({
        data: {
          type: 'SYSTEM',
          source: 'ADT_MFG_PRICING_REFERENCE',
          title: `ADT bid-sheet cost drift: ${m.product.sku}`,
          description:
            `Bid sheet cost $${m.bid.cost.toFixed(2)} vs Aegis Product.cost $${m.product.cost.toFixed(2)} ` +
            `(diff $${m.costDiffAbs.toFixed(2)}, ${m.costDiffPct.toFixed(1)}%). ` +
            `Bid row: "${m.bid.description}" on sheet "${m.bid.sheet}". ` +
            `NO write was made to Product. Review and decide.`,
          priority: m.costDiffPct >= 25 ? 'HIGH' : 'MEDIUM',
          status: 'PENDING',
          entityType: 'Product',
          entityId: m.product.id,
          financialImpact: m.costDiffAbs,
          actionData: {
            sku: m.product.sku,
            productName: m.product.name,
            aegisCost: m.product.cost,
            bidSheetCost: m.bid.cost,
            bidSheetDescription: m.bid.description,
            bidSheetSheet: m.bid.sheet,
            priceWaterfall: m.bid.priceWaterfall,
            matchScore: m.score,
          },
        },
      });
      written++;
    }
    console.log(`  Wrote ${written} InboxItem(s).`);
  } else {
    console.log(
      '\n(DRY-RUN — no InboxItems written. Re-run with --apply to persist as reference.)',
    );
  }

  console.log('\n--- Verdict ---');
  console.log(
    'ADT bid sheet is Abel internal manufacturing pricing with a margin waterfall. ' +
      'Product.cost was loaded authoritatively by the prior catalog ETL, so we do NOT ' +
      'overwrite it. Discrepancies are surfaced as InboxItems tagged ' +
      'ADT_MFG_PRICING_REFERENCE for manual review.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
