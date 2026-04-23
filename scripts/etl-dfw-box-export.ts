/**
 * scripts/etl-dfw-box-export.ts
 *
 * Cautious filesystem sample of the ~14 GB DFW Box Export archive.
 *
 * Rules:
 *   - NEVER readFile. Only readdirSync + statSync.
 *   - Skip individual files > 100 MB (stat only, no hydrate).
 *   - 5-minute wall-clock cap. If exceeded, finish current dir and exit cleanly.
 *   - Progress log every 500 files.
 *   - Emit a manifest JSON: total files, total bytes, top-level folder stats,
 *     extension histogram, biggest files (top 50), suspected high-value and
 *     legacy-duplicate folders.
 *   - Create 3–5 InboxItem summaries (sourceTag = DFW_BOX_EXPORT_SAMPLE[*]):
 *       1) top-level summary
 *       2) pricing / financial high-value pointer
 *       3) plans / customer high-value pointer
 *       4) legacy-overlap pointer (data we already have in Aegis → skip)
 *       5) (optional) biggest-files pointer
 *
 * Usage:
 *   npx tsx scripts/etl-dfw-box-export.ts          # scan only (dry-run)
 *   npx tsx scripts/etl-dfw-box-export.ts --commit # scan + write InboxItems
 *   npx tsx scripts/etl-dfw-box-export.ts --manifest-only  # no DB connect
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--commit');
const MANIFEST_ONLY = argv.includes('--manifest-only');

// ── Config ────────────────────────────────────────────────────────────────────
const ABEL_ROOT = path.resolve(__dirname, '..', '..');
const BOX_ROOT = path.join(ABEL_ROOT, 'Abel Door & Trim_ DFW Box Export', 'Abel Door & Trim_ DFW');
const MANIFEST_OUT = path.join(__dirname, 'dfw_box_export_manifest.json');

const WALL_CLOCK_MS = 5 * 60 * 1000;     // 5 minutes
const BIG_FILE_BYTES = 100 * 1024 * 1024; // 100 MB — still counted, NOT recursed into
const PROGRESS_EVERY = 500;

const SOURCE_TAG_ROOT = 'DFW_BOX_EXPORT_SAMPLE';

// Classification hints (case-insensitive substrings).
const HIGH_VALUE_HINTS = [
  'pricing', 'price', 'financial', 'finance', 'p&l', 'pnl',
  'bid', 'contract', 'margin', 'cost', 'rebate',
];
const PLANS_HINTS = ['plan', 'blueprint', 'takeoff', 'bloomfield', 'customer', 'bid'];
const LEGACY_OVERLAP_HINTS = [
  'inflow', 'bolt', 'eci', 'quickbook', 'qb export',
  'bom', 'bill of material', 'purchas', 'inventory',
];
const SKIP_BINARY_EXTS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.heic', '.tif', '.tiff',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.mp4', '.mov', '.avi', '.mkv', '.wmv',
  '.dwg', '.dxf', '.skp', '.rvt',
  '.exe', '.msi', '.iso',
]);

// ── Types ─────────────────────────────────────────────────────────────────────
type ExtStat = { count: number; bytes: number };
type TopFolderStat = {
  name: string;
  files: number;
  bytes: number;
  subdirs: number;
  deepest: number;
  flagHighValue: boolean;
  flagPlans: boolean;
  flagLegacy: boolean;
};
type BigFile = { relpath: string; bytes: number };

interface Manifest {
  scannedAt: string;
  boxRoot: string;
  scanCompleted: boolean;
  wallClockMs: number;
  totalFiles: number;
  totalDirs: number;
  totalBytes: number;
  skippedOversizeFiles: number;
  extensionHistogram: Record<string, ExtStat>;
  topLevelFolders: TopFolderStat[];
  biggestFiles: BigFile[];
  highValueFolders: string[];
  plansFolders: string[];
  legacyOverlapFolders: string[];
}

// ── Scan ──────────────────────────────────────────────────────────────────────
function hintMatch(s: string, hints: string[]): boolean {
  const low = s.toLowerCase();
  return hints.some(h => low.includes(h));
}

function fmtMB(b: number): string {
  return (b / 1_000_000).toFixed(1) + ' MB';
}

function scan(boxRoot: string): Manifest {
  const t0 = Date.now();
  const manifest: Manifest = {
    scannedAt: new Date().toISOString(),
    boxRoot,
    scanCompleted: false,
    wallClockMs: 0,
    totalFiles: 0,
    totalDirs: 0,
    totalBytes: 0,
    skippedOversizeFiles: 0,
    extensionHistogram: {},
    topLevelFolders: [],
    biggestFiles: [],
    highValueFolders: [],
    plansFolders: [],
    legacyOverlapFolders: [],
  };

  if (!fs.existsSync(boxRoot)) {
    console.error('Box root missing:', boxRoot);
    return manifest;
  }

  const topEntries = fs.readdirSync(boxRoot, { withFileTypes: true })
    .filter(e => e.isDirectory());

  let fileCount = 0;
  let aborted = false;

  const bigFiles: BigFile[] = [];

  for (const topEntry of topEntries) {
    if (aborted) break;
    const topPath = path.join(boxRoot, topEntry.name);
    const tf: TopFolderStat = {
      name: topEntry.name,
      files: 0,
      bytes: 0,
      subdirs: 0,
      deepest: 0,
      flagHighValue: hintMatch(topEntry.name, HIGH_VALUE_HINTS),
      flagPlans: hintMatch(topEntry.name, PLANS_HINTS),
      flagLegacy: hintMatch(topEntry.name, LEGACY_OVERLAP_HINTS),
    };

    // Stack-based walker to avoid recursion depth issues on OneDrive.
    type Frame = { dir: string; depth: number };
    const stack: Frame[] = [{ dir: topPath, depth: 0 }];

    while (stack.length) {
      if (Date.now() - t0 > WALL_CLOCK_MS) {
        console.warn('WALL-CLOCK CAP HIT — aborting scan cleanly');
        aborted = true;
        break;
      }
      const frame = stack.pop()!;
      manifest.totalDirs += 1;
      tf.subdirs += 1;
      if (frame.depth > tf.deepest) tf.deepest = frame.depth;

      let dirents: fs.Dirent[];
      try {
        dirents = fs.readdirSync(frame.dir, { withFileTypes: true });
      } catch (e: any) {
        console.warn('readdir failed', frame.dir, e?.code);
        continue;
      }

      for (const d of dirents) {
        if (Date.now() - t0 > WALL_CLOCK_MS) { aborted = true; break; }
        const full = path.join(frame.dir, d.name);
        if (d.isDirectory()) {
          stack.push({ dir: full, depth: frame.depth + 1 });
          continue;
        }
        if (!d.isFile()) continue; // symlinks / junk

        let st: fs.Stats;
        try {
          st = fs.statSync(full); // stat is metadata-only, does NOT rehydrate
        } catch (e: any) {
          continue;
        }

        // Track extension
        const ext = path.extname(d.name).toLowerCase() || '(noext)';
        const bucket = manifest.extensionHistogram[ext] ?? { count: 0, bytes: 0 };
        bucket.count += 1;
        bucket.bytes += st.size;
        manifest.extensionHistogram[ext] = bucket;

        manifest.totalFiles += 1;
        manifest.totalBytes += st.size;
        tf.files += 1;
        tf.bytes += st.size;
        fileCount += 1;

        if (st.size > BIG_FILE_BYTES) {
          manifest.skippedOversizeFiles += 1;
          // Don't read; just note metadata.
        }

        // Track biggest files regardless of ext (stat only).
        bigFiles.push({
          relpath: path.relative(boxRoot, full),
          bytes: st.size,
        });
        if (bigFiles.length > 200) {
          bigFiles.sort((a, b) => b.bytes - a.bytes);
          bigFiles.length = 100;
        }

        // Defensive: never read binary contents, just in case someone later
        // changes code — we keep the ext skiplist for future-proof gating.
        if (SKIP_BINARY_EXTS.has(ext)) { /* no-op: stat already done */ }

        if (fileCount % PROGRESS_EVERY === 0) {
          const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(
            `  [${elapsedS}s] files=${fileCount}  bytes=${(manifest.totalBytes / 1e9).toFixed(2)} GB  top=${topEntry.name.slice(0, 40)}`
          );
        }
      }
    }

    manifest.topLevelFolders.push(tf);
    if (tf.flagHighValue) manifest.highValueFolders.push(tf.name);
    if (tf.flagPlans) manifest.plansFolders.push(tf.name);
    if (tf.flagLegacy) manifest.legacyOverlapFolders.push(tf.name);
  }

  bigFiles.sort((a, b) => b.bytes - a.bytes);
  manifest.biggestFiles = bigFiles.slice(0, 50);
  manifest.wallClockMs = Date.now() - t0;
  manifest.scanCompleted = !aborted;
  return manifest;
}

