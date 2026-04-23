/**
 * scripts/etl-inventory-count.ts
 *
 * Authoritative April 2026 physical inventory count.
 *
 * SOURCE REALITY (inspected 2026-04-22):
 *   - Abel_Inventory_Count_Sheet_April2026.xlsx is a BLANK dual-count sheet
 *     (3,106 data rows, 0 filled Count 1 / Count 2 / Final Qty). Using it to
 *     overwrite InventoryItem.onHand would zero out real inventory. We REFUSE.
 *
 *   - The authoritative post-count data lives in
 *     Abel_Recount_Priority_April2026.xlsx:
 *
 *       "Confirmed Adjustments"  (186 rows)
 *         Both counters agreed; number differs from InFlow System Qty.
 *         Columns: BC | Product | Category | System Qty | Confirmed Count |
 *                  Δ Qty | Unit Cost | Δ $ | Verified | Post Flag | Notes
 *         Post Flag ∈ {VERIFY FIRST, REVIEW, SAFE}. We post everything EXCEPT
 *         "VERIFY FIRST" (those need a receipt/PO check first — they become
 *         an InboxItem instead).
 *
 *       "Needs 3rd Count"  (86 rows)
 *         Count 1 ≠ Count 2. Do NOT touch InventoryItem; each becomes an
 *         InboxItem tagged RECOUNT_PRIORITY_APR2026 for a third counter.
 *
 *       "Same Person Recount"  (14 rows)
 *         Same counter did both passes. Also InboxItem.
 *
 * Match key:  BC number (sheet "BC" col) ↔ Product.sku.
 *
 * What we write on a VALID confirmed-adjustment row:
 *   - InventoryItem.onHand       = Confirmed Count
 *   - InventoryItem.available    = onHand - committed     (recomputed)
 *   - InventoryItem.lastCountedAt = 2026-04-10   (count date from the sheet)
 *   - If no InventoryItem exists for the product, CREATE one with onHand set
 *     and everything else at schema defaults.
 *
 * What we DO NOT touch (even though the sheet has columns for some):
 *   committed, onOrder, reorderPoint, reorderQty, safetyStock, maxStock,
 *   unitCost, avgDailyUsage, daysOfSupply, warehouseZone, binLocation,
 *   location, status.
 *
 * Modes:
 *   --dry-run  (default) — plan + report, write nothing
 *   --commit            — actually upsert
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const argv = process.argv.slice(2)
const DRY_RUN = !argv.includes('--commit')

const RECOUNT_FILE =
  argv[argv.indexOf('--recount') + 1] && argv.includes('--recount')
    ? argv[argv.indexOf('--recount') + 1]
    : path.resolve(__dirname, '..', '..', 'Abel_Recount_Priority_April2026.xlsx')

const COUNT_SHEET_FILE =
  argv[argv.indexOf('--count') + 1] && argv.includes('--count')
    ? argv[argv.indexOf('--count') + 1]
    : path.resolve(__dirname, '..', '..', 'Abel_Inventory_Count_Sheet_April2026.xlsx')

const COUNT_DATE = new Date('2026-04-10T00:00:00Z')
const RECOUNT_SOURCE_TAG = 'RECOUNT_PRIORITY_APR2026'

// ─── helpers ────────────────────────────────────────────────────────

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function bar(title: string) {
  console.log('\n' + '═'.repeat(68))
  console.log('  ' + title)
  console.log('═'.repeat(68))
}

function money(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── safety check: ensure the main count sheet is blank (and therefore unusable) ───

function assertCountSheetIsBlank(file: string): {
  dataRows: number
  filled: number
} {
  if (!fs.existsSync(file)) {
    console.warn(`  (count sheet not found at ${file} — skipping blank check)`)
    return { dataRows: 0, filled: 0 }
  }
  const wb = XLSX.readFile(file, { cellDates: true })
  let dataRows = 0
  let filled = 0
  for (const sn of ['Inventory Count', 'Stock Items Only']) {
    const ws = wb.Sheets[sn]
    if (!ws) continue
    const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true })
    // header row = 4 for "Inventory Count"; row 3 for "Stock Items Only"
    const startRow = sn === 'Inventory Count' ? 5 : 4
    for (let i = startRow; i < m.length; i++) {
      const r = (m[i] || []) as unknown[]
      const bc = r[0]
      if (typeof bc !== 'string' || !bc.startsWith('BC')) continue
      dataRows++
      // Count 1 = col 10, Count 2 = col 12, Final Qty = col 15
      if (r[10] != null && r[10] !== '') filled++
      if (r[12] != null && r[12] !== '') filled++
      if (r[15] != null && r[15] !== '') filled++
    }
  }
  return { dataRows, filled }
}

// ─── parsers ────────────────────────────────────────────────────────

interface ConfirmedRow {
  sku: string
  productName: string
  category: string
  systemQty: number
  confirmedCount: number
  deltaQty: number
  unitCost: number
  deltaDollars: number
  postFlag: string // VERIFY FIRST | REVIEW | SAFE
  notes: string
}

function parseConfirmedAdjustments(file: string): ConfirmedRow[] {
  const wb = XLSX.readFile(file, { cellDates: true })
  const ws = wb.Sheets['Confirmed Adjustments']
  if (!ws) throw new Error('Sheet "Confirmed Adjustments" not found')
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true })
  // header row = 0; cols:
  //  0 BC | 1 Product | 2 Category | 3 System Qty | 4 Confirmed Count |
  //  5 Δ Qty | 6 Unit Cost | 7 Δ $ | 8 Verified | 9 Post Flag | 10 Notes
  const rows: ConfirmedRow[] = []
  for (let i = 1; i < m.length; i++) {
    const r = (m[i] || []) as unknown[]
    const sku = normStr(r[0])
    if (!sku.startsWith('BC')) continue
    rows.push({
      sku,
      productName: normStr(r[1]),
      category: normStr(r[2]),
      systemQty: toNum(r[3]),
      confirmedCount: toNum(r[4]),
      deltaQty: toNum(r[5]),
      unitCost: toNum(r[6]),
      deltaDollars: toNum(r[7]),
      postFlag: normStr(r[9]).toUpperCase(),
      notes: normStr(r[10]),
    })
  }
  return rows
}

interface RecountRow {
  sku: string
  productName: string
  category: string
  systemQty: number
  count1: number
  countedBy1: string
  count2: number
  countedBy2: string
  deltaQty: number
  unitCost: number
  deltaDollars: number
  priority: string
  notes: string
}

function parseNeeds3rd(file: string): RecountRow[] {
  const wb = XLSX.readFile(file, { cellDates: true })
  const ws = wb.Sheets['Needs 3rd Count']
  if (!ws) return []
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true })
  const rows: RecountRow[] = []
  for (let i = 1; i < m.length; i++) {
    const r = (m[i] || []) as unknown[]
    const sku = normStr(r[0])
    if (!sku.startsWith('BC')) continue
    rows.push({
      sku,
      productName: normStr(r[1]),
      category: normStr(r[2]),
      systemQty: toNum(r[3]),
      count1: toNum(r[4]),
      countedBy1: normStr(r[5]),
      count2: toNum(r[6]),
      countedBy2: normStr(r[7]),
      deltaQty: toNum(r[8]),
      unitCost: toNum(r[9]),
      deltaDollars: toNum(r[10]),
      priority: normStr(r[11]).toUpperCase(),
      notes: normStr(r[12]),
    })
  }
  return rows
}

interface SamePersonRow {
  sku: string
  productName: string
  counter1: string
  count1: number
  counter2: string
  count2: number
  reassignTo: string
  notes: string
}

function parseSamePerson(file: string): SamePersonRow[] {
  const wb = XLSX.readFile(file, { cellDates: true })
  const ws = wb.Sheets['Same Person Recount']
  if (!ws) return []
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true })
  const rows: SamePersonRow[] = []
  for (let i = 1; i < m.length; i++) {
    const r = (m[i] || []) as unknown[]
    const sku = normStr(r[0])
    if (!sku.startsWith('BC')) continue
    rows.push({
      sku,
      productName: normStr(r[1]),
      counter1: normStr(r[2]),
      count1: toNum(r[3]),
      counter2: normStr(r[4]),
      count2: toNum(r[5]),
      reassignTo: normStr(r[6]),
      notes: normStr(r[7]),
    })
  }
  return rows
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  bar('ABEL — Inventory Count ETL (April 2026)')
  console.log(`  Mode:          ${DRY_RUN ? 'DRY-RUN (no writes)' : 'COMMIT (will write)'}`)
  console.log(`  Count sheet:   ${COUNT_SHEET_FILE}`)
  console.log(`  Recount file:  ${RECOUNT_FILE}`)

  // Safety gate: confirm the dual-count sheet is still blank (we are NOT using it)
  bar('Safety check — dual-count sheet should be blank')
  const blank = assertCountSheetIsBlank(COUNT_SHEET_FILE)
  console.log(
    `  Dual-count sheet rows: ${blank.dataRows}; filled Count 1/2/Final cells: ${blank.filled}`,
  )
  if (blank.filled > 0) {
    console.warn(
      `  ⚠️  The dual-count sheet now has ${blank.filled} filled count cells.`,
    )
    console.warn(
      `     This script was built under the assumption that the dual-count sheet is empty`,
    )
    console.warn(
      `     and that Recount Priority is the authoritative source. Abort and re-inspect.`,
    )
    process.exit(2)
  }

  if (!fs.existsSync(RECOUNT_FILE)) {
    console.error(`\n❌ Recount Priority file missing: ${RECOUNT_FILE}`)
    process.exit(1)
  }

  // Parse
  bar('Parsing Abel_Recount_Priority_April2026.xlsx')
  const confirmed = parseConfirmedAdjustments(RECOUNT_FILE)
  const needs3rd = parseNeeds3rd(RECOUNT_FILE)
  const samePerson = parseSamePerson(RECOUNT_FILE)
  console.log(`  Confirmed Adjustments:   ${confirmed.length} rows`)
  console.log(`  Needs 3rd Count:         ${needs3rd.length} rows`)
  console.log(`  Same Person Recount:     ${samePerson.length} rows`)

  // Post Flag distribution
  const postFlagCounts: Record<string, number> = {}
  for (const r of confirmed) postFlagCounts[r.postFlag] = (postFlagCounts[r.postFlag] || 0) + 1
  console.log(`  Post-flag distribution: ${JSON.stringify(postFlagCounts)}`)

  // Split confirmed by post flag
  const toPost = confirmed.filter((r) => r.postFlag === 'SAFE' || r.postFlag === 'REVIEW')
  const verifyFirst = confirmed.filter((r) => r.postFlag === 'VERIFY FIRST')
  console.log(
    `  → Will post to InventoryItem:  ${toPost.length}  (SAFE + REVIEW)`,
  )
  console.log(
    `  → Will route to InboxItem:     ${verifyFirst.length}  (VERIFY FIRST — need receipt/PO check)`,
  )

  const prisma = new PrismaClient()

  try {
    // ─── Match SKUs to Product ─────────────────────────────────────
    bar('Matching SKUs → Product')
    const allSkus = Array.from(
      new Set([
        ...confirmed.map((r) => r.sku),
        ...needs3rd.map((r) => r.sku),
        ...samePerson.map((r) => r.sku),
      ]),
    )
    const products = await prisma.product.findMany({
      where: { sku: { in: allSkus } },
      select: { id: true, sku: true, name: true, category: true, cost: true },
    })
    const bySku = new Map(products.map((p) => [p.sku, p]))
    const matched = confirmed.filter((r) => bySku.has(r.sku))
    const unmatched = confirmed.filter((r) => !bySku.has(r.sku))
    console.log(`  Confirmed matched:    ${matched.length}/${confirmed.length}`)
    console.log(`  Confirmed unmatched:  ${unmatched.length}`)
    if (unmatched.length > 0) {
      console.log('  First 5 unmatched SKUs:')
      unmatched.slice(0, 5).forEach((r) =>
        console.log(`    ${r.sku}  ${r.productName.slice(0, 60)}  Δ${money(r.deltaDollars)}`),
      )
    }

    // ─── Variance analysis ─────────────────────────────────────────
    bar('Variance distribution (Confirmed Adjustments, matched only)')
    const matchedToPost = toPost.filter((r) => bySku.has(r.sku))
    const variancesNonZero = matchedToPost.filter((r) => r.deltaQty !== 0)
    const totalPositiveDollar = matchedToPost
      .filter((r) => r.deltaDollars > 0)
      .reduce((a, r) => a + r.deltaDollars, 0)
    const totalNegativeDollar = matchedToPost
      .filter((r) => r.deltaDollars < 0)
      .reduce((a, r) => a + r.deltaDollars, 0)
    const netDollar = totalPositiveDollar + totalNegativeDollar
    console.log(`  Rows to post:                 ${matchedToPost.length}`)
    console.log(`  Rows with Δ qty ≠ 0:          ${variancesNonZero.length}`)
    console.log(`  Total positive $ variance:    ${money(totalPositiveDollar)}`)
    console.log(`  Total negative $ variance:    ${money(totalNegativeDollar)}`)
    console.log(`  Net $ variance vs InFlow:     ${money(netDollar)}`)

    // Top 10 biggest by |Δ $|
    const top = [...matchedToPost]
      .sort((a, b) => Math.abs(b.deltaDollars) - Math.abs(a.deltaDollars))
      .slice(0, 10)
    console.log('\n  Top 10 biggest $ variances (to be posted):')
    console.log(`  ${'SKU'.padEnd(10)} ${'SysQty'.padStart(8)} ${'Count'.padStart(8)} ${'Δ Qty'.padStart(8)} ${'Δ $'.padStart(14)}  ${'Flag'.padEnd(12)} Product`)
    for (const r of top) {
      console.log(
        `  ${r.sku.padEnd(10)} ${String(r.systemQty).padStart(8)} ${String(r.confirmedCount).padStart(8)} ${String(r.deltaQty).padStart(8)} ${money(r.deltaDollars).padStart(14)}  ${r.postFlag.padEnd(12)} ${r.productName.slice(0, 50)}`,
      )
    }

    // Sanity — if > 90% of rows have huge variance something is wrong
    const hugeVar = matchedToPost.filter(
      (r) => r.systemQty !== 0 && Math.abs(r.deltaQty / Math.max(r.systemQty, 1)) > 5,
    )
    const hugeRatio = matchedToPost.length > 0 ? hugeVar.length / matchedToPost.length : 0
    console.log(`\n  Sanity: ${hugeVar.length}/${matchedToPost.length} rows have |Δ/SysQty| > 5 (${(hugeRatio * 100).toFixed(1)}%)`)
    if (hugeRatio > 0.9) {
      console.warn('  ⚠️  Variance distribution looks off. Investigate before --commit.')
    }

    // ─── InboxItem plan ────────────────────────────────────────────
    bar('Recount / follow-up plan (InboxItem)')
    const inboxPlanned = needs3rd.length + samePerson.length + verifyFirst.length
    console.log(`  Needs 3rd Count:        ${needs3rd.length}`)
    console.log(`  Same Person Recount:    ${samePerson.length}`)
    console.log(`  VERIFY FIRST (deferred from post): ${verifyFirst.length}`)
    console.log(`  Total InboxItem rows:   ${inboxPlanned}`)

    if (DRY_RUN) {
      bar('DRY-RUN complete — no changes written')
      console.log('  Re-run with --commit to apply.')
      await prisma.$disconnect()
      return
    }

    // ─── COMMIT: InventoryItem upserts ─────────────────────────────
    bar('COMMIT — writing InventoryItem')
    let updated = 0
    let created = 0
    let skipped = 0
    for (const r of matchedToPost) {
      const product = bySku.get(r.sku)!
      // Find existing InventoryItem by productId
      const existing = await prisma.inventoryItem.findUnique({
        where: { productId: product.id },
        select: { id: true, committed: true },
      })
      if (existing) {
        const committed = existing.committed ?? 0
        await prisma.inventoryItem.update({
          where: { productId: product.id },
          data: {
            onHand: r.confirmedCount,
            available: r.confirmedCount - committed,
            lastCountedAt: COUNT_DATE,
            // denormalised label fields — refresh if we have them
            sku: product.sku,
            productName: product.name,
            category: product.category,
          },
        })
        updated++
      } else {
        await prisma.inventoryItem.create({
          data: {
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            category: product.category,
            onHand: r.confirmedCount,
            available: r.confirmedCount, // committed defaults to 0
            lastCountedAt: COUNT_DATE,
          },
        })
        created++
      }
    }
    // Unmatched SKUs we simply skip (no Product → no productId)
    skipped = confirmed.length - matched.length
    console.log(`  InventoryItem updated: ${updated}`)
    console.log(`  InventoryItem created: ${created}`)
    console.log(`  Skipped (no Product):  ${skipped}`)

    // ─── COMMIT: InboxItem recount routing ────────────────────────
    // NOTE: using raw SQL here because Prisma schema includes a
    // `brainAcknowledgedAt` column that is not yet applied to the DB,
    // which makes prisma.inboxItem.create() fail with P2022. We only
    // insert the columns that exist in the live DB.
    bar('COMMIT — writing InboxItem (recount priority)')

    async function insertInbox(opts: {
      title: string
      description: string
      priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
      entityType: string | null
      entityId: string | null
      financialImpact: number | null
      actionData: Record<string, unknown>
    }) {
      const id = 'c' + Math.random().toString(36).slice(2, 14) + Date.now().toString(36)
      await prisma.$executeRaw`
        INSERT INTO "InboxItem" (
          id, type, source, title, description, priority, status,
          "entityType", "entityId", "financialImpact",
          "actionData", "createdAt", "updatedAt"
        ) VALUES (
          ${id}, 'SYSTEM', ${RECOUNT_SOURCE_TAG},
          ${opts.title}, ${opts.description}, ${opts.priority}, 'PENDING',
          ${opts.entityType}, ${opts.entityId}, ${opts.financialImpact},
          ${JSON.stringify(opts.actionData)}::jsonb,
          NOW(), NOW()
        )
      `
    }

    let inboxCreated = 0

    for (const r of needs3rd) {
      const product = bySku.get(r.sku)
      const title = `Recount needed (3rd count): ${r.sku} — ${r.productName.slice(0, 60)}`
      const description =
        `Count 1 = ${r.count1} (by ${r.countedBy1 || 'unknown'}), ` +
        `Count 2 = ${r.count2} (by ${r.countedBy2 || 'unknown'}), ` +
        `System Qty = ${r.systemQty}. Δ qty = ${r.deltaQty}, Δ $ = ${money(r.deltaDollars)}. ` +
        `Category: ${r.category}. ${r.notes ? 'Notes: ' + r.notes : ''}`
      await insertInbox({
        title,
        description,
        priority: r.priority === 'HIGH' ? 'HIGH' : r.priority === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        entityType: product ? 'Product' : null,
        entityId: product ? product.id : null,
        financialImpact: r.deltaDollars,
        actionData: {
          reason: 'NEEDS_3RD_COUNT',
          sku: r.sku,
          systemQty: r.systemQty,
          count1: r.count1,
          countedBy1: r.countedBy1,
          count2: r.count2,
          countedBy2: r.countedBy2,
          unitCost: r.unitCost,
          deltaQty: r.deltaQty,
          deltaDollars: r.deltaDollars,
        },
      })
      inboxCreated++
    }

    for (const r of samePerson) {
      const product = bySku.get(r.sku)
      await insertInbox({
        title: `Reassign counter: ${r.sku} — ${r.productName.slice(0, 60)}`,
        description:
          `Same counter did both passes (${r.counter1} / ${r.counter2}). ` +
          `Count 1 = ${r.count1}, Count 2 = ${r.count2}. Reassign to an uninvolved counter.`,
        priority: 'MEDIUM',
        entityType: product ? 'Product' : null,
        entityId: product ? product.id : null,
        financialImpact: null,
        actionData: {
          reason: 'SAME_PERSON_RECOUNT',
          sku: r.sku,
          counter1: r.counter1,
          count1: r.count1,
          counter2: r.counter2,
          count2: r.count2,
          reassignTo: r.reassignTo,
        },
      })
      inboxCreated++
    }

    for (const r of verifyFirst) {
      const product = bySku.get(r.sku)
      await insertInbox({
        title: `Verify before posting: ${r.sku} — ${r.productName.slice(0, 60)}`,
        description:
          `Confirmed count = ${r.confirmedCount} vs System = ${r.systemQty} ` +
          `(Δ ${r.deltaQty}, Δ $ ${money(r.deltaDollars)}). ` +
          `Flagged VERIFY FIRST — check receipt / PO before adjusting InventoryItem.`,
        priority: Math.abs(r.deltaDollars) > 5000 ? 'HIGH' : 'MEDIUM',
        entityType: product ? 'Product' : null,
        entityId: product ? product.id : null,
        financialImpact: r.deltaDollars,
        actionData: {
          reason: 'VERIFY_FIRST',
          sku: r.sku,
          systemQty: r.systemQty,
          confirmedCount: r.confirmedCount,
          deltaQty: r.deltaQty,
          unitCost: r.unitCost,
          deltaDollars: r.deltaDollars,
        },
      })
      inboxCreated++
    }

    console.log(`  InboxItem rows created: ${inboxCreated}`)

    bar('DONE')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
