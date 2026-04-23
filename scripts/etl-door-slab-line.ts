/**
 * scripts/etl-door-slab-line.ts
 *
 * Abel Door Slab Line Business Plan — strategic-folder extraction.
 *
 * Folder: OneDrive/Abel Lumber/Abel Door Slab Line Business Plan/
 * Contents: 6 DOCX files (no XLSX/CSV/PPTX/PDF). All are narrative business
 * planning documents for a greenfield interior door slab manufacturing line at
 * Abel's Gainesville, TX site. No spreadsheets to parse — this script creates
 * pointer InboxItems per doc plus one CRITICAL summary item carrying the key
 * capex/ROI numbers extracted from the Financial Model DOCX so the numbers
 * surface in the Inbox without needing to re-open the file.
 *
 * Key findings extracted from the Financial Model doc:
 *   - Total CapEx:       ~$1.2M–$1.3M (facility $200–300K, machinery $700–900K,
 *                        auxiliary equipment $100K, contingency $100K)
 *   - Equipment budget target (Proposal doc): <$750K upfront
 *   - Capacity ramp:     5,000 slabs/month Y1 → 7,500/month Y2–3 (2-shift)
 *   - Throughput target: 35–50 slabs/hour single shift
 *   - Gross margin:      20–30% on external sales; $5–10/slab internal savings
 *   - Payback:           ~3.5 years; IRR 20–25% over 5 years
 *   - Steady-state ROI:  40–50% annual once at scale (~$500–600K net/yr)
 *   - Breakeven volume:  ~60K slabs/year covers all fixed overhead + deprec
 *   - Year 3 revenue:    ~$1.8M external + ~$200K internal cost savings
 *   - Site:              Gainesville, TX (sq ft, layout detailed in Facility doc)
 *
 * Source tag:  DOOR_SLAB_LINE_PLAN
 * Writes only: InboxItem
 *
 * Usage:
 *   tsx scripts/etl-door-slab-line.ts            (dry-run)
 *   tsx scripts/etl-door-slab-line.ts --commit   (write)
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')
const FOLDER = path.join(ROOT, 'Abel Door Slab Line Business Plan')
const SRC = 'DOOR_SLAB_LINE_PLAN'

function hashId(k: string): string {
  return 'ib_dslab_' + crypto.createHash('sha256').update(`${SRC}::${k}`).digest('hex').slice(0, 16)
}

interface Item {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact?: number
}

interface PlanDoc {
  key: string
  file: string
  title: string
  summary: string
  priority: 'HIGH' | 'MEDIUM'
}

// All 6 docs in the folder (all DOCX — no loadable spreadsheets).
const PLAN_DOCS: PlanDoc[] = [
  {
    key: 'financial-model',
    file: 'Abel Lumber Door Slab Manufacturing Expansion \u2013 Financial Model & Sales Strategy.docx',
    title: '[DOOR SLAB PLAN] Review Financial Model & Sales Strategy (capex, ROI, pricing)',
    summary:
      'Financial model for the Gainesville door slab line. Contains the $1.2–1.3M total CapEx build-up, 3.5yr payback, 20–25% IRR, capacity ramp (5k → 7.5k slabs/month), and tiered external pricing ($22–35/slab by channel). This is the numbers doc — read before any board or bank conversation about this project.',
    priority: 'HIGH',
  },
  {
    key: 'proposal',
    file: 'Abel Lumber Interior Door Slab Line Proposal.docx',
    title: '[DOOR SLAB PLAN] Review Interior Door Slab Line Proposal',
    summary:
      'Core project proposal — target 35–50 slabs/hour single shift, equipment budget <$750K upfront, focus on interior slabs. Walks the business case end-to-end; shorter than the full plan suite and suitable for initial stakeholder review.',
    priority: 'HIGH',
  },
  {
    key: 'exec-summary',
    file: 'Executive Summary - Abel Lumber Door Slab Manufacturing Expansion.docx',
    title: '[DOOR SLAB PLAN] Review Executive Summary',
    summary:
      'One-doc exec summary of the full expansion case — margin improvement, lead-time reduction, Texas demand. Use this as the opener when sharing the project with outside parties (bank, board, vendors).',
    priority: 'HIGH',
  },
  {
    key: 'facility-equipment',
    file: 'Facility and Equipment Plan \u2013 Door Slab Manufacturing Expansion (Gainesville, TX).docx',
    title: '[DOOR SLAB PLAN] Review Facility & Equipment Plan (Gainesville)',
    summary:
      'Physical buildout plan — sq ft requirements, equipment list with per-line cost ranges (panel saw $25–50K, laminating press $50–100K, CNC router $30–80K, edge bander ~$100–150K), layout, dust collection, finishing booth. This is the doc to hand the contractor and Boise/equipment vendors.',
    priority: 'HIGH',
  },
  {
    key: 'operations',
    file: 'Operations Plan for Abel Lumber\u2019s Door Slab Manufacturing Facility (Gainesville, TX).docx',
    title: '[DOOR SLAB PLAN] Review Operations Plan (staffing, sourcing, workflow)',
    summary:
      'Day-to-day operations plan — domestic lumber sourcing strategy, workflow sequencing, single- vs two-shift staffing, QC, maintenance. Largest doc (55K chars) — deep reference for whoever ends up running the plant.',
    priority: 'MEDIUM',
  },
  {
    key: 'market-analysis',
    file: 'Market Analysis for Abel Lumber\u2019s Texas Door Slab Expansion (Q3\u2013Q4 2025).docx',
    title: '[DOOR SLAB PLAN] Review Market Analysis (Texas Q3–Q4 2025)',
    summary:
      'Texas door-slab market analysis — demand drivers, competitor landscape (JELD-WEN flagged as formidable competitor with manufacturing capacity + brand), channel sizing. Supports the revenue-side of the financial model.',
    priority: 'MEDIUM',
  },
]

function build(): Item[] {
  const items: Item[] = []

  // Per-doc pointers
  for (const doc of PLAN_DOCS) {
    const fullPath = path.join(FOLDER, doc.file)
    const exists = fs.existsSync(fullPath)
    const size = exists ? fs.statSync(fullPath).size : 0
    if (!exists) {
      console.warn(`  MISSING: ${doc.file}`)
    }
    items.push({
      id: hashId(doc.key),
      type: 'AGENT_TASK',
      source: 'door-slab-line-plan',
      title: doc.title,
      description:
        `${doc.summary}\n\n` +
        `File: ${fullPath}\n` +
        `Size: ${size.toLocaleString()} bytes` +
        (exists ? '' : '\n\n[WARN: file not found at expected path]'),
      priority: doc.priority,
    })
  }

  // Consolidated CRITICAL summary item — carries the key numbers so they surface
  // in the inbox without needing to open the Financial Model doc.
  items.push({
    id: hashId('summary'),
    type: 'AGENT_TASK',
    source: 'door-slab-line-plan',
    title: '[DOOR SLAB PLAN] Decision brief — $1.2–1.3M CapEx, 3.5yr payback, Gainesville TX',
    description:
      `Consolidated decision brief for the Abel Door Slab Manufacturing Line (Gainesville, TX).\n\n` +
      `CAPEX BREAKDOWN (~$1.2M–$1.3M total):\n` +
      `  - Facility buildout (layout, flooring, ventilation, electrical): $200K–$300K\n` +
      `  - Primary machinery (saws, CNC, presses, finishing): $700K–$900K\n` +
      `  - Material handling & auxiliary (forklifts, dust, compressors): ~$100K\n` +
      `  - Contingency (10–15% of machinery): ~$100K\n` +
      `  - Proposal doc target: <$750K equipment budget upfront\n\n` +
      `CAPACITY & THROUGHPUT:\n` +
      `  - Target: 35–50 slabs/hour single shift\n` +
      `  - Year 1 steady-state: ~5,000 slabs/month (~60K/yr)\n` +
      `  - Year 2–3 with 2nd shift: 6,000–7,500/month (~90K/yr)\n` +
      `  - Only minor add-on capex (<$200K) needed to go to 2 shifts\n\n` +
      `UNIT ECONOMICS:\n` +
      `  - Avg material cost: ~$18/slab blended\n` +
      `  - Fully loaded cost: ~$33/slab at 60K/yr, ~$30/slab at 90K/yr\n` +
      `  - External avg selling price: ~$30/slab (tiers $22–35)\n` +
      `  - Gross margin external: 20–30%\n` +
      `  - Internal cost savings: $5–10/slab vs buying from vendors\n\n` +
      `RETURNS:\n` +
      `  - Breakeven volume: ~60K slabs/year\n` +
      `  - Cash payback: ~3.5 years\n` +
      `  - 5-yr IRR: 20–25%\n` +
      `  - Steady-state annual net: $500K–$600K (40–50% ROI on $1.3M)\n` +
      `  - Year 3 revenue: ~$1.8M external + ~$200K internal savings\n\n` +
      `COMPETITIVE CONTEXT (from Market Analysis doc):\n` +
      `  - JELD-WEN flagged as formidable competitor (capacity + brand)\n` +
      `  - Texas Q3–Q4 2025 demand supports plan assumptions\n\n` +
      `FOLDER: ${FOLDER}\n` +
      `6 DOCX files loaded as individual InboxItem pointers — see related items.`,
    priority: 'CRITICAL',
    financialImpact: 1300000, // total CapEx mid-point
  })

  return items
}

async function main() {
  console.log(`ETL door-slab-line-plan — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
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
            financialImpact: it.financialImpact,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact,
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
