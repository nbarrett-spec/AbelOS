/**
 * scripts/etl-bom.ts
 *
 * Loads the "Bill of Materials" sheet of Abel_Product_Catalog_LIVE.xlsx into
 * the Aegis BomEntry table. Schema has NO unique constraint on
 * (parentId, componentId) — so we reconcile manually to avoid duplicate
 * inserts.
 *
 * Matching: Product.name (exact, case-insensitive) for both parent and
 * component. Rows where either side doesn't match are reported and skipped.
 *
 * Modes:
 *   --dry-run (default) — compute diff, write nothing
 *   --commit            — apply
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')

interface BomRow {
  parentName: string
  componentName: string
  quantity: number
  componentType: string | null
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function main() {
  console.log(`ETL BOM — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets['Bill of Materials']
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null })
  console.log(`XLSX rows: ${rows.length}`)

  const parsed: BomRow[] = []
  for (const r of rows) {
    const parentName = String(r['Finished Product'] ?? '').trim()
    const componentName = String(r['Component'] ?? '').trim()
    const qty = typeof r.Quantity === 'number' ? r.Quantity : parseFloat(String(r.Quantity ?? '1'))
    const componentType = String(r['Component Category'] ?? '').trim() || null
    if (!parentName || !componentName) continue
    if (!Number.isFinite(qty) || qty <= 0) continue
    parsed.push({ parentName, componentName, quantity: qty, componentType })
  }
  console.log(`Parsed rows: ${parsed.length}`)

  const prisma = new PrismaClient()
  try {
    const products = await prisma.product.findMany({ select: { id: true, name: true } })
    const byName = new Map(products.map((p) => [normName(p.name), p]))

    // Resolve parent + component to product IDs
    type Resolved = BomRow & { parentId: string; componentId: string }
    const resolved: Resolved[] = []
    const unmatchedParents = new Set<string>()
    const unmatchedComponents = new Set<string>()
    for (const r of parsed) {
      const p = byName.get(normName(r.parentName))
      const c = byName.get(normName(r.componentName))
      if (!p) unmatchedParents.add(r.parentName)
      if (!c) unmatchedComponents.add(r.componentName)
      if (p && c) resolved.push({ ...r, parentId: p.id, componentId: c.id })
    }
    console.log(`Resolved (parent+component both matched): ${resolved.length}`)
    console.log(`Unmatched distinct parents: ${unmatchedParents.size}`)
    console.log(`Unmatched distinct components: ${unmatchedComponents.size}`)

    // Deduplicate XLSX rows by (parentId, componentId) — same pair appearing
    // twice: sum quantities? or prefer the first? Real BOM data shouldn't
    // double-list the same component. Prefer the first occurrence; log warnings.
    const dedup = new Map<string, Resolved>()
    let dupeCount = 0
    for (const r of resolved) {
      const k = `${r.parentId}::${r.componentId}`
      if (dedup.has(k)) { dupeCount++; continue }
      dedup.set(k, r)
    }
    if (dupeCount > 0) console.log(`XLSX duplicates ignored: ${dupeCount}`)
    const uniqueXlsx = [...dedup.values()]

    // Load existing BomEntry rows
    const existing = await prisma.bomEntry.findMany({
      select: { id: true, parentId: true, componentId: true, quantity: true, componentType: true },
    })
    console.log(`Aegis current BomEntry: ${existing.length}`)
    const existingMap = new Map<string, typeof existing[number]>()
    for (const e of existing) existingMap.set(`${e.parentId}::${e.componentId}`, e)

    // Diff
    const toCreate: Resolved[] = []
    const toUpdate: Array<{ existingId: string; next: Resolved }> = []
    let unchanged = 0

    for (const r of uniqueXlsx) {
      const key = `${r.parentId}::${r.componentId}`
      const prev = existingMap.get(key)
      if (!prev) { toCreate.push(r); continue }
      const qtyChanged = Math.abs(prev.quantity - r.quantity) > 0.001
      const typeChanged = (prev.componentType || null) !== (r.componentType || null)
      if (!qtyChanged && !typeChanged) { unchanged++; continue }
      toUpdate.push({ existingId: prev.id, next: r })
    }

    console.log()
    console.log('=== DIFF SUMMARY ===')
    console.log(`  Will CREATE: ${toCreate.length}`)
    console.log(`  Will UPDATE: ${toUpdate.length}`)
    console.log(`  Unchanged:   ${unchanged}`)
    console.log()

    if (toCreate.length > 0) {
      console.log('Sample CREATE (first 3):')
      toCreate.slice(0, 3).forEach((r) =>
        console.log(`  + ${r.parentName.slice(0, 40)}  +  ${r.componentName.slice(0, 40)}  qty=${r.quantity} type=${r.componentType}`)
      )
      console.log()
    }
    if (toUpdate.length > 0) {
      console.log('Sample UPDATE (first 3):')
      toUpdate.slice(0, 3).forEach((u) =>
        console.log(`  ~ ${u.next.parentName.slice(0, 30)} → ${u.next.componentName.slice(0, 30)}  qty=${u.next.quantity}`)
      )
      console.log()
    }
    if (unmatchedParents.size > 0 && unmatchedParents.size <= 15) {
      console.log('Unmatched parents:')
      ;[...unmatchedParents].slice(0, 15).forEach((n) => console.log('  -', n))
      console.log()
    }
    if (unmatchedComponents.size > 0 && unmatchedComponents.size <= 15) {
      console.log('Unmatched components:')
      ;[...unmatchedComponents].slice(0, 15).forEach((n) => console.log('  -', n))
      console.log()
    }

    if (DRY_RUN) {
      console.log('DRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('COMMIT — applying...')
    let created = 0, updated = 0, failed = 0
    const CHUNK = 300

    // Creates: bulk-ish via createMany (no relational constraint issue)
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const slice = toCreate.slice(i, i + CHUNK)
      try {
        const res = await prisma.bomEntry.createMany({
          data: slice.map((r) => ({
            parentId: r.parentId,
            componentId: r.componentId,
            quantity: r.quantity,
            componentType: r.componentType,
          })),
        })
        created += res.count
      } catch (e) {
        failed += slice.length
        console.error('createMany fail:', (e as Error).message.slice(0, 200))
      }
      process.stdout.write(`  create progress: ${Math.min(i + CHUNK, toCreate.length)} / ${toCreate.length}\r`)
    }
    console.log()

    // Updates: one-by-one (small batch)
    for (const u of toUpdate) {
      try {
        await prisma.bomEntry.update({
          where: { id: u.existingId },
          data: { quantity: u.next.quantity, componentType: u.next.componentType },
        })
        updated++
      } catch (e) {
        failed++
        console.error('update fail:', (e as Error).message.slice(0, 200))
      }
    }

    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
