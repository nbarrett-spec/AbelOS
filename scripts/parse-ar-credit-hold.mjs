#!/usr/bin/env node
/**
 * Parse historical AR reports + credit-hold analysis into Builder rows,
 * and snapshot per-builder aging into ArHistorySnapshot for trend charts.
 *
 * Source files (parent workspace root):
 *   - Abel_Master_AR_Report_2026-04-10.xlsx    (per-builder aging with "No Invoice Date" bucket)
 *   - Abel_True_AR_Report_2026-04-10.xlsx      (adjusted/canonical — preferred)
 *   - Abel Credit Hold Analysis.xlsx           (Boise-side PO credit holds — diagnostic only)
 *
 * What this does:
 *   1. Pulls per-customer aging from the True AR "Aging Schedule" sheet (canonical).
 *      Falls back to Master AR "Aging Schedule" when a customer is missing.
 *      Master has a "No Invoice Date" bucket that True omits — we preserve it.
 *   2. Fuzzy-matches customer → Builder.companyName (ACTIVE only).
 *   3. Updates Builder.accountBalance from current AR total (or 0 when missing).
 *   4. Creates ArHistorySnapshot table via CREATE TABLE IF NOT EXISTS, inserts
 *      one row per matched builder at snapshot date 2026-04-10. Idempotent:
 *      (builderId, snapshotDate) unique — re-running the same file is a no-op.
 *   5. Credit-hold file: the spreadsheet tracks Boise Cascade PO holds (vendor
 *      side), NOT a per-builder recommended creditLimit. The task says only
 *      touch creditLimit "if the Excel has a recommended limit column" — it
 *      doesn't. We report per-builder on-hold $ but do NOT mutate creditLimit.
 *      Flagged in the console report so Dawn/Nate can set limits manually.
 *
 * Dry-run default. Pass --commit to write. Pass --verbose for every row.
 *
 * Doesn't touch prisma/schema.prisma. Raw SQL only.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
const ABEL_ROOT = resolve(PROJECT_ROOT, '..')

const dbUrl = readFileSync(join(PROJECT_ROOT, '.env'), 'utf-8').match(
  /DATABASE_URL="([^"]+)"/,
)?.[1]
if (!dbUrl) {
  console.error('Missing DATABASE_URL in .env')
  process.exit(1)
}

const COMMIT = process.argv.includes('--commit')
const VERBOSE = process.argv.includes('--verbose')
const SNAPSHOT_DATE = '2026-04-10' // reports are dated this

const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

// ---- Helpers -------------------------------------------------------------

function parseMoney(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function fmt$(n) {
  const sign = n < 0 ? '-' : ''
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function readXlsxMatrix(path, sheet) {
  const wb = XLSX.readFile(path, { cellDates: true })
  const ws = wb.Sheets[sheet]
  if (!ws) throw new Error(`Sheet "${sheet}" missing from ${path}`)
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
}

/**
 * Normalize a customer string from the AR reports to something comparable.
 * Covers the "TOLL BROTHERS" / "BROOKFIELD" shouty formatting inFlow uses,
 * doubled spaces ("Hayhurst  Bros."), trailing divisions, etc.
 */
function norm(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,']/g, '')
    .trim()
}

