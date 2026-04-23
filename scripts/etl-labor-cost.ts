/**
 * scripts/etl-labor-cost.ts
 *
 * Loads the Abel Lumber Labor Cost Analysis workbook into InboxItem rows so
 * the ops team sees labor-rate intel without touching the Staff roster
 * (frozen until NUC seed completes) or Product/BuilderPricing (out of scope).
 *
 * Source file: ../Abel Lumber - Labor Cost Analysis.xlsx
 * Sheets: Payroll Data, Assumptions, Labor Allocation, Category Rates
 *
 * Classification (all InboxItem, nothing else):
 *   - Per-role loaded hourly rate         -> source `LABOR_COST_APR2026`  (11 items)
 *   - Per-category door-assembly labor    -> source `LABOR_RATES_BY_TASK` ( 7 items)
 *   - Analytical monthly-summary rollup   -> source `LABOR_COST_APR2026`  ( 1 item)
 *
 * The spreadsheet has NO per-SKU labor entries (e.g. "BC001006 LABOR-TRIM
 * $0.73/unit") — so the SKU-verify path is not triggered. If the sheet is
 * ever extended with per-SKU rows, the existing classifier branch will flag
 * them under `LABOR_RATES_BY_TASK` with a "verify against catalog" note.
 *
 * FORBIDDEN (enforced by this script never importing the models):
 *   - Staff writes   — roster frozen until NUC seed
 *   - Product writes — out of scope
 *   - BuilderPricing writes — out of scope
 *
 * Idempotency: deterministic InboxItem ids keyed by SOURCE_TAG + slug. Safe
 * to re-run; all operations are upserts.
 *
 * Hard cap: 20 InboxItems. Current production count = 19.
 *
 * Usage:
 *   npx tsx scripts/etl-labor-cost.ts           # dry run (default)
 *   npx tsx scripts/etl-labor-cost.ts --commit  # write
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_ROLES = 'LABOR_COST_APR2026'
const SOURCE_TASKS = 'LABOR_RATES_BY_TASK'
const FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'Abel Lumber - Labor Cost Analysis.xlsx',
)
const MAX_ITEMS = 20

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PayrollRow = {
  employee: string
  title: string
  costCenter: string
  hourlyRate: number
  annualSalary: number
  burdenRate: number
  loadedHourly: number
  monthlyCost: number
}

type CategoryRow = {
  category: string
  complexity: number
  laborPerDoor: number
  overheadPerDoor: number
  totalPerDoor: number
  notes: string
}

type InboxDraft = {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact: number | null
  actionData: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return (v ?? '').toString().trim()
}

function fmt$(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function footer(sheet: string): string {
  return `\n\n---\nSource: Abel Lumber - Labor Cost Analysis.xlsx (sheet: ${sheet})\nTag: ${SOURCE_ROLES} / ${SOURCE_TASKS}\nLoaded: 2026-04-22 via scripts/etl-labor-cost.ts\nDo NOT use for Staff roster writes or Product/BuilderPricing updates — advisory only.`
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parsePayroll(ws: XLSX.WorkSheet): PayrollRow[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const out: PayrollRow[] = []
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 8) continue
    const emp = str(r[0])
    if (!emp || emp === 'Employee' || emp === 'TOTALS' || emp.startsWith('ABEL LUMBER')) continue
    const title = str(r[1])
    if (!title) continue
    out.push({
      employee: emp,
      title,
      costCenter: str(r[2]),
      hourlyRate: num(r[3]),
      annualSalary: num(r[4]),
      burdenRate: num(r[5]),
      loadedHourly: num(r[6]),
      monthlyCost: num(r[7]),
    })
  }
  return out
}

function parseAssumptions(ws: XLSX.WorkSheet): Record<string, { value: number; notes: string; unit: string }> {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const out: Record<string, { value: number; notes: string; unit: string }> = {}
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    const key = str(r[0])
    if (!key || key === 'Assumption' || key.startsWith('ABEL LUMBER')) continue
    out[key] = { value: num(r[1]), notes: str(r[2]), unit: str(r[3]) }
  }
  return out
}

function parseCategoryRates(ws: XLSX.WorkSheet): CategoryRow[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const out: CategoryRow[] = []
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue
    const cat = str(r[0])
    if (!cat || cat === 'Category' || cat.startsWith('ABEL LUMBER') || cat.startsWith('Base labor')) continue
    out.push({
      category: cat,
      complexity: num(r[1]),
      laborPerDoor: num(r[2]),
      overheadPerDoor: num(r[3]),
      totalPerDoor: num(r[4]),
      notes: str(r[5]),
    })
  }
  return out
}

function parseAllocation(ws: XLSX.WorkSheet): {
  directLabor: number
  overheadAllocated: number
  totalLabor: number
  monthlyOutput: number
  laborPerDoor: number
  overheadPerDoor: number
  totalPerDoor: number
} {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null })
  const find = (label: string) => {
    for (const r of rows) {
      if (Array.isArray(r) && str(r[0]) === label) return r
    }
    return null
  }
  const directRow = find('TOTAL DIRECT PRODUCTION LABOR')
  const overheadRow = find('TOTAL OVERHEAD ALLOCATED')
  const totalRow = find('TOTAL LABOR COST / MONTH')
  const outputRow = find('Monthly Door Output')
  const perDoorRow = find('LABOR COST PER DOOR (Direct)')
  const ohPerDoorRow = find('OVERHEAD COST PER DOOR')
  const fullRow = find('FULLY LOADED LABOR COST PER DOOR')
  return {
    directLabor: directRow ? num(directRow[5]) : 0,
    overheadAllocated: overheadRow ? num(overheadRow[5]) : 0,
    totalLabor: totalRow ? num(totalRow[5]) : 0,
    monthlyOutput: outputRow ? num(outputRow[5]) : 0,
    laborPerDoor: perDoorRow ? num(perDoorRow[5]) : 0,
    overheadPerDoor: ohPerDoorRow ? num(ohPerDoorRow[5]) : 0,
    totalPerDoor: fullRow ? num(fullRow[5]) : 0,
  }
}

// ---------------------------------------------------------------------------
// Builders: per-role items
// ---------------------------------------------------------------------------

function buildRoleItems(payroll: PayrollRow[]): InboxDraft[] {
  // Collapse by title — multiple people in same role -> one item with roster.
  const byTitle = new Map<string, PayrollRow[]>()
  for (const p of payroll) {
    const arr = byTitle.get(p.title) ?? []
    arr.push(p)
    byTitle.set(p.title, arr)
  }
  const out: InboxDraft[] = []
  for (const [title, people] of byTitle) {
    const rates = people.map((p) => p.loadedHourly)
    const min = Math.min(...rates)
    const max = Math.max(...rates)
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length
    const bases = people.map((p) => p.hourlyRate)
    const baseMin = Math.min(...bases)
    const baseMax = Math.max(...bases)
    const monthlyTotal = people.reduce((a, p) => a + p.monthlyCost, 0)
    const roster = people.map((p) => `${p.employee} (base ${fmt$(p.hourlyRate)}/hr, loaded ${fmt$(p.loadedHourly)}/hr)`).join('; ')
    const costCenters = Array.from(new Set(people.map((p) => p.costCenter))).join(', ')

    const rateLabel = min === max
      ? `${fmt$(min)}/hr loaded`
      : `${fmt$(min)}–${fmt$(max)}/hr loaded (avg ${fmt$(avg)})`
    const baseLabel = baseMin === baseMax
      ? `${fmt$(baseMin)}/hr base`
      : `${fmt$(baseMin)}–${fmt$(baseMax)}/hr base`

    const description = [
      `Role: ${title}`,
      `Cost center(s): ${costCenters}`,
      `Headcount: ${people.length}`,
      `Base rate: ${baseLabel}`,
      `Fully-loaded rate: ${rateLabel} (burden 30%)`,
      `Monthly payroll burden for this role: ${fmt$(monthlyTotal)}`,
      ``,
      `Roster: ${roster}`,
      footer('Payroll Data'),
    ].join('\n')

    out.push({
      id: `labor-role-${slug(title)}`,
      type: 'AGENT_TASK',
      source: SOURCE_ROLES,
      title: `Labor rate — ${title}: ${rateLabel}`,
      description,
      priority: 'LOW',
      financialImpact: avg, // per request: financialImpact = rate
      actionData: {
        role: title,
        costCenters,
        headcount: people.length,
        loadedHourlyAvg: avg,
        loadedHourlyMin: min,
        loadedHourlyMax: max,
        baseHourlyMin: baseMin,
        baseHourlyMax: baseMax,
        monthlyBurden: monthlyTotal,
        burdenRate: 0.3,
        staff: people.map((p) => ({
          name: p.employee,
          base: p.hourlyRate,
          loaded: p.loadedHourly,
          annual: p.annualSalary,
          monthly: p.monthlyCost,
        })),
      },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Builders: per-task (door category) items
// ---------------------------------------------------------------------------

function buildCategoryItems(cats: CategoryRow[], base: number): InboxDraft[] {
  const out: InboxDraft[] = []
  for (const c of cats) {
    // Skip "no production labor" lines (SERVICE / TRIM / HARDWARE) — they
    // carry zero labor cost and are not assembly tasks.
    if (c.laborPerDoor === 0 && c.totalPerDoor === 0) continue
    const description = [
      `Task: Assemble 1 ${c.category}`,
      `Complexity factor: ${c.complexity.toFixed(2)}× (base loaded cost/door ${fmt$(base)})`,
      `Direct labor / door: ${fmt$(c.laborPerDoor)}`,
      `Allocated overhead / door: ${fmt$(c.overheadPerDoor)}`,
      `Fully-loaded labor+OH / door: ${fmt$(c.totalPerDoor)}`,
      c.notes ? `\nNotes: ${c.notes}` : '',
      footer('Category Rates'),
    ].join('\n')
    out.push({
      id: `labor-task-${slug(c.category)}`,
      type: 'AGENT_TASK',
      source: SOURCE_TASKS,
      title: `Labor cost — ${c.category}: ${fmt$(c.totalPerDoor)}/door`,
      description,
      priority: 'LOW',
      financialImpact: c.totalPerDoor,
      actionData: {
        category: c.category,
        complexityFactor: c.complexity,
        laborPerDoor: c.laborPerDoor,
        overheadPerDoor: c.overheadPerDoor,
        totalPerDoor: c.totalPerDoor,
        notes: c.notes,
      },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Builders: analytical summary
// ---------------------------------------------------------------------------

function buildSummary(
  payroll: PayrollRow[],
  alloc: ReturnType<typeof parseAllocation>,
  assumptions: Record<string, { value: number; notes: string; unit: string }>,
): InboxDraft {
  const totalAnnualPayroll = payroll.reduce((a, p) => a + p.annualSalary, 0)
  const totalMonthlyLoaded = payroll.reduce((a, p) => a + p.monthlyCost, 0)
  const headcount = payroll.length
  const byCenter = new Map<string, number>()
  for (const p of payroll) {
    byCenter.set(p.costCenter, (byCenter.get(p.costCenter) ?? 0) + p.monthlyCost)
  }
  const centerLines = Array.from(byCenter.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `  - ${c}: ${fmt$(v)}/mo`)
    .join('\n')

  const description = [
    `Company-wide labor economics (monthly basis).`,
    ``,
    `Headcount: ${headcount}`,
    `Total annual payroll (base salaries): ${fmt$(totalAnnualPayroll)}`,
    `Total monthly fully-loaded labor: ${fmt$(totalMonthlyLoaded)} (burden 30%)`,
    ``,
    `By cost center (monthly loaded):`,
    centerLines,
    ``,
    `Production allocation (Labor Allocation sheet):`,
    `  - Direct production labor / mo:   ${fmt$(alloc.directLabor)}`,
    `  - Overhead allocated to prod / mo: ${fmt$(alloc.overheadAllocated)}`,
    `  - TOTAL labor cost to prod / mo:   ${fmt$(alloc.totalLabor)}`,
    `  - Monthly door output:             ${alloc.monthlyOutput} doors`,
    `  - Labor / door (direct):           ${fmt$(alloc.laborPerDoor)}`,
    `  - Overhead / door:                 ${fmt$(alloc.overheadPerDoor)}`,
    `  - Fully-loaded labor / door:       ${fmt$(alloc.totalPerDoor)}`,
    ``,
    `Key assumptions:`,
    `  - Work hours / month: ${assumptions['Work Hours / Month']?.value ?? '?'}`,
    `  - Employer burden rate: ${((assumptions['Employer Burden Rate']?.value ?? 0) * 100).toFixed(1)}%`,
    `  - Production staff utilization: ${((assumptions['Production Staff Utilization']?.value ?? 0) * 100).toFixed(1)}%`,
    `  - Warehouse sup production %: ${((assumptions['Warehouse Supervisor Production %']?.value ?? 0) * 100).toFixed(1)}%`,
    `  - Avg doors / day: ${assumptions['Avg Doors Produced / Day']?.value ?? '?'}`,
    `  - Annual door output: ${assumptions['Annual Door Output']?.value ?? '?'}`,
    footer('Labor Allocation + Assumptions + Payroll Data'),
  ].join('\n')

  return {
    id: `labor-summary-apr2026`,
    type: 'AGENT_TASK',
    source: SOURCE_ROLES,
    title: `Labor cost summary — ${fmt$(alloc.totalLabor)}/mo, ${fmt$(alloc.totalPerDoor)}/door (Apr 2026)`,
    description,
    priority: 'MEDIUM',
    financialImpact: alloc.totalLabor,
    actionData: {
      headcount,
      totalAnnualPayroll,
      totalMonthlyLoaded,
      byCostCenter: Object.fromEntries(byCenter),
      production: alloc,
      assumptions,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`FILE NOT FOUND: ${FILE}`)
    process.exit(1)
  }
  const wb = XLSX.readFile(FILE)
  const needed = ['Payroll Data', 'Assumptions', 'Labor Allocation', 'Category Rates']
  for (const n of needed) {
    if (!wb.Sheets[n]) {
      console.error(`Missing sheet: ${n}`)
      process.exit(1)
    }
  }

  const payroll = parsePayroll(wb.Sheets['Payroll Data'])
  const assumptions = parseAssumptions(wb.Sheets['Assumptions'])
  const alloc = parseAllocation(wb.Sheets['Labor Allocation'])
  const cats = parseCategoryRates(wb.Sheets['Category Rates'])

  console.log(`Parsed: ${payroll.length} employees, ${cats.length} categories, alloc.totalLabor=${fmt$(alloc.totalLabor)}`)

  const roleItems = buildRoleItems(payroll)
  const baseLoadedPerDoor = alloc.totalPerDoor || 78.96
  const taskItems = buildCategoryItems(cats, baseLoadedPerDoor)
  const summary = buildSummary(payroll, alloc, assumptions)

  const all: InboxDraft[] = [...roleItems, ...taskItems, summary]

  console.log(`\nDrafted: roles=${roleItems.length}, tasks=${taskItems.length}, summaries=1, total=${all.length}`)

  if (all.length > MAX_ITEMS) {
    console.error(`CAP EXCEEDED: ${all.length} > ${MAX_ITEMS}`)
    process.exit(1)
  }

  console.log(`\n--- Items ---`)
  for (const it of all) {
    console.log(`  [${it.source}] ${it.id} :: ${it.title}`)
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — no writes. Re-run with --commit to persist.`)
    await prisma.$disconnect()
    return
  }

  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of all) {
      try {
        const existing = await prisma.inboxItem.findUnique({
          where: { id: it.id },
          select: { id: true },
        })
        await prisma.inboxItem.upsert({
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
            actionData: it.actionData as never,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact,
            actionData: it.actionData as never,
          },
        })
        if (existing) updated++
        else created++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 200))
      }
    }
    console.log(`\nCommitted: created=${created}, updated=${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
