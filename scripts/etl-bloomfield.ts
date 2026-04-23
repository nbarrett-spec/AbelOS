/**
 * scripts/etl-bloomfield.ts
 *
 * Loads Bloomfield Homes data (Aegis builder id: created 2026-04-22, companyName
 * "Bloomfield Homes"). Populates:
 *   - Community (one: "Bloomfield Homes DFW") if missing
 *   - CommunityFloorPlan — one per plan name found across Rev2 pricing sheets
 *     and Lisa's bid-sheet folder, with square footage from Rev2 where known
 *   - InboxItem — 4 summary items (Pricing Assessment, Hardware Sourcing,
 *     Trim Bid, Rev2 Pricing overview) with source tag BLOOMFIELD_DEAL_APR2026
 *
 * Does NOT extract per-SKU BuilderPricing — the Rev2 file uses a
 * CLASSIC/SIGNATURE/ELEMENT tier structure that doesn't map cleanly to the
 * flat BuilderPricing table. Follow-up task if needed.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const BLOOMFIELD_DIR = path.resolve(__dirname, '..', '..', 'Bloomfield Homes')
const LISA_BIDS_DIR = path.join(BLOOMFIELD_DIR, 'Worksheets (Lisas Bids)')
const SRC_TAG = 'BLOOMFIELD_APR2026'

function hashId(s: string, k: string): string {
  return 'bfd_' + crypto.createHash('sha256').update(`${s}::${k}`).digest('hex').slice(0, 18)
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim()
}

// Pull plan names from bid sheet filenames: "BLOOMFIELD BELLFLOWER.xlsx" → "Bellflower"
function planNamesFromBids(): Set<string> {
  if (!fs.existsSync(LISA_BIDS_DIR)) return new Set()
  const names = new Set<string>()
  for (const f of fs.readdirSync(LISA_BIDS_DIR)) {
    if (!f.toLowerCase().endsWith('.xlsx')) continue
    // Extract plan name portion: "BLOOMFIELD SPRING CRESS.xlsx" → "Spring Cress"
    const m = f.match(/BLOOMFIELD\s+(.+?)\.xlsx$/i)
    if (!m) continue
    let n = titleCase(m[1])
    // Normalize near-duplicates: "Bellflowere" is a typo of "Bellflower"
    if (/^Bellflowere?$/i.test(n)) n = 'Bellflower'
    names.add(n)
  }
  return names
}

// Pull plan names + sq ft from Rev2 pricing file
function planNamesFromRev2(): Map<string, number | null> {
  const file = path.join(BLOOMFIELD_DIR, 'Bloomfield_Rev2_Pricing.xlsx')
  if (!fs.existsSync(file)) return new Map()
  const wb = XLSX.readFile(file)
  const out = new Map<string, number | null>()
  for (const sheet of wb.SheetNames) {
    if (sheet === 'Summary' || sheet === 'Cost Inputs') continue
    // Sheet name IS the plan name
    const name = titleCase(sheet)
    // Read row 1 to find square footage: "Sq Ft: 3,034 | ..."
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheet], { header: 1, defval: null }) as any[][]
    let sqft: number | null = null
    for (const r of rows.slice(0, 5)) {
      for (const c of r) {
        const s = String(c ?? '')
        const m = s.match(/Sq\s*Ft[:\s]+([\d,]+)/i)
        if (m) { sqft = parseInt(m[1].replace(/,/g, ''), 10); break }
      }
      if (sqft !== null) break
    }
    out.set(name, sqft)
  }
  return out
}

async function main() {
  console.log(`ETL Bloomfield — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  const rev2Plans = planNamesFromRev2()
  const bidPlans = planNamesFromBids()
  const allPlans = new Map<string, number | null>()
  for (const [n, sq] of rev2Plans) allPlans.set(n, sq)
  for (const n of bidPlans) if (!allPlans.has(n)) allPlans.set(n, null)

  console.log(`Plans from Rev2 pricing:   ${rev2Plans.size} (${[...rev2Plans.keys()].join(', ')})`)
  console.log(`Plans from Lisa's bids:    ${bidPlans.size}`)
  console.log(`Total unique plans:        ${allPlans.size}`)
  console.log()

  const prisma = new PrismaClient()
  try {
    const builder = await prisma.builder.findFirst({
      where: { companyName: { equals: 'Bloomfield Homes', mode: 'insensitive' } },
      select: { id: true, companyName: true },
    })
    if (!builder) {
      console.error('Bloomfield builder not found — run the create step first.')
      return
    }
    console.log(`Builder: ${builder.companyName} (${builder.id})`)

    // Ensure Community exists
    let community = await prisma.community.findFirst({
      where: { builderId: builder.id, name: { contains: 'Bloomfield', mode: 'insensitive' } },
      select: { id: true, name: true },
    })
    console.log(`Community existing:        ${community ? `YES (${community.name})` : 'no — will create'}`)
    console.log()

    // Preview plan list
    console.log('Plans that will be created/upserted (Name | Sq Ft):')
    const sortedPlans = [...allPlans.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [name, sqft] of sortedPlans) {
      console.log(`  ${name.padEnd(20)} | ${sqft ?? '(unknown)'}`)
    }
    console.log()

    // Preview summary InboxItems
    const summaryItems: { file: string; title: string; desc: string }[] = [
      {
        file: 'Bloomfield_Rev2_Pricing.xlsx',
        title: '[BLOOMFIELD] Rev2 pricing active — 5 model plans on CLASSIC/SIGNATURE/ELEMENT tier',
        desc: 'Authoritative Bloomfield pricing workbook (Rev2, April 2026). Carolina (3,034 sqft), Cypress (2,500), Hawthorne, Magnolia, Bayberry. Per-plan price tiers: CLASSIC / SIGNATURE / ELEMENT. File lives in Bloomfield Homes/Bloomfield_Rev2_Pricing.xlsx. Per-SKU extraction deferred — tier structure needs dedicated loader.',
      },
      {
        file: 'Bloomfield_Pricing_Assessment.xlsx',
        title: '[BLOOMFIELD] Pricing assessment available — "The Real Numbers" + Scenario Calculator',
        desc: 'Analysis workbook with 70-row assessment and adjustable scenario calculator (Ext Door Markup, Homes/Year). Based on ADT Manufacturing costs. Review for margin sensitivity before contract finalization.',
      },
      {
        file: 'Bloomfield_Hardware_Sourcing_Analysis.xlsx',
        title: '[BLOOMFIELD] Hardware sourcing analysis — Domestic vs Overseas comparison',
        desc: '50-row analysis prepared for Avery. Covers door hardware sourcing tradeoffs (lead time, landed cost, quality). Review before hardware selection is finalized for Bloomfield plans.',
      },
      {
        file: 'Bloomfield_Trim_Bid_Out_Abel.xlsx',
        title: '[BLOOMFIELD] Trim bid-out sheet — 123 line items for Abel to bid',
        desc: 'Trim bid-out worksheet. 123 line items across plans. Use to price out the trim scope and return a competitive bid.',
      },
    ]
    console.log(`Summary InboxItems to create: ${summaryItems.length}`)
    summaryItems.forEach((s) => console.log(`  + ${s.title.slice(0, 90)}`))
    console.log()

    if (DRY_RUN) { console.log('DRY-RUN — re-run with --commit.'); return }

    console.log('COMMIT — applying...')

    // Create community if missing
    if (!community) {
      community = await prisma.community.create({
        data: {
          builderId: builder.id,
          name: 'Bloomfield Homes DFW',
          city: 'DFW',
          state: 'TX',
        },
        select: { id: true, name: true },
      })
      console.log(`  community created: ${community.id}`)
    }

    // Upsert plans
    let plansCreated = 0, plansUpdated = 0
    for (const [name, sqft] of allPlans) {
      const existing = await prisma.communityFloorPlan.findFirst({
        where: { communityId: community.id, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existing) {
        if (sqft !== null) {
          await prisma.communityFloorPlan.update({ where: { id: existing.id }, data: { sqFootage: sqft } })
          plansUpdated++
        }
      } else {
        await prisma.communityFloorPlan.create({
          data: { communityId: community.id, name, sqFootage: sqft },
        })
        plansCreated++
      }
    }
    console.log(`  plans: created=${plansCreated} updated=${plansUpdated}`)

    // Upsert summary InboxItems
    let ibCreated = 0, ibUpdated = 0
    for (const s of summaryItems) {
      const id = hashId(SRC_TAG, s.file)
      const res = await prisma.inboxItem.upsert({
        where: { id },
        create: {
          id,
          type: 'DEAL_FOLLOWUP',
          source: 'bloomfield-deal',
          title: s.title,
          description: s.desc,
          priority: 'HIGH',
          status: 'PENDING',
          entityType: 'Builder',
          entityId: builder.id,
          actionData: { sourceTag: SRC_TAG, file: s.file },
        },
        update: { title: s.title, description: s.desc, priority: 'HIGH' },
        select: { createdAt: true, updatedAt: true },
      })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) ibCreated++; else ibUpdated++
    }
    console.log(`  inbox items: created=${ibCreated} updated=${ibUpdated}`)
    console.log('DONE.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
