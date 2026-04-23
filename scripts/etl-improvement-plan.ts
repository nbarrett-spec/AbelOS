/**
 * scripts/etl-improvement-plan.ts
 *
 * Loads Abel_Comprehensive_Improvement_Plan.xlsx into the Aegis `InboxItem`
 * table so the punch-list of 60+ strategic actions surfaces in the inbox UI
 * alongside MRP / collections / agent-hub items.
 *
 * Source sheets ingested (one row per action, header rows skipped):
 *   1. Pricing Fixes (URGENT)          — Issue | Current Margin | Target | Revenue at Risk | Margin Gain | Action
 *   2. Inventory Recovery              — Action | Value Tied Up | Expected Recovery | Timeline | Status
 *   3. Supplier Strategy               — Initiative | Annual Spend | Target Savings | Savings% | Action | Status
 *   4. Revenue Growth                  — Opportunity | Revenue Potential | Target GM | Probability | Next Step | Timeline
 *   5. Org & Operations                — Issue | Cost | Annual Benefit | Priority | Action
 *   6. Risk Register                   — Risk | Likelihood | Impact | $ Exposure | Mitigation
 *   7. 90-Day Action Plan              — Task | Impact | Owner | Expected Result | Status (grouped by WEEK section)
 *
 * Sheet 0 (Executive Summary) and Sheet 8 (Email Log) are skipped — narrative
 * and outbound-log rather than actionable items.
 *
 * Idempotency:
 *   Each row gets a deterministic entityId hash derived from
 *     `${sheetKey}|${rowIndex}|${title}`
 *   We look up InboxItem by (source='improvement-plan-v1', entityType='ImprovementPlan', entityId=hash)
 *   and upsert. Re-runs update mutable fields without creating duplicates.
 *
 * Modes:
 *   (default)  DRY-RUN: prints diff, writes nothing
 *   --commit   applies create/update
 *
 * Usage:
 *   npx tsx scripts/etl-improvement-plan.ts
 *   npx tsx scripts/etl-improvement-plan.ts --commit
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'improvement-plan-v1'
const ENTITY_TYPE = 'ImprovementPlan'
const FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'Abel_Comprehensive_Improvement_Plan.xlsx',
)

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SNOOZED' | 'EXPIRED' | 'COMPLETED'

interface Item {
  entityId: string
  sheet: string
  title: string
  description: string
  priority: Priority
  status: Status
  type: string
  financialImpact: number | null
  actionData: Record<string, unknown>
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).replace(/[$,%\s]/g, '')
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function deterministicId(sheetKey: string, rowIdx: number, title: string): string {
  return crypto
    .createHash('sha1')
    .update(`${SOURCE_TAG}|${sheetKey}|${rowIdx}|${title.toLowerCase()}`)
    .digest('hex')
    .slice(0, 24)
}

function mapPriorityWord(raw: string): Priority | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  if (s.startsWith('CRIT')) return 'CRITICAL'
  if (s.startsWith('HIGH')) return 'HIGH'
  if (s.startsWith('MED')) return 'MEDIUM'
  if (s.startsWith('LOW')) return 'LOW'
  if (s === 'DO NOW' || s === 'URGENT') return 'CRITICAL'
  return null
}

function mapStatusWord(raw: string): Status | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  if (s.includes('DONE') || s.includes('COMPLETE') || s === 'SENT') return 'COMPLETED'
  if (s.includes('PENDING') || s === 'DO NOW' || s === 'TODO' || s === 'IN PROGRESS') return 'PENDING'
  return null
}

// Combine any trailing non-null cells into a readable description blob.
function joinDetail(pairs: Array<[string, unknown]>): string {
  const parts: string[] = []
  for (const [label, v] of pairs) {
    const s = normStr(v)
    if (!s) continue
    parts.push(`${label}: ${s}`)
  }
  return parts.join(' | ')
}

// ── Sheet-specific extractors ────────────────────────────────────────────────
//
// Each sheet has its own header row (at row index 0) followed by data rows.
// The first column holds a running number (1, 2, 3, …). We skip rows whose
// first column isn't numeric, and we also skip section-header rows in
// Sheet 7 (e.g. "WEEK 1 — STOP THE BLEEDING") which we track as context.

function extractPricing(rows: any[]): Item[] {
  const out: Item[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = num(r['URGENT PRICING CORRECTIONS — DO THIS WEEK'])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const description = joinDetail([
      ['Current Margin', r['__EMPTY_1']],
      ['Target Margin', r['__EMPTY_2']],
      ['Revenue at Risk', r['__EMPTY_3']],
      ['Margin Gain', r['__EMPTY_4']],
      ['Action', r['__EMPTY_5']],
    ])
    out.push({
      entityId: deterministicId('pricing', i, title),
      sheet: '1. Pricing Fixes (URGENT)',
      title,
      description,
      priority: 'CRITICAL',
      status: 'PENDING',
      type: 'IMPROVEMENT_PRICING',
      financialImpact: num(r['__EMPTY_3']),
      actionData: {
        currentMargin: normStr(r['__EMPTY_1']),
        targetMargin: normStr(r['__EMPTY_2']),
        revenueAtRisk: num(r['__EMPTY_3']),
        marginGain: num(r['__EMPTY_4']),
        action: normStr(r['__EMPTY_5']),
      },
    })
  }
  return out
}

function extractInventory(rows: any[]): Item[] {
  const out: Item[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = num(r['INVENTORY RECOVERY — $686K TIED UP'])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const statusRaw = normStr(r['__EMPTY_4'])
    out.push({
      entityId: deterministicId('inventory', i, title),
      sheet: '2. Inventory Recovery',
      title,
      description: joinDetail([
        ['Value Tied Up', r['__EMPTY_1']],
        ['Expected Recovery', r['__EMPTY_2']],
        ['Timeline', r['__EMPTY_3']],
        ['Status', r['__EMPTY_4']],
      ]),
      priority: 'HIGH',
      status: mapStatusWord(statusRaw) ?? 'PENDING',
      type: 'IMPROVEMENT_INVENTORY',
      financialImpact: num(r['__EMPTY_2']) ?? num(r['__EMPTY_1']),
      actionData: {
        valueTiedUp: num(r['__EMPTY_1']),
        expectedRecovery: num(r['__EMPTY_2']),
        timeline: normStr(r['__EMPTY_3']),
        status: statusRaw,
      },
    })
  }
  return out
}

function extractSupplier(rows: any[]): Item[] {
  const out: Item[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = num(r['SUPPLIER DIVERSIFICATION & COST REDUCTION'])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const statusRaw = normStr(r['__EMPTY_5'])
    out.push({
      entityId: deterministicId('supplier', i, title),
      sheet: '3. Supplier Strategy',
      title,
      description: joinDetail([
        ['Annual Spend', r['__EMPTY_1']],
        ['Target Savings', r['__EMPTY_2']],
        ['Savings %', r['__EMPTY_3']],
        ['Action', r['__EMPTY_4']],
        ['Status', r['__EMPTY_5']],
      ]),
      priority: 'HIGH',
      status: mapStatusWord(statusRaw) ?? 'PENDING',
      type: 'IMPROVEMENT_SUPPLIER',
      financialImpact: num(r['__EMPTY_2']),
      actionData: {
        annualSpend: num(r['__EMPTY_1']),
        targetSavings: num(r['__EMPTY_2']),
        savingsPct: num(r['__EMPTY_3']),
        action: normStr(r['__EMPTY_4']),
        status: statusRaw,
      },
    })
  }
  return out
}

function extractRevenue(rows: any[]): Item[] {
  const out: Item[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = num(r['REVENUE GROWTH — PATH TO $20M+'])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const probability = num(r['__EMPTY_3']) // 0-1
    const priority: Priority =
      probability !== null && probability >= 0.7
        ? 'HIGH'
        : probability !== null && probability >= 0.4
          ? 'MEDIUM'
          : 'LOW'
    out.push({
      entityId: deterministicId('revenue', i, title),
      sheet: '4. Revenue Growth',
      title,
      description: joinDetail([
        ['Revenue Potential', r['__EMPTY_1']],
        ['Target GM', r['__EMPTY_2']],
        ['Probability', r['__EMPTY_3']],
        ['Next Step', r['__EMPTY_4']],
        ['Timeline', r['__EMPTY_5']],
      ]),
      priority,
      status: 'PENDING',
      type: 'IMPROVEMENT_REVENUE',
      financialImpact: num(r['__EMPTY_1']),
      actionData: {
        revenuePotential: num(r['__EMPTY_1']),
        targetGM: num(r['__EMPTY_2']),
        probability,
        nextStep: normStr(r['__EMPTY_4']),
        timeline: normStr(r['__EMPTY_5']),
      },
    })
  }
  return out
}

function extractOrgOps(rows: any[]): Item[] {
  const out: Item[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = num(r['ORGANIZATIONAL & OPERATIONAL IMPROVEMENTS'])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const prioRaw = normStr(r['__EMPTY_3'])
    out.push({
      entityId: deterministicId('orgops', i, title),
      sheet: '5. Org & Operations',
      title,
      description: joinDetail([
        ['Cost', r['__EMPTY_1']],
        ['Annual Benefit', r['__EMPTY_2']],
        ['Priority', r['__EMPTY_3']],
        ['Action', r['__EMPTY_4']],
      ]),
      priority: mapPriorityWord(prioRaw) ?? 'MEDIUM',
      status: 'PENDING',
      type: 'IMPROVEMENT_ORG',
      financialImpact: num(r['__EMPTY_2']),
      actionData: {
        cost: num(r['__EMPTY_1']),
        annualBenefit: num(r['__EMPTY_2']),
        priorityRaw: prioRaw,
        action: normStr(r['__EMPTY_4']),
      },
    })
  }
  return out
}

function extractRisk(rows: any[]): Item[] {
  const out: Item[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const n = num(r['RISK REGISTER — TOP THREATS'])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const impact = normStr(r['__EMPTY_2']).toUpperCase()
    const priority: Priority =
      impact.includes('CRIT')
        ? 'CRITICAL'
        : impact.includes('HIGH')
          ? 'HIGH'
          : impact.includes('MED')
            ? 'MEDIUM'
            : 'LOW'
    out.push({
      entityId: deterministicId('risk', i, title),
      sheet: '6. Risk Register',
      title: `RISK: ${title}`,
      description: joinDetail([
        ['Likelihood', r['__EMPTY_1']],
        ['Impact', r['__EMPTY_2']],
        ['$ Exposure', r['__EMPTY_3']],
        ['Mitigation', r['__EMPTY_4']],
      ]),
      priority,
      status: 'PENDING',
      type: 'IMPROVEMENT_RISK',
      financialImpact: num(r['__EMPTY_3']),
      actionData: {
        likelihood: normStr(r['__EMPTY_1']),
        impact: normStr(r['__EMPTY_2']),
        exposure: num(r['__EMPTY_3']),
        mitigation: normStr(r['__EMPTY_4']),
      },
    })
  }
  return out
}

function extract90Day(rows: any[]): Item[] {
  const out: Item[] = []
  let section = 'WEEK 1'
  const firstCol = '90-DAY EXECUTION ROADMAP'
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const c0 = normStr(r[firstCol])
    if (!c0) continue
    // Section header — all other cols null
    if (/^WEEK\b/i.test(c0) || /^MONTH\b/i.test(c0)) {
      section = c0
      continue
    }
    // Row-local header (the literal "#") — skip
    if (c0 === '#') continue
    const n = num(r[firstCol])
    if (n === null) continue
    const title = normStr(r['__EMPTY'])
    if (!title) continue
    const statusRaw = normStr(r['__EMPTY_4'])
    const priority: Priority =
      /WEEK 1|WEEK 2/i.test(section) ? 'CRITICAL' : /WEEK/i.test(section) ? 'HIGH' : 'MEDIUM'
    out.push({
      entityId: deterministicId('90day', i, `${section}|${title}`),
      sheet: '7. 90-Day Action Plan',
      title: `[${section}] ${title}`,
      description: joinDetail([
        ['Impact', r['__EMPTY_1']],
        ['Owner', r['__EMPTY_2']],
        ['Expected Result', r['__EMPTY_3']],
        ['Status', r['__EMPTY_4']],
      ]),
      priority,
      status: mapStatusWord(statusRaw) ?? 'PENDING',
      type: 'IMPROVEMENT_90DAY',
      financialImpact: num(r['__EMPTY_1']),
      actionData: {
        section,
        impact: normStr(r['__EMPTY_1']),
        owner: normStr(r['__EMPTY_2']),
        expectedResult: normStr(r['__EMPTY_3']),
        status: statusRaw,
      },
    })
  }
  return out
}

async function main() {
  console.log(`ETL improvement-plan — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)

  const wb = XLSX.readFile(FILE)
  const items: Item[] = []

  const loaders: Array<[string, (rows: any[]) => Item[]]> = [
    ['1. Pricing Fixes (URGENT)', extractPricing],
    ['2. Inventory Recovery', extractInventory],
    ['3. Supplier Strategy', extractSupplier],
    ['4. Revenue Growth', extractRevenue],
    ['5. Org & Operations', extractOrgOps],
    ['6. Risk Register', extractRisk],
    ['7. 90-Day Action Plan', extract90Day],
  ]
  for (const [name, fn] of loaders) {
    if (!wb.SheetNames.includes(name)) {
      console.warn(`  (sheet missing: "${name}" — skipping)`)
      continue
    }
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[name], { defval: null })
    const extracted = fn(rows)
    console.log(`  sheet "${name}": ${rows.length} raw rows → ${extracted.length} items`)
    items.push(...extracted)
  }

  // Detect dup entityIds (shouldn't happen — safeguard)
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const it of items) {
    if (seen.has(it.entityId)) dupes.push(it.entityId)
    else seen.add(it.entityId)
  }
  if (dupes.length > 0) {
    console.warn(`  WARN: ${dupes.length} duplicate entityId(s) — consider tweaking hash input`)
  }

  console.log(`\nTotal items parsed: ${items.length}`)
  if (items.length === 0) { console.log('Nothing to do.'); return }

  const prisma = new PrismaClient()
  try {
    // NOTE: Use raw SQL for both reads and writes. The Prisma-generated client
    // expects an `InboxItem.brainAcknowledgedAt` column that hasn't been migrated
    // into this Neon DB yet; `findMany`/`create` both fail with a column-missing
    // error. Raw SQL lets us work column-by-column and avoid the drift.
    type ExistingRow = {
      id: string
      entityId: string | null
      title: string
      description: string | null
      priority: string
      status: string
      type: string
      financialImpact: number | null
      actionData: unknown
    }
    const existing = await prisma.$queryRawUnsafe<ExistingRow[]>(
      `SELECT id, "entityId", title, description, priority, status, type, "financialImpact", "actionData"
         FROM "InboxItem"
         WHERE source = $1 AND "entityType" = $2`,
      SOURCE_TAG,
      ENTITY_TYPE,
    )
    const byEntityId = new Map(existing.map((e) => [e.entityId ?? '', e]))
    console.log(`Existing improvement-plan InboxItems: ${existing.length}`)

    let toCreate = 0
    let toUpdate = 0
    let unchanged = 0
    const updatePlans: Array<{
      id: string
      entityId: string
      title: string
      changes: string[]
      data: Record<string, unknown>
    }> = []
    const creates: Item[] = []

    for (const it of items) {
      const hit = byEntityId.get(it.entityId)
      if (!hit) { creates.push(it); toCreate++; continue }
      const changes: string[] = []
      const data: Record<string, unknown> = {}
      if (hit.title !== it.title) { changes.push(`title`); data.title = it.title }
      if ((hit.description ?? '') !== it.description) { changes.push(`description`); data.description = it.description }
      if (hit.type !== it.type) { changes.push(`type`); data.type = it.type }
      if (hit.priority !== it.priority) { changes.push(`priority`); data.priority = it.priority }
      // Don't clobber user-driven status transitions (APPROVED/REJECTED/SNOOZED/COMPLETED)
      // but do sync the XLSX's status when it's still PENDING in DB and XLSX has a new value.
      if (hit.status === 'PENDING' && it.status !== hit.status) {
        changes.push(`status`); data.status = it.status
      }
      if ((hit.financialImpact ?? null) !== (it.financialImpact ?? null)) {
        changes.push(`financialImpact`); data.financialImpact = it.financialImpact
      }
      // actionData — canonical-JSON compare (jsonb round-trips may reorder keys)
      const canon = (x: unknown): string => {
        if (x === null || x === undefined) return 'null'
        if (typeof x !== 'object') return JSON.stringify(x)
        if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']'
        const o = x as Record<string, unknown>
        const keys = Object.keys(o).sort()
        return '{' + keys.map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
      }
      const prev = canon(hit.actionData)
      const next = canon(it.actionData)
      if (prev !== next) { changes.push(`actionData`); data.actionData = it.actionData as any }

      if (changes.length > 0) {
        updatePlans.push({ id: hit.id, entityId: it.entityId, title: it.title, changes, data })
        toUpdate++
      } else {
        unchanged++
      }
    }

    console.log()
    console.log('=== SUMMARY ===')
    console.log(`  Parsed items     : ${items.length}`)
    console.log(`  Existing records : ${existing.length}`)
    console.log(`  To create        : ${toCreate}`)
    console.log(`  To update        : ${toUpdate}`)
    console.log(`  Unchanged        : ${unchanged}`)

    if (creates.length > 0) {
      console.log(`\nSample creates (first 5 of ${creates.length}):`)
      creates.slice(0, 5).forEach((c) => {
        console.log(`  + [${c.priority}] ${c.type} — ${c.title}`)
        if (c.description) console.log(`      ${c.description.slice(0, 160)}`)
      })
    }
    if (updatePlans.length > 0) {
      console.log(`\nSample updates (first 5 of ${updatePlans.length}):`)
      updatePlans.slice(0, 5).forEach((u) => {
        console.log(`  ~ ${u.title} — changes: ${u.changes.join(', ')}`)
      })
    }

    if (DRY_RUN) {
      console.log('\nDRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('\nCOMMIT — applying...')
    let created = 0, updated = 0, failed = 0

    // Raw SQL insert — lets us list only real columns and bypass the Prisma
    // schema drift (missing brainAcknowledgedAt in DB). Primary key `id` uses
    // cuid from Node since the Postgres column has no default.
    function cuidish(): string {
      // lightweight, unique-enough id in the cuid shape: c + 24 random chars
      return 'c' + crypto.randomBytes(12).toString('hex')
    }

    for (const c of creates) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InboxItem"
             (id, type, source, title, description, priority, status,
              "entityType", "entityId", "financialImpact", "actionData",
              "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())`,
          cuidish(),
          c.type,
          SOURCE_TAG,
          c.title,
          c.description || null,
          c.priority,
          c.status,
          ENTITY_TYPE,
          c.entityId,
          c.financialImpact,
          JSON.stringify(c.actionData),
        )
        created++
      } catch (e) {
        failed++
        console.error(`  FAIL create "${c.title}":`, (e as Error).message)
      }
    }

    for (const u of updatePlans) {
      try {
        // Build a dynamic SET clause from only the changed fields.
        const sets: string[] = []
        const vals: unknown[] = []
        let i = 1
        for (const [k, v] of Object.entries(u.data)) {
          if (k === 'actionData') {
            sets.push(`"actionData" = $${i}::jsonb`)
            vals.push(JSON.stringify(v))
          } else if (k === 'financialImpact') {
            sets.push(`"financialImpact" = $${i}`)
            vals.push(v)
          } else {
            sets.push(`"${k}" = $${i}`)
            vals.push(v)
          }
          i++
        }
        sets.push(`"updatedAt" = NOW()`)
        vals.push(u.id)
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem" SET ${sets.join(', ')} WHERE id = $${i}`,
          ...vals,
        )
        updated++
      } catch (e) {
        failed++
        console.error(`  FAIL update "${u.title}":`, (e as Error).message.slice(0, 300))
      }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
