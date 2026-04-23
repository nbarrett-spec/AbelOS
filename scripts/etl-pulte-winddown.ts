/**
 * scripts/etl-pulte-winddown.ts
 *
 * Pulte account was confirmed LOST on 2026-04-20 (Treeline -> 84 Lumber;
 * Mobberly moved in March; in-person meeting declined). 21 open POs
 * totaling ~$32.5K remain in cancel/reduce queue.
 *
 * This ETL is a FLAG-ONLY wind-down: it creates `InboxItem` rows so Nate
 * and Thomas can act on each PO from the inbox UI. It does NOT modify any
 * Order / PurchaseOrder / Deal / Builder rows. Other agents own those.
 *
 * Source:
 *   ../Pulte_PO_Impact_For_Thomas.xlsx
 *     - Sheet "Summary" — list of 15 CANCEL + 6 REDUCE POs (read from the
 *       section headers below the two subtotal rows).
 *     - Sheet "Line Detail" — per-line breakdown rolled into each PO item.
 *   ../BWP_Pulte_CRM_Export_April2026.xlsx (CRM state / deal context only)
 *   ../BWP_Pulte_Complete_Export_April2026.xlsx (narrative / strategy)
 *   ../BWP_Pulte_PM_Portal_Data.xlsx (narrative / schedules)
 *
 * Only Pulte_PO_Impact_For_Thomas.xlsx drives flagged action items. The
 * other three are reference documents that support the wind-down story
 * but do not yield InboxItems.
 *
 * Output InboxItems:
 *   - source       = 'pulte-winddown'   (tag; stable)
 *   - type         = 'PO_APPROVAL'      (matches existing inbox type enum)
 *   - entityType   = 'PurchaseOrder'    (PO-scoped) | 'Deal' (summary item)
 *   - entityId     = PO number (e.g. 'PO-003730') or 'PULTE-DEAL-WINDDOWN'
 *   - priority     = CRITICAL ($>=2500) | HIGH ($>=500) | MEDIUM (<$500)
 *                    Summary deal-closure item = HIGH.
 *
 * Idempotency: upsert on (source, entityType, entityId). Re-runs update
 * mutable fields in place; no duplicates.
 *
 * Modes:
 *   (default)  DRY-RUN — prints plan, writes nothing.
 *   --commit   applies upserts.
 *
 * Usage:
 *   npx tsx scripts/etl-pulte-winddown.ts
 *   npx tsx scripts/etl-pulte-winddown.ts --commit
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'pulte-winddown'
const ABEL_FOLDER = path.resolve(__dirname, '..', '..')
const IMPACT_FILE = path.join(ABEL_FOLDER, 'Pulte_PO_Impact_For_Thomas.xlsx')
const WINDDOWN_CONFIRMED_DATE = '2026-04-20'

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface PoRow {
  poNumber: string
  vendor: string
  action: 'CANCEL' | 'REDUCE'
  poTotal: number // full PO total for CANCEL, Pulte-portion total for REDUCE
  fullPoTotal: number | null // only set for REDUCE (may differ from pulte portion)
  linkedPulteSOs: string
  nonPulteSOs: string // only for REDUCE
  numLines: number
  lines: LineRow[]
}

interface LineRow {
  poNumber: string
  action: string
  vendor: string
  product: string
  sku: string
  qty: number
  subtotal: number
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-')
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function priorityFor(amount: number): Priority {
  if (amount >= 2500) return 'CRITICAL'
  if (amount >= 500) return 'HIGH'
  return 'MEDIUM'
}

function readImpactFile(): { pos: PoRow[]; totals: { cancelCount: number; cancelTotal: number; reduceCount: number; reduceTotal: number } } {
  if (!fs.existsSync(IMPACT_FILE)) {
    throw new Error(`Required file missing: ${IMPACT_FILE}`)
  }
  const wb = XLSX.readFile(IMPACT_FILE, { cellDates: true })
  const summary = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets['Summary'], { header: 1, defval: null })
  const detail = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets['Line Detail'], { header: 1, defval: null })

  // Parse header totals (rows 3,4,5 in 0-indexed terms)
  const cancelTotalRow = summary[3] as unknown[]
  const reduceTotalRow = summary[4] as unknown[]
  const cancelCount = parseInt(String(cancelTotalRow?.[2] ?? '').replace(/\D/g, '')) || 0
  const cancelTotal = toNum(cancelTotalRow?.[3])
  const reduceCount = parseInt(String(reduceTotalRow?.[2] ?? '').replace(/\D/g, '')) || 0
  const reduceTotal = toNum(reduceTotalRow?.[3])

  // Section 1 (CANCEL): header at row 7/8, data rows 9..23 (inclusive)
  // Section 2 (REDUCE): header at row 26/27, data rows 28..33
  const cancelRows: PoRow[] = []
  const reduceRows: PoRow[] = []

  for (let i = 9; i < summary.length; i++) {
    const r = summary[i] as unknown[]
    const po = toStr(r?.[0])
    if (!po || !po.startsWith('PO-')) continue
    if (po === 'SUBTOTAL') continue
    cancelRows.push({
      poNumber: po,
      vendor: toStr(r[1]),
      action: 'CANCEL',
      poTotal: toNum(r[2]),
      fullPoTotal: null,
      linkedPulteSOs: toStr(r[3]),
      nonPulteSOs: '',
      numLines: toNum(r[4]) || 0,
      lines: [],
    })
    if (cancelRows.length >= 15) break
  }

  for (let i = 28; i < summary.length; i++) {
    const r = summary[i] as unknown[]
    const po = toStr(r?.[0])
    if (!po || !po.startsWith('PO-')) continue
    reduceRows.push({
      poNumber: po,
      vendor: toStr(r[1]),
      action: 'REDUCE',
      poTotal: toNum(r[3]), // Pulte portion
      fullPoTotal: toNum(r[2]), // full PO total
      linkedPulteSOs: toStr(r[4]),
      nonPulteSOs: toStr(r[5]),
      numLines: toNum(r[6]) || 0,
      lines: [],
    })
    if (reduceRows.length >= 6) break
  }

  // Build a line-detail map keyed by PO number
  const lineMap = new Map<string, LineRow[]>()
  for (let i = 3; i < detail.length; i++) {
    const r = detail[i] as unknown[]
    const po = toStr(r?.[0])
    if (!po || !po.startsWith('PO-')) continue
    const line: LineRow = {
      poNumber: po,
      action: toStr(r[1]),
      vendor: toStr(r[2]),
      product: toStr(r[3]),
      sku: toStr(r[4]),
      qty: toNum(r[5]),
      subtotal: toNum(r[6]),
    }
    const arr = lineMap.get(po) ?? []
    arr.push(line)
    lineMap.set(po, arr)
  }

  const allPos = [...cancelRows, ...reduceRows]
  for (const po of allPos) po.lines = lineMap.get(po.poNumber) ?? []

  return {
    pos: allPos,
    totals: { cancelCount, cancelTotal, reduceCount, reduceTotal },
  }
}

// Raw SQL throughout: this Neon DB is missing `InboxItem.brainAcknowledgedAt`
// which the generated Prisma client expects (see etl-improvement-plan.ts for
// the same workaround). Listing columns explicitly sidesteps the drift.
function cuidish(): string {
  return 'c' + crypto.randomBytes(12).toString('hex')
}

async function upsertInboxItem(
  prisma: PrismaClient,
  args: {
    entityType: string
    entityId: string
    type: string
    title: string
    description: string
    priority: Priority
    financialImpact: number | null
    actionData: Record<string, unknown>
  },
): Promise<'created' | 'updated' | 'skipped'> {
  type ExistingRow = { id: string; status: string }
  const existing = await prisma.$queryRawUnsafe<ExistingRow[]>(
    `SELECT id, status FROM "InboxItem"
       WHERE source = $1 AND "entityType" = $2 AND "entityId" = $3
       LIMIT 1`,
    SOURCE_TAG,
    args.entityType,
    args.entityId,
  )
  const hit = existing[0]

  if (DRY_RUN) {
    return hit ? (isResolved(hit.status) ? 'skipped' : 'updated') : 'created'
  }

  if (hit) {
    if (isResolved(hit.status)) return 'skipped'
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
         SET type = $1,
             title = $2,
             description = $3,
             priority = $4,
             "financialImpact" = $5,
             "actionData" = $6::jsonb,
             "updatedAt" = NOW()
         WHERE id = $7`,
      args.type,
      args.title,
      args.description,
      args.priority,
      args.financialImpact,
      JSON.stringify(args.actionData),
      hit.id,
    )
    return 'updated'
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem"
       (id, type, source, title, description, priority, status,
        "entityType", "entityId", "financialImpact", "actionData",
        "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())`,
    cuidish(),
    args.type,
    SOURCE_TAG,
    args.title,
    args.description,
    args.priority,
    'PENDING',
    args.entityType,
    args.entityId,
    args.financialImpact,
    JSON.stringify(args.actionData),
  )
  return 'created'
}

function isResolved(status: string): boolean {
  return status === 'APPROVED' || status === 'REJECTED' || status === 'COMPLETED' || status === 'EXPIRED'
}

function describePo(po: PoRow): string {
  const lines = po.lines
    .slice(0, 8)
    .map(l => `  - ${l.product} (${l.sku}) qty ${l.qty} @ $${l.subtotal.toFixed(2)}`)
    .join('\n')
  const extra = po.lines.length > 8 ? `\n  ...and ${po.lines.length - 8} more line(s)` : ''
  const header =
    po.action === 'CANCEL'
      ? `CANCEL entire PO with ${po.vendor}. PO total $${po.poTotal.toFixed(2)}.`
      : `REDUCE PO with ${po.vendor}: strip Pulte-linked lines only. Pulte portion $${po.poTotal.toFixed(2)} of full PO $${(po.fullPoTotal ?? 0).toFixed(2)}.`
  const sos = po.linkedPulteSOs ? `\nLinked Pulte SOs: ${po.linkedPulteSOs}` : ''
  const keep = po.action === 'REDUCE' && po.nonPulteSOs ? `\nNon-Pulte SOs to KEEP: ${po.nonPulteSOs}` : ''
  return `${header}${sos}${keep}\nCheck vendor for restocking fees or in-transit items before canceling.\nLines:\n${lines}${extra}`
}

async function main() {
  console.log('═'.repeat(64))
  console.log('  PULTE WIND-DOWN — InboxItem flag-only ETL')
  console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT'}`)
  console.log(`  Confirmed lost: ${WINDDOWN_CONFIRMED_DATE}`)
  console.log('═'.repeat(64))

  const { pos, totals } = readImpactFile()
  console.log(`\nImpact file parsed:`)
  console.log(`  CANCEL section: ${totals.cancelCount} POs, subtotal $${totals.cancelTotal.toFixed(2)}`)
  console.log(`  REDUCE section: ${totals.reduceCount} POs, Pulte portion $${totals.reduceTotal.toFixed(2)}`)
  console.log(`  Parsed rows: ${pos.length} (expected 21)`)
  const grandTotal = pos.reduce((s, p) => s + p.poTotal, 0)
  console.log(`  Total Pulte exposure: $${grandTotal.toFixed(2)}`)

  if (pos.length !== 21) {
    console.warn(`\nWARNING: expected 21 POs, parsed ${pos.length}. Review before --commit.`)
  }

  const prisma = new PrismaClient()
  try {
    let created = 0
    let updated = 0
    let skipped = 0

    // One InboxItem per PO
    for (const po of pos) {
      const priority = priorityFor(po.poTotal)
      const title =
        po.action === 'CANCEL'
          ? `Cancel ${po.poNumber} (${po.vendor}) — $${po.poTotal.toFixed(2)} — Pulte wind-down`
          : `Reduce ${po.poNumber} (${po.vendor}) — strip Pulte lines, $${po.poTotal.toFixed(2)} — Pulte wind-down`

      const result = await upsertInboxItem(prisma, {
        entityType: 'PurchaseOrder',
        entityId: po.poNumber,
        type: 'PO_APPROVAL',
        title,
        description: describePo(po),
        priority,
        financialImpact: po.poTotal,
        actionData: {
          source: SOURCE_TAG,
          winddownConfirmedDate: WINDDOWN_CONFIRMED_DATE,
          poNumber: po.poNumber,
          vendor: po.vendor,
          action: po.action,
          pulteAmount: po.poTotal,
          fullPoTotal: po.fullPoTotal,
          linkedPulteSOs: po.linkedPulteSOs,
          nonPulteSOsToKeep: po.nonPulteSOs,
          numLines: po.numLines,
          lines: po.lines,
        },
      })
      if (result === 'created') created++
      else if (result === 'updated') updated++
      else skipped++
      console.log(`  [${po.action.padEnd(6)}] ${po.poNumber.padEnd(11)} ${po.vendor.padEnd(30).slice(0, 30)} $${po.poTotal.toFixed(2).padStart(9)} ${priority.padEnd(8)} -> ${result}`)
    }

    // One summary InboxItem for the Deal closure
    const summaryEntityId = 'PULTE-DEAL-WINDDOWN'
    const summaryResult = await upsertInboxItem(prisma, {
      entityType: 'Deal',
      entityId: summaryEntityId,
      type: 'DEAL_FOLLOWUP',
      title: `Mark Pulte HubSpot deal as Closed Lost — winddown confirmed ${WINDDOWN_CONFIRMED_DATE}`,
      description:
        `Pulte / PulteGroup / Centex / Del Webb account lost on ${WINDDOWN_CONFIRMED_DATE}.\n` +
        `Doug Gough (Senior Procurement) confirmed Treeline -> 84 Lumber; Mobberly Farms moved in March.\n` +
        `In-person meeting declined. 21 open POs totaling ~$${grandTotal.toFixed(2)} flagged for cancel/reduce as separate inbox items.\n\n` +
        `Action: mark the HubSpot / CRM deal as Closed Lost with reason, then archive community/contact records.\n` +
        `This item does NOT modify the Deal row itself — it is a reminder for Nate / Sales to close out manually.`,
      priority: 'HIGH',
      financialImpact: grandTotal,
      actionData: {
        source: SOURCE_TAG,
        winddownConfirmedDate: WINDDOWN_CONFIRMED_DATE,
        totalPulteExposure: grandTotal,
        openPoCount: pos.length,
        cancelCount: pos.filter(p => p.action === 'CANCEL').length,
        reduceCount: pos.filter(p => p.action === 'REDUCE').length,
        note: 'Creates reminder only. Do not auto-modify Deal row.',
      },
    })
    if (summaryResult === 'created') created++
    else if (summaryResult === 'updated') updated++
    else skipped++
    console.log(`\n  [SUMMARY] PULTE-DEAL-WINDDOWN -> ${summaryResult}`)

    console.log('\n' + '─'.repeat(64))
    console.log(`  ${DRY_RUN ? 'Would' : 'Did'} create: ${created}`)
    console.log(`  ${DRY_RUN ? 'Would' : 'Did'} update: ${updated}`)
    console.log(`  Skipped (already resolved): ${skipped}`)
    console.log(`  Total InboxItems: ${created + updated + skipped} (expected 22: 21 POs + 1 summary)`)
    console.log('─'.repeat(64))
    if (DRY_RUN) {
      console.log('\nDRY-RUN complete. Re-run with --commit to persist.')
    } else {
      console.log('\nCommit complete.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
