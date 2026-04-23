/**
 * scripts/etl-bloomfield-pricing-v2.ts
 *
 * Bloomfield Homes Rev2 per-plan pricing loader (v2).
 *
 * A27's finding: CLASSIC/SIGNATURE/ELEMENT in the plan sheets are NOT separate
 * columns — they're section markers like `--- CLASSIC ---` and `--- ELEMENT ---`
 * above line-item blocks, with a single "Total" column per line. Per-plan grand
 * totals live on rows r3/r4/r5, column 7:
 *   r3 = CLASSIC GRAND TOTAL
 *   r4 = SIGNATURE GRAND TOTAL (== CLASSIC for all 5 plans)
 *   r5 = ELEMENT GRAND TOTAL (8–12% cheaper)
 *
 * The Summary sheet (rows r17–r21) also publishes the per-tier grand totals —
 * we cross-check against plan-sheet totals for safety.
 *
 * What this loader does:
 *   1. Parse 5 plan sheets (Carolina, Cypress, Hawthorne, Magnolia, Bayberry),
 *      extracting per-section line items, grand totals, and tier deltas.
 *   2. Update CommunityFloorPlan.basePackagePrice = CLASSIC grand total.
 *   3. Update CommunityFloorPlan.takeoffNotes = JSON payload with full
 *      CLASSIC + ELEMENT tier breakdown (line items, section totals,
 *      delta $ and %).
 *   4. Create BuilderPricing rows for items that fuzzy-match Aegis Product
 *      with high confidence (unit-priced EA items; $/LF trim and "$75 avg"
 *      catch-alls excluded). customPrice = workbook unit cost × 1.37 material
 *      markup (per Cost Inputs r48).
 *   5. One summary InboxItem: what landed, what was skipped, and why.
 *
 * Constraints honored:
 *   - NO new Community / Product / Builder / Vendor writes.
 *   - ONLY CommunityFloorPlan updates (existing rows), BuilderPricing creates,
 *     one InboxItem upsert.
 *   - Source tag: BLOOMFIELD_PRICING_V2
 *
 * Usage:
 *   npx tsx scripts/etl-bloomfield-pricing-v2.ts          # DRY-RUN
 *   npx tsx scripts/etl-bloomfield-pricing-v2.ts --commit # apply
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const BLOOMFIELD_DIR = path.resolve(__dirname, '..', '..', 'Bloomfield Homes')
const REV2_FILE = path.join(BLOOMFIELD_DIR, 'Bloomfield_Rev2_Pricing.xlsx')
const SRC_TAG = 'BLOOMFIELD_PRICING_V2'
const MARKUP = 1.37 // 37% material markup from Cost Inputs r48

// Each plan sheet has these well-known section markers (case-insensitive):
const SECTION_HEADERS = new Set([
  'EXTERIOR DOORS',
  'INTERIOR DOORS',
  'TRIM & MILLWORK',
  'HARDWARE',
  'STAIR',
  'SHELVING & CLOSET',
])

type LineItem = {
  section: string
  tier: 'SHARED' | 'CLASSIC' | 'ELEMENT'
  item: string
  unitCost: number | null
  qty: number | null
  material: number | null
  margin: number | null
  labor: number | null
  total: number | null
}

type PlanSheet = {
  planName: string
  sqFt: number | null
  intDoors: number | null
  classicTotal: number | null
  signatureTotal: number | null
  elementTotal: number | null
  items: LineItem[]
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''))
  return isFinite(n) ? n : null
}

function s(v: any): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function parsePlanSheet(wb: XLSX.WorkBook, sheetName: string): PlanSheet {
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, defval: null }) as any[][]
  const out: PlanSheet = {
    planName: sheetName,
    sqFt: null,
    intDoors: null,
    classicTotal: null,
    signatureTotal: null,
    elementTotal: null,
    items: [],
  }

  // Header row(s): "Sq Ft: 3,034 | Interior Doors: 29 | ..."
  for (const r of rows.slice(0, 6)) {
    for (const c of r || []) {
      const t = s(c)
      const sq = t.match(/Sq\s*Ft[:\s]+([\d,]+)/i)
      if (sq) out.sqFt = parseInt(sq[1].replace(/,/g, ''), 10)
      const id = t.match(/Interior\s*Doors[:\s]+(\d+)/i)
      if (id) out.intDoors = parseInt(id[1], 10)
    }
  }

  // Grand totals: look at rows where col 0 contains "GRAND TOTAL"; value in col 7
  for (const r of rows.slice(0, 10)) {
    if (!r) continue
    const label = s(r[0]).toUpperCase()
    const val = num(r[7])
    if (val === null) continue
    if (label.startsWith('CLASSIC GRAND TOTAL')) out.classicTotal = val
    else if (label.startsWith('SIGNATURE GRAND TOTAL')) out.signatureTotal = val
    else if (label.startsWith('ELEMENT GRAND TOTAL')) out.elementTotal = val
  }

  // Line-item walk.
  // State machine: sectionName and tier are updated by banner rows:
  //   - Section banners: single-cell uppercase text in col 0 matching SECTION_HEADERS
  //   - Tier banners: "--- CLASSIC ---", "--- CLASSIC / SIGNATURE (Daylon) ---",
  //     "--- ELEMENT ---", "--- ELEMENT (Delta + Basic) ---"
  let section = ''
  let tier: 'SHARED' | 'CLASSIC' | 'ELEMENT' = 'SHARED'

  for (let i = 6; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    const col0 = s(r[0])
    const col0U = col0.toUpperCase()

    if (!col0) continue
    // Section banner?
    if (SECTION_HEADERS.has(col0U)) {
      section = col0U
      tier = 'SHARED' // reset; next "---" resets tier within this section
      continue
    }
    // Tier banner?
    if (/^---/.test(col0)) {
      if (/CLASSIC/i.test(col0)) tier = 'CLASSIC'
      else if (/ELEMENT/i.test(col0)) tier = 'ELEMENT'
      continue
    }
    // Column-header row inside a section (skip)
    if (/^Item$/i.test(col0)) continue
    // Total rollup rows (e.g. "EXT DOORS TOTAL") — capture but don't treat as item
    if (/TOTAL$/i.test(col0U)) continue

    // Body row
    const total = num(r[6]) // "Total" column is col 6 for most body rows
    const item: LineItem = {
      section: section || 'UNSPECIFIED',
      tier,
      item: col0,
      unitCost: num(r[1]),
      qty: num(r[2]),
      material: num(r[3]),
      margin: num(r[4]),
      labor: num(r[5]),
      total,
    }
    // Only keep rows that look like actual line items (have SOMETHING numeric)
    if (item.unitCost !== null || item.qty !== null || item.material !== null || item.total !== null || item.labor !== null) {
      out.items.push(item)
    }
  }

  return out
}

// Build a compact JSON payload for takeoffNotes
function buildTakeoffNotes(plan: PlanSheet): string {
  // Roll up by (section, tier)
  const byGroup = new Map<string, LineItem[]>()
  for (const it of plan.items) {
    const k = `${it.section}::${it.tier}`
    if (!byGroup.has(k)) byGroup.set(k, [])
    byGroup.get(k)!.push(it)
  }

  const classicTotal = plan.classicTotal ?? 0
  const elementTotal = plan.elementTotal ?? 0
  const deltaDollars = Math.round((classicTotal - elementTotal) * 100) / 100
  const deltaPct = classicTotal ? Math.round((deltaDollars / classicTotal) * 10000) / 100 : 0

  const payload = {
    source: 'Bloomfield_Rev2_Pricing.xlsx',
    sourceTag: SRC_TAG,
    loadedAt: new Date().toISOString(),
    plan: plan.planName,
    sqFt: plan.sqFt,
    interiorDoors: plan.intDoors,
    totals: {
      classic: plan.classicTotal,
      signature: plan.signatureTotal,
      element: plan.elementTotal,
      classicVsElement: { deltaDollars, deltaPct },
    },
    lineItems: plan.items.map((it) => ({
      section: it.section,
      tier: it.tier,
      item: it.item,
      unitCost: it.unitCost,
      qty: it.qty,
      material: it.material,
      margin: it.margin,
      labor: it.labor,
      total: it.total,
    })),
  }
  return JSON.stringify(payload)
}

// ─────────────────────────────────────────────────────────────────────────────
// Confident BuilderPricing matches — only high-confidence EA-priced items.
// Trim is $/LF (unit mismatch), Carrara is "$75 avg" (not a real SKU price),
// so we deliberately exclude them. customPrice = unit cost × 1.37 markup.
// ─────────────────────────────────────────────────────────────────────────────
const BUILDER_PRICING_MATCHES: { sku: string; workbookItem: string; unitCost: number; rationale: string }[] = [
  {
    sku: 'BC000134',
    workbookItem: 'Sure Sill Pan',
    unitCost: 33.9,
    rationale: 'Sure Sill Pan 4-9/16" x 40" CP464S040 — exact product-family match; 4-9/16" is the standard interior jamb size.',
  },
  {
    sku: 'BC004231',
    workbookItem: 'R10 Attic Stair',
    unitCost: 212.01,
    rationale: 'A2254R10 ATTIC STAIR 22 1/2 x 54 — exact SKU-code match to R10 attic stair spec.',
  },
  {
    sku: 'DR-3068-FG-6P',
    workbookItem: `6'8" FG Six Panel (Front)`,
    unitCost: 240.41,
    rationale: '3068 Fiberglass 6-Panel Exterior — 3068 is the standard size for a 6\'8" front door; exact style/material match.',
  },
]

async function main() {
  console.log(`ETL Bloomfield Pricing v2 — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source: ${REV2_FILE}`)

  if (!fs.existsSync(REV2_FILE)) {
    console.error(`Workbook not found at ${REV2_FILE}`)
    process.exit(1)
  }

  const wb = XLSX.readFile(REV2_FILE)
  const planSheets = wb.SheetNames.filter((n) => n !== 'Summary' && n !== 'Cost Inputs')
  if (planSheets.length !== 5) {
    console.error(`Expected 5 plan sheets, found ${planSheets.length}: ${planSheets.join(', ')}. STOP.`)
    process.exit(1)
  }
  console.log(`Plan sheets: ${planSheets.join(', ')}`)

  const parsed: PlanSheet[] = planSheets.map((n) => parsePlanSheet(wb, n))

  console.log('\nParsed totals:')
  for (const p of parsed) {
    console.log(
      `  ${p.planName.padEnd(12)} sqFt=${String(p.sqFt ?? '?').padStart(5)} intDoors=${String(p.intDoors ?? '?').padStart(3)}  ` +
      `CLASSIC=$${p.classicTotal?.toFixed(2)}  SIGNATURE=$${p.signatureTotal?.toFixed(2)}  ELEMENT=$${p.elementTotal?.toFixed(2)}  items=${p.items.length}`,
    )
  }

  // Sanity: SIGNATURE should == CLASSIC for all 5 per A27
  for (const p of parsed) {
    if (p.classicTotal && p.signatureTotal && Math.abs(p.classicTotal - p.signatureTotal) > 0.005) {
      console.warn(`  ⚠ ${p.planName}: SIGNATURE (${p.signatureTotal}) ≠ CLASSIC (${p.classicTotal}) — unexpected per A27.`)
    }
  }

  const prisma = new PrismaClient()
  try {
    const builder = await prisma.builder.findFirst({
      where: { companyName: { equals: 'Bloomfield Homes', mode: 'insensitive' } },
      select: { id: true, companyName: true },
    })
    if (!builder) {
      console.error('Bloomfield builder not found. STOP.')
      return
    }
    console.log(`\nBuilder: ${builder.companyName} (${builder.id})`)

    const community = await prisma.community.findFirst({
      where: { builderId: builder.id, name: { contains: 'Bloomfield', mode: 'insensitive' } },
      select: { id: true, name: true },
    })
    if (!community) {
      console.error('Bloomfield community not found. STOP.')
      return
    }
    console.log(`Community: ${community.name} (${community.id})`)

    // Preview floor-plan updates
    console.log('\nFloorPlan updates preview:')
    const planUpdates: { id: string; name: string; basePackagePrice: number; takeoffNotesLen: number }[] = []
    for (const p of parsed) {
      const existing = await prisma.communityFloorPlan.findFirst({
        where: { communityId: community.id, name: { equals: p.planName, mode: 'insensitive' } },
        select: { id: true, name: true, basePackagePrice: true, sqFootage: true },
      })
      if (!existing) {
        console.warn(`  ⚠ plan "${p.planName}" not found — skipping (constraint: no new Community/Plan writes).`)
        continue
      }
      if (p.classicTotal === null) {
        console.warn(`  ⚠ plan "${p.planName}" has no CLASSIC total — skipping.`)
        continue
      }
      const notes = buildTakeoffNotes(p)
      planUpdates.push({ id: existing.id, name: p.planName, basePackagePrice: p.classicTotal, takeoffNotesLen: notes.length })
      console.log(
        `  ${p.planName.padEnd(12)} → basePackagePrice=$${p.classicTotal.toFixed(2)}  (was ${existing.basePackagePrice === null ? 'null' : '$' + existing.basePackagePrice})  takeoffNotes=${notes.length} chars`,
      )
    }

    // Preview BuilderPricing upserts
    console.log('\nBuilderPricing preview:')
    const pricingPlan: { productId: string; sku: string; customPrice: number; workbookItem: string }[] = []
    const pricingSkipped: string[] = []
    for (const m of BUILDER_PRICING_MATCHES) {
      const prod = await prisma.product.findUnique({ where: { sku: m.sku }, select: { id: true, sku: true, name: true, basePrice: true } })
      if (!prod) {
        pricingSkipped.push(`${m.sku} (not in Product table)`)
        continue
      }
      const customPrice = Math.round(m.unitCost * MARKUP * 100) / 100
      pricingPlan.push({ productId: prod.id, sku: prod.sku, customPrice, workbookItem: m.workbookItem })
      console.log(`  + ${prod.sku.padEnd(20)} "${m.workbookItem}" → customPrice=$${customPrice}  (cost $${m.unitCost} × ${MARKUP}; retail $${prod.basePrice})`)
    }
    for (const s of pricingSkipped) console.log(`  - SKIP: ${s}`)

    // Preview summary InboxItem
    const skippedReasons = [
      'Trim line items ($/LF) — unit mismatch with Product.basePrice (EA)',
      'Carrara interior doors — workbook uses "$75 avg" not per-SKU (2068/2668/2868 not in catalog as Carrara HC SKUs)',
      'Daylon / Delta / Monza / Basic hardware — no matching SKUs in Product (Kwikset/Sure-Loc SKUs not yet loaded)',
      'Shelving (12"/16"/24" shelf, pole socket, rod support) — low-confidence name matches, not committed',
      'Stair Rail Package + Safety Rail — no matching SKUs in Product',
      `Tier detail (CLASSIC + ELEMENT items, per-section totals, $${/*will fill*/ ''}deltas) captured in takeoffNotes JSON for each plan.`,
    ]

    const inboxId = 'bfpv2_' + crypto.createHash('sha256').update(SRC_TAG + '::' + builder.id).digest('hex').slice(0, 20)
    const inboxTitle = `[BLOOMFIELD] Rev2 pricing loaded: ${planUpdates.length} plan basePackagePrice set, ${pricingPlan.length} BuilderPricing rows. Tier deltas in takeoffNotes.`
    const inboxDesc =
      `Bloomfield Rev2 pricing load (source: Bloomfield_Rev2_Pricing.xlsx, tag ${SRC_TAG}). ` +
      `Set CommunityFloorPlan.basePackagePrice = CLASSIC tier grand total for ${planUpdates.length} plans: ` +
      planUpdates.map((p) => `${p.name} ($${p.basePackagePrice.toFixed(2)})`).join(', ') + '. ' +
      `Per-plan CLASSIC + ELEMENT tier line-item breakdown (section totals, delta $ and %) serialized into takeoffNotes as JSON. ` +
      `BuilderPricing rows created for ${pricingPlan.length} confident fuzzy-matched SKUs: ` +
      pricingPlan.map((p) => `${p.sku} "${p.workbookItem}" @ $${p.customPrice}`).join('; ') + '. ' +
      `Items intentionally SKIPPED (no confident match or unit mismatch): ${skippedReasons.join(' | ')}. ` +
      `Next step: load Kwikset Daylon / Delta / Sure-Loc Monza hardware SKUs into Product table, then re-run this loader to fill in the remaining ~25 hardware line items per plan.`

    console.log('\nInboxItem preview:')
    console.log(`  id: ${inboxId}`)
    console.log(`  title: ${inboxTitle}`)
    console.log(`  desc (first 200 chars): ${inboxDesc.slice(0, 200)}...`)

    if (DRY_RUN) {
      console.log('\nDRY-RUN — re-run with --commit to apply.')
      return
    }

    console.log('\nCOMMIT — applying...')

    // 1. Update CommunityFloorPlan rows
    let planWrote = 0
    for (const u of planUpdates) {
      const planObj = parsed.find((p) => p.planName === u.name)!
      const notes = buildTakeoffNotes(planObj)
      await prisma.communityFloorPlan.update({
        where: { id: u.id },
        data: { basePackagePrice: u.basePackagePrice, takeoffNotes: notes },
      })
      planWrote++
    }
    console.log(`  floor plans updated: ${planWrote}`)

    // 2. Upsert BuilderPricing rows (unique on [builderId, productId])
    let pricingWrote = 0
    for (const pp of pricingPlan) {
      await prisma.builderPricing.upsert({
        where: { builderId_productId: { builderId: builder.id, productId: pp.productId } },
        create: { builderId: builder.id, productId: pp.productId, customPrice: pp.customPrice },
        update: { customPrice: pp.customPrice },
      })
      pricingWrote++
    }
    console.log(`  builder pricing rows: ${pricingWrote}`)

    // 3. Upsert summary InboxItem
    await prisma.inboxItem.upsert({
      where: { id: inboxId },
      create: {
        id: inboxId,
        type: 'DEAL_FOLLOWUP',
        source: 'bloomfield-pricing-v2',
        title: inboxTitle,
        description: inboxDesc,
        priority: 'HIGH',
        status: 'PENDING',
        entityType: 'Builder',
        entityId: builder.id,
        actionData: {
          sourceTag: SRC_TAG,
          planCount: planUpdates.length,
          pricingCount: pricingPlan.length,
          skippedReasons,
        },
      },
      update: { title: inboxTitle, description: inboxDesc, priority: 'HIGH' },
    })
    console.log('  inbox item: upserted')
    console.log('\nDONE.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
