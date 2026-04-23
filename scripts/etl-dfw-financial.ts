/**
 * scripts/etl-dfw-financial.ts
 *
 * Privacy-aware filesystem sample of the DFW Box Export Financial folders.
 *
 * PII RISK: These folders may contain tax returns, payroll stubs, bank
 * statements, W9s (SSN/EIN), and internal financial statements. This script
 * is STATS-ONLY — no filename logging to InboxItem descriptions, no content
 * read, no persistence of any file path beyond aggregate counts.
 *
 * Scope:
 *   - Scans the two finance-related roots discovered under
 *     Abel Door & Trim_ DFW Box Export/Abel Door & Trim_ DFW/:
 *       - Financial/
 *       - Management/Finance/
 *   - Classifies subfolders by coarse category (tax, bank, payroll, loans,
 *     vendor W9s, P&L history, cash flow, meeting agendas, cost analysis).
 *   - Emits 3-5 privacy-safe pointer InboxItems (sourceTag = DFW_EXPORT_FINANCIAL[*]):
 *       1) Folder overview: total files, MB, extension mix, category counts
 *       2) Per-category pointer: W9s / vendor tax (HIGH privacy)
 *       3) Per-category pointer: M&G Financial historical records (litigation-adjacent)
 *       4) Per-category pointer: operational financial spreadsheets
 *       5) Annual retention-review reminder (priority MEDIUM)
 *
 * Usage:
 *   npx tsx scripts/etl-dfw-financial.ts                 # scan-only dry run
 *   npx tsx scripts/etl-dfw-financial.ts --commit        # write InboxItems
 *
 * Constraints:
 *   - NEVER readFile. Only readdirSync + statSync.
 *   - NEVER log filenames to stdout in a way that could be captured by a
 *     git commit message. Only aggregate counts.
 *   - 3-minute wall-clock cap.
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--commit');

// ── Config ────────────────────────────────────────────────────────────────────
const ABEL_ROOT = path.resolve(__dirname, '..', '..');
const DFW_ROOT = path.join(
  ABEL_ROOT,
  'Abel Door & Trim_ DFW Box Export',
  'Abel Door & Trim_ DFW',
);

const FINANCE_ROOTS = [
  path.join(DFW_ROOT, 'Financial'),
  path.join(DFW_ROOT, 'Management', 'Finance'),
];

const WALL_CLOCK_MS = 3 * 60 * 1000; // 3 minutes

const SOURCE_TAG_ROOT = 'DFW_EXPORT_FINANCIAL';

// Category classifiers — substring match on the *folder path* (relative, lowercased).
// These are coarse labels for aggregate stats, not for filename logging.
type Category =
  | 'tax_w9'
  | 'bank_statements'
  | 'payroll'
  | 'pnl_history'
  | 'cash_flow'
  | 'loans'
  | 'mg_financial'
  | 'meeting_agendas'
  | 'cost_analysis'
  | 'workflow'
  | 'other';

const CATEGORY_HINTS: Array<{ cat: Category; hints: string[] }> = [
  { cat: 'tax_w9', hints: ['w9', 'w-9', 'tax return', '1099', '1040', 'form 941'] },
  { cat: 'bank_statements', hints: ['bank statement', 'bank-statement', 'statements/', 'reconciliation'] },
  { cat: 'payroll', hints: ['payroll', 'paystub', 'pay stub'] },
  { cat: 'pnl_history', hints: ['p&l', 'pnl', 'profit and loss', 'profit-loss', 'income statement'] },
  { cat: 'cash_flow', hints: ['cash flow', 'cash-flow', 'cashflow', 'projection'] },
  { cat: 'loans', hints: ['loan', 'truck & trailer', 'credit line', 'line of credit'] },
  { cat: 'mg_financial', hints: ['m&g', 'm & g', 'mg financial'] },
  { cat: 'meeting_agendas', hints: ['meeting agenda', 'agenda'] },
  { cat: 'cost_analysis', hints: ['cost analysis', 'cost-analysis', 'door cost'] },
  { cat: 'workflow', hints: ['workflow', 'workflow spreadsheet'] },
];

function classify(relpath: string): Category {
  const low = relpath.toLowerCase();
  for (const { cat, hints } of CATEGORY_HINTS) {
    if (hints.some(h => low.includes(h))) return cat;
  }
  return 'other';
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ExtStat = { count: number; bytes: number };
type CategoryStat = { files: number; bytes: number; subdirCount: number };

interface FinanceManifest {
  scannedAt: string;
  roots: string[];
  scanCompleted: boolean;
  wallClockMs: number;
  totalFiles: number;
  totalDirs: number;
  totalBytes: number;
  extensionHistogram: Record<string, ExtStat>;
  categoryStats: Record<Category, CategoryStat>;
  // Year coverage hint — just counts of folders whose name matches 20xx.
  yearCoverage: string[];
}

// ── Scan ──────────────────────────────────────────────────────────────────────
function fmtMB(b: number): string {
  return (b / 1_000_000).toFixed(2) + ' MB';
}

function emptyCatStats(): Record<Category, CategoryStat> {
  return {
    tax_w9: { files: 0, bytes: 0, subdirCount: 0 },
    bank_statements: { files: 0, bytes: 0, subdirCount: 0 },
    payroll: { files: 0, bytes: 0, subdirCount: 0 },
    pnl_history: { files: 0, bytes: 0, subdirCount: 0 },
    cash_flow: { files: 0, bytes: 0, subdirCount: 0 },
    loans: { files: 0, bytes: 0, subdirCount: 0 },
    mg_financial: { files: 0, bytes: 0, subdirCount: 0 },
    meeting_agendas: { files: 0, bytes: 0, subdirCount: 0 },
    cost_analysis: { files: 0, bytes: 0, subdirCount: 0 },
    workflow: { files: 0, bytes: 0, subdirCount: 0 },
    other: { files: 0, bytes: 0, subdirCount: 0 },
  };
}

function scan(roots: string[]): FinanceManifest {
  const t0 = Date.now();
  const m: FinanceManifest = {
    scannedAt: new Date().toISOString(),
    roots,
    scanCompleted: false,
    wallClockMs: 0,
    totalFiles: 0,
    totalDirs: 0,
    totalBytes: 0,
    extensionHistogram: {},
    categoryStats: emptyCatStats(),
    yearCoverage: [],
  };

  const yearSet = new Set<string>();
  const yearRe = /\b(19|20)\d{2}\b/;

  let aborted = false;

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    if (aborted) break;

    type Frame = { dir: string };
    const stack: Frame[] = [{ dir: root }];

    while (stack.length) {
      if (Date.now() - t0 > WALL_CLOCK_MS) { aborted = true; break; }
      const frame = stack.pop()!;
      m.totalDirs += 1;

      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(frame.dir, { withFileTypes: true });
      } catch {
        continue;
      }

      // If this dir's own name suggests a year, track it.
      const dirName = path.basename(frame.dir);
      const yM = dirName.match(yearRe);
      if (yM) yearSet.add(yM[0]);

      // Classify this dir once, distribute its direct-child files to that
      // category. (We only classify from the directory path — never the filename.)
      const relDir = path.relative(DFW_ROOT, frame.dir);
      const dirCat = classify(relDir);
      m.categoryStats[dirCat].subdirCount += 1;

      for (const d of dirents) {
        if (Date.now() - t0 > WALL_CLOCK_MS) { aborted = true; break; }
        const full = path.join(frame.dir, d.name);
        if (d.isDirectory()) {
          stack.push({ dir: full });
          continue;
        }
        if (!d.isFile()) continue;

        let st: fs.Stats;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }

        // Ext histogram only — no filename.
        const ext = path.extname(d.name).toLowerCase() || '(noext)';
        const bucket = m.extensionHistogram[ext] ?? { count: 0, bytes: 0 };
        bucket.count += 1;
        bucket.bytes += st.size;
        m.extensionHistogram[ext] = bucket;

        m.totalFiles += 1;
        m.totalBytes += st.size;

        // Category bump
        m.categoryStats[dirCat].files += 1;
        m.categoryStats[dirCat].bytes += st.size;
      }
    }
  }

  m.yearCoverage = [...yearSet].sort();
  m.wallClockMs = Date.now() - t0;
  m.scanCompleted = !aborted;
  return m;
}

// ── Inbox item builder (aggregate-only, no filenames) ─────────────────────────
type NewInboxItem = {
  tag: string;
  title: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
};

function buildItems(m: FinanceManifest): NewInboxItem[] {
  const items: NewInboxItem[] = [];
  const nonEmptyCats = Object.entries(m.categoryStats)
    .filter(([, s]) => s.files > 0 || s.subdirCount > 1)
    .sort(([, a], [, b]) => b.bytes - a.bytes);

  const extLines = Object.entries(m.extensionHistogram)
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([ext, s]) => `  - ${ext}  count=${s.count}  ${fmtMB(s.bytes)}`)
    .join('\n');

  const catLines = nonEmptyCats
    .map(([c, s]) => `  - ${c.padEnd(18)}  files=${s.files}  ${fmtMB(s.bytes).padStart(10)}  subdirs=${s.subdirCount}`)
    .join('\n');

  // 1) Folder overview (LOW priority — informational)
  items.push({
    tag: SOURCE_TAG_ROOT,
    title: 'DFW export — Financial folders: privacy-safe inventory',
    priority: 'LOW',
    description: [
      'Privacy-aware stats-only scan of the DFW Box Export financial folders.',
      'NO filenames or content were read — aggregate metadata only.',
      '',
      `Scanned roots: ${m.roots.length}`,
      `Completed: ${m.scanCompleted}  walltime=${(m.wallClockMs / 1000).toFixed(1)}s`,
      `Totals: ${m.totalFiles} files, ${m.totalDirs} dirs, ${fmtMB(m.totalBytes)}`,
      m.yearCoverage.length ? `Year folders detected: ${m.yearCoverage.join(', ')}` : '',
      '',
      'Extensions:',
      extLines || '  (none)',
      '',
      'Categories (by path hints, not filename):',
      catLines || '  (none)',
      '',
      'Archive is small — not a deep-ETL candidate. Financial truth lives in',
      'QuickBooks + Aegis. Treat this as a historical retention archive.',
    ].filter(Boolean).join('\n'),
  });

  // 2) Tax / W9 pointer — HIGH privacy
  const taxStat = m.categoryStats.tax_w9;
  if (taxStat.files > 0 || taxStat.subdirCount > 1) {
    items.push({
      tag: `${SOURCE_TAG_ROOT}_TAX_W9`,
      title: 'DFW export — vendor W9 / tax records (PII-sensitive, retention review)',
      priority: 'MEDIUM',
      description: [
        'Vendor W9s and tax-form records detected under the Management/Finance area.',
        'These likely contain EINs / SSNs and must stay in restricted-access storage.',
        '',
        `Aggregate: files=${taxStat.files}  ${fmtMB(taxStat.bytes)}  subdirs=${taxStat.subdirCount}`,
        m.yearCoverage.length ? `Year coverage hint: ${m.yearCoverage.join(', ')}` : '',
        '',
        'Action: do NOT ingest into Aegis. Keep in Box with restricted ACL.',
        'Annual review should prune any vendor no longer active or past 7-year hold.',
      ].filter(Boolean).join('\n'),
    });
  }

  // 3) M&G Financial pointer — litigation-adjacent
  const mgStat = m.categoryStats.mg_financial;
  const mgFlowStat = m.categoryStats.cash_flow;
  const mgAgendaStat = m.categoryStats.meeting_agendas;
  const mgBytes = mgStat.bytes + mgFlowStat.bytes + mgAgendaStat.bytes;
  const mgFiles = mgStat.files + mgFlowStat.files + mgAgendaStat.files;
  if (mgFiles > 0) {
    items.push({
      tag: `${SOURCE_TAG_ROOT}_MG_FINANCIAL`,
      title: 'DFW export — M&G Financial historical records (litigation-adjacent)',
      priority: 'MEDIUM',
      description: [
        'Historical M&G Financial artifacts detected — cash flow projections and',
        'meeting agendas. M&G is currently an active litigation counterparty',
        '(see memory/projects and the MG Financial Evidence for Counsel folder).',
        '',
        `Aggregate: files=${mgFiles}  ${fmtMB(mgBytes)}`,
        '',
        'Action: preserve in place — do NOT delete or re-organize until litigation',
        'closes. Counsel may need the complete historical set as-originally-stored.',
      ].join('\n'),
    });
  }

  // 4) Operational financial workbooks pointer
  const opBytes = m.categoryStats.workflow.bytes + m.categoryStats.cost_analysis.bytes +
    m.categoryStats.pnl_history.bytes + m.categoryStats.loans.bytes;
  const opFiles = m.categoryStats.workflow.files + m.categoryStats.cost_analysis.files +
    m.categoryStats.pnl_history.files + m.categoryStats.loans.files;
  if (opFiles > 0) {
    items.push({
      tag: `${SOURCE_TAG_ROOT}_OPERATIONAL`,
      title: 'DFW export — operational financial workbooks (cost / workflow / loans)',
      priority: 'LOW',
      description: [
        'Operational finance spreadsheets detected: cost analyses, workflow',
        'spreadsheets, P&L history, equipment loan tracking.',
        '',
        `Aggregate: files=${opFiles}  ${fmtMB(opBytes)}`,
        '',
        'Not a priority ingest — modern equivalents already live in Aegis',
        '(purchasing, AMP spend outlook, margin analysis). Archive only.',
      ].join('\n'),
    });
  }

  // 5) Annual retention-review reminder — MEDIUM
  items.push({
    tag: `${SOURCE_TAG_ROOT}_RETENTION_REVIEW`,
    title: 'Annual review: DFW financial archive retention policy',
    priority: 'MEDIUM',
    description: [
      'Reminder to review the DFW Box Export financial folders annually',
      'against a written retention policy:',
      '  - Tax returns / W9s: 7 years from filing',
      '  - Bank statements: 7 years',
      '  - Payroll: 4 years (IRS) / 6 years (FLSA)',
      '  - P&L / internal statements: keep indefinitely (historical)',
      '  - Litigation holds (M&G): keep until case closes + 3 years',
      '',
      'Next review due: one year from creation of this InboxItem.',
      `Current aggregate size: ${fmtMB(m.totalBytes)} across ${m.totalFiles} files.`,
    ].join('\n'),
  });

  return items;
}

// ── DB write ──────────────────────────────────────────────────────────────────
async function writeInboxItems(items: NewInboxItem[], dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log('\n[DRY-RUN] Would upsert', items.length, 'InboxItems:');
    for (const it of items) console.log('  -', it.tag, '[' + it.priority + '] →', it.title);
    return;
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    for (const it of items) {
      const dupes: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "InboxItem" WHERE "actionData"->>'sourceTag' = $1 LIMIT 1`,
        it.tag,
      );
      const payload = JSON.stringify({
        sourceTag: it.tag,
        scanRoots: FINANCE_ROOTS,
        privacyMode: 'stats-only',
      });
      if (dupes.length) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem" SET title=$1, description=$2, "actionData"=$3::jsonb,
             priority=$4, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$5`,
          it.title, it.description, payload, it.priority, dupes[0].id,
        );
        console.log('  updated', it.tag, dupes[0].id);
      } else {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `INSERT INTO "InboxItem"
             ("id","type","source","title","description","priority","status",
              "actionData","createdAt","updatedAt")
           VALUES (gen_random_uuid()::text, 'DATA_IMPORT', 'dfw-financial',
             $1,$2,$3,'PENDING',$4::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id`,
          it.title, it.description, it.priority, payload,
        );
        console.log('  created', it.tag, rows[0].id);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('  DFW Box Export — Financial folder stats-only ETL');
  console.log('='.repeat(60));
  console.log(DRY_RUN ? '[DRY-RUN] (use --commit to write)' : '[COMMIT]');

  const manifest = scan(FINANCE_ROOTS);

  // Intentionally do NOT print roots or filenames — stats only.
  console.log(`Scan complete=${manifest.scanCompleted}  walltime=${(manifest.wallClockMs / 1000).toFixed(1)}s`);
  console.log(`Totals: ${manifest.totalFiles} files, ${manifest.totalDirs} dirs, ${fmtMB(manifest.totalBytes)}`);
  console.log('Non-empty categories:');
  for (const [c, s] of Object.entries(manifest.categoryStats)) {
    if (s.files > 0 || s.subdirCount > 1) {
      console.log(`  - ${c.padEnd(18)} files=${s.files}  ${fmtMB(s.bytes).padStart(10)}`);
    }
  }

  const items = buildItems(manifest);
  console.log(`\nInboxItems computed: ${items.length}`);
  await writeInboxItems(items, DRY_RUN);
  console.log('\nDONE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
