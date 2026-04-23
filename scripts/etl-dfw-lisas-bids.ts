/**
 * scripts/etl-dfw-lisas-bids.ts
 *
 * Sample Lisa Adams's historical-bid archive inside the DFW Box Export and
 * create pointer InboxItems so her bid library is queryable from Nate's inbox
 * (for pricing negotiation reference and re-review of currently-active-builder
 * bids). Lisa is Abel's Estimator — these folders are her working files.
 *
 *   Root: C:/Users/natha/OneDrive/Abel Lumber/Abel Door & Trim_ DFW Box
 *         Export/Abel Door & Trim_ DFW/Lisa's Bids
 *   Size: ~6 GB, 727 files across 20 builder folders + 4 top-level xlsx/pdf
 *
 * Classification (from folder name + filename; no binary reads):
 *   - HISTORICAL — reference bids, value for builder-specific pricing leverage
 *   - ACTIVE     — builder is a current/prospect account (BLOOMFIELD, TOLL
 *                  BROS 2026, SHADDOCK, PERRY, TROPHY SIGNATURE, MERITAGE,
 *                  CROSS CUSTOM) — flag for re-review
 *   - LOST       — PULTE / PULTE HOMES (account lost 2026-04-20)
 *   - TEMPLATE   — filename contains "Template" — skip in counts
 *
 * Top builders by file count:
 *   YARDLY (337), SHADDOCK HOMES (89), BLOOMFIELD HOMES (84),
 *   OLERIO HOMES (44), TOLL BROS 2026 (35), IMAGINATION HOMES (35),
 *   NATE TOLL BROS (22), DAVIDSON HOMES (19)
 *
 * Target table: InboxItem only. No src/**, prisma/**, Builder / Product /
 * Inventory / Vendor / BuilderPriceSheet writes.
 *
 * Source tag:  DFW_LISA_BIDS_SAMPLE
 * Scope:       1 folder-summary + top-5 per-builder pointers + 1
 *              active-re-review roll-up = 7 InboxItems (fits the 5-8 budget).
 * Idempotency: deterministic ids (`dfw-lisa-bids-{slug}`), upsert pattern.
 * Safety:      readdir / statSync only. No file contents read.
 *
 * Usage:
 *   npx tsx scripts/etl-dfw-lisas-bids.ts            # dry-run (default)
 *   npx tsx scripts/etl-dfw-lisas-bids.ts --commit   # write
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'DFW_LISA_BIDS_SAMPLE'
const MAX_WALL_MS = 5 * 60 * 1000

const ROOT =
  'C:/Users/natha/OneDrive/Abel Lumber/Abel Door & Trim_ DFW Box Export/' +
  "Abel Door & Trim_ DFW/Lisa's Bids"

// Builders we want to re-review — Abel has live / prospect activity with
// these accounts as of 2026-04. Anything named PULTE stays excluded (lost).
const ACTIVE_BUILDER_FOLDERS = new Set<string>([
  'BLOOMFIELD HOMES',
  'TOLL BROS 2026',
  'NATE TOLL BROS',
  'SHADDOCK HOMES',
  'PERRY HOMES',
  'TROPHY SIGNATURE',
  'MERITAGE BIDS 10.7',
  'Cross Custom Homes-MINNERLY HOME-',
])

const LOST_BUILDER_FOLDERS = new Set<string>(['PULTE', 'PULTE HOMES'])

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Filesystem walk — readdir + statSync only. No binary reads.
// ---------------------------------------------------------------------------

type FolderStats = {
  folder: string // e.g. "YARDLY"
  fileCount: number
  totalBytes: number
  templateCount: number
  newestMtime: Date | null
  oldestMtime: Date | null
  subfolderCount: number
  sampleFiles: string[] // up to 8 filenames for the pointer
  sampleSubfolders: string[] // up to 6 immediate subfolder names
  deadlineEnd: Date
}

function walk(dir: string, stats: {
  fileCount: number
  totalBytes: number
  templateCount: number
  newestMtime: Date | null
  oldestMtime: Date | null
  sampleFiles: string[]
  deadlineEnd: Date
}) {
  if (Date.now() > stats.deadlineEnd.getTime()) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (Date.now() > stats.deadlineEnd.getTime()) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(full, stats)
    } else if (e.isFile()) {
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      stats.fileCount += 1
      stats.totalBytes += st.size
      if (/template/i.test(e.name)) stats.templateCount += 1
      const mt = st.mtime
      if (!stats.newestMtime || mt > stats.newestMtime) stats.newestMtime = mt
      if (!stats.oldestMtime || mt < stats.oldestMtime) stats.oldestMtime = mt
      if (stats.sampleFiles.length < 8) stats.sampleFiles.push(e.name)
    }
  }
}

function summarizeFolder(folderAbs: string, folderName: string, deadlineEnd: Date): FolderStats {
  const s: FolderStats = {
    folder: folderName,
    fileCount: 0,
    totalBytes: 0,
    templateCount: 0,
    newestMtime: null,
    oldestMtime: null,
    subfolderCount: 0,
    sampleFiles: [],
    sampleSubfolders: [],
    deadlineEnd,
  }
  try {
    const top = fs.readdirSync(folderAbs, { withFileTypes: true })
    for (const e of top) {
      if (e.isDirectory()) {
        s.subfolderCount += 1
        if (s.sampleSubfolders.length < 6) s.sampleSubfolders.push(e.name)
      }
    }
  } catch {}
  walk(folderAbs, s)
  return s
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// ---------------------------------------------------------------------------
// InboxItem upsert
// ---------------------------------------------------------------------------

async function upsertInbox(
  id: string,
  data: {
    title: string
    description: string
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    actionData: any
  },
) {
  if (DRY_RUN) {
    console.log(`\n[dry] InboxItem ${id} (${data.priority})`)
    console.log(`  title: ${data.title}`)
    console.log(`  desc[0..200]: ${data.description.slice(0, 200).replace(/\n/g, ' / ')}`)
    return
  }
  await prisma.inboxItem.upsert({
    where: { id },
    create: {
      id,
      type: 'AGENT_TASK',
      source: SOURCE_TAG,
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      entityType: 'BidArchive',
      entityId: SOURCE_TAG,
      actionData: data.actionData,
    },
    update: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      actionData: data.actionData,
    },
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startMs = Date.now()
  const deadline = new Date(startMs + MAX_WALL_MS)
  console.log(`[dfw-lisa-bids] root=${ROOT}`)
  console.log(`[dfw-lisa-bids] mode=${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  if (!fs.existsSync(ROOT)) {
    throw new Error(`Lisa's Bids root not found: ${ROOT}`)
  }

  const top = fs.readdirSync(ROOT, { withFileTypes: true })
  const builderFolders = top.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const topLevelFiles = top.filter((e) => e.isFile()).map((e) => e.name).sort()

  // Summarize each builder folder.
  const perBuilder: FolderStats[] = []
  for (const name of builderFolders) {
    if (Date.now() > deadline.getTime()) {
      console.log(`[dfw-lisa-bids] wall clock reached; stopping walk at ${name}`)
      break
    }
    const stats = summarizeFolder(path.join(ROOT, name), name, deadline)
    perBuilder.push(stats)
  }

  const totalFiles = perBuilder.reduce((a, b) => a + b.fileCount, 0) + topLevelFiles.length
  const totalBytes = perBuilder.reduce((a, b) => a + b.totalBytes, 0)

  console.log(`[dfw-lisa-bids] builders=${perBuilder.length} totalFiles=${totalFiles} totalSize=${humanBytes(totalBytes)}`)

  // -------------------------------------------------------------------------
  // 1) Folder summary InboxItem
  // -------------------------------------------------------------------------

  const rankLines = [...perBuilder]
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 10)
    .map(
      (b, i) =>
        `  ${String(i + 1).padStart(2)}. ${b.folder} — ${b.fileCount} files, ` +
        `${humanBytes(b.totalBytes)}` +
        (ACTIVE_BUILDER_FOLDERS.has(b.folder) ? '  [ACTIVE]' : LOST_BUILDER_FOLDERS.has(b.folder) ? '  [LOST]' : ''),
    )
    .join('\n')

  await upsertInbox('dfw-lisa-bids-summary', {
    title: `Lisa's Bids archive sampled — ${perBuilder.length} builder folders, ${totalFiles} files, ${humanBytes(totalBytes)}`,
    description: [
      `Lisa Adams's historical bid archive inside the DFW Box Export has been`,
      `scanned (readdir/statSync only — no file contents read). Use this as the`,
      `index for builder-specific pricing reference and proposal staging.`,
      ``,
      `Root: ${ROOT}`,
      `Top-level loose files (${topLevelFiles.length}): ${topLevelFiles.slice(0, 6).join(', ')}${topLevelFiles.length > 6 ? ', …' : ''}`,
      ``,
      `Top builders by file count:`,
      rankLines,
      ``,
      `Next actions:`,
      `  - Pull historical bid prices per builder as reference for live`,
      `    negotiations (esp. Bloomfield, Toll Bros, Shaddock).`,
      `  - Re-review active-builder folders (see companion inbox item).`,
      `  - Skip bid-template files (filename contains "Template").`,
    ].join('\n'),
    priority: 'MEDIUM',
    actionData: {
      sourceTag: SOURCE_TAG,
      root: ROOT,
      totalFiles,
      totalBytes,
      builderCount: perBuilder.length,
      topLevelFiles,
      builders: perBuilder.map((b) => ({
        folder: b.folder,
        fileCount: b.fileCount,
        totalBytes: b.totalBytes,
        subfolderCount: b.subfolderCount,
      })),
    },
  })

  // -------------------------------------------------------------------------
  // 2) Per-builder pointer items for top 5 by file count
  // -------------------------------------------------------------------------

  const top5 = [...perBuilder].sort((a, b) => b.fileCount - a.fileCount).slice(0, 5)

  for (const b of top5) {
    const isActive = ACTIVE_BUILDER_FOLDERS.has(b.folder)
    const isLost = LOST_BUILDER_FOLDERS.has(b.folder)
    const priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = isActive ? 'HIGH' : isLost ? 'LOW' : 'MEDIUM'
    const status = isActive ? 'ACTIVE' : isLost ? 'LOST' : 'HISTORICAL'

    await upsertInbox(`dfw-lisa-bids-builder-${slug(b.folder)}`, {
      title: `${b.folder} — ${b.fileCount} bid files (${humanBytes(b.totalBytes)})  [${status}]`,
      description: [
        `Pointer into Lisa's Bids sub-folder for ${b.folder}.`,
        ``,
        `Path: ${path.join(ROOT, b.folder)}`,
        `Files: ${b.fileCount}  Size: ${humanBytes(b.totalBytes)}  Subfolders: ${b.subfolderCount}  Templates: ${b.templateCount}`,
        b.oldestMtime ? `Mtime range: ${b.oldestMtime.toISOString().slice(0, 10)} … ${b.newestMtime?.toISOString().slice(0, 10)}` : '',
        ``,
        `Sample subfolders: ${b.sampleSubfolders.join(' | ') || '(none)'}`,
        `Sample files: ${b.sampleFiles.slice(0, 6).join(' | ')}`,
        ``,
        isActive
          ? `STATUS: ACTIVE — re-review these bids against current pricing before` +
            `\nnext proposal/quote round. Cross-check with memory/customers/${slug(b.folder)}.md.`
          : isLost
          ? `STATUS: LOST — Pulte account closed 2026-04-20. Keep as historical` +
            `\nreference only; do not re-engage without owner approval.`
          : `STATUS: HISTORICAL — use as reference when negotiating pricing or` +
            `\nresponding to re-bid requests from this builder.`,
      ].filter(Boolean).join('\n'),
      priority,
      actionData: {
        sourceTag: SOURCE_TAG,
        builderFolder: b.folder,
        status,
        fileCount: b.fileCount,
        totalBytes: b.totalBytes,
        subfolderCount: b.subfolderCount,
        templateCount: b.templateCount,
        sampleFiles: b.sampleFiles,
        sampleSubfolders: b.sampleSubfolders,
        newestMtime: b.newestMtime?.toISOString() ?? null,
        oldestMtime: b.oldestMtime?.toISOString() ?? null,
      },
    })
  }

  // -------------------------------------------------------------------------
  // 3) Active-builder roll-up (re-review flag)
  // -------------------------------------------------------------------------

  const activeMatches = perBuilder.filter((b) => ACTIVE_BUILDER_FOLDERS.has(b.folder))
  const activeFiles = activeMatches.reduce((a, b) => a + b.fileCount, 0)
  const activeBytes = activeMatches.reduce((a, b) => a + b.totalBytes, 0)

  await upsertInbox('dfw-lisa-bids-active-review', {
    title: `Re-review active-builder bids — ${activeMatches.length} folders, ${activeFiles} files`,
    description: [
      `These sub-folders of Lisa's Bids belong to builders with live or prospect`,
      `status as of 2026-04. Content may still be in play for ongoing proposals.`,
      `Treat as "pull and reconcile against current pricing," not archive.`,
      ``,
      `Active folders flagged:`,
      ...activeMatches.map(
        (b) => `  - ${b.folder} — ${b.fileCount} files, ${humanBytes(b.totalBytes)}`,
      ),
      ``,
      `Total: ${activeFiles} files, ${humanBytes(activeBytes)}`,
      ``,
      `Owner: Lisa Adams (Estimator). Coordinate with Dalton / Clint before`,
      `acting on any of these bids externally.`,
    ].join('\n'),
    priority: 'HIGH',
    actionData: {
      sourceTag: SOURCE_TAG,
      activeFolders: activeMatches.map((b) => ({
        folder: b.folder,
        fileCount: b.fileCount,
        totalBytes: b.totalBytes,
      })),
      totalFiles: activeFiles,
      totalBytes: activeBytes,
    },
  })

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  console.log(`[dfw-lisa-bids] done in ${elapsed}s (mode=${DRY_RUN ? 'DRY-RUN' : 'COMMIT'})`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