function canonicalizeCustomer(raw, builders) {
  if (!raw) return null
  const needle = norm(raw)
  if (!needle) return null

  // 1. exact normalized match
  const exact = builders.find((b) => norm(b.companyName) === needle)
  if (exact) return exact

  // 2. hand-maintained synonym table for the known-weird ones
  const syn = {
    'toll brothers': 'Toll Brothers',
    toll: 'Toll Brothers',
    brookfield: 'Brookfield Residential',
    'brookfield residential': 'Brookfield Residential',
    pulte: 'Pulte Homes',
    'pulte homes': 'Pulte Homes',
    centex: 'Pulte Homes',
    bloomfield: 'Bloomfield Homes',
    'bloomfield homes': 'Bloomfield Homes',
    'cross custom homes': 'Cross Custom Homes',
    'joseph paul homes': 'Joseph Paul Homes',
    jph: 'Joseph Paul Homes',
    'shaddock homes': 'Shaddock Homes',
    shaddock: 'Shaddock Homes',
    'true grit custom builders': 'True Grit Custom Builders',
    'rdr development': 'RDR Development',
    rdr: 'RDR Development',
    'laird contractors': 'Laird Contractors',
    'f7 construction': 'F7 Construction',
    'star flower homes': 'Star Flower Homes',
    'parker construction & fence': 'Parker Construction & Fence',
    'parker construction and fence': 'Parker Construction & Fence',
    'tate development': 'Tate Development',
    'tristar built': 'Tristar Built',
    'd&b construction': 'D&B Construction',
    'hayhurst bros builders': 'Hayhurst Bros. Builders',
    'hayhurst bros builders ': 'Hayhurst Bros. Builders',
    'bill durham': 'Bill Durham',
    'agd homes': 'AGD Homes',
    'western construction': 'Western Construction',
    'lala construction': 'LaLa Construction',
    'stoffels custom homes': 'Stoffels Custom Homes',
    'restore grounds management': 'Restore Grounds Management',
    'texas restoration & rescue': 'Texas Restoration & Rescue',
    'm cooper homes': 'M Cooper Homes',
    'brookson builders': 'Brookson Builders',
    'brad eugster': 'Brad Eugster',
    'bailey brothers builders': 'Bailey Brothers Builders',
    'mccoys building supply': "McCoy's Building Supply",
    'mccage properties': 'McCage Properties',
    'fig tree homes': 'FIG TREE HOMES',
    'joseph paul': 'Joseph Paul Homes',
  }
  const synHit = syn[needle]
  if (synHit) {
    const b = builders.find((x) => norm(x.companyName) === norm(synHit))
    if (b) return b
  }

  // 3. substring containment both ways
  for (const b of builders) {
    const hay = norm(b.companyName)
    if (hay === needle) return b
    if (hay.startsWith(needle + ' ') || needle.startsWith(hay + ' ')) return b
    if ((hay.length >= 6 && needle.includes(hay)) || (needle.length >= 6 && hay.includes(needle))) return b
  }

  return null
}

// ---- Parse the three files ----------------------------------------------

function parseTrueArAging() {
  const file = join(ABEL_ROOT, 'Abel_True_AR_Report_2026-04-10.xlsx')
  const m = readXlsxMatrix(file, 'Aging Schedule')
  // Header row: [Customer, Current (0-30), 31-60, 61-90, 90+, Total, % of Total]
  const out = new Map()
  for (let r = 1; r < m.length; r++) {
    const row = m[r] || []
    const cust = row[0]
    if (!cust || /^TOTAL$/i.test(String(cust).trim())) continue
    out.set(String(cust).trim(), {
      current: parseMoney(row[1]),
      d31_60: parseMoney(row[2]),
      d61_90: parseMoney(row[3]),
      d90p: parseMoney(row[4]),
      noInvoiceDate: 0, // True AR doesn't split this bucket
      total: parseMoney(row[5]),
      source: 'true',
    })
  }
  return out
}

function parseMasterArAging() {
  const file = join(ABEL_ROOT, 'Abel_Master_AR_Report_2026-04-10.xlsx')
  const m = readXlsxMatrix(file, 'Aging Schedule')
  // Header: [Customer, Current (0-30), 31-60, 61-90, 90+, No Invoice Date, Total, % of Total]
  const out = new Map()
  for (let r = 3; r < m.length; r++) {
    const row = m[r] || []
    const cust = row[0]
    if (!cust || /^TOTAL$/i.test(String(cust).trim())) continue
    out.set(String(cust).trim(), {
      current: parseMoney(row[1]),
      d31_60: parseMoney(row[2]),
      d61_90: parseMoney(row[3]),
      d90p: parseMoney(row[4]),
      noInvoiceDate: parseMoney(row[5]),
      total: parseMoney(row[6]),
      source: 'master',
    })
  }
  return out
}