// ── Reporting helpers ─────────────────────────────────────────────────────────
function topNExts(
  hist: Record<string, ExtStat>,
  n: number,
): Array<{ ext: string; count: number; bytes: number }> {
  return Object.entries(hist)
    .map(([ext, s]) => ({ ext, count: s.count, bytes: s.bytes }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function buildInboxItems(m: Manifest): Array<{
  tag: string; title: string; description: string; priority: string;
}> {
  const items: Array<{ tag: string; title: string; description: string; priority: string }> = [];
  const topExts = topNExts(m.extensionHistogram, 10);
  const topFolders = [...m.topLevelFolders].sort((a, b) => b.bytes - a.bytes).slice(0, 10);

  // 1) Top-level summary
  items.push({
    tag: SOURCE_TAG_ROOT,
    title: 'DFW Box Export — 14 GB archive: filesystem sample',
    priority: 'MEDIUM',
    description: [
      `Scanned ${m.boxRoot}`,
      `Completed: ${m.scanCompleted}  walltime=${(m.wallClockMs / 1000).toFixed(1)}s`,
      `Totals: ${m.totalFiles.toLocaleString()} files, ${m.totalDirs.toLocaleString()} dirs, ` +
        `${(m.totalBytes / 1e9).toFixed(2)} GB. Oversize (>100MB) = ${m.skippedOversizeFiles}.`,
      '',
      'Top folders by size:',
      ...topFolders.map(f =>
        `  - ${f.name}  ${fmtMB(f.bytes)}  files=${f.files}  depth=${f.deepest}` +
        (f.flagHighValue ? '  [HIGH-VALUE]' : '') +
        (f.flagPlans ? '  [PLANS/CUSTOMER]' : '') +
        (f.flagLegacy ? '  [LEGACY-OVERLAP]' : ''),
      ),
      '',
      'Top extensions:',
      ...topExts.map(e => `  - ${e.ext}  count=${e.count}  ${fmtMB(e.bytes)}`),
      '',
      'Full manifest: scripts/dfw_box_export_manifest.json',
      'NOTE: files metadata-only; no content read. Re-run with targeted ETL for extraction.',
    ].join('\n'),
  });

  // 2) Pricing / financial high-value pointer
  if (m.highValueFolders.length) {
    const detail = m.topLevelFolders
      .filter(f => f.flagHighValue)
      .map(f => `  - ${f.name}  ${fmtMB(f.bytes)}  files=${f.files}`)
      .join('\n');
    items.push({
      tag: `${SOURCE_TAG_ROOT}_PRICING_FIN`,
      title: 'DFW Box Export — pricing & financial folders (future targeted ETL)',
      priority: 'HIGH',
      description: [
        'Likely contains legacy pricing sheets, P&L, bids, contracts. Worth a targeted',
        'extraction pass that only reads the .xlsx / .xlsm / .csv files inside and',
        'compares to current Aegis pricing (PRICING/ folder and builder account pricing).',
        '',
        'Folders flagged:',
        detail,
        '',
        `Source root: ${m.boxRoot}`,
      ].join('\n'),
    });
  }

  // 3) Plans / customers pointer
  if (m.plansFolders.length) {
    const detail = m.topLevelFolders
      .filter(f => f.flagPlans && !f.flagHighValue)
      .map(f => `  - ${f.name}  ${fmtMB(f.bytes)}  files=${f.files}`)
      .join('\n');
    if (detail.length) {
      items.push({
        tag: `${SOURCE_TAG_ROOT}_PLANS_CUSTOMERS`,
        title: 'DFW Box Export — plans / customer folders (extract blueprints + takeoffs)',
        priority: 'MEDIUM',
        description: [
          'Plans, blueprints, and customer-specific packages. Heavy binary (.pdf, .dwg).',
          'For future work: a PDF-only pass to build a per-builder plans index and link',
          'to Community + Plan records in Aegis.',
          '',
          'Folders flagged:',
          detail,
          '',
          `Source root: ${m.boxRoot}`,
        ].join('\n'),
      });
    }
  }

  // 4) Legacy overlap pointer — data we already have in Aegis
  if (m.legacyOverlapFolders.length) {
    const detail = m.topLevelFolders
      .filter(f => f.flagLegacy)
      .map(f => `  - ${f.name}  ${fmtMB(f.bytes)}  files=${f.files}`)
      .join('\n');
    items.push({
      tag: `${SOURCE_TAG_ROOT}_LEGACY_SKIP`,
      title: 'DFW Box Export — legacy-overlap folders (already in Aegis, SKIP)',
      priority: 'LOW',
      description: [
        'These folders look like exports from InFlow / ECI Bolt / QuickBooks /',
        'purchasing + inventory — all of which Aegis already owns as live data.',
        'Recommend NOT running a deep ETL against these; they will duplicate records.',
        'Keep as a historical archive only.',
        '',
        'Folders flagged:',
        detail,
        '',
        `Source root: ${m.boxRoot}`,
      ].join('\n'),
    });
  }

  // 5) Biggest files (if any notable ones)
  if (m.biggestFiles.length) {
    const top = m.biggestFiles.slice(0, 15)
      .map(f => `  - ${fmtMB(f.bytes).padStart(10)}  ${f.relpath}`)
      .join('\n');
    items.push({
      tag: `${SOURCE_TAG_ROOT}_BIG_FILES`,
      title: 'DFW Box Export — 15 largest files (inspect individually)',
      priority: 'LOW',
      description: [
        'Largest individual files in the archive. Worth a human eyeball to decide',
        'whether any warrant targeted extraction (e.g. a master pricing workbook)',
        'or whether they are just high-res plan PDFs / photos to leave in Box.',
        '',
        top,
      ].join('\n'),
    });
  }

  return items;
}

// ── DB write ──────────────────────────────────────────────────────────────────
async function writeInboxItems(
  items: ReturnType<typeof buildInboxItems>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    console.log('\n[DRY-RUN] Would upsert', items.length, 'InboxItems:');
    for (const it of items) {
      console.log('  -', it.tag, '→', it.title);
    }
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
      const payload = JSON.stringify({ sourceTag: it.tag, scanRoot: BOX_ROOT });
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
           VALUES (gen_random_uuid()::text, 'DATA_IMPORT', 'dfw-box-export',
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
  console.log('  DFW Box Export — filesystem sample');
  console.log('='.repeat(60));
  console.log(DRY_RUN ? '[DRY-RUN MODE] (use --commit to write InboxItems)' : '[COMMIT MODE]');
  console.log('Root:', BOX_ROOT);

  const manifest = scan(BOX_ROOT);

  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  console.log('\nManifest written:', MANIFEST_OUT);
  console.log(`Scan complete=${manifest.scanCompleted}`);
  console.log(`Totals: ${manifest.totalFiles.toLocaleString()} files, ` +
    `${(manifest.totalBytes / 1e9).toFixed(2)} GB`);
  console.log(`Top-level folders: ${manifest.topLevelFolders.length}`);
  console.log('High-value flagged:', manifest.highValueFolders.join(', ') || '(none)');
  console.log('Plans flagged:', manifest.plansFolders.join(', ') || '(none)');
  console.log('Legacy-overlap flagged:', manifest.legacyOverlapFolders.join(', ') || '(none)');

  const items = buildInboxItems(manifest);
  console.log(`\nInboxItems computed: ${items.length}`);

  if (MANIFEST_ONLY) {
    console.log('[MANIFEST-ONLY] Skipping DB write.');
    return;
  }
  await writeInboxItems(items, DRY_RUN);
  console.log('\nDONE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
