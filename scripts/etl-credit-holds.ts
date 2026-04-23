/**
 * scripts/etl-credit-holds.ts
 *
 * Loads `Abel Credit Hold Analysis.xlsx` (sheet: "Credit Hold Analysis") into
 * Aegis `CollectionAction` rows tagged with source `CREDIT_HOLD_2026`.
 *
 * Why CollectionAction: this is the only collections-flavored table in the
 * schema, and a credit hold is an ACCOUNT_HOLD collection action. The source
 * XLSX is per-SO (sales order) from Boise Cascade's credit team, not per-
 * customer — so we bucket by builder and write ONE ACCOUNT_HOLD action per
 * builder that has any SOs on hold, with the total exposure + SO list in
 * `notes`. CollectionAction requires a real `invoiceId` (Cascade FK), so we
 * attach the action to the builder's most recent open invoice (ISSUED /
 * PARTIALLY_PAID / OVERDUE, falling back to most recent of any status).
 *
 * Builder match path (first hit wins):
 *   1. XLSX "SO #"         → Aegis `Order.inflowOrderId` → Order.builderId
 *   2. XLSX "Customer PO"  → Aegis `Order.poNumber`      → Order.builderId
 *   3. XLSX "Customer PO"  → Aegis `Job.bwpPoNumber`     → Job.builderId
 *   PO matching is done with leading-zero-stripped + case-insensitive keys.
 *   Rows that match none are reported and skipped.
 *
 * Idempotency: deterministic `notes` header `[CREDIT_HOLD_2026:<builderId>]`.
 * Re-running deletes the previous action for that builder+source and re-inserts.
 *
 * Modes:
 *   (default)  — DRY-RUN: print diff, write nothing
 *   --commit   — actually upsert
 *
 * Usage:
 *   npx tsx scripts/etl-credit-holds.ts
 *   npx tsx scripts/etl-credit-holds.ts --commit
 *
 * Constraints (A11/A5/A10 workstream isolation):
 *   - Writes ONLY to CollectionAction.
 *   - Never touches AccountTouchpoint, InboxItem, or Builder.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const SOURCE_TAG = 'CREDIT_HOLD_2026'
const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel Credit Hold Analysis.xlsx')

interface HoldRow {
  soNumber: string
  orderDate: string
  openSoAmt: number
  holdAmt: number
  customerPo: string
  emailStatus: string
  notes: string
}

function parseMoney(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function isSummaryRow(r: Record<string, unknown>): boolean {
  const so = normStr(r['SO #'])
  // the spreadsheet has SUMMARY rows where 'SO #' is a label like
  // "Total Credit Hold SOs:" or "SUMMARY"
  if (!so) return true
  if (/^summary$/i.test(so)) return true
  if (/total|confirmed|requested|removed|still on hold/i.test(so) && !/^\d+$/.test(so)) {
    return true
  }
  // keep only numeric SO numbers (real rows)
  return !/^\d+$/.test(so)
}

function readXlsx(): HoldRow[] {
  if (!fs.existsSync(FILE)) {
    console.error(`Missing source file: ${FILE}`)
    process.exit(1)
  }
  const wb = XLSX.readFile(FILE, { cellDates: true })
  const ws = wb.Sheets['Credit Hold Analysis']
  if (!ws) {
    console.error('Sheet "Credit Hold Analysis" not found.')
    process.exit(1)
  }
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: true })
  const rows: HoldRow[] = []
  for (const r of raw) {
    if (isSummaryRow(r)) continue
    rows.push({
      soNumber: normStr(r['SO #']),
      orderDate: normStr(r['Inv/Ord Date']),
      openSoAmt: parseMoney(r['Open SO Amt']),
      holdAmt: parseMoney(r['Credit Hold Amt']),
      customerPo: normStr(r['Customer PO']),
      emailStatus: normStr(r['Email Status']) || '(none)',
      notes: normStr(r['Notes']),
    })
  }
  return rows
}

async function main() {
  const prisma = new PrismaClient()
  try {
    console.log(`\n${'═'.repeat(70)}`)
    console.log(`  ETL: Credit Holds → CollectionAction  (${SOURCE_TAG})`)
    console.log(`  Mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
    console.log(`  Source: ${FILE}`)
    console.log('═'.repeat(70))

    const rows = readXlsx()
    console.log(`\nRows parsed (real SOs only): ${rows.length}`)
    const totalExposure = rows.reduce((s, r) => s + r.holdAmt, 0)
    console.log(`Total credit-hold exposure: $${totalExposure.toFixed(2)}`)

    // ── Match each SO to a builder via poNumber or inflowOrderId ─────────
    const soNumbers = rows.map(r => r.soNumber).filter(Boolean)
    const customerPos = Array.from(new Set(rows.map(r => r.customerPo).filter(Boolean)))

    const normPo = (s: string) => s.trim().toUpperCase().replace(/^0+/, '')
    const normPoSet = Array.from(new Set(customerPos.map(normPo).filter(Boolean)))

    const ordersByInflow = await prisma.order.findMany({
      where: { inflowOrderId: { in: soNumbers } },
      select: { id: true, builderId: true, inflowOrderId: true, poNumber: true },
    })
    // Pull a wider net of orders + jobs and normalize PO on the JS side
    const ordersWithPo = await prisma.order.findMany({
      where: { poNumber: { not: null } },
      select: { id: true, builderId: true, poNumber: true },
    })
    const jobsWithPo = await prisma.job.findMany({
      where: { bwpPoNumber: { not: null } },
      select: { id: true, bwpPoNumber: true, order: { select: { builderId: true } } },
    })
    const byInflow = new Map(ordersByInflow.map(o => [o.inflowOrderId!, o]))
    const byPoOrder = new Map<string, { builderId: string }>()
    for (const o of ordersWithPo) {
      const k = normPo(o.poNumber!)
      if (k && !byPoOrder.has(k)) byPoOrder.set(k, { builderId: o.builderId })
    }
    const byPoJob = new Map<string, { builderId: string }>()
    for (const j of jobsWithPo) {
      const bid = j.order?.builderId
      if (!bid) continue
      const k = normPo(j.bwpPoNumber!)
      if (k && !byPoJob.has(k)) byPoJob.set(k, { builderId: bid })
    }
    void normPoSet

    // bucket rows by builderId
    interface Bucket {
      builderId: string
      totalAmt: number
      rows: HoldRow[]
      matchPaths: Set<string>
    }
    const buckets = new Map<string, Bucket>()
    const unmatched: HoldRow[] = []

    for (const r of rows) {
      let builderId: string | null = null
      let matchPath = ''
      if (r.soNumber && byInflow.has(r.soNumber)) {
        builderId = byInflow.get(r.soNumber)!.builderId
        matchPath = 'inflow'
      }
      if (!builderId && r.customerPo) {
        const k = normPo(r.customerPo)
        if (byPoOrder.has(k)) {
          builderId = byPoOrder.get(k)!.builderId
          matchPath = 'order.po'
        } else if (byPoJob.has(k)) {
          builderId = byPoJob.get(k)!.builderId
          matchPath = 'job.po'
        }
      }
      if (!builderId) {
        unmatched.push(r)
        continue
      }
      const b = buckets.get(builderId) ?? { builderId, totalAmt: 0, rows: [], matchPaths: new Set<string>() }
      b.totalAmt += r.holdAmt
      b.rows.push(r)
      b.matchPaths.add(matchPath)
      buckets.set(builderId, b)
    }

    // fetch builder company names + latest invoice for attachment
    const builderIds = Array.from(buckets.keys())
    const builders = await prisma.builder.findMany({
      where: { id: { in: builderIds } },
      select: { id: true, companyName: true },
    })
    const nameById = new Map(builders.map(b => [b.id, b.companyName]))

    // find a target invoice per builder (required by CollectionAction FK)
    const invoicePreference: Array<'OVERDUE' | 'PARTIALLY_PAID' | 'ISSUED' | 'SENT' | 'DRAFT'> = [
      'OVERDUE', 'PARTIALLY_PAID', 'ISSUED', 'SENT', 'DRAFT',
    ]
    const invoiceByBuilder = new Map<string, { id: string; invoiceNumber: string; status: string }>()
    for (const bid of builderIds) {
      // preferred: open-ish invoices
      let inv = await prisma.invoice.findFirst({
        where: { builderId: bid, status: { in: invoicePreference as any } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, invoiceNumber: true, status: true },
      })
      if (!inv) {
        // fall back to any invoice for this builder
        inv = await prisma.invoice.findFirst({
          where: { builderId: bid },
          orderBy: { createdAt: 'desc' },
          select: { id: true, invoiceNumber: true, status: true },
        })
      }
      if (inv) invoiceByBuilder.set(bid, inv)
    }

    // ── Report ──────────────────────────────────────────────────────────
    console.log(`\n${'─'.repeat(70)}`)
    console.log(`  Matched builders: ${buckets.size}`)
    console.log(`  Unmatched SO rows: ${unmatched.length}  ($${unmatched.reduce((s,r) => s + r.holdAmt, 0).toFixed(2)})`)
    console.log('─'.repeat(70))

    let targetable = 0
    let noInvoice = 0
    for (const [bid, b] of buckets) {
      const name = nameById.get(bid) ?? '(unknown builder)'
      const inv = invoiceByBuilder.get(bid)
      const invLabel = inv ? `${inv.invoiceNumber} [${inv.status}]` : '(no invoice found)'
      const paths = Array.from(b.matchPaths).join('+')
      console.log(`  ${name.padEnd(40)}  $${b.totalAmt.toFixed(2).padStart(10)}  SOs:${String(b.rows.length).padStart(3)}  via ${paths}  → ${invLabel}`)
      if (inv) targetable++; else noInvoice++
    }
    console.log(`\n  Actions to write: ${targetable}   Skipped (no invoice): ${noInvoice}`)

    if (unmatched.length) {
      console.log(`\n  Unmatched SO/PO sample (up to 10):`)
      for (const u of unmatched.slice(0, 10)) {
        console.log(`    SO ${u.soNumber}  PO ${u.customerPo}  $${u.holdAmt.toFixed(2)}  "${u.emailStatus}"  ${u.notes.slice(0,60)}`)
      }
    }

    if (DRY_RUN) {
      console.log(`\n[DRY-RUN] No writes performed. Re-run with --commit to apply.\n`)
      return
    }

    // ── Commit ─────────────────────────────────────────────────────────
    let writes = 0
    let replaced = 0
    for (const [bid, b] of buckets) {
      const inv = invoiceByBuilder.get(bid)
      if (!inv) continue
      const name = nameById.get(bid) ?? bid
      const header = `[${SOURCE_TAG}:${bid}]`
      const body = [
        header,
        `Builder: ${name}`,
        `Source: Abel Credit Hold Analysis.xlsx (Boise Cascade)`,
        `SOs on hold: ${b.rows.length}   Total exposure: $${b.totalAmt.toFixed(2)}`,
        '',
        'SO list:',
        ...b.rows.map(r =>
          `  - SO ${r.soNumber} (PO ${r.customerPo || '—'})  $${r.holdAmt.toFixed(2)}  ${r.emailStatus}${r.notes ? ` — ${r.notes}` : ''}`
        ),
      ].join('\n')

      // idempotent: delete prior rows for this builder tagged with SOURCE_TAG
      const del = await prisma.collectionAction.deleteMany({
        where: {
          invoiceId: inv.id,
          actionType: 'ACCOUNT_HOLD',
          notes: { startsWith: header },
        },
      })
      replaced += del.count

      await prisma.collectionAction.create({
        data: {
          invoiceId: inv.id,
          actionType: 'ACCOUNT_HOLD',
          channel: 'SYSTEM',
          notes: body,
        },
      })
      writes++
    }
    console.log(`\n  Wrote ${writes} CollectionAction rows (replaced ${replaced} prior ${SOURCE_TAG} rows).\n`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