/**
 * Merge aging data: prefer True (adjusted) for the buckets it has, but keep
 * Master's "No Invoice Date" amount since True omits that classification.
 * Grand total is recomputed from the merged buckets so it's internally
 * consistent rather than mixing two sources.
 */
function mergeAging(trueMap, masterMap) {
  const out = new Map()
  const keys = new Set([...trueMap.keys(), ...masterMap.keys()])
  for (const k of keys) {
    const t = trueMap.get(k)
    const m = masterMap.get(k)
    const noInv = m ? m.noInvoiceDate : 0
    if (t) {
      const total = t.current + t.d31_60 + t.d61_90 + t.d90p + noInv
      out.set(k, {
        current: t.current,
        d31_60: t.d31_60,
        d61_90: t.d61_90,
        d90p: t.d90p,
        noInvoiceDate: noInv,
        total,
        primarySource: 'true',
        hasMaster: !!m,
      })
    } else if (m) {
      out.set(k, {
        current: m.current,
        d31_60: m.d31_60,
        d61_90: m.d61_90,
        d90p: m.d90p,
        noInvoiceDate: m.noInvoiceDate,
        total: m.total,
        primarySource: 'master',
        hasMaster: true,
      })
    }
  }
  return out
}

function parseCreditHold() {
  const file = join(ABEL_ROOT, 'Abel Credit Hold Analysis.xlsx')
  const m = readXlsxMatrix(file, 'Credit Hold Analysis')
  // This file is Boise-Cascade PO holds, not builder-side credit.
  // Header: [SO #, Inv/Ord Date, Open SO Amt, Credit Hold Amt, Customer PO, Email Status, Notes]
  // No per-builder rollup column exists. We extract raw rows only — zero
  // reliable way to bucket these to a Builder without a customer name column.
  const rows = []
  for (let r = 1; r < m.length; r++) {
    const row = m[r] || []
    const so = row[0]
    if (!so) continue
    // skip the "Summary" bottom-of-file rollup rows
    if (typeof so === 'string' && /^(Boise|Requested|Still|POs|Summary|Total)/i.test(so)) continue
    rows.push({
      so: String(so),
      orderDate: row[1] ? String(row[1]) : null,
      openSoAmt: parseMoney(row[2]),
      creditHoldAmt: parseMoney(row[3]),
      customerPo: row[4] != null ? String(row[4]) : null,
      emailStatus: row[5] != null ? String(row[5]) : null,
      notes: row[6] != null ? String(row[6]) : null,
    })
  }
  return rows
}

// ---- Main ----------------------------------------------------------------

