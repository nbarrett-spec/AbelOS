/**
 * scripts/etl-margin-analysis.ts
 *
 * Loads actionable findings from Abel_Gross_Margin_Executive_Report.xlsx into
 * the Aegis AccountReviewTrigger table.
 *
 * The file is mostly an executive dashboard (5 sheets: Dashboard, Monthly
 * Trend, Customers, Abel, Assumptions). Only the "Customers" sheet has
 * per-entity actionable data — a Top-20-by-revenue table with calculated
 * gross margin per builder.
 *
 * We flag every builder whose gross margin is below the policy floor as an
 * AccountReviewTrigger (triggerType = "LOW_MARGIN"). Severity is scored by
 * how far below the blended target they are AND how much revenue is at risk.
 *
 * Policy floor used: 0.30 (AccountMarginTarget.targetBlendedMargin default).
 * HIGH severity: margin < 0.20 AND revenue > $100K
 * MEDIUM:       margin < 0.25
 * LOW:          margin < 0.30
 *
 * Modes:
 *   --dry-run  (default) — compute the diff, print summary, write nothing
 *   --commit           — actually upsert
 *
 * Usage:
 *   tsx scripts/etl-margin-analysis.ts
 *   tsx scripts/etl-margin-analysis.ts --commit
 *
 * Idempotency:
 *   AccountReviewTrigger has no unique constraint, so we de-dupe by
 *   (builderId, triggerType='LOW_MARGIN', source tag in description).
 *   The source tag ("[source:margin-report-YYYY-MM-DD]") is embedded in the
 *   description text, so re-running for the same report-date is a no-op.
 *   A newer report date will create a new trigger; we do not delete prior ones.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'

const argv = process.argv.slice(2)
const arg = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : def
}
const DRY_RUN = !argv.includes('--commit')
const FILE =
  arg('--file') ||
  path.resolve(__dirname, '..', '..', 'Abel_Gross_Margin_Executive_Report.xlsx')

// Policy thresholds
const POLICY_FLOOR = 0.30 // AccountMarginTarget default
const HIGH_MARGIN_CUTOFF = 0.20
const HIGH_REVENUE_CUTOFF = 100_000
const MEDIUM_MARGIN_CUTOFF = 0.25

// Report data-through date — pulled from the sheet header; used in the source
// tag for idempotency.
const REPORT_DATE = '2026-02-25'
const SOURCE_TAG = `[source:margin-report-${REPORT_DATE}]`

interface CustomerRow {
  customer: string
  orders: number
  revenue: number
  knownCogs: number
  unknownRevPos: number
  adjCogs: number
  grossProfit: number
  grossMargin: number // as decimal, e.g. 0.17
}

interface Flagged extends CustomerRow {
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  reason: string
}

/**
 * Normalize customer name for matching against Builder.companyName.
 * The report uses mixed casing ("Pulte Homes", "BROOKFIELD", "TOLL BROTHERS").
 * We uppercase + strip punctuation for a fuzzy compare.
 */
function norm(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function scoreSeverity(row: CustomerRow): Flagged | null {
  const gm = row.grossMargin
  if (gm >= POLICY_FLOOR) return null

  let severity: Flagged['severity']
  if (gm < HIGH_MARGIN_CUTOFF && row.revenue > HIGH_REVENUE_CUTOFF) {
    severity = 'HIGH'
  } else if (gm < MEDIUM_MARGIN_CUTOFF) {
    severity = 'MEDIUM'
  } else {
    severity = 'LOW'
  }

  const reason =
    `Gross margin ${(gm * 100).toFixed(1)}% on $${row.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} revenue ` +
    `across ${row.orders} orders — below ${(POLICY_FLOOR * 100).toFixed(0)}% policy floor. ` +
    `Gross profit: $${row.grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`

  return { ...row, severity, reason }
}

function parseCustomersSheet(filePath: string): CustomerRow[] {
  const wb = XLSX.readFile(filePath, { cellDates: false })
  const ws = wb.Sheets['Customers']
  if (!ws) {
    throw new Error(
      `Sheet "Customers" not found. Sheets: ${wb.SheetNames.join(', ')}`
    )
  }
  const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  })

  // Header row is at index 3 (rows 0-2 are title + subtitle + blank).
  const header = matrix[3] as string[]
  if (!header || header[0] !== 'Customer') {
    throw new Error(
      `Unexpected Customers sheet shape. Row 3: ${JSON.stringify(header)}`
    )
  }

  const rows: CustomerRow[] = []
  for (let i = 4; i < matrix.length; i++) {
    const r = matrix[i] || []
    const customer = r[0]
    if (customer == null || String(customer).trim() === '') continue
    rows.push({
      customer: String(customer).trim(),
      orders: Number(r[1] ?? 0) || 0,
      revenue: Number(r[2] ?? 0) || 0,
      knownCogs: Number(r[3] ?? 0) || 0,
      unknownRevPos: Number(r[4] ?? 0) || 0,
      adjCogs: Number(r[5] ?? 0) || 0,
      grossProfit: Number(r[6] ?? 0) || 0,
      grossMargin: Number(r[7] ?? 0) || 0,
    })
  }
  return rows
}

