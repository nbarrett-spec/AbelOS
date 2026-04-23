/**
 * scripts/etl-ar-aging.ts
 *
 * Loads the True A/R snapshot (2026-04-10) into AccountTouchpoint, one
 * touchpoint per builder summarizing their aging position on that date.
 *
 * Source files:
 *   Abel_True_AR_Report_2026-04-10.xlsx   — primary (clean 1:1 invoice detail)
 *   Abel_Master_AR_Report_2026-04-10.xlsx — reference only (headline totals)
 *
 * Why AccountTouchpoint:
 *   - CollectionAction is owned by another agent (A12) — we stay out.
 *   - InboxItem is used for builder-visible punch lists (A5/A10) — avoid.
 *   - Invoice table can't be populated 1:1 (order #'s are SO-* not invoice #'s
 *     and invoice-schema fields don't line up cleanly).
 *   - AccountTouchpoint is a safe, additive log the ops/accounts views already
 *     read (src/app/api/ops/accounts/proactive/route.ts). Perfect for a snapshot.
 *
 * Idempotency:
 *   Deterministic id per (builder, snapshot date): `ar-snap-2026-04-10-<builderId>`.
 *   Re-running upserts — never duplicates.
 *
 * Source tag: `AR_REPORT_2026-04-10` — embedded in notes + outcome so later
 *   scripts can filter these apart from manual touchpoints.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'AR_REPORT_2026-04-10'
const SNAPSHOT_DATE = '2026-04-10'

const TRUE_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'Abel_True_AR_Report_2026-04-10.xlsx',
)

type DetailRow = {
  orderNumber: string
  customer: string
  invoiceDate: string | null
  daysOut: number | null
  bucket: string
  inventory: string
  payment: string
  sales: number
  risk: string
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Map an XLSX customer string to a Builder row via several fallback strategies */
function matchBuilder(
  xCustomer: string,
  builders: { id: string; companyName: string }[],
  nameMap: Map<string, { id: string; companyName: string }>,
): { id: string; companyName: string } | null {
  const lower = xCustomer.toLowerCase()
  if (nameMap.has(lower)) return nameMap.get(lower)!
  const want = normalizeKey(xCustomer)
  if (!want) return null
  // Exact normalized match
  const exact = builders.find((b) => normalizeKey(b.companyName) === want)
  if (exact) return exact
  // Startswith either direction (handles "Pulte Homes" vs "Pulte Group" etc.)
  const starts = builders.find((b) => {
    const k = normalizeKey(b.companyName)
    return k.length >= 5 && (k.startsWith(want) || want.startsWith(k))
  })
  if (starts) return starts
  // Contains (last resort, require >=6 chars to avoid false pos)
  if (want.length >= 6) {
    const contains = builders.find((b) => {
      const k = normalizeKey(b.companyName)
      return k.includes(want) || want.includes(k)
    })
    if (contains) return contains
  }
  return null
}

function bucketKey(b: string): '0-30' | '31-60' | '61-90' | '90+' | 'unknown' {
  const s = b.toLowerCase()
  if (s.includes('0-30') || s.includes('current')) return '0-30'
  if (s.includes('31-60')) return '31-60'
  if (s.includes('61-90')) return '61-90'
  if (s.includes('90+') || s.includes('>90') || s.includes('over')) return '90+'
  return 'unknown'
}