async function main() {
  const mode = COMMIT ? 'COMMIT' : 'DRY-RUN'
  console.log('\n═══════════════════════════════════════════════')
  console.log(`  Parse AR + Credit Hold → Builder / ArHistorySnapshot`)
  console.log(`  Mode: ${mode}   Snapshot date: ${SNAPSHOT_DATE}`)
  console.log('═══════════════════════════════════════════════\n')

  // 1. Load builders
  const builders = await sql.query(
    `SELECT id, "companyName", "creditLimit", "accountBalance", status
       FROM "Builder"
      WHERE status = 'ACTIVE' OR "accountBalance" <> 0 OR "creditLimit" IS NOT NULL
      ORDER BY "companyName"`,
  )
  console.log(`Loaded ${builders.length} candidate builders from DB.`)

  // 2. Parse spreadsheets
  const trueMap = parseTrueArAging()
  const masterMap = parseMasterArAging()
  const aging = mergeAging(trueMap, masterMap)
  const creditHoldRows = parseCreditHold()
  console.log(
    `Parsed: ${trueMap.size} customers in True AR, ${masterMap.size} in Master AR, merged → ${aging.size}.`,
  )
  console.log(
    `Credit-Hold file: ${creditHoldRows.length} SO rows (Boise PO holds, no per-builder limit column).`,
  )

  // 3. Canonicalize customers → builders
  const matches = [] // { customerName, builder, aging }
  const unmatched = []
  for (const [custName, a] of aging.entries()) {
    const b = canonicalizeCustomer(custName, builders)
    if (b) {
      matches.push({ customerName: custName, builder: b, aging: a })
    } else {
      unmatched.push({ customerName: custName, total: a.total })
    }
  }
  console.log(`\nMatched: ${matches.length}/${aging.size} customers to Builder rows.`)
  if (unmatched.length) {
    console.log(`Unmatched customers (${unmatched.length}):`)
    for (const u of unmatched) {
      console.log(`  • "${u.customerName}" → ${fmt$(u.total)} AR (create Builder or add synonym)`)
    }
  }

  // 4. Ensure ArHistorySnapshot table exists
  if (COMMIT) {
    console.log(`\nEnsuring ArHistorySnapshot table exists...`)
    await sql.query(`
      CREATE TABLE IF NOT EXISTS "ArHistorySnapshot" (
        id              TEXT PRIMARY KEY,
        "builderId"     TEXT NOT NULL,
        "snapshotDate"  DATE NOT NULL,
        "total"         DOUBLE PRECISION NOT NULL DEFAULT 0,
        "current"       DOUBLE PRECISION NOT NULL DEFAULT 0,
        "bucket31_60"   DOUBLE PRECISION NOT NULL DEFAULT 0,
        "bucket61_90"   DOUBLE PRECISION NOT NULL DEFAULT 0,
        "bucket90_plus" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "noInvoiceDate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "primarySource" TEXT,
        "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await sql.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ArHistorySnapshot_builder_date_unique"
        ON "ArHistorySnapshot"("builderId", "snapshotDate")
    `)
    await sql.query(`
      CREATE INDEX IF NOT EXISTS "ArHistorySnapshot_builderId_idx"
        ON "ArHistorySnapshot"("builderId")
    `)
    await sql.query(`
      CREATE INDEX IF NOT EXISTS "ArHistorySnapshot_snapshotDate_idx"
        ON "ArHistorySnapshot"("snapshotDate")
    `)
    // FK (best effort — won't fail the run if Builder missing for some reason)
    try {
      await sql.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ArHistorySnapshot_builderId_fkey'
          ) THEN
            ALTER TABLE "ArHistorySnapshot"
              ADD CONSTRAINT "ArHistorySnapshot_builderId_fkey"
              FOREIGN KEY ("builderId") REFERENCES "Builder"(id) ON DELETE CASCADE;
          END IF;
        END $$;
      `)
    } catch (e) {
      console.log(`  (FK attach skipped: ${e.message})`)
    }
    console.log(`  OK`)
  } else {
    console.log(`\n[dry-run] Would create ArHistorySnapshot table + indexes + FK.`)
  }

  // 5. Per-builder report + writes
  console.log(`\nPer-builder changes (${matches.length} rows):`)
  console.log(
    [
      '  Builder'.padEnd(38),
      'Before bal'.padStart(14),
      'After bal'.padStart(14),
      'Δ'.padStart(12),
      'Current'.padStart(11),
      '31-60'.padStart(10),
      '61-90'.padStart(10),
      '90+'.padStart(10),
      'NoInvDt'.padStart(10),
      'src'.padStart(6),
    ].join(' '),
  )
  console.log('  ' + '─'.repeat(130))

  let totalBefore = 0
  let totalAfter = 0
  let updates = 0
  let snapshots = 0

  for (const { customerName, builder, aging: a } of matches) {
    const before = builder.accountBalance ?? 0
    const after = a.total
    const delta = after - before
    totalBefore += before
    totalAfter += after

    console.log(
      [
        '  ' + builder.companyName.padEnd(36).slice(0, 36),
        fmt$(before).padStart(14),
        fmt$(after).padStart(14),
        (delta >= 0 ? '+' : '') + fmt$(delta).padStart(11),
        fmt$(a.current).padStart(11),
        fmt$(a.d31_60).padStart(10),
        fmt$(a.d61_90).padStart(10),
        fmt$(a.d90p).padStart(10),
        fmt$(a.noInvoiceDate).padStart(10),
        a.primarySource.padStart(6),
      ].join(' '),
    )

    if (VERBOSE) {
      console.log(
        `      spreadsheet customer: "${customerName}"  (creditLimit unchanged: ${
          builder.creditLimit == null ? 'NULL' : fmt$(builder.creditLimit)
        })`,
      )
    }

    if (COMMIT) {
      // Update accountBalance
      await sql.query(
        `UPDATE "Builder" SET "accountBalance" = $1 WHERE id = $2`,
        [after, builder.id],
      )
      updates++

      // Insert snapshot (idempotent via unique index)
      const snapId = `arhs_${builder.id}_${SNAPSHOT_DATE}`.replace(/[^a-zA-Z0-9_]/g, '')
      await sql.query(
        `INSERT INTO "ArHistorySnapshot"
           (id, "builderId", "snapshotDate", "total", "current",
            "bucket31_60", "bucket61_90", "bucket90_plus", "noInvoiceDate", "primarySource")
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ("builderId", "snapshotDate") DO UPDATE SET
           "total" = EXCLUDED."total",
           "current" = EXCLUDED."current",
           "bucket31_60" = EXCLUDED."bucket31_60",
           "bucket61_90" = EXCLUDED."bucket61_90",
           "bucket90_plus" = EXCLUDED."bucket90_plus",
           "noInvoiceDate" = EXCLUDED."noInvoiceDate",
           "primarySource" = EXCLUDED."primarySource"`,
        [
          snapId,
          builder.id,
          SNAPSHOT_DATE,
          a.total,
          a.current,
          a.d31_60,
          a.d61_90,
          a.d90p,
          a.noInvoiceDate,
          a.primarySource,
        ],
      )
      snapshots++
    }
  }

  console.log('  ' + '─'.repeat(130))
  console.log(
    '  ' +
      'TOTAL'.padEnd(36) +
      ' ' +
      fmt$(totalBefore).padStart(14) +
      ' ' +
      fmt$(totalAfter).padStart(14) +
      ' ' +
      (totalAfter - totalBefore >= 0 ? '+' : '') +
      fmt$(totalAfter - totalBefore).padStart(11),
  )

  // 6. Credit hold diagnostic
  const holdTotal = creditHoldRows.reduce((s, r) => s + (r.creditHoldAmt || 0), 0)
  const stillOnHold = creditHoldRows.filter((r) => /still on hold/i.test(r.emailStatus || ''))
  const requested = creditHoldRows.filter((r) => /requested/i.test(r.emailStatus || ''))
  const confirmed = creditHoldRows.filter((r) => /boise confirmed/i.test(r.emailStatus || ''))
  console.log(
    `\nCredit-hold analysis summary (informational — no Builder.creditLimit column in file):`,
  )
  console.log(`  Total on-hold PO value:     ${fmt$(holdTotal)} (${creditHoldRows.length} SOs)`)
  console.log(`  Still on Hold:              ${stillOnHold.length} SOs`)
  console.log(`  Requested Release:          ${requested.length} SOs`)
  console.log(`  Boise Confirmed Done:       ${confirmed.length} SOs`)
  console.log(
    `  NOTE: Builder.creditLimit left untouched (task spec: only update if recommended-limit column present).`,
  )

  // 7. Summary
  console.log(`\n═══════════════════════════════════════════════`)
  console.log(`  Summary`)
  console.log(`═══════════════════════════════════════════════`)
  console.log(`  Mode:              ${mode}`)
  console.log(`  Builders matched:  ${matches.length}`)
  console.log(`  Unmatched:         ${unmatched.length}`)
  if (COMMIT) {
    console.log(`  Builder updates:   ${updates}`)
    console.log(`  Snapshots written: ${snapshots}`)
  } else {
    console.log(`  (Run with --commit to write. Re-run to see no-op.)`)
  }
  console.log('')
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