async function main() {
  console.log(`ETL margin analysis — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Reading: ${FILE}`)
  if (!fs.existsSync(FILE)) {
    throw new Error(`File not found: ${FILE}`)
  }

  const customers = parseCustomersSheet(FILE)
  console.log(`Customers rows parsed: ${customers.length}`)

  // Flag those below policy floor
  const flagged: Flagged[] = []
  const healthy: CustomerRow[] = []
  for (const c of customers) {
    const f = scoreSeverity(c)
    if (f) flagged.push(f)
    else healthy.push(c)
  }
  flagged.sort((a, b) => a.grossMargin - b.grossMargin)

  console.log()
  console.log('=== MARGIN ANALYSIS ===')
  console.log(`  Healthy (GM >= ${(POLICY_FLOOR * 100).toFixed(0)}%):  ${healthy.length}`)
  console.log(`  Flagged (below floor):       ${flagged.length}`)
  console.log()
  if (flagged.length > 0) {
    console.log('Flagged accounts (lowest margin first):')
    flagged.forEach((f) =>
      console.log(
        `  [${f.severity.padEnd(6)}] ${f.customer.padEnd(32)} GM=${(f.grossMargin * 100).toFixed(1)}%  rev=$${f.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(10)}  orders=${f.orders}`
      )
    )
    console.log()
  }

  // Match to Builder rows
  const prisma = new PrismaClient()
  try {
    const allBuilders = await prisma.builder.findMany({
      select: { id: true, companyName: true },
    })
    const byNorm = new Map<string, { id: string; companyName: string }>()
    for (const b of allBuilders) {
      byNorm.set(norm(b.companyName), b)
    }

    interface Match {
      flagged: Flagged
      builderId: string
      builderName: string
    }
    const matched: Match[] = []
    const unmatched: Flagged[] = []
    for (const f of flagged) {
      const key = norm(f.customer)
      // exact-norm first, then startsWith / includes fallback
      let hit = byNorm.get(key)
      if (!hit) {
        for (const [k, v] of byNorm) {
          if (k.startsWith(key) || key.startsWith(k) || k.includes(key) || key.includes(k)) {
            hit = v
            break
          }
        }
      }
      if (hit) {
        matched.push({ flagged: f, builderId: hit.id, builderName: hit.companyName })
      } else {
        unmatched.push(f)
      }
    }

    console.log('=== BUILDER MATCH ===')
    console.log(`  Matched:    ${matched.length}`)
    console.log(`  Unmatched:  ${unmatched.length}`)
    if (unmatched.length) {
      console.log('  Unmatched customer names (no Aegis Builder):')
      unmatched.forEach((u) => console.log(`    - ${u.customer}`))
    }
    console.log()

    // Check existing triggers for idempotency
    const existing = await prisma.accountReviewTrigger.findMany({
      where: {
        triggerType: 'LOW_MARGIN',
        builderId: { in: matched.map((m) => m.builderId) },
      },
      select: { id: true, builderId: true, description: true, isResolved: true },
    })
    const existingByBuilder = new Map<string, typeof existing>()
    for (const e of existing) {
      const list = existingByBuilder.get(e.builderId) ?? []
      list.push(e)
      existingByBuilder.set(e.builderId, list)
    }

    const toCreate: Match[] = []
    const skipped: Match[] = []
    for (const m of matched) {
      const prior = existingByBuilder.get(m.builderId) || []
      const hasSameSource = prior.some((p) => (p.description || '').includes(SOURCE_TAG))
      if (hasSameSource) {
        skipped.push(m)
      } else {
        toCreate.push(m)
      }
    }

    console.log('=== TRIGGER PLAN ===')
    console.log(`  Will CREATE:  ${toCreate.length}`)
    console.log(`  Skipped (same source tag already present):  ${skipped.length}`)
    console.log()
    if (toCreate.length > 0) {
      console.log('Sample CREATE:')
      toCreate.slice(0, 10).forEach((m) =>
        console.log(
          `  + ${m.builderName.padEnd(32)} [${m.flagged.severity}] ${(m.flagged.grossMargin * 100).toFixed(1)}%`
        )
      )
      console.log()
    }

    if (DRY_RUN) {
      console.log('DRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('COMMIT — creating AccountReviewTrigger rows...')
    let created = 0
    let failed = 0
    for (const m of toCreate) {
      try {
        await prisma.accountReviewTrigger.create({
          data: {
            builderId: m.builderId,
            triggerType: 'LOW_MARGIN',
            severity: m.flagged.severity,
            description:
              `${m.flagged.reason} ${SOURCE_TAG}`,
            isResolved: false,
          },
        })
        created++
      } catch (e) {
        failed++
        console.error(
          `  FAIL ${m.builderName}:`,
          (e as Error).message.slice(0, 160)
        )
      }
    }
    console.log(`Committed: created=${created} skipped=${skipped.length} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
