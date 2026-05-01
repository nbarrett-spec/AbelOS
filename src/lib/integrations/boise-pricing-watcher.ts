// ──────────────────────────────────────────────────────────────────────────
// Boise Cascade Pricing Watcher
// ──────────────────────────────────────────────────────────────────────────
// Realistic mechanism: Boise Cascade does NOT publish a dealer pricing API.
// Pricing is distributed via:
//   (a) periodic emailed price-list spreadsheets from the Abel rep, and
//   (b) the dealer-portal price list (PDF / XLSX export).
//
// This module:
//   1. Parses an .xlsx buffer into a per-SKU price map
//   2. Persists it as a BoisePriceSnapshot row
//   3. Diffs against the most recent prior snapshot
//   4. Emits up to top-50 movers (by abs % delta, >1% threshold) to Brain
//      as `boise_price_change` events on source: 'commodity'
//
// Companion route: /api/admin/boise/upload-pricing  (manual XLSX upload)
// Companion cron:  /api/cron/boise-pricing-sync     (daily at 12 UTC)
// ──────────────────────────────────────────────────────────────────────────

import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'

// ── Types ────────────────────────────────────────────────────────────────

export interface ParsedPriceRow {
  sku: string
  name: string | null
  category: string | null
  unitPrice: number
  uom: string | null
}

export interface PriceDelta {
  sku: string
  name: string | null
  previousPrice: number
  newPrice: number
  delta: number
  deltaPct: number
  direction: 'UP' | 'DOWN'
}

export interface DiffResult {
  snapshotId: string
  totalSkus: number
  newSkus: number
  removedSkus: number
  changedSkus: number
  topMovers: PriceDelta[] // capped to top 50 by |deltaPct|, threshold > 1%
}

// ── Parser ────────────────────────────────────────────────────────────────
//
// Tolerant header detection — handles both:
//   • The AMP-style outlook (Top_SKUs sheet, "ProductSKU" / "Avg unit price")
//   • A standard Boise price-list (Item Number / Net Price / Description)
//   • The Boise_PO_Lines_12mo style (per-PO lines — averaged per SKU)

const SKU_KEYS = ['productsku', 'sku', 'item number', 'itemnumber', 'item #', 'item', 'product code', 'item code']
const NAME_KEYS = ['productname', 'description', 'product name', 'product', 'name', 'item description']
const PRICE_KEYS = [
  'avg unit price',
  'unit price',
  'productunitprice',
  'net price',
  'cost',
  'unit cost',
  'your cost',
  'list price',
  'price',
]
const CATEGORY_KEYS = ['category', 'product category', 'class']
const UOM_KEYS = ['uom', 'unit of measure', 'unit', 'measure']

function pickColumn(headers: string[], candidates: string[]): number {
  const lc = headers.map((h) => (h || '').toString().trim().toLowerCase())
  // Exact first
  for (const c of candidates) {
    const i = lc.indexOf(c)
    if (i >= 0) return i
  }
  // Substring fallback
  for (let i = 0; i < lc.length; i++) {
    if (candidates.some((c) => lc[i].includes(c))) return i
  }
  return -1
}

