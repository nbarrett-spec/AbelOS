/**
 * scripts/etl-account-pricing-rebuild.ts
 *
 * ETL for Abel_Account_Pricing_Rebuild_Q4Q1.xlsx
 *
 * File is a last-2-quarter margin analysis (Oct 2025 – Feb 2026) generating
 * account-specific target unit prices for three builders:
 *   - BROOKFIELD Pricing          → Brookfield
 *   - Pulte Homes Pricing         → Pulte Homes
 *   - TOLL BROTHERS Pricing       → Toll Brothers
 *
 * Each sheet has per-SKU unit targets ("Target Unit Price") derived from
 * category margin goals. We land these into BuilderPricing.
 *
 * Also captures the per-account category margin targets from the sheet's
 * header "Targets:" line → AccountCategoryMargin, and the blended target from
 * the Executive Summary → AccountMarginTarget.
 *
 * Source tag:  ACCOUNT_PRICING_REBUILD_Q4Q1
 *
 * PRESERVES Brookfield Rev2 pricing loaded by etl-brookfield.ts. For the
 * BROOKFIELD builder we ONLY create new BuilderPricing rows — we never
 * overwrite an existing row (those are assumed to be Rev2 authoritative).
 * For Pulte / Toll we diff + update as normal.
 *
 * Flags:
 *   (default)  dry-run — diff + counts, no writes
 *   --commit            actually write
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'node:path';
import * as fs from 'node:fs';

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--commit');

const prisma = new PrismaClient();

const ABEL_ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ABEL_ROOT, 'Abel_Account_Pricing_Rebuild_Q4Q1.xlsx');
const SOURCE_TAG = 'ACCOUNT_PRICING_REBUILD_Q4Q1';

function bar(title: string) {
  console.log('\n' + '='.repeat(64));
  console.log('  ' + title);
  console.log('='.repeat(64));
}
function parseNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function readMatrix(fp: string, sheet: string): any[][] {
  const wb = XLSX.readFile(fp, { cellDates: true });
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet not found: ${sheet}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as any[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse one builder pricing sheet
// ─────────────────────────────────────────────────────────────────────────────

interface TargetRow {
  category: string;
  sku: string;
  name: string;
  currentUnitPrice: number | null;
  unitCost: number | null;
  targetUnitPrice: number;
  targetMargin: number | null;
  currentMargin: number | null;
  marginRecovery: number | null;
  status: string | null;
}

interface CategoryTargets {
  blendedStatement: string | null;            // raw "Targets: Exterior 30%, ..." line
  byCategory: Map<string, number>;            // category → target margin (decimal)
}

function parseBuilderSheet(fp: string, sheetName: string): {
  targets: CategoryTargets;
  rows: TargetRow[];
} {
  const m = readMatrix(fp, sheetName);
  // r00 col0: header/title
  // r01 col0: "Targets: Exterior Doors 30%, Interior Doors 35%, ..."
  // r02: (blank)
  // r03 col0..14: header
  // r04+ : data
  const targetsLine = m[0] && m[0][0] ? String(m[0][0]) : '';
  // Actually inspection showed the "Targets:" line is in r00. The sheet title
  // is the key name at col0 r00 in sheet_to_json; with header:1 it's row0 c0.
  // Build cat→margin map.
  const byCategory = new Map<string, number>();
  const tLine = (m[0] && m[0][0] && String(m[0][0]).includes('Targets:')) ? String(m[0][0]) : '';
  if (tLine) {
    // "Targets: Exterior Doors 30%, Interior Doors 35%, ..."
    const body = tLine.replace(/^Targets:\s*/, '');
    for (const chunk of body.split(/,\s*/)) {
      const mm = chunk.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*%$/);
      if (mm) byCategory.set(mm[1].trim(), Number(mm[2]) / 100);
    }
  }

  const rows: TargetRow[] = [];
  // Header row is the first row where col0 === 'Category'
  let dataStart = -1;
  for (let i = 0; i < Math.min(m.length, 6); i++) {
    if (m[i] && String(m[i][0]).trim() === 'Category') { dataStart = i + 1; break; }
  }
  if (dataStart < 0) dataStart = 3;

  for (let i = dataStart; i < m.length; i++) {
    const r = m[i] || [];
    const category = (r[0] ?? '').toString().trim();
    const sku = (r[1] ?? '').toString().trim();
    const name = (r[2] ?? '').toString().trim();
    const targetUnitPrice = parseNum(r[10]);
    if (!sku || !name || targetUnitPrice == null) continue;
    if (!/^BC\d+/i.test(sku)) continue; // skip footer/summary rows
    rows.push({
      category,
      sku: sku.toUpperCase(),
      name,
      currentUnitPrice: parseNum(r[8]),
      unitCost: parseNum(r[9]),
      targetUnitPrice,
      currentMargin: parseNum(r[6]),
      targetMargin: parseNum(r[7]),
      marginRecovery: parseNum(r[13]),
      status: (r[14] ?? '').toString().trim() || null,
    });
  }
  return { targets: { blendedStatement: tLine || null, byCategory }, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Executive Summary — blended margin targets
// ─────────────────────────────────────────────────────────────────────────────

interface ExecRow {
  account: string;
  revenue: number | null;
  cogs: number | null;
  gmDollars: number | null;
  currentGmPct: number | null;
  blendedTarget: number | null;
  gapToTarget: number | null;
  status: string | null;
  orders: number | null;
  lines: number | null;
  zeroRevLines: number | null;
}

function parseExecSummary(fp: string): ExecRow[] {
  const m = readMatrix(fp, 'Executive Summary');
  // Header is row with col0 === 'Account'
  let dataStart = -1;
  for (let i = 0; i < Math.min(m.length, 6); i++) {
    if (m[i] && String(m[i][0]).trim() === 'Account') { dataStart = i + 1; break; }
  }
  if (dataStart < 0) return [];
  const out: ExecRow[] = [];
  for (let i = dataStart; i < m.length; i++) {
    const r = m[i] || [];
    const account = (r[0] ?? '').toString().trim();
    if (!account) continue;
    // Stop at any totals / blank separator
    if (/^(TOTAL|GRAND|AVERAGE)/i.test(account)) continue;
    out.push({
      account,
      revenue: parseNum(r[1]),
      cogs: parseNum(r[2]),
      gmDollars: parseNum(r[3]),
      currentGmPct: parseNum(r[4]),
      blendedTarget: parseNum(r[5]),
      gapToTarget: parseNum(r[6]),
      status: (r[7] ?? '').toString().trim() || null,
      orders: parseNum(r[8]),
      lines: parseNum(r[9]),
      zeroRevLines: parseNum(r[10]),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder lookup
// ─────────────────────────────────────────────────────────────────────────────

async function findBuilder(label: string): Promise<{ id: string; companyName: string } | null> {
  // Exact-preferred order for known labels
  const norm = label.trim().toUpperCase();
  let rows: any[] = [];
  if (norm.startsWith('BROOKFIELD')) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName" FROM "Builder"
         WHERE "companyName" = 'BROOKFIELD'
            OR LOWER("companyName") LIKE 'brookfield%'
         ORDER BY (CASE WHEN "companyName" = 'BROOKFIELD' THEN 0 ELSE 1 END)
         LIMIT 1`,
    );
  } else if (norm.startsWith('PULTE')) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName" FROM "Builder"
         WHERE "companyName" = 'Pulte Homes'
            OR LOWER("companyName") LIKE 'pulte%'
         ORDER BY (CASE WHEN "companyName" = 'Pulte Homes' THEN 0
                        WHEN "companyName" = 'Pulte' THEN 1 ELSE 2 END)
         LIMIT 1`,
    );
  } else if (norm.startsWith('TOLL')) {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName" FROM "Builder"
         WHERE "companyName" = 'Toll Brothers'
            OR LOWER("companyName") LIKE 'toll brothers%'
         ORDER BY (CASE WHEN "companyName" = 'Toll Brothers' THEN 0 ELSE 1 END)
         LIMIT 1`,
    );
  } else {
    rows = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName" FROM "Builder"
         WHERE LOWER("companyName") = LOWER($1)
            OR LOWER("companyName") LIKE LOWER($2)
         ORDER BY LENGTH("companyName") ASC LIMIT 1`,
      label, label + '%',
    );
  }
  return rows[0] ?? null;
}

// Sheet label → builder search token
const SHEET_MAP: { sheet: string; label: string; protectExisting: boolean }[] = [
  { sheet: 'BROOKFIELD Pricing',    label: 'BROOKFIELD',    protectExisting: true  }, // don't clobber Rev2
  { sheet: 'Pulte Homes Pricing',   label: 'Pulte Homes',   protectExisting: false },
  { sheet: 'TOLL BROTHERS Pricing', label: 'Toll Brothers', protectExisting: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: Pricing per sheet
// ─────────────────────────────────────────────────────────────────────────────

interface StageStats {
  sheet: string;
  builder: string | null;
  parsedRows: number;
  matchedProducts: number;
  missingProducts: string[];
  create: number;
  updateChanged: number;
  unchanged: number;
  protectedSkipped: number;
  topChanges: { sku: string; name: string; from: number | null; to: number; delta: number }[];
}

async function stagePricing(): Promise<StageStats[]> {
  bar(`STAGE 1: PRICING → BuilderPricing  [sourceTag=${SOURCE_TAG}]`);
  const stats: StageStats[] = [];

  for (const map of SHEET_MAP) {
    console.log(`\n--- Sheet: ${map.sheet} ---`);
    const { targets, rows } = parseBuilderSheet(SRC, map.sheet);
    const builder = await findBuilder(map.label);
    if (!builder) {
      console.log(`  UNMATCHED builder for "${map.label}" — skipping sheet (${rows.length} rows)`);
      stats.push({ sheet: map.sheet, builder: null, parsedRows: rows.length, matchedProducts: 0,
        missingProducts: [], create: 0, updateChanged: 0, unchanged: 0, protectedSkipped: 0, topChanges: [] });
      continue;
    }
    console.log(`  Builder: ${builder.companyName}  id=${builder.id}  protectExisting=${map.protectExisting}`);
    console.log(`  Parsed pricing rows: ${rows.length}`);
    console.log(`  Targets from sheet: ${targets.byCategory.size} categories — ${[...targets.byCategory.entries()].map(([k,v]) => `${k}=${(v*100).toFixed(0)}%`).join(', ')}`);

    // Existing BuilderPricing for this builder
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT bp."productId", p."sku", bp."customPrice"
         FROM "BuilderPricing" bp JOIN "Product" p ON p.id = bp."productId"
        WHERE bp."builderId" = $1`, builder.id,
    );
    const exBySku = new Map<string, { productId: string; customPrice: number }>();
    for (const e of existing) exBySku.set(String(e.sku).toUpperCase(), { productId: e.productId, customPrice: Number(e.customPrice) });
    console.log(`  Existing BuilderPricing for ${builder.companyName}: ${existing.length}`);

    // Products by SKU
    const skus = rows.map(r => r.sku);
    const prodRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, sku, name FROM "Product" WHERE UPPER(sku) = ANY($1::text[])`, skus,
    );
    const prodBySku = new Map<string, { id: string; name: string }>();
    for (const p of prodRows) prodBySku.set(String(p.sku).toUpperCase(), { id: p.id, name: p.name });
    console.log(`  Products matched in catalog: ${prodBySku.size}/${rows.length}`);

    const missingProducts: string[] = [];
    const changes: { sku: string; name: string; from: number | null; to: number; delta: number }[] = [];
    let create = 0, updateChanged = 0, unchanged = 0, protectedSkipped = 0;

    for (const row of rows) {
      const prod = prodBySku.get(row.sku);
      if (!prod) { missingProducts.push(row.sku); continue; }
      const ex = exBySku.get(row.sku);
      if (!ex) {
        create++;
        changes.push({ sku: row.sku, name: row.name, from: null, to: row.targetUnitPrice, delta: row.targetUnitPrice });
        continue;
      }
      const delta = Math.round((row.targetUnitPrice - ex.customPrice) * 100) / 100;
      if (Math.abs(delta) < 0.005) { unchanged++; continue; }
      if (map.protectExisting) {
        protectedSkipped++;
        continue;
      }
      updateChanged++;
      changes.push({ sku: row.sku, name: row.name, from: ex.customPrice, to: row.targetUnitPrice, delta });
    }

    console.log(`  CREATE: ${create}   UPDATE(changed): ${updateChanged}   UNCHANGED: ${unchanged}   PROTECTED(skip): ${protectedSkipped}   MISSING_PRODUCT: ${missingProducts.length}`);
    const sorted = [...changes].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    console.log('  Top 10 largest price changes:');
    for (const c of sorted.slice(0, 10)) {
      const fromS = c.from == null ? 'NEW     ' : `$${c.from.toFixed(2)}`.padStart(8);
      console.log(`    ${c.sku.padEnd(10)}  ${fromS}  ->  $${c.to.toFixed(2).padStart(8)}   Δ ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(2)}   ${c.name.slice(0, 48)}`);
    }

    if (!DRY_RUN) {
      let wrote = 0;
      for (const row of rows) {
        const prod = prodBySku.get(row.sku);
        if (!prod) continue;
        const ex = exBySku.get(row.sku);
        if (ex) {
          if (Math.abs(ex.customPrice - row.targetUnitPrice) < 0.005) continue;
          if (map.protectExisting) continue;
        }
        // Compute margin if we have cost
        const margin = row.unitCost && row.targetUnitPrice > 0
          ? (row.targetUnitPrice - row.unitCost) / row.targetUnitPrice
          : null;
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BuilderPricing" ("id","builderId","productId","customPrice","margin","createdAt","updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("builderId","productId") DO UPDATE SET
             "customPrice" = EXCLUDED."customPrice",
             "margin"      = EXCLUDED."margin",
             "updatedAt"   = CURRENT_TIMESTAMP`,
          builder.id, prod.id, row.targetUnitPrice, margin,
        );
        wrote++;
      }
      console.log(`  WROTE ${wrote} BuilderPricing rows`);
    } else {
      console.log('  [dry-run] no writes');
    }

    stats.push({
      sheet: map.sheet, builder: builder.companyName, parsedRows: rows.length,
      matchedProducts: prodBySku.size, missingProducts, create, updateChanged, unchanged,
      protectedSkipped, topChanges: sorted.slice(0, 5),
    });

    // Category margin targets → AccountCategoryMargin
    if (targets.byCategory.size) {
      console.log(`  Writing ${targets.byCategory.size} AccountCategoryMargin rows${DRY_RUN ? ' (dry-run)' : ''}`);
      if (!DRY_RUN) {
        for (const [cat, pct] of targets.byCategory.entries()) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "AccountCategoryMargin" ("id","builderId","category","targetMargin","notes","createdAt","updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT ("builderId","category") DO UPDATE SET
               "targetMargin" = EXCLUDED."targetMargin",
               "notes"        = EXCLUDED."notes",
               "updatedAt"    = CURRENT_TIMESTAMP`,
            builder.id, cat, pct, `Source: ${SOURCE_TAG}`,
          );
        }
      }
    }
  }

  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2: Executive Summary → AccountMarginTarget + InboxItem summary
// ─────────────────────────────────────────────────────────────────────────────

async function stageExecSummary(allStats: StageStats[]) {
  bar(`STAGE 2: EXECUTIVE SUMMARY → AccountMarginTarget + InboxItem`);
  const execRows = parseExecSummary(SRC);
  console.log(`  Parsed exec rows: ${execRows.length}`);

  for (const e of execRows) {
    const builder = await findBuilder(e.account);
    console.log(`  ${e.account.padEnd(18)}  current=${((e.currentGmPct ?? 0) * 100).toFixed(1)}%  blended-target=${((e.blendedTarget ?? 0) * 100).toFixed(1)}%  gap=$${(e.gapToTarget ?? 0).toFixed(0)}  status=${e.status}  match=${builder?.companyName ?? 'UNMATCHED'}`);
    if (!builder || e.blendedTarget == null) continue;

    if (!DRY_RUN) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AccountMarginTarget" ("id","builderId","targetBlendedMargin","notes","createdAt","updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT ("builderId") DO UPDATE SET
           "targetBlendedMargin" = EXCLUDED."targetBlendedMargin",
           "notes" = EXCLUDED."notes",
           "updatedAt" = CURRENT_TIMESTAMP`,
        builder.id, e.blendedTarget, `Source: ${SOURCE_TAG}; status=${e.status}; currentGmPct=${e.currentGmPct}`,
      );
    }
  }

  // One summary InboxItem
  const title = 'Account Pricing Rebuild — Q4 2025 / Q1 2026';
  const description = [
    'Margin analysis covering the last two quarters (Oct 2025 – Feb 2026).',
    `Builders analyzed: ${allStats.map(s => s.builder ?? s.sheet).join(', ')}.`,
    '',
    ...allStats.map(s => s.builder
      ? `${s.builder}: parsed=${s.parsedRows}  matched=${s.matchedProducts}  create=${s.create}  updateChanged=${s.updateChanged}  unchanged=${s.unchanged}  protectedSkipped=${s.protectedSkipped}  missingProduct=${s.missingProducts.length}`
      : `${s.sheet}: UNMATCHED builder, skipped`),
    '',
    'Source file: Abel_Account_Pricing_Rebuild_Q4Q1.xlsx',
  ].join('\n');
  console.log(`\n  InboxItem preview:\n    ${title}\n    ${description.replace(/\n/g, '\n    ')}`);

  if (!DRY_RUN) {
    const dupes: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "InboxItem" WHERE "actionData"->>'sourceTag' = $1 LIMIT 1`, SOURCE_TAG,
    );
    if (dupes.length) {
      await prisma.inboxItem.update({
        where: { id: dupes[0].id },
        data: {
          title, description,
          actionData: { sourceTag: SOURCE_TAG, stats: allStats.map(s => ({ ...s, missingProducts: s.missingProducts.slice(0, 30) })) } as any,
        },
      });
      console.log(`  updated existing InboxItem id=${dupes[0].id}`);
    } else {
      const created = await prisma.inboxItem.create({
        data: {
          type: 'DEAL_FOLLOWUP',
          source: 'sales-account-pricing',
          title,
          description,
          priority: 'HIGH',
          status: 'PENDING',
          actionData: { sourceTag: SOURCE_TAG, stats: allStats.map(s => ({ ...s, missingProducts: s.missingProducts.slice(0, 30) })) } as any,
        },
      });
      console.log(`  created InboxItem id=${created.id}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '\n[DRY-RUN MODE]  (use --commit to write)' : '\n[COMMIT MODE]');
  console.log(`Source: ${SRC}`);
  if (!fs.existsSync(SRC)) throw new Error(`Source file missing: ${SRC}`);

  const stats = await stagePricing();
  await stageExecSummary(stats);

  bar('DONE');
  console.log('Summary by sheet:');
  for (const s of stats) {
    console.log(`  ${s.sheet.padEnd(26)} builder=${(s.builder ?? 'UNMATCHED').padEnd(18)} parsed=${String(s.parsedRows).padStart(3)} matched=${String(s.matchedProducts).padStart(3)} create=${String(s.create).padStart(3)} updChanged=${String(s.updateChanged).padStart(3)} unchanged=${String(s.unchanged).padStart(3)} protected=${String(s.protectedSkipped).padStart(3)} missing=${String(s.missingProducts.length).padStart(3)}`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
