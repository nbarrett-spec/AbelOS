/**
 * scripts/etl-q4q1-rebuild.ts
 *
 * Loads Brookfield + Toll Brothers per-SKU pricing-rebuild action items from
 * Abel_Account_Pricing_Rebuild_Q4Q1.xlsx. Skips Pulte (lost account as of 4/20).
 *
 * Writes InboxItem rows (NOT BuilderPricing — these are TARGETS, not agreed
 * prices; Nate decides per-item). Source tags:
 *   PRICING_REBUILD_Q4Q1_BROOKFIELD
 *   PRICING_REBUILD_Q4Q1_TOLL
 *
 * Filters: only SKUs with margin recovery >= $200 (signal, not noise).
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Account_Pricing_Rebuild_Q4Q1.xlsx')
const MIN_RECOVERY = 200

function hashId(tag: string, k: string): string {
  return 'ib_q4_' + crypto.createHash('sha256').update(`${tag}::${k}`).digest('hex').slice(0, 18)
}
function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseAccountSheet(wb: XLSX.WorkBook, sheetName: string, builderLabel: string, sourceTag: string, priorityTier: 'CRITICAL' | 'HIGH') {
  const ws = wb.Sheets[sheetName]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  // Find header row
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    if (rows[i].map(normStr).some((c) => c === 'SKU') && rows[i].map(normStr).some((c) => /Target\s*Unit\s*Price/i.test(c))) {
      hdrIdx = i; break
    }
  }
  if (hdrIdx < 0) return []
  const hdrs = rows[hdrIdx].map((h) => normStr(h))
  const col = (match: RegExp) => hdrs.findIndex((h) => match.test(h))
  const cSku = col(/^SKU$/)
  const cName = col(/Product Name/)
  const cCur = col(/Current Unit Price/)
  const cTgt = col(/Target Unit Price/)
  const cRec = col(/Margin Recovery/)
  const cCurM = col(/Current Margin%/)
  const cTgtM = col(/Target Margin%/)
  const cStatus = col(/Status/)
  const cCat = col(/Category/)

  const out: Array<{ id: string; title: string; description: string; priority: 'CRITICAL' | 'HIGH' | 'MEDIUM'; financialImpact: number; sku: string }> = []
  for (const row of rows.slice(hdrIdx + 1)) {
    const sku = normStr(row[cSku])
    if (!sku || !/^BC\d+/i.test(sku)) continue
    const name = normStr(row[cName])
    const current = toNum(row[cCur]) ?? 0
    const target = toNum(row[cTgt]) ?? 0
    const recovery = toNum(row[cRec]) ?? 0
    const curM = (toNum(row[cCurM]) ?? 0) * (Math.abs(toNum(row[cCurM]) ?? 0) > 2 ? 1 : 100)
    const tgtM = (toNum(row[cTgtM]) ?? 0) * (Math.abs(toNum(row[cTgtM]) ?? 0) > 2 ? 1 : 100)
    const status = normStr(row[cStatus])
    const cat = normStr(row[cCat])
    if (recovery < MIN_RECOVERY) continue
    if (current === 0 && target === 0) continue
    const priority = recovery >= 5000 ? priorityTier : recovery >= 1500 ? 'HIGH' : 'MEDIUM'
    out.push({
      id: hashId(sourceTag, `sku:${sku}`),
      sku,
      title: `[${builderLabel} Q4Q1] ${sku} push $${current.toFixed(2)} → $${target.toFixed(2)} — recover $${recovery.toFixed(0)}`,
      description: `${name} (${cat}). Current margin ${curM.toFixed(1)}% at $${current.toFixed(2)}, target margin ${tgtM.toFixed(1)}% at $${target.toFixed(2)}. Annual margin recovery potential: $${recovery.toFixed(2)}. Status in rebuild sheet: ${status}.`,
      priority,
      financialImpact: recovery,
    })
  }
  return out
}

async function main() {
  console.log(`ETL Q4/Q1 pricing rebuild — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  const wb = XLSX.readFile(FILE)
  const brookfield = parseAccountSheet(wb, 'BROOKFIELD Pricing', 'BROOKFIELD', 'PRICING_REBUILD_Q4Q1_BROOKFIELD', 'CRITICAL')
  const toll = parseAccountSheet(wb, 'TOLL BROTHERS Pricing', 'TOLL', 'PRICING_REBUILD_Q4Q1_TOLL', 'CRITICAL')

  console.log(`Brookfield action items: ${brookfield.length}`)
  console.log(`Toll Brothers action items: ${toll.length}`)
  const bkTotal = brookfield.reduce((s, it) => s + it.financialImpact, 0)
  const tlTotal = toll.reduce((s, it) => s + it.financialImpact, 0)
  console.log(`Brookfield total margin recovery: $${bkTotal.toFixed(0)}`)
  console.log(`Toll total margin recovery:       $${tlTotal.toFixed(0)}`)
  console.log(`Combined total:                   $${(bkTotal + tlTotal).toFixed(0)}`)
  console.log()
  console.log('Top 5 Brookfield by recovery:')
  brookfield.slice().sort((a, b) => b.financialImpact - a.financialImpact).slice(0, 5)
    .forEach((it) => console.log(`  $${it.financialImpact.toFixed(0).padStart(6)} ${it.sku}  ${it.title.slice(0, 80)}`))
  console.log('Top 5 Toll by recovery:')
  toll.slice().sort((a, b) => b.financialImpact - a.financialImpact).slice(0, 5)
    .forEach((it) => console.log(`  $${it.financialImpact.toFixed(0).padStart(6)} ${it.sku}  ${it.title.slice(0, 80)}`))
  console.log()

  if (DRY_RUN) { console.log('DRY-RUN — re-run with --commit.'); return }

  const prisma = new PrismaClient()
  let created = 0, updated = 0, failed = 0
  try {
    const all = [
      ...brookfield.map((it) => ({ ...it, source: 'pricing-rebuild-brookfield' as const })),
      ...toll.map((it) => ({ ...it, source: 'pricing-rebuild-toll' as const })),
    ]
    for (const it of all) {
      try {
        const res = await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: 'PO_APPROVAL',
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            financialImpact: it.financialImpact,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
      } catch (e) {
        failed++
        console.error('  FAIL:', (e as Error).message.slice(0, 120))
      }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally { await prisma.$disconnect() }
}

main().catch((e) => { console.error(e); process.exit(1) })
