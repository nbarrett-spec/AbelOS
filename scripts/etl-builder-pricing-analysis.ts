/**
 * scripts/etl-builder-pricing-analysis.ts
 *
 * Source: Abel_Builder_Pricing_Analysis.xlsx (generated March 20, 2026 from
 * InFlow Product Details Export).
 *
 * Classification: ANALYTICAL SNAPSHOT — NOT new pricing targets.
 *   - "Builder Detail" sheet holds the pre-Rev2/Q4Q1 state of BuilderPricing
 *     (as of 3/20). Loading it back would OVERWRITE newer Rev2 (commit
 *     ed0380a) and Q4Q1 (commit fb4b3e3) values. We do NOT write to
 *     BuilderPricing from this workbook.
 *   - The remaining sheets are diagnostic: below-cost list, category margins,
 *     top 100 products by revenue, builder account health rollup, payment
 *     term pricing model proposal, and strategic recommendations.
 *
 * Output: a small number of InboxItem rows summarizing the analysis so Nate
 * sees the findings without a new ETL for each chart.
 *
 *   IB #1 (CRITICAL) — Below-cost rollup (71 SKUs, ~$18.5K annual impact)
 *   IB #2 (HIGH)     — Builder account health: CRITICAL/WARNING accounts
 *   IB #3 (MEDIUM)   — Strategic pricing recommendations + payment tier model
 *
 * Source tag: BUILDER_PRICING_ANALYSIS_V1_MAR2026
 *
 * Run:
 *   npx tsx scripts/etl-builder-pricing-analysis.ts            # dry-run
 *   npx tsx scripts/etl-builder-pricing-analysis.ts --commit   # write InboxItems
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Builder_Pricing_Analysis.xlsx')
const SOURCE_TAG = 'BUILDER_PRICING_ANALYSIS_V1_MAR2026'

function hashId(tag: string, k: string): string {
  return 'ib_bpa_' + crypto.createHash('sha256').update(`${tag}::${k}`).digest('hex').slice(0, 18)
}
function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%]/g, ''))
  return Number.isFinite(n) ? n : null
}

type Item = {
  id: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  financialImpact: number | null
  source: string
}

function buildBelowCostItem(wb: XLSX.WorkBook): Item | null {
  const ws = wb.Sheets['Below Cost Alert']
  if (!ws) return null
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null })
  if (!rows.length) return null
  const totalLoss = rows.reduce((s, r) => s + (toNum(r['Loss Per Unit']) ?? 0), 0)
  const revLost = rows.reduce((s, r) => s + (toNum(r['Revenue Lost vs List']) ?? 0), 0)
  const byBuilder: Record<string, number> = {}
  for (const r of rows) {
    const b = normStr(r['Builder']) || 'UNKNOWN'
    byBuilder[b] = (byBuilder[b] || 0) + 1
  }
  const builderBreak = Object.entries(byBuilder)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([b, n]) => `${b}: ${n}`)
    .join(', ')

  const top = rows
    .slice()
    .sort((a, b) => (toNum(a['Loss Per Unit']) ?? 0) - (toNum(b['Loss Per Unit']) ?? 0))
    .slice(0, 8)
    .map((r) => {
      const sku = normStr(r['SKU'])
      const name = normStr(r['Product Name']).slice(0, 50)
      const cost = toNum(r['Unit Cost']) ?? 0
      const price = toNum(r['Builder Price']) ?? 0
      const builder = normStr(r['Builder'])
      return `  ${sku} [${builder}] cost $${cost.toFixed(2)} priced $${price.toFixed(2)} — ${name}`
    })
    .join('\n')

  const desc = `${rows.length} SKU/builder combos priced below cost as of 3/20/2026 snapshot.\n\n` +
    `Total loss per unit (sum): $${totalLoss.toFixed(2)}\n` +
    `Revenue lost vs list price: $${revLost.toFixed(0)}\n\n` +
    `By builder: ${builderBreak}\n\n` +
    `Worst 8 by loss per unit:\n${top}\n\n` +
    `Source: Abel_Builder_Pricing_Analysis.xlsx (InFlow 3/20 export). ` +
    `Note: Rev2 and Q4Q1 rebuilds since then may have corrected some of these — ` +
    `cross-check against current BuilderPricing before acting.`

  return {
    id: hashId(SOURCE_TAG, 'below-cost-rollup'),
    title: `[Pricing Analysis 3/20] ${rows.length} below-cost SKUs — $${(revLost).toFixed(0)} revenue at stake`,
    description: desc.slice(0, 2000),
    priority: 'CRITICAL',
    financialImpact: revLost,
    source: 'builder-pricing-analysis',
  }
}

function buildAccountHealthItem(wb: XLSX.WorkBook): Item | null {
  const ws = wb.Sheets['Executive Summary']
  if (!ws) return null
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null }) as any[][]
  // Find builder-health header row
  const hdrIdx = rows.findIndex((r) => r[0] === 'Builder' && r[9] === 'Risk Level')
  if (hdrIdx < 0) return null
  const accounts: Array<{ builder: string; count: number; margin: number; gap: number; revGap: number; risk: string }> = []
  for (const r of rows.slice(hdrIdx + 1)) {
    if (!r[0] || typeof r[0] !== 'string') break
    const risk = normStr(r[9])
    if (!risk) break
    accounts.push({
      builder: normStr(r[0]),
      count: toNum(r[1]) ?? 0,
      margin: (toNum(r[2]) ?? 0) * 100,
      gap: (toNum(r[4]) ?? 0) * 100,
      revGap: toNum(r[8]) ?? 0,
      risk,
    })
  }
  if (!accounts.length) return null

  const critical = accounts.filter((a) => a.risk === 'CRITICAL')
  const warning = accounts.filter((a) => a.risk === 'WARNING')
  const watch = accounts.filter((a) => a.risk === 'WATCH')
  const totalRevGap = accounts.reduce((s, a) => s + a.revGap, 0)

  const fmtAcct = (a: { builder: string; count: number; margin: number; revGap: number }) =>
    `  ${a.builder.padEnd(28)} ${a.count.toString().padStart(4)} SKUs  margin ${a.margin.toFixed(1)}%  revenue gap $${a.revGap.toFixed(0)}`

  const desc = `Builder account health rollup from 3/20/2026 InFlow snapshot. ` +
    `Revenue gap = what would be earned at 60% list margin minus actual builder price.\n\n` +
    `CRITICAL (${critical.length}):\n${critical.map(fmtAcct).join('\n') || '  (none)'}\n\n` +
    `WARNING (${warning.length}):\n${warning.map(fmtAcct).join('\n') || '  (none)'}\n\n` +
    `WATCH (${watch.length}):\n${watch.slice(0, 8).map(fmtAcct).join('\n') || '  (none)'}\n\n` +
    `Total revenue gap across all accounts: $${totalRevGap.toFixed(0)}.\n\n` +
    `Note: Pulte was LOST 4/20 — its $46K gap is no longer recoverable at Abel. ` +
    `Brookfield's $77K gap is live and partly addressed by Rev2 + Q4Q1 rebuild.`

  return {
    id: hashId(SOURCE_TAG, 'account-health-rollup'),
    title: `[Pricing Analysis 3/20] Account health: ${critical.length} CRITICAL / ${warning.length} WARNING — $${totalRevGap.toFixed(0)} revenue gap`,
    description: desc.slice(0, 2000),
    priority: 'HIGH',
    financialImpact: totalRevGap,
    source: 'builder-pricing-analysis',
  }
}

function buildStrategyItem(wb: XLSX.WorkBook): Item | null {
  const tierWs = wb.Sheets['Payment Term Model']
  const recWs = wb.Sheets['Pricing Recommendations']
  if (!tierWs && !recWs) return null

  const tierRows = tierWs ? (XLSX.utils.sheet_to_json<any[]>(tierWs, { header: 1, defval: null }) as any[][]) : []
  const baseMargin = toNum(tierRows.find((r) => normStr(r[0]).startsWith('Base Margin'))?.[1]) ?? 0.35
  const payAtOrder = toNum(tierRows.find((r) => normStr(r[0]).startsWith('Pay at Order'))?.[1]) ?? 0.03
  const net15 = toNum(tierRows.find((r) => normStr(r[0]).startsWith('Net 15'))?.[1]) ?? 0.01
  const net30 = toNum(tierRows.find((r) => normStr(r[0]).startsWith('Net 30'))?.[1]) ?? 0.025

  const recRows = recWs ? (XLSX.utils.sheet_to_json<any[]>(recWs, { header: 1, defval: null }) as any[][]) : []
  const actions: string[] = []
  let sumImpact = 0
  for (const r of recRows) {
    const pri = normStr(r[0])
    if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(pri)) continue
    const action = normStr(r[1])
    const who = normStr(r[2])
    const impactStr = normStr(r[3])
    const impact = toNum(impactStr) ?? 0
    sumImpact += impact
    actions.push(`  [${pri}] ${action} — ${who} — ${impactStr}`)
  }

  const desc = `Strategic pricing recommendations from 3/20/2026 analysis.\n\n` +
    `PROPOSED PAYMENT-TERM TIER MODEL:\n` +
    `  Base margin target: ${(baseMargin * 100).toFixed(0)}%\n` +
    `  Pay at Order discount: ${(payAtOrder * 100).toFixed(1)}%\n` +
    `  Net 15 premium: ${(net15 * 100).toFixed(1)}%\n` +
    `  Net 30 premium: ${(net30 * 100).toFixed(1)}%\n` +
    `  Intent: replace flat discounts with standardized tier pricing keyed off ` +
    `payment terms to get predictable 30-40% margins across all accounts.\n\n` +
    `MARGIN FLOORS BY CATEGORY (proposed):\n` +
    `  Interior Doors: 35% min\n` +
    `  Exterior Doors: 40% min\n` +
    `  Trim & Casing:  32% min\n` +
    `  Patio/Sliding:  38% min\n\n` +
    `RECOMMENDED ACTIONS:\n${actions.join('\n') || '  (none)'}\n\n` +
    `Pulte tier-pricing recommendation (~$52K) is MOOT — account lost 4/20. ` +
    `Brookfield strategy ($45K) is the live priority.`

  return {
    id: hashId(SOURCE_TAG, 'strategy-rollup'),
    title: `[Pricing Analysis 3/20] Strategic recommendations + payment tier model`,
    description: desc.slice(0, 2000),
    priority: 'MEDIUM',
    financialImpact: sumImpact > 0 ? sumImpact : null,
    source: 'builder-pricing-analysis',
  }
}

async function main() {
  console.log(`ETL builder-pricing-analysis — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`File: ${FILE}`)

  const wb = XLSX.readFile(FILE)
  console.log(`Sheets: ${wb.SheetNames.join(', ')}`)

  const items: Item[] = []
  const belowCost = buildBelowCostItem(wb)
  if (belowCost) items.push(belowCost)
  const accountHealth = buildAccountHealthItem(wb)
  if (accountHealth) items.push(accountHealth)
  const strategy = buildStrategyItem(wb)
  if (strategy) items.push(strategy)

  console.log(`\nBuilt ${items.length} InboxItem(s):`)
  for (const it of items) {
    console.log(`  [${it.priority}] ${it.title}`)
    console.log(`    impact: ${it.financialImpact === null ? 'n/a' : '$' + it.financialImpact.toFixed(0)}`)
    console.log(`    id: ${it.id}`)
  }

  // Classification reminder — nothing goes to BuilderPricing.
  console.log(`\nBuilderPricing writes: 0 (workbook is analytical snapshot, not new targets).`)
  console.log(`Would NOT overwrite Rev2 (ed0380a) or Q4Q1 (fb4b3e3) pricing.`)

  if (DRY_RUN) {
    console.log(`\nDRY-RUN — re-run with --commit to write InboxItems.`)
    return
  }

  const prisma = new PrismaClient()
  let created = 0, updated = 0, failed = 0
  try {
    for (const it of items) {
      try {
        const res = await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: 'SYSTEM',
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description,
            priority: it.priority,
            status: 'PENDING',
            financialImpact: it.financialImpact ?? undefined,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description,
            priority: it.priority,
            financialImpact: it.financialImpact ?? undefined,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
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

main().catch((e) => { console.error(e); process.exit(1) })