function toFloat(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).replace(/[$,\s]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse an .xlsx buffer into per-SKU price rows.
 * Strategy: walk every sheet, score each by how many price/SKU columns it has,
 * use the best-scoring sheet. If multiple SKU rows appear (e.g. PO-line file),
 * average unit prices weighted by quantity if a quantity col exists.
 */
export function parseBoisePriceXlsx(buf: Buffer): ParsedPriceRow[] {
  const wb = XLSX.read(buf, { type: 'buffer' })

  type Candidate = {
    sheetName: string
    rows: ParsedPriceRow[]
    score: number
  }
  const candidates: Candidate[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
    if (!aoa.length) continue

    // Find the header row — first row with both an SKU-ish column and a price-ish column
    let headerRowIdx = -1
    let headers: string[] = []
    for (let r = 0; r < Math.min(aoa.length, 10); r++) {
      const row = (aoa[r] || []).map((c) => (c == null ? '' : String(c)))
      const skuIdx = pickColumn(row, SKU_KEYS)
      const priceIdx = pickColumn(row, PRICE_KEYS)
      if (skuIdx >= 0 && priceIdx >= 0) {
        headerRowIdx = r
        headers = row
        break
      }
    }
    if (headerRowIdx < 0) continue

    const skuIdx = pickColumn(headers, SKU_KEYS)
    const nameIdx = pickColumn(headers, NAME_KEYS)
    const priceIdx = pickColumn(headers, PRICE_KEYS)
    const catIdx = pickColumn(headers, CATEGORY_KEYS)
    const uomIdx = pickColumn(headers, UOM_KEYS)
    const qtyIdx = pickColumn(headers, ['productquantity', 'quantity', 'qty'])

    // Aggregate: keep latest price per SKU, but if quantity col exists, do qty-weighted avg.
    const acc = new Map<string, { name: string | null; cat: string | null; uom: string | null; pxSum: number; qtySum: number; lastPx: number }>()

    for (let r = headerRowIdx + 1; r < aoa.length; r++) {
      const row = aoa[r] || []
      const sku = (row[skuIdx] ?? '').toString().trim()
      if (!sku) continue
      const px = toFloat(row[priceIdx])
      if (px == null || px <= 0) continue

      const name = nameIdx >= 0 ? (row[nameIdx] ?? '')?.toString().trim() || null : null
      const cat = catIdx >= 0 ? (row[catIdx] ?? '')?.toString().trim() || null : null
      const uom = uomIdx >= 0 ? (row[uomIdx] ?? '')?.toString().trim() || null : null
      const qty = qtyIdx >= 0 ? toFloat(row[qtyIdx]) ?? 1 : 1

      const cur = acc.get(sku)
      if (!cur) {
        acc.set(sku, { name, cat, uom, pxSum: px * qty, qtySum: qty, lastPx: px })
      } else {
        cur.pxSum += px * qty
        cur.qtySum += qty
        cur.lastPx = px
        if (!cur.name && name) cur.name = name
        if (!cur.cat && cat) cur.cat = cat
        if (!cur.uom && uom) cur.uom = uom
      }
    }

    const rows: ParsedPriceRow[] = []
    for (const [sku, v] of acc.entries()) {
      const unitPrice = v.qtySum > 0 ? v.pxSum / v.qtySum : v.lastPx
      rows.push({ sku, name: v.name, category: v.cat, unitPrice, uom: v.uom })
    }

    if (rows.length > 0) {
      // Score: row count + bonus for having qty (more authoritative)
      const score = rows.length + (qtyIdx >= 0 ? 50 : 0)
      candidates.push({ sheetName, rows, score })
    }
  }

  if (!candidates.length) return []
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].rows
}

// ── Snapshot persistence + diff ───────────────────────────────────────────

