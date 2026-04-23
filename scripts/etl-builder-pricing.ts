/**
 * scripts/etl-builder-pricing.ts
 *
 * Loads the "Builder Pricing" sheet of Abel_Product_Catalog_LIVE.xlsx into
 * the Aegis BuilderPricing table. Sheet is wide-format (one column per
 * builder); this script pivots it long into (builderId, productId, customPrice)
 * rows and upserts on the [builderId, productId] unique constraint.
 *
 * Modes:
 *   (default) --dry-run — print diff summary + samples, write nothing
 *   --commit            — actually upsert
 *
 * Skips:
 *   - Builder columns with no Aegis match (reported at end)
 *   - SKUs not found in Aegis Product (reported at end)
 *   - Cells equal to the "Default Price" column (those aren't custom)
 *   - Zero or negative prices (treated as missing)
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const argv = process.argv.slice(2)
const DRY_RUN = !argv.includes('--commit')
const arg = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def
}
const FILE = arg('--file') || path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')

// Same override map as the match script — keep in sync.
const MANUAL_OVERRIDES: Record<string, string | null> = {
  Millcreek: 'MILLCREEK AMAVI CELINA',
}

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(homes|homebuilders|homebuild|construction|builders|builder|custom|design|homebuilder|development|developement|inc|llc|residential|corp)\b/g, '')
    .replace(/\s+/g, ' ').trim()
}
function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 1))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0; for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : null
}

interface PricingCell {
  xlsxBuilder: string
  aegisBuilderId: string
  aegisCompanyName: string
  sku: string
  productId: string
  customPrice: number
  defaultPrice: number
}

async function main() {
  console.log(`ETL builder pricing — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Reading: ${FILE}`)
  if (!fs.existsSync(FILE)) throw new Error(`File not found: ${FILE}`)

  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets['Builder Pricing']
  if (!ws) throw new Error('Sheet "Builder Pricing" not found')

  const raw = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]
  const header = raw[0] as string[]
  const bodyRows = raw.slice(1)

  const builderCols = header.slice(3).map((h, i) => ({ name: String(h ?? '').trim(), colIdx: i + 3 })).filter((b) => b.name)
  console.log(`XLSX: ${bodyRows.length} SKU rows × ${builderCols.length} builder columns`)

  const prisma = new PrismaClient()
  try {
    const [aegisBuilders, aegisProducts] = await Promise.all([
      prisma.builder.findMany({ select: { id: true, companyName: true } }),
      prisma.product.findMany({ select: { id: true, sku: true, basePrice: true } }),
    ])
    const builderByName = new Map(aegisBuilders.map((b) => [b.companyName.toLowerCase(), b]))
    const productBySku = new Map(aegisProducts.map((p) => [p.sku.toLowerCase(), p]))

    // Build XLSX→Aegis builder map (manual override → exact → fuzzy)
    const builderMap = new Map<string, { id: string; companyName: string } | null>()
    const unmatchedBuilders: string[] = []
    for (const { name } of builderCols) {
      if (name in MANUAL_OVERRIDES) {
        const target = MANUAL_OVERRIDES[name]
        if (target === null) { builderMap.set(name, null); unmatchedBuilders.push(name); continue }
        const hit = aegisBuilders.find((a) => a.companyName === target)
        builderMap.set(name, hit ?? null)
        if (!hit) unmatchedBuilders.push(name)
        continue
      }
      const exact = builderByName.get(name.toLowerCase())
      if (exact) { builderMap.set(name, { id: exact.id, companyName: exact.companyName }); continue }
      const xtok = tokens(name)
      let best: { a: typeof aegisBuilders[number]; score: number } | null = null
      for (const a of aegisBuilders) {
        const s = jaccard(xtok, tokens(a.companyName))
        if (!best || s > best.score) best = { a, score: s }
      }
      if (best && best.score >= 0.5) builderMap.set(name, { id: best.a.id, companyName: best.a.companyName })
      else { builderMap.set(name, null); unmatchedBuilders.push(name) }
    }

    // Pivot: collect every (builder, sku) with a non-default positive price
    const cells: PricingCell[] = []
    const unmatchedSkus = new Set<string>()
    let skippedBlank = 0
    let skippedBuilder = 0
    let skippedSku = 0
    let skippedSameAsDefault = 0
    let skippedNonPositive = 0

    for (const row of bodyRows) {
      const sku = String(row[0] ?? '').trim()
      const defaultPrice = toNum(row[2]) ?? 0
      if (!sku) continue
      const prod = productBySku.get(sku.toLowerCase())
      for (const { name, colIdx } of builderCols) {
        const cell = row[colIdx]
        if (cell === null || cell === undefined || cell === '') { skippedBlank++; continue }
        const builder = builderMap.get(name)
        if (!builder) { skippedBuilder++; continue }
        if (!prod) { skippedSku++; unmatchedSkus.add(sku); continue }
        const customPrice = toNum(cell)
        if (customPrice === null || customPrice <= 0) { skippedNonPositive++; continue }
        if (Math.abs(customPrice - defaultPrice) < 0.001) { skippedSameAsDefault++; continue }
        cells.push({
          xlsxBuilder: name,
          aegisBuilderId: builder.id,
          aegisCompanyName: builder.companyName,
          sku,
          productId: prod.id,
          customPrice,
          defaultPrice,
        })
      }
    }

    // Compare against existing BuilderPricing to classify create/update/unchanged
    const existing = await prisma.builderPricing.findMany({
      select: { id: true, builderId: true, productId: true, customPrice: true },
    })
    const existingMap = new Map(existing.map((r) => [`${r.builderId}::${r.productId}`, r]))

    let toCreate = 0, toUpdate = 0, unchanged = 0
    const updates: Array<{ key: string; prev: number; next: number }> = []
    for (const c of cells) {
      const key = `${c.aegisBuilderId}::${c.productId}`
      const prev = existingMap.get(key)
      if (!prev) { toCreate++; continue }
      if (Math.abs(prev.customPrice - c.customPrice) < 0.001) { unchanged++; continue }
      toUpdate++
      updates.push({ key, prev: prev.customPrice, next: c.customPrice })
    }

    console.log()
    console.log('=== BUILDER MAPPING ===')
    const matched = [...builderMap.values()].filter(Boolean).length
    console.log(`  matched: ${matched} / ${builderCols.length}`)
    if (unmatchedBuilders.length) console.log(`  unmatched (skipped): ${unmatchedBuilders.join(', ')}`)
    console.log()
    console.log('=== PIVOT STATS ===')
    console.log(`  non-blank cells total:         ${cells.length + skippedBuilder + skippedSku + skippedSameAsDefault + skippedNonPositive}`)
    console.log(`  → usable custom-price cells:   ${cells.length}`)
    console.log(`  skipped (unmatched builder):   ${skippedBuilder}`)
    console.log(`  skipped (SKU not in Aegis):    ${skippedSku}  (${unmatchedSkus.size} distinct SKUs)`)
    console.log(`  skipped (= default price):     ${skippedSameAsDefault}`)
    console.log(`  skipped (zero/negative price): ${skippedNonPositive}`)
    console.log()
    console.log('=== WRITE PLAN ===')
    console.log(`  Will CREATE:  ${toCreate}`)
    console.log(`  Will UPDATE:  ${toUpdate}`)
    console.log(`  Unchanged:    ${unchanged}`)
    console.log(`  Aegis current BuilderPricing rows: ${existing.length}`)
    console.log()
    if (updates.length > 0) {
      console.log('Sample updates (first 5):')
      updates.slice(0, 5).forEach((u) => console.log(`  ~ ${u.key.slice(0, 48)}  $${u.prev.toFixed(2)} → $${u.next.toFixed(2)}`))
      console.log()
    }
    if (unmatchedSkus.size > 0 && unmatchedSkus.size <= 20) {
      console.log('Unmatched SKUs:', [...unmatchedSkus].join(', '))
      console.log()
    }

    if (DRY_RUN) {
      console.log('DRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('COMMIT — applying upserts...')
    let created = 0, updated = 0, failed = 0
    const CHUNK = 200
    const all = cells.filter((c) => {
      const key = `${c.aegisBuilderId}::${c.productId}`
      const prev = existingMap.get(key)
      return !prev || Math.abs(prev.customPrice - c.customPrice) >= 0.001
    })
    for (let i = 0; i < all.length; i += CHUNK) {
      const slice = all.slice(i, i + CHUNK)
      await Promise.all(slice.map(async (c) => {
        try {
          const margin = c.defaultPrice > 0 ? (c.customPrice - (c.customPrice * 0)) / c.customPrice : null
          // Note: Aegis doesn't expose Product.cost here without another query,
          // so we leave `margin` null — it's computed server-side elsewhere anyway.
          const wasExisting = existingMap.has(`${c.aegisBuilderId}::${c.productId}`)
          await prisma.builderPricing.upsert({
            where: { builderId_productId: { builderId: c.aegisBuilderId, productId: c.productId } },
            create: {
              builderId: c.aegisBuilderId,
              productId: c.productId,
              customPrice: c.customPrice,
              margin: null,
            },
            update: { customPrice: c.customPrice },
          })
          if (wasExisting) updated++; else created++
        } catch (e) {
          failed++
          console.error(`  FAIL ${c.xlsxBuilder} / ${c.sku}:`, (e as Error).message.slice(0, 140))
        }
      }))
      process.stdout.write(`  progress: ${Math.min(i + CHUNK, all.length)} / ${all.length}\r`)
    }
    console.log()
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
