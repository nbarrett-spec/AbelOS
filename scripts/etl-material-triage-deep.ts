/**
 * scripts/etl-material-triage-deep.ts
 *
 * DEEP follow-up to etl-material-triage.ts / etl-urgent-v2.ts. The prior
 * scripts loaded one SUMMARY InboxItem each for "Order Now" and "PO Aging".
 * This script drills into 3 sheets of `Abel_Lumber_Material_Triage.xlsx`
 * and writes per-line InboxItems with distinct source tags so they can be
 * separated and dismissed in bulk once resolved:
 *
 *   Sheet "4. Order Now"         → source `TRIAGE_ORDER_NOW_TOP20`
 *                                  Top 20 SKUs by (unitCost * Units to Order),
 *                                  unitCost looked up from InventoryItem.sku.
 *                                  The other ~320 SKUs are already covered by
 *                                  the aggregate summary item — we cap at 20
 *                                  to avoid inbox noise.
 *
 *   Sheet "2. Whiteboard Jobs"   → source `TRIAGE_WB_JOBS`
 *                                  One InboxItem per job (50 rows). Linked
 *                                  by SO# → Order.inflowOrderId /
 *                                  Order.orderNumber where possible (entityId
 *                                  set). Priority derived from sheet Priority
 *                                  column and Status (BLOCKED vs READY).
 *
 *   Sheet "5. Open SOs Priority" → source `TRIAGE_P1_SOS`
 *                                  ONLY Priority-1 rows (30+ days past due).
 *                                  One InboxItem per P1 SO. Linked by SO# to
 *                                  Aegis `Order` where possible.
 *
 * All three use deterministic IDs so re-runs upsert rather than duplicate.
 *
 * Writes ONLY to InboxItem. Reads Order + InventoryItem for linkage/cost
 * lookup — never modifies them.
 *
 * Usage:
 *   npx tsx scripts/etl-material-triage-deep.ts           # DRY-RUN
 *   npx tsx scripts/etl-material-triage-deep.ts --commit  # write
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')
const FILE = path.join(ROOT, 'Abel_Lumber_Material_Triage.xlsx')

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface Item {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: Priority
  entityType: string | null
  entityId: string | null
  financialImpact: number | null
  dueBy?: Date | null
  actionData: Record<string, unknown>
}

function hashId(tag: string, k: string): string {
  return 'ib_td_' + crypto.createHash('sha256').update(`${tag}::${k}`).digest('hex').slice(0, 18)
}
function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%()]/g, ''))
  return Number.isFinite(n) ? n : null
}
function readSheet(sheet: string): unknown[][] {
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets[sheet]
  if (!ws) throw new Error(`Sheet not found: ${sheet}`)
  return XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 }) as unknown[][]
}
function parseSheetDate(s: string): Date | null {
  if (!s) return null
  // "04/13/2026" form
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [_, mm, dd, yyyy] = m
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
  return Number.isFinite(d.getTime()) ? d : null
}

// ---------- Order Now: Top 20 by unitCost * UnitsToOrder ----------
async function loadOrderNowTop20(prisma: PrismaClient): Promise<Item[]> {
  const SRC = 'TRIAGE_ORDER_NOW_TOP20'
  const rows = readSheet('4. Order Now')
  // Header is at index 3: ["SKU","Product","Total Demand","On Hand","On Open PO","Units to Order","Jobs Affected"]
  const HDR_IDX = 3
  const hdr = (rows[HDR_IDX] as unknown[]).map((h) => normStr(h).toLowerCase())
  const cSku = hdr.indexOf('sku')
  const cName = hdr.indexOf('product')
  const cDemand = hdr.findIndex((h) => /total demand/.test(h))
  const cOnHand = hdr.findIndex((h) => /on hand/.test(h))
  const cOnPo = hdr.findIndex((h) => /on open po/.test(h))
  const cToOrder = hdr.findIndex((h) => /units to order/.test(h))
  const cJobs = hdr.findIndex((h) => /jobs affected/.test(h))

  const parsed: Array<{
    sku: string; name: string; demand: number; onHand: number; onPo: number;
    toOrder: number; jobs: number
  }> = []
  for (let i = HDR_IDX + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[]
    const sku = normStr(r[cSku])
    if (!sku) continue
    const toOrder = toNum(r[cToOrder]) ?? 0
    if (toOrder <= 0) continue
    parsed.push({
      sku,
      name: normStr(r[cName]),
      demand: toNum(r[cDemand]) ?? 0,
      onHand: toNum(r[cOnHand]) ?? 0,
      onPo: toNum(r[cOnPo]) ?? 0,
      toOrder,
      jobs: toNum(r[cJobs]) ?? 0,
    })
  }

  // Cost lookup — batch by SKU
  const skus = Array.from(new Set(parsed.map((p) => p.sku)))
  const inv = skus.length
    ? await prisma.inventoryItem.findMany({
        where: { sku: { in: skus } },
        select: { sku: true, unitCost: true },
      })
    : []
  const costBySku = new Map<string, number>()
  for (const it of inv) {
    if (it.sku) costBySku.set(it.sku, it.unitCost ?? 0)
  }

  // Rank — fallback proxy when no cost: score by toOrder * jobs
  const scored = parsed.map((p) => {
    const cost = costBySku.get(p.sku) ?? 0
    const hasCost = cost > 0
    const score = hasCost ? cost * p.toOrder : p.toOrder * Math.max(1, p.jobs) * 0.01
    return { ...p, cost, hasCost, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const top20 = scored.slice(0, 20)

  return top20.map((s) => {
    const estCost = s.cost * s.toOrder
    const priority: Priority =
      s.jobs >= 10 || estCost >= 2000 ? 'CRITICAL' :
      s.jobs >= 5 || estCost >= 500 ? 'HIGH' :
      s.toOrder >= 20 ? 'MEDIUM' : 'LOW'
    const costBlurb = s.hasCost
      ? `est $${estCost.toFixed(0)} @ $${s.cost.toFixed(2)}/unit`
      : `cost unknown (no InventoryItem.unitCost)`
    const title = `[ORDER NOW] ${s.sku} — order ${s.toOrder} units, ${costBlurb}`
    const desc =
      `SKU ${s.sku} (${s.name}). Total demand ${s.demand}, on hand ${s.onHand}, on open PO ${s.onPo}, ` +
      `need to order ${s.toOrder}. Affects ${s.jobs} open jobs. ${costBlurb}. ` +
      `Ranked ${top20.findIndex((x) => x.sku === s.sku) + 1}/20 by projected order cost. ` +
      `Rest of SKUs covered by the aggregate MATERIAL_TRIAGE_APR2026 summary item.`
    return {
      id: hashId(SRC, `sku:${s.sku}`),
      type: 'MRP_RECOMMENDATION',
      source: SRC,
      title: title.slice(0, 240),
      description: desc.slice(0, 2000),
      priority,
      entityType: null,
      entityId: null,
      financialImpact: s.hasCost ? estCost : null,
      actionData: {
        sku: s.sku,
        productName: s.name,
        totalDemand: s.demand,
        onHand: s.onHand,
        onOpenPo: s.onPo,
        unitsToOrder: s.toOrder,
        jobsAffected: s.jobs,
        unitCost: s.cost,
        estimatedCost: estCost,
        rank: top20.findIndex((x) => x.sku === s.sku) + 1,
        key: `${SRC}:${s.sku}`,
      },
    }
  })
}

// ---------- Whiteboard Jobs: one InboxItem per job ----------
async function loadWbJobs(prisma: PrismaClient): Promise<{ items: Item[]; matched: number; unmatched: number }> {
  const SRC = 'TRIAGE_WB_JOBS'
  const rows = readSheet('2. Whiteboard Jobs')
  // Header row 3: Priority, Builder, Job / Address, SO #, Earliest Need, # Lines, Qty Needed, From Stock, From Open PO, Shortfall, Status
  const HDR_IDX = 3
  const hdr = (rows[HDR_IDX] as unknown[]).map((h) => normStr(h).toLowerCase())
  const cPri = hdr.indexOf('priority')
  const cBuilder = hdr.indexOf('builder')
  const cJob = hdr.findIndex((h) => /job|address/.test(h))
  const cSo = hdr.findIndex((h) => /so ?#/.test(h))
  const cNeed = hdr.findIndex((h) => /earliest need/.test(h))
  const cLines = hdr.findIndex((h) => /# lines|lines/.test(h))
  const cQty = hdr.findIndex((h) => /qty needed/.test(h))
  const cStock = hdr.findIndex((h) => /from stock/.test(h))
  const cOpenPo = hdr.findIndex((h) => /from open po/.test(h))
  const cShort = hdr.findIndex((h) => /shortfall/.test(h))
  const cStatus = hdr.indexOf('status')

  interface WbRow {
    pri: number; builder: string; job: string; so: string; need: string;
    lines: number; qty: number; stock: number; openPo: number; short: number; status: string
  }
  const parsed: WbRow[] = []
  for (let i = HDR_IDX + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[]
    const so = normStr(r[cSo])
    if (!so) continue
    parsed.push({
      pri: toNum(r[cPri]) ?? 999,
      builder: normStr(r[cBuilder]),
      job: normStr(r[cJob]),
      so,
      need: normStr(r[cNeed]),
      lines: toNum(r[cLines]) ?? 0,
      qty: toNum(r[cQty]) ?? 0,
      stock: toNum(r[cStock]) ?? 0,
      openPo: toNum(r[cOpenPo]) ?? 0,
      short: toNum(r[cShort]) ?? 0,
      status: normStr(r[cStatus]),
    })
  }

  // Linkage: SO# → Order (inflowOrderId first, then orderNumber)
  const sos = Array.from(new Set(parsed.map((p) => p.so)))
  const orders = sos.length
    ? await prisma.order.findMany({
        where: {
          OR: [
            { inflowOrderId: { in: sos } },
            { orderNumber: { in: sos } },
          ],
        },
        select: { id: true, inflowOrderId: true, orderNumber: true },
      })
    : []
  const orderBySo = new Map<string, string>()
  for (const o of orders) {
    if (o.inflowOrderId) orderBySo.set(o.inflowOrderId, o.id)
    if (o.orderNumber) orderBySo.set(o.orderNumber, o.id)
  }

  let matched = 0, unmatched = 0
  const items: Item[] = parsed.map((p) => {
    const orderId = orderBySo.get(p.so) ?? null
    if (orderId) matched++; else unmatched++
    const blocked = /BLOCKED/i.test(p.status) || p.short > 0
    const priority: Priority =
      blocked && p.pri <= 3 ? 'CRITICAL' :
      blocked && p.pri <= 10 ? 'HIGH' :
      blocked ? 'MEDIUM' :
      p.pri <= 5 ? 'MEDIUM' : 'LOW'
    const dueBy = parseSheetDate(p.need)
    const title = `[WB P${p.pri}] ${p.builder} — ${p.job} (${p.so}) ${blocked ? `BLOCKED, ${p.short} short` : 'READY'}`
    const desc =
      `Whiteboard job priority ${p.pri}. ${p.builder} / ${p.job}, SO ${p.so}. ` +
      `Lines: ${p.lines}, qty needed: ${p.qty}, from stock: ${p.stock}, from open PO: ${p.openPo}, ` +
      `shortfall: ${p.short}. Status: ${p.status || '(n/a)'}. ` +
      `Earliest need: ${p.need || 'n/a'}.`
    return {
      id: hashId(SRC, `so:${p.so}`),
      type: 'SCHEDULE_CHANGE',
      source: SRC,
      title: title.slice(0, 240),
      description: desc.slice(0, 2000),
      priority,
      entityType: orderId ? 'Order' : null,
      entityId: orderId,
      financialImpact: null,
      dueBy,
      actionData: {
        priority: p.pri,
        builder: p.builder,
        job: p.job,
        salesOrder: p.so,
        earliestNeed: p.need,
        lines: p.lines,
        qtyNeeded: p.qty,
        fromStock: p.stock,
        fromOpenPo: p.openPo,
        shortfall: p.short,
        status: p.status,
        key: `${SRC}:${p.so}`,
      },
    }
  })

  return { items, matched, unmatched }
}

// ---------- Open SOs Priority: P1 (30+ days past due) ----------
async function loadP1Sos(prisma: PrismaClient): Promise<{ items: Item[]; matched: number; unmatched: number }> {
  const SRC = 'TRIAGE_P1_SOS'
  const rows = readSheet('5. Open SOs Priority')
  // Header row 3: Priority, SO #, Customer, Location, Earliest Need, Lines, Total Qty, Short, On Whiteboard
  const HDR_IDX = 3
  const hdr = (rows[HDR_IDX] as unknown[]).map((h) => normStr(h).toLowerCase())
  const cPri = hdr.indexOf('priority')
  const cSo = hdr.findIndex((h) => /so ?#/.test(h))
  const cCust = hdr.indexOf('customer')
  const cLoc = hdr.indexOf('location')
  const cNeed = hdr.findIndex((h) => /earliest need/.test(h))
  const cLines = hdr.indexOf('lines')
  const cQty = hdr.findIndex((h) => /total qty/.test(h))
  const cShort = hdr.indexOf('short')
  const cWb = hdr.findIndex((h) => /whiteboard/.test(h))

  interface SoRow {
    priLabel: string; so: string; cust: string; loc: string; need: string;
    lines: number; qty: number; short: number; onWb: string
  }
  const p1: SoRow[] = []
  for (let i = HDR_IDX + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[]
    const so = normStr(r[cSo])
    if (!so) continue
    const priLabel = normStr(r[cPri])
    // Task says: P1 = 30+ days past due
    if (!/^1\b|30\+?\s*days?\s*past\s*due/i.test(priLabel)) continue
    p1.push({
      priLabel,
      so,
      cust: normStr(r[cCust]),
      loc: normStr(r[cLoc]),
      need: normStr(r[cNeed]),
      lines: toNum(r[cLines]) ?? 0,
      qty: toNum(r[cQty]) ?? 0,
      short: toNum(r[cShort]) ?? 0,
      onWb: normStr(r[cWb]),
    })
  }

  // Linkage
  const sos = Array.from(new Set(p1.map((p) => p.so)))
  const orders = sos.length
    ? await prisma.order.findMany({
        where: {
          OR: [
            { inflowOrderId: { in: sos } },
            { orderNumber: { in: sos } },
          ],
        },
        select: { id: true, inflowOrderId: true, orderNumber: true, total: true },
      })
    : []
  const orderBySo = new Map<string, { id: string; total: number }>()
  for (const o of orders) {
    const rec = { id: o.id, total: o.total ?? 0 }
    if (o.inflowOrderId) orderBySo.set(o.inflowOrderId, rec)
    if (o.orderNumber) orderBySo.set(o.orderNumber, rec)
  }

  let matched = 0, unmatched = 0
  const items: Item[] = p1.map((p) => {
    const hit = orderBySo.get(p.so) ?? null
    if (hit) matched++; else unmatched++
    // P1 is past-due — CRITICAL if shortage, otherwise HIGH
    const priority: Priority =
      p.short > 0 && p.lines >= 10 ? 'CRITICAL' :
      p.short > 0 ? 'HIGH' :
      'MEDIUM'
    const dueBy = parseSheetDate(p.need)
    const title =
      `[P1 SO] ${p.cust} — ${p.so} (${p.loc})` +
      (p.short > 0 ? `, ${p.short} short` : '')
    const desc =
      `Priority-1 Sales Order (30+ days past due). ${p.cust}, ${p.loc || '(no location)'}. ` +
      `SO ${p.so}: ${p.lines} lines, ${p.qty} total qty, ${p.short} short. ` +
      `Earliest need: ${p.need || 'n/a'}. On whiteboard: ${p.onWb || 'no'}. ` +
      (hit ? `Linked Aegis Order total $${hit.total.toFixed(2)}.` : 'No matching Aegis Order by SO#.')
    return {
      id: hashId(SRC, `so:${p.so}`),
      type: 'SCHEDULE_CHANGE',
      source: SRC,
      title: title.slice(0, 240),
      description: desc.slice(0, 2000),
      priority,
      entityType: hit ? 'Order' : null,
      entityId: hit?.id ?? null,
      financialImpact: hit ? hit.total : null,
      dueBy,
      actionData: {
        priorityLabel: p.priLabel,
        salesOrder: p.so,
        customer: p.cust,
        location: p.loc,
        earliestNeed: p.need,
        lines: p.lines,
        totalQty: p.qty,
        short: p.short,
        onWhiteboard: p.onWb,
        key: `${SRC}:${p.so}`,
      },
    }
  })

  return { items, matched, unmatched }
}

async function main() {
  console.log(`ETL material-triage-deep — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`  Source: ${FILE}`)
  const prisma = new PrismaClient()
  try {
    const orderNow = await loadOrderNowTop20(prisma)
    const wb = await loadWbJobs(prisma)
    const p1 = await loadP1Sos(prisma)

    console.log(`\nSource counts:`)
    console.log(`  TRIAGE_ORDER_NOW_TOP20: ${orderNow.length}`)
    console.log(`  TRIAGE_WB_JOBS: ${wb.items.length} (matched=${wb.matched}, unmatched=${wb.unmatched})`)
    console.log(`  TRIAGE_P1_SOS: ${p1.items.length} (matched=${p1.matched}, unmatched=${p1.unmatched})`)

    const all = [...orderNow, ...wb.items, ...p1.items]
    const priMix: Record<string, number> = {}
    for (const it of all) priMix[it.priority] = (priMix[it.priority] ?? 0) + 1
    console.log(`\nPriority mix: ${JSON.stringify(priMix)}`)
    console.log(`Total: ${all.length} InboxItems\n`)

    console.log(`Sample:`)
    for (const it of [orderNow[0], wb.items[0], p1.items[0]].filter(Boolean) as Item[]) {
      console.log(`  [${it.priority.padEnd(8)}] ${it.source}: ${it.title.slice(0, 100)}`)
    }

    if (DRY_RUN) {
      console.log('\nDRY-RUN — re-run with --commit to write.')
      return
    }

    let created = 0, updated = 0, failed = 0
    for (const it of all) {
      try {
        const res = await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title,
            description: it.description,
            priority: it.priority,
            status: 'PENDING',
            entityType: it.entityType,
            entityId: it.entityId,
            financialImpact: it.financialImpact,
            dueBy: it.dueBy,
            actionData: it.actionData as object,
          },
          update: {
            title: it.title,
            description: it.description,
            priority: it.priority,
            entityType: it.entityType,
            entityId: it.entityId,
            financialImpact: it.financialImpact,
            dueBy: it.dueBy,
            actionData: it.actionData as object,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
        else updated++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 160))
      }
    }
    console.log(`\nCommitted: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
