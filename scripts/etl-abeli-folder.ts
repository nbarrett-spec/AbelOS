/**
 * scripts/etl-abeli-folder.ts
 *
 * ABELI_FOLDER — classify and index the contents of
 *   "C:/Users/natha/OneDrive/Abel Lumber/ABELi/"
 *
 * Findings
 * --------
 *   The folder contains a SINGLE file:
 *     - "Technical Blueprint for Abel Lumber\u2019s Internal AI Assistant.docx"  (41 KB, 2025-04-25)
 *
 *   Inferred purpose: LEGACY / HISTORICAL design document.
 *   Internal codename "ABELi v1" — a April-2025 proposal for a GPT-based
 *   internal AI assistant (LangChain orchestrator, Notion front-end,
 *   inFlow + QuickBooks + Spruce integrations, Replit/Render hosting).
 *   Predates and has been SUPERSEDED by the two production systems now in use:
 *     1) Abel OS / Aegis  (app.abellumber.com, Next.js, went live 2026-04-13)
 *     2) NUC AI Engine    (Master NUC cluster, coordinator online at 100.84.113.47)
 *
 *   Value: reference only — captures earlier architectural thinking that
 *   informed the current stack. NOT an active project. No pricing, builder,
 *   vendor, or financial data in the doc.
 *
 * What this ETL does
 * ------------------
 *   - Enumerates the ABELi/ folder (classification + size report).
 *   - Creates a SINGLE pointer InboxItem (MEDIUM priority — historical only,
 *     not time-sensitive, no dollars at stake).
 *   - Does NOT extract content from the .docx (proprietary file type per
 *     project constraints; content preview only used for classification).
 *   - Does NOT create Builder / Product / Vendor / Community rows.
 *
 * Usage
 * -----
 *   npx tsx scripts/etl-abeli-folder.ts            # DRY-RUN (default)
 *   npx tsx scripts/etl-abeli-folder.ts --commit   # persist to DB
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

const DRY_RUN = !process.argv.includes('--commit')
const SRC_TAG = 'ABELI_FOLDER'

const ABELI_DIR = 'C:/Users/natha/OneDrive/Abel Lumber/ABELi/'

function hashId(k: string): string {
  return 'abeli_' + crypto.createHash('sha256').update(`${SRC_TAG}::${k}`).digest('hex').slice(0, 18)
}

type FileEntry = {
  name: string
  fullPath: string
  sizeBytes: number
  ext: string
  modified: string
}

function enumerate(dir: string): FileEntry[] {
  const out: FileEntry[] = []
  function walk(d: string) {
    if (!fs.existsSync(d)) return
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        const st = fs.statSync(full)
        out.push({
          name: entry.name,
          fullPath: full.replace(/\\/g, '/'),
          sizeBytes: st.size,
          ext: (path.extname(entry.name) || '').toLowerCase(),
          modified: st.mtime.toISOString(),
        })
      }
    }
  }
  walk(dir)
  return out
}

type Item = {
  key: string
  type: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact?: number | null
  dueBy?: Date | null
  actionData: Record<string, unknown>
}

async function main() {
  console.log(`ETL ABELi Folder — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SRC_TAG}`)
  console.log(`Source dir: ${ABELI_DIR}`)
  console.log()

  // ---------------------------------------------------------------------
  // 1) Enumerate + classify
  // ---------------------------------------------------------------------
  const files = enumerate(ABELI_DIR)
  const totalBytes = files.reduce((a, f) => a + f.sizeBytes, 0)
  const byExt = files.reduce<Record<string, { count: number; bytes: number }>>((acc, f) => {
    const k = f.ext || '(none)'
    acc[k] = acc[k] || { count: 0, bytes: 0 }
    acc[k].count += 1
    acc[k].bytes += f.sizeBytes
    return acc
  }, {})

  console.log(`Files: ${files.length}    Total: ${(totalBytes / 1024).toFixed(1)} KB`)
  console.log(`By extension:`)
  for (const [ext, v] of Object.entries(byExt)) {
    console.log(`  ${ext.padEnd(8)} count=${v.count}   bytes=${v.bytes}`)
  }
  console.log(`File list:`)
  for (const f of files) {
    console.log(`  - ${f.name}   (${(f.sizeBytes / 1024).toFixed(1)} KB, mod ${f.modified.slice(0, 10)})`)
  }
  console.log()

  // ---------------------------------------------------------------------
  // 2) Build InboxItem (single pointer — classification only, no extract)
  // ---------------------------------------------------------------------
  const items: Item[] = []

  if (files.length === 0) {
    console.log('Folder is empty. Nothing to index. Done.')
    return
  }

  // Classification decision:
  //   - Single .docx, 41 KB, filename "Technical Blueprint for Abel Lumber's
  //     Internal AI Assistant" + internal codename "ABELi v1".
  //   - Content preview confirms: April-2025 design doc for GPT/LangChain
  //     assistant — predates the current Abel OS (live 2026-04-13) and the
  //     NUC AI Engine. No live data, no dollar values, no decisions pending.
  //   - Priority MEDIUM (not CRITICAL or HIGH): reference / historical only.
  //     Useful only if someone revisits the earlier design thinking.
  items.push({
    key: 'abeli-v1-blueprint-pointer',
    type: 'SYSTEM',
    title: '[POINTER] ABELi v1 Technical Blueprint (April 2025) — legacy AI-assistant design doc',
    description:
      'Pointer record for the ABELi/ folder on OneDrive. The folder contains a single file: ' +
      '"Technical Blueprint for Abel Lumber\u2019s Internal AI Assistant.docx" (41 KB, modified ' +
      '2025-04-25). Internal codename "ABELi v1" — an April-2025 proposal for a GPT-based internal ' +
      'AI assistant built on LangChain, fronted by Notion, with integrations to inFlow / QuickBooks ' +
      '/ Spruce, targeted for Replit + Render hosting. SUPERSEDED by the two production systems now ' +
      'in use: (1) Abel OS / Aegis (app.abellumber.com, Next.js, went live 2026-04-13) and (2) the ' +
      'NUC AI Engine (Master NUC cluster, coordinator online at 100.84.113.47). Kept for historical ' +
      'reference only — captures earlier architectural thinking. No pricing, no builder data, no ' +
      'financial info. Content deliberately NOT extracted into the inbox (proprietary .docx format, ' +
      'and no active decisions depend on it). Revisit only if doing a retrospective on how the AI ' +
      'strategy evolved from v1 to today.',
    priority: 'MEDIUM',
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'pointer',
      classification: 'LEGACY_DESIGN_DOC',
      folderPath: ABELI_DIR,
      fileCount: files.length,
      totalBytes,
      filesByExt: byExt,
      files: files.map((f) => ({
        name: f.name,
        path: f.fullPath,
        sizeBytes: f.sizeBytes,
        ext: f.ext,
        modified: f.modified,
      })),
      extractedContent: false,
      supersededBy: ['Abel OS (Aegis)', 'NUC AI Engine'],
      supersedingSystems: {
        abelOs: { url: 'https://app.abellumber.com', goLive: '2026-04-13' },
        nucEngine: { coordinatorIp: '100.84.113.47', status: 'coordinator online; 4 workers built not provisioned' },
      },
      retainReason: 'historical / architectural-evolution reference only',
    },
  })

  console.log(`Items to upsert: ${items.length} (cap: 3)`)
  for (const it of items) {
    console.log(`  + ${it.priority.padEnd(6)} ${it.title}`)
  }
  console.log()

  if (items.length > 3) {
    throw new Error(`Cap exceeded: ${items.length} > 3`)
  }

  if (DRY_RUN) {
    console.log('DRY-RUN — re-run with --commit to persist.')
    return
  }

  const prisma = new PrismaClient()
  try {
    let created = 0
    let updated = 0
    for (const it of items) {
      const id = hashId(it.key)
      const res = await prisma.inboxItem.upsert({
        where: { id },
        create: {
          id,
          type: it.type,
          source: 'abeli-folder',
          title: it.title,
          description: it.description,
          priority: it.priority,
          status: 'PENDING',
          financialImpact: it.financialImpact ?? null,
          dueBy: it.dueBy ?? null,
          actionData: it.actionData as any,
        },
        update: {
          title: it.title,
          description: it.description,
          priority: it.priority,
          financialImpact: it.financialImpact ?? null,
          dueBy: it.dueBy ?? null,
          actionData: it.actionData as any,
        },
        select: { createdAt: true, updatedAt: true },
      })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
      else updated++
    }
    console.log(`InboxItems: created=${created} updated=${updated}`)
    console.log('DONE.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
