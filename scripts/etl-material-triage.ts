/**
 * scripts/etl-material-triage.ts
 *
 * Loads `Abel_Lumber_Material_Triage.xlsx` → `InboxItem` rows tagged
 * with source `MATERIAL_TRIAGE_APR2026`.
 *
 * Two item streams, both additive. We do NOT touch Job / Order / Inventory.
 *
 *   1. Sheet "2. Whiteboard Jobs" (48 data rows) →
 *      one MATERIAL_ARRIVAL-typed InboxItem per job decision.
 *      Priority derived from "Status" + "Priority" column.
 *        - BLOCKED + shortfall > 0     → HIGH  (or CRITICAL if Priority <= 3)
 *        - READY (all covered)         → LOW   (informational; still surfaces)
 *        - default                     → MEDIUM
 *
 *   2. Sheet "4. Order Now" (339 data rows) →
 *      one MRP_RECOMMENDATION-typed InboxItem per SKU shortage.
 *      Priority derived from "Units to Order" and "Jobs Affected":
 *        - Jobs Affected >= 5 or Units to Order >= 50 → HIGH
 *        - Units to Order > 0                         → MEDIUM
 *        - otherwise                                  → LOW
 *
 * financialImpact: not included (source has no cost columns on these sheets).
 *
 * Idempotency: deterministic `actionData.key` per source row:
 *   - Whiteboard:  "MATERIAL_TRIAGE_APR2026:WB:<SO#>"
 *   - Order Now:   "MATERIAL_TRIAGE_APR2026:SKU:<SKU>"
 * On each run we deleteMany({ source: SOURCE_TAG }) then re-create. This keeps
 * Nate's inbox synced to the latest file without drift.
 *
 * Modes:
 *   (default)  DRY-RUN: summarize what would be written
 *   --commit   actually write
 *
 * Usage:
 *   npx tsx scripts/etl-material-triage.ts
 *   npx tsx scripts/etl-material-triage.ts --commit
 *
 * Constraints:
 *   - Writes ONLY to InboxItem with source = MATERIAL_TRIAGE_APR2026
 *   - Never modifies Job, Order, PurchaseOrder, InventoryItem, Builder.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const SOURCE_TAG = 'MATERIAL_TRIAGE_APR2026'
const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Lumber_Material_Triage.xlsx')

const prisma = new PrismaClient()

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface InboxPayload {
  type: string
  source: string
  title: string
  description: string
  priority: Priority
  entityType: string | null
  entityId: string | null
  financialImpact: number | null
  actionData: Record<string, unknown>
}

function readSheetAsArrays(file: string, sheetName: string): unknown[][] {
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`)
  return XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 }) as unknown[][]
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function buildWhiteboardItems(): InboxPayload[] {
  // Layout (row index):
  //   0 title, 1 subtitle, 2 blank, 3 headers, 4..N data
  //   Columns: Priority, Builder, Job, SO#, EarliestNeed, #Lines, QtyNeeded,
  //            FromStock, FromOpenPO, Shortfall, Status
  const rows = readSheetAsArrays(FILE, '2. Whiteboard Jobs')
  const out: InboxPayload[] = []
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => c === null || c === '')) continue
    const priorityNum = toNum(r[0])
    const builder = toStr(r[1])
    const job = toStr(r[2])
    const so = toStr(r[3])
    const earliestNeedRaw = r[4]
    const lines = toNum(r[5])
    const qtyNeeded = toNum(r[6])
    const fromStock = toNum(r[7])
    const fromOpenPO = toNum(r[8])
    const shortfall = toNum(r[9])
    const status = toStr(r[10])
    if (!so) continue

    let priority: Priority = 'MEDIUM'
    const isBlocked = /BLOCKED/i.test(status)
    const isReady = /READY/i.test(status)
    if (isBlocked) {
      priority = priorityNum > 0 && priorityNum <= 3 ? 'CRITICAL' : 'HIGH'
    } else if (isReady) {
      priority = 'LOW'
    }

    const key = `${SOURCE_TAG}:WB:${so}`
    const title = `[Triage] ${builder || '—'} · ${job || so} · ${status}`
    const description =
      `Whiteboard job ${so} (${builder}${job ? ` — ${job}` : ''})\n` +
      `Priority rank ${priorityNum || '?'} · Earliest need: ${toStr(earliestNeedRaw) || 'n/a'}\n` +
      `Lines: ${lines} · Qty needed: ${qtyNeeded} · From stock: ${fromStock} · ` +
      `From open PO: ${fromOpenPO} · Shortfall: ${shortfall}\n` +
      `Status: ${status}`

    out.push({
      type: 'MATERIAL_ARRIVAL',
      source: SOURCE_TAG,
      title,
      description,
      priority,
      entityType: null,
      entityId: null,
      financialImpact: null,
      actionData: {
        key,
        stream: 'WHITEBOARD_JOB',
        priorityRank: priorityNum,
        builder,
        job,
        soNumber: so,
        earliestNeed: toStr(earliestNeedRaw),
        lines,
        qtyNeeded,
        fromStock,
        fromOpenPO,
        shortfall,
        status,
      },
    })
  }
  return out
}

function buildOrderNowItems(): InboxPayload[] {
  // Layout:
  //   0 title, 1 blank, 2 headers, 3..N data
  //   Columns: SKU, Product, Total Demand, On Hand, On Open PO, Units to Order, Jobs Affected
  const rows = readSheetAsArrays(FILE, '4. Order Now')
  const out: InboxPayload[] = []
  // Find header row dynamically: look for row containing "SKU" in col 0
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (toStr(rows[i]?.[0]) === 'SKU') {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return out
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => c === null || c === '')) continue
    const sku = toStr(r[0])
    if (!sku) continue
    const product = toStr(r[1])
    const totalDemand = toNum(r[2])
    const onHand = toNum(r[3])
    const onOpenPO = toNum(r[4])
    const unitsToOrder = toNum(r[5])
    const jobsAffected = toNum(r[6])
    if (unitsToOrder <= 0 && jobsAffected <= 0) continue

    let priority: Priority = 'LOW'
    if (jobsAffected >= 5 || unitsToOrder >= 50) priority = 'HIGH'
    else if (unitsToOrder > 0) priority = 'MEDIUM'

    const key = `${SOURCE_TAG}:SKU:${sku}`
    const title = `[Order] ${sku} · ${unitsToOrder} units short · ${jobsAffected} job${jobsAffected === 1 ? '' : 's'}`
    const description =
      `${product || sku}\n` +
      `Total demand: ${totalDemand} · On hand: ${onHand} · On open PO: ${onOpenPO}\n` +
      `Units to order: ${unitsToOrder} · Jobs affected: ${jobsAffected}`

    out.push({
      type: 'MRP_RECOMMENDATION',
      source: SOURCE_TAG,
      title,
      description,
      priority,
      entityType: null,
      entityId: null,
      financialImpact: null,
      actionData: {
        key,
        stream: 'SKU_SHORTAGE',
        sku,
        product,
        totalDemand,
        onHand,
        onOpenPO,
        unitsToOrder,
        jobsAffected,
      },
    })
  }
  return out
}

function summarize(items: InboxPayload[], label: string) {
  const priCounts: Record<Priority, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const it of items) priCounts[it.priority]++
  console.log(
    `  ${label}: ${items.length} items · CRIT=${priCounts.CRITICAL} HIGH=${priCounts.HIGH} MED=${priCounts.MEDIUM} LOW=${priCounts.LOW}`
  )
}

async function main() {
  console.log(`\n== etl-material-triage  ${DRY_RUN ? '[DRY-RUN]' : '[COMMIT]'}`)
  console.log(`   source: ${FILE}`)
  console.log(`   tag:    ${SOURCE_TAG}\n`)

  const wb = buildWhiteboardItems()
  const sku = buildOrderNowItems()
  const all = [...wb, ...sku]

  console.log('Parsed:')
  summarize(wb, 'Whiteboard jobs')
  summarize(sku, 'SKU shortages')
  summarize(all, 'TOTAL')

  if (DRY_RUN) {
    console.log('\nSample items (first 3):')
    for (const it of all.slice(0, 3)) {
      console.log(`  [${it.priority}] ${it.title}`)
    }
    console.log('\nDRY-RUN — no database writes. Re-run with --commit.\n')
    await prisma.$disconnect()
    return
  }

  const existing = await prisma.inboxItem.count({ where: { source: SOURCE_TAG } })
  console.log(`\nDeleting ${existing} existing InboxItem(s) with source=${SOURCE_TAG}...`)
  await prisma.inboxItem.deleteMany({ where: { source: SOURCE_TAG } })

  console.log(`Creating ${all.length} InboxItem(s)...`)
  let created = 0
  for (const it of all) {
    await prisma.inboxItem.create({
      data: {
        type: it.type,
        source: it.source,
        title: it.title,
        description: it.description,
        priority: it.priority,
        status: 'PENDING',
        entityType: it.entityType,
        entityId: it.entityId,
        financialImpact: it.financialImpact,
        actionData: it.actionData as never,
      },
    })
    created++
    if (created % 50 === 0) console.log(`   ...${created}/${all.length}`)
  }
  console.log(`Done. Created ${created} InboxItem(s).`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