export async function persistSnapshot(args: {
  rows: ParsedPriceRow[]
  source: 'UPLOAD' | 'EMAIL' | 'CRON' | 'MANUAL'
  effectiveDate?: Date | null
  filename?: string | null
  uploadedBy?: string | null
}): Promise<{ snapshotId: string; totalSkus: number }> {
  const { rows, source, effectiveDate, filename, uploadedBy } = args
  const priceMap: Record<string, { name: string | null; price: number; uom: string | null; category: string | null }> = {}
  for (const r of rows) {
    priceMap[r.sku] = { name: r.name, price: r.unitPrice, uom: r.uom, category: r.category }
  }

  const id = `bps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BoisePriceSnapshot"
     (id, "source", "effectiveDate", "filename", "uploadedBy", "totalSkus", "priceMap", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
    id,
    source,
    effectiveDate ?? null,
    filename ?? null,
    uploadedBy ?? null,
    rows.length,
    JSON.stringify(priceMap)
  )
  return { snapshotId: id, totalSkus: rows.length }
}

export async function getPreviousSnapshot(beforeId: string): Promise<{
  id: string
  priceMap: Record<string, { name: string | null; price: number }>
} | null> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "priceMap"
     FROM "BoisePriceSnapshot"
     WHERE id <> $1
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    beforeId
  )
  if (!rows.length) return null
  return { id: rows[0].id, priceMap: rows[0].priceMap }
}

export function diffSnapshots(
  current: ParsedPriceRow[],
  previousMap: Record<string, { name: string | null; price: number }> | null,
  opts: { thresholdPct?: number; topN?: number } = {}
): Pick<DiffResult, 'totalSkus' | 'newSkus' | 'removedSkus' | 'changedSkus' | 'topMovers'> {
  const thresholdPct = opts.thresholdPct ?? 1.0
  const topN = opts.topN ?? 50

  const currentMap = new Map(current.map((r) => [r.sku, r]))
  const prev = previousMap ?? {}

  let newSkus = 0
  let removedSkus = 0
  let changedSkus = 0
  const movers: PriceDelta[] = []

  for (const [sku, r] of currentMap.entries()) {
    const p = prev[sku]
    if (!p) {
      newSkus++
      continue
    }
    if (p.price <= 0) continue
    const delta = r.unitPrice - p.price
    const deltaPct = (delta / p.price) * 100
    if (Math.abs(deltaPct) >= thresholdPct) {
      changedSkus++
      movers.push({
        sku,
        name: r.name ?? p.name ?? null,
        previousPrice: p.price,
        newPrice: r.unitPrice,
        delta,
        deltaPct,
        direction: delta >= 0 ? 'UP' : 'DOWN',
      })
    }
  }
  for (const sku of Object.keys(prev)) {
    if (!currentMap.has(sku)) removedSkus++
  }

  movers.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
  return {
    totalSkus: current.length,
    newSkus,
    removedSkus,
    changedSkus,
    topMovers: movers.slice(0, topN),
  }
}

// ── Brain emitter ────────────────────────────────────────────────────────

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'
const BRAIN_INGEST_URL = `${BRAIN_BASE_URL}/brain/ingest/batch`

export async function emitToBrain(
  movers: PriceDelta[],
  snapshotId: string,
  effectiveDate: Date | null
): Promise<{ sent: number; skipped: boolean; error?: string }> {
  if (!movers.length) return { sent: 0, skipped: true }

  const brainKey = process.env.BRAIN_API_KEY
  if (!brainKey) return { sent: 0, skipped: true, error: 'BRAIN_API_KEY not set' }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BoisePricingWatcher/1.0',
    'X-API-Key': brainKey,
    Authorization: `Bearer ${brainKey}`,
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId
    headers['CF-Access-Client-Secret'] = cfSecret
  }

  const events = movers.map((m) => ({
    source: 'commodity',
    type: 'boise_price_change',
    source_id: `boise:${snapshotId}:${m.sku}`,
    occurred_at: (effectiveDate ?? new Date()).toISOString(),
    payload: {
      vendor: 'BOISE_CASCADE',
      sku: m.sku,
      name: m.name,
      previous_price: round2(m.previousPrice),
      new_price: round2(m.newPrice),
      delta: round2(m.delta),
      delta_pct: round2(m.deltaPct),
      direction: m.direction,
      snapshot_id: snapshotId,
    },
  }))

  try {
    const res = await fetch(BRAIN_INGEST_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { sent: 0, skipped: false, error: `Brain ${res.status}: ${text.substring(0, 200)}` }
    }
    return { sent: events.length, skipped: false }
  } catch (e: any) {
    return { sent: 0, skipped: false, error: e?.message || String(e) }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Top-level orchestration ───────────────────────────────────────────────

export async function ingestPriceSheet(args: {
  buffer: Buffer
  source: 'UPLOAD' | 'EMAIL' | 'CRON' | 'MANUAL'
  filename?: string | null
  effectiveDate?: Date | null
  uploadedBy?: string | null
  emit?: boolean // default true
}): Promise<DiffResult & { brain: { sent: number; skipped: boolean; error?: string } }> {
  const rows = parseBoisePriceXlsx(args.buffer)
  if (!rows.length) {
    throw new Error('No price rows found in uploaded file (no recognized SKU/price columns)')
  }
  const { snapshotId, totalSkus } = await persistSnapshot({
    rows,
    source: args.source,
    effectiveDate: args.effectiveDate ?? null,
    filename: args.filename ?? null,
    uploadedBy: args.uploadedBy ?? null,
  })
  const prev = await getPreviousSnapshot(snapshotId)
  const diff = diffSnapshots(rows, prev?.priceMap ?? null, { thresholdPct: 1.0, topN: 50 })

  let brain: { sent: number; skipped: boolean; error?: string } = {
    sent: 0,
    skipped: true,
  }
  if (args.emit !== false && prev) {
    brain = await emitToBrain(diff.topMovers, snapshotId, args.effectiveDate ?? null)
  }

  return {
    snapshotId,
    ...diff,
    totalSkus,
    brain,
  }
}
