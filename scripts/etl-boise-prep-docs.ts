/**
 * scripts/etl-boise-prep-docs.ts
 *
 * Boise Cascade 4/28/2026 meeting — prep-doc pointer load.
 *
 * The 3 XLSX workbooks in the Boise Cascade Negotiation Package were already
 * parsed into InboxItems by etl-urgent-items.ts and etl-urgent-v2.ts (SKU
 * pricing, invoices due, statement vs InFlow receipt audit).
 *
 * The remaining prep materials are DOCX/PDF/HTML — binary/rendered formats we
 * don't need to parse. Nate just needs reminder pointers that surface in the
 * inbox ahead of the 4/28 meeting. This script creates one InboxItem per prep
 * doc (path + title + due date) plus one consolidated "prep checklist" item.
 *
 * Source tag:   BOISE_MEETING_PREP_APR2026
 * Due:          2026-04-28
 *
 * Usage:
 *   tsx scripts/etl-boise-prep-docs.ts            (dry-run)
 *   tsx scripts/etl-boise-prep-docs.ts --commit   (write)
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')
const FOLDER = path.join(ROOT, 'Boise Cascade Negotiation Package')
const SRC = 'BOISE_MEETING_PREP_APR2026'
const DUE = new Date('2026-04-28T12:00:00Z')

function hashId(k: string): string {
  return 'ib_bprep_' + crypto.createHash('sha256').update(`${SRC}::${k}`).digest('hex').slice(0, 16)
}

interface Item {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  dueBy: Date
}

interface PrepDoc {
  key: string
  file: string
  title: string
  summary: string
  priority: 'CRITICAL' | 'HIGH'
}

// Remaining prep docs (DOCX / PDF / HTML). XLSX files intentionally omitted —
// already loaded via etl-urgent-items.ts + etl-urgent-v2.ts.
const PREP_DOCS: PrepDoc[] = [
  {
    key: 'exec-summary',
    file: '01_Executive_Summary.docx',
    title: '[BOISE 4/28 PREP] Review Executive Summary before meeting',
    summary:
      'Executive summary for the 4/28 Boise Cascade negotiation — the top-line narrative Nate walks in with. Read first; it frames every other prep doc.',
    priority: 'HIGH',
  },
  {
    key: 'market-research',
    file: '03_Market_Research_Brief.docx',
    title: '[BOISE 4/28 PREP] Review Market Research Brief before meeting',
    summary:
      'Market research brief — competitive pricing benchmarks, supplier landscape, and leverage points for the Boise negotiation.',
    priority: 'HIGH',
  },
  {
    key: 'talking-points',
    file: '04_Meeting_Prep_Talking_Points.docx',
    title: '[BOISE 4/28 PREP] Review Meeting Prep Talking Points doc before 4/28',
    summary:
      'Talking points for the 4/28 meeting — the specific asks, objection handling, and concessions. This is the doc Nate should have open during the meeting.',
    priority: 'CRITICAL',
  },
  {
    key: 'data-quality-audit',
    file: '05_Data_Quality_Audit.pdf',
    title: '[BOISE 4/28 PREP] Review Data Quality Audit PDF',
    summary:
      'Data quality audit across Boise-supplied SKUs, pricing, and receipts. Catches bad data that could embarrass us at the table if we quote the wrong number.',
    priority: 'HIGH',
  },
  {
    key: 'dashboard',
    file: '06_Interactive_Pricing_Dashboard.html',
    title: '[BOISE 4/28 PREP] Open Interactive Pricing Dashboard (HTML) for live reference',
    summary:
      'Interactive HTML dashboard of per-SKU pricing asks. Open in browser during call for quick lookup. Backs the per-SKU asks already loaded from 02_SKU_Pricing_Analysis_v2.xlsx.',
    priority: 'HIGH',
  },
  {
    key: 'credit-line',
    file: '07_Credit_Line_Increase_Justification.docx',
    title: '[BOISE 4/28 PREP] Review Credit Line Increase Justification doc',
    summary:
      'Justification package for asking Boise to increase Abel\'s credit line. Read alongside Hancock Whitney pitch — same AMP spend narrative.',
    priority: 'HIGH',
  },
  {
    key: 'pipeline-antonio-pdf',
    file: '08_Pipeline_Snapshot_for_Antonio_LC.pdf',
    title: '[BOISE 4/28 PREP] Pipeline Snapshot for Antonio (PDF) — hand-leave version',
    summary:
      'Pipeline snapshot prepared specifically for Antonio LC at Boise. PDF version suitable for emailing/leaving behind. Shows forward AMP demand justifying pricing + credit asks.',
    priority: 'HIGH',
  },
  {
    key: 'pipeline-antonio-html',
    file: '08_Pipeline_Snapshot_for_Antonio_LC.html',
    title: '[BOISE 4/28 PREP] Pipeline Snapshot for Antonio (HTML) — interactive version',
    summary:
      'Interactive HTML version of the pipeline snapshot for Antonio. Better for live walk-through on screen; PDF is for leave-behind.',
    priority: 'HIGH',
  },
]

function build(): Item[] {
  const items: Item[] = []

  // Per-doc pointers
  for (const doc of PREP_DOCS) {
    const fullPath = path.join(FOLDER, doc.file)
    const exists = fs.existsSync(fullPath)
    if (!exists) {
      console.warn(`  MISSING: ${doc.file}`)
    }
    items.push({
      id: hashId(doc.key),
      type: 'ACTION_REQUIRED',
      source: 'boise-meeting-prep',
      title: doc.title,
      description: `${doc.summary}\n\nFile: ${fullPath}${exists ? '' : '\n\n[WARN: file not found at expected path]'}`,
      priority: doc.priority,
      dueBy: DUE,
    })
  }

  // One consolidated prep-checklist item
  const coreDocs = [
    '04_Meeting_Prep_Talking_Points.docx (talking points)',
    '03_Market_Research_Brief.docx (market research)',
    '01_Executive_Summary.docx (executive summary)',
    '07_Credit_Line_Increase_Justification.docx (credit line ask)',
  ]
  items.push({
    id: hashId('checklist'),
    type: 'ACTION_REQUIRED',
    source: 'boise-meeting-prep',
    title: '[BOISE 4/28 PREP] Prep checklist — open these 4 docs before the Boise meeting',
    description:
      `Consolidated prep checklist for the 4/28 Boise Cascade meeting. Minimum required reading:\n\n` +
      coreDocs.map((d, i) => `  ${i + 1}. ${d}`).join('\n') +
      `\n\nAll 4 live in: ${FOLDER}\n\n` +
      `Supporting data (already loaded as separate InboxItems):\n` +
      `  - 02_SKU_Pricing_Analysis_v2.xlsx (46 per-SKU asks)\n` +
      `  - Boise_Cascade_Invoices_Due_04-20-2026.xlsx (94 invoices due)\n` +
      `  - Boise_Statement_vs_InFlow_Receipt_Audit_v2.xlsx (reconciliation)\n\n` +
      `Also handy during the meeting: 06_Interactive_Pricing_Dashboard.html, ` +
      `08_Pipeline_Snapshot_for_Antonio_LC.html/pdf.`,
    priority: 'CRITICAL',
    dueBy: DUE,
  })

  return items
}

async function main() {
  console.log(`ETL boise-prep-docs — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Folder: ${FOLDER}`)
  const items = build()
  console.log(`\n${items.length} InboxItem(s) to upsert:`)
  for (const it of items) {
    console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 100)}`)
  }
  if (DRY_RUN) {
    console.log('\nDRY-RUN — re-run with --commit to write.')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of items) {
      try {
        const res = await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            dueBy: it.dueBy,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            dueBy: it.dueBy,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
        else updated++
      } catch (e) {
        failed++
        console.error('  FAIL:', (e as Error).message.slice(0, 160))
      }
    }
    console.log(`\nCommitted: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