async function main() {
  console.log(`ETL AR Aging — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SOURCE_TAG}`)
  if (!fs.existsSync(TRUE_FILE)) throw new Error(`Not found: ${TRUE_FILE}`)

  const wb = XLSX.readFile(TRUE_FILE)
  const detailSheet = wb.Sheets['True AR Detail']
  if (!detailSheet) throw new Error('Sheet "True AR Detail" not found')

  const rawRows = XLSX.utils.sheet_to_json<any>(detailSheet, { defval: null })
  console.log(`True AR Detail rows: ${rawRows.length}`)

  const details: DetailRow[] = rawRows
    .map((r) => ({
      orderNumber: normStr(r['Order Number']),
      customer: normStr(r['Customer']),
      invoiceDate: normStr(r['Invoice Date']) || null,
      daysOut: r['Days Out'] === null ? null : num(r['Days Out']),
      bucket: normStr(r['Aging Bucket']),
      inventory: normStr(r['Inventory Status']),
      payment: normStr(r['Payment Status']),
      sales: num(r['Sales Amount']),
      risk: normStr(r['Risk Flag']),
    }))
    .filter((r) => r.orderNumber && r.customer)

  // Aging Schedule sheet — per-customer bucket totals (authoritative)
  const agingSheet = wb.Sheets['Aging Schedule']
  const agingRaw = XLSX.utils.sheet_to_json<any>(agingSheet, { defval: null })
  type AgingRow = {
    customer: string
    b0_30: number
    b31_60: number
    b61_90: number
    b90: number
    total: number
  }
  const aging: AgingRow[] = agingRaw
    .map((r) => ({
      customer: normStr(r['Customer']),
      b0_30: num(r['Current (0-30)']),
      b31_60: num(r['31-60']),
      b61_90: num(r['61-90']),
      b90: num(r['90+']),
      total: num(r['Total']),
    }))
    .filter(
      (r) =>
        r.customer &&
        r.total > 0 &&
        r.customer.toUpperCase() !== 'TOTAL' &&
        r.customer.toUpperCase() !== 'GRAND TOTAL',
    )

  // Totals for sanity check
  const totals = aging.reduce(
    (acc, r) => {
      acc.b0_30 += r.b0_30
      acc.b31_60 += r.b31_60
      acc.b61_90 += r.b61_90
      acc.b90 += r.b90
      acc.total += r.total
      return acc
    },
    { b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, total: 0 },
  )

  // Detail-side: sum (excluding negative credits distorting perception)
  const detailSum = details.reduce((s, r) => s + r.sales, 0)

  // Customer Summary (oldest days, # invoices) — nice-to-have for the note
  const custSumSheet = wb.Sheets['Customer Summary']
  const custSumRaw = XLSX.utils.sheet_to_json<any>(custSumSheet, { defval: null })
  const custMeta = new Map<
    string,
    { invoices: number; oldest: number; riskFlags: number }
  >()
  for (const r of custSumRaw) {
    const name = normStr(r['Customer'])
    if (!name) continue
    custMeta.set(name.toLowerCase(), {
      invoices: num(r['# Invoices']),
      oldest: num(r['Oldest Days']),
      riskFlags: num(r['# Risk Flags']),
    })
  }

  const prisma = new PrismaClient()
  try {
    const builders = await prisma.builder.findMany({
      select: { id: true, companyName: true },
    })
    console.log(`Aegis builders: ${builders.length}`)
    const nameMap = new Map(
      builders.map((b) => [b.companyName.toLowerCase(), b] as const),
    )

    type Plan = {
      builderId: string
      builderName: string
      customer: string
      b0_30: number
      b31_60: number
      b61_90: number
      b90: number
      total: number
      invoices: number
      oldest: number
      riskFlags: number
      orderNumbers: string[]
      touchpointId: string
    }

    const plans: Plan[] = []
    const unmatched: { customer: string; total: number }[] = []

    for (const row of aging) {
      const hit = matchBuilder(row.customer, builders, nameMap)
      if (!hit) {
        unmatched.push({ customer: row.customer, total: row.total })
        continue
      }
      const related = details.filter(
        (d) => d.customer.toLowerCase() === row.customer.toLowerCase(),
      )
      const meta = custMeta.get(row.customer.toLowerCase()) ?? {
        invoices: related.length,
        oldest: 0,
        riskFlags: 0,
      }
      plans.push({
        builderId: hit.id,
        builderName: hit.companyName,
        customer: row.customer,
        b0_30: row.b0_30,
        b31_60: row.b31_60,
        b61_90: row.b61_90,
        b90: row.b90,
        total: row.total,
        invoices: meta.invoices,
        oldest: meta.oldest,
        riskFlags: meta.riskFlags,
        orderNumbers: related.map((d) => d.orderNumber).slice(0, 30),
        touchpointId: `ar-snap-${SNAPSHOT_DATE}-${hit.id}`,
      })
    }

    // Ranked output
    const byTotal = [...plans].sort((a, b) => b.total - a.total)

    console.log()
    console.log('=== AGING BUCKET TOTALS (from Aging Schedule sheet) ===')
    console.log(`  0-30 : $${totals.b0_30.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  31-60: $${totals.b31_60.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  61-90: $${totals.b61_90.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  90+  : $${totals.b90.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  TOTAL: $${totals.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`  (detail-row sum cross-check: $${detailSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`)
    console.log()
    console.log('=== TOP 10 CUSTOMERS BY OPEN AR ===')
    byTotal.slice(0, 10).forEach((p, i) => {
      const flag = p.b90 > 0 ? ' 90+!' : p.b61_90 > 0 ? ' 61-90' : ''
      console.log(
        `  ${String(i + 1).padStart(2)}. ${p.customer.padEnd(32)} $${p.total.toFixed(2).padStart(12)}  oldest=${p.oldest}d  inv=${p.invoices}${flag}`,
      )
    })

    if (unmatched.length > 0) {
      const uTotal = unmatched.reduce((s, u) => s + u.total, 0)
      console.log()
      console.log(`=== UNMATCHED (${unmatched.length}, $${uTotal.toFixed(2)}) ===`)
      unmatched.forEach((u) =>
        console.log(`  - ${u.customer.padEnd(32)} $${u.total.toFixed(2)}`),
      )
    }

    console.log()
    console.log(`Planned upserts: ${plans.length} touchpoints (one per matched builder)`)

    if (DRY_RUN) {
      console.log()
      console.log('DRY-RUN — nothing written. Re-run with --commit to apply.')
      return
    }

    console.log()
    console.log('COMMIT — upserting touchpoints...')
    let ins = 0, upd = 0, fail = 0
    for (const p of plans) {
      const subject = `AR snapshot ${SNAPSHOT_DATE}: $${p.total.toFixed(2)} open`
      const notes = [
        `[${SOURCE_TAG}]`,
        `Open AR as of ${SNAPSHOT_DATE}: $${p.total.toFixed(2)} across ${p.invoices} invoice(s).`,
        `Buckets: 0-30=$${p.b0_30.toFixed(2)}  31-60=$${p.b31_60.toFixed(2)}  61-90=$${p.b61_90.toFixed(2)}  90+=$${p.b90.toFixed(2)}.`,
        p.oldest > 0 ? `Oldest invoice: ${p.oldest} days out.` : '',
        p.riskFlags > 0 ? `Risk flags: ${p.riskFlags}.` : '',
        p.orderNumbers.length > 0
          ? `Order #s: ${p.orderNumbers.join(', ')}${p.orderNumbers.length >= 30 ? ' …' : ''}`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
      const outcome =
        p.b90 > 0
          ? 'OVERDUE_90_PLUS'
          : p.b61_90 > 0
            ? 'OVERDUE_61_90'
            : p.b31_60 > 0
              ? 'OVERDUE_31_60'
              : 'CURRENT'

      try {
        const existing = await prisma.accountTouchpoint.findUnique({
          where: { id: p.touchpointId },
        })
        if (existing) {
          await prisma.accountTouchpoint.update({
            where: { id: p.touchpointId },
            data: {
              touchType: 'AR_SNAPSHOT',
              channel: 'SYSTEM',
              subject,
              notes,
              outcome,
            },
          })
          upd++
        } else {
          await prisma.accountTouchpoint.create({
            data: {
              id: p.touchpointId,
              builderId: p.builderId,
              touchType: 'AR_SNAPSHOT',
              channel: 'SYSTEM',
              subject,
              notes,
              outcome,
            },
          })
          ins++
        }
      } catch (e) {
        fail++
        console.error(
          `  FAIL ${p.customer}: ${(e as Error).message.slice(0, 160)}`,
        )
      }
    }
    console.log(`Committed: inserted=${ins} updated=${upd} failed=${fail}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
