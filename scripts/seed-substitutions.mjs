#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// seed-substitutions.mjs
// ──────────────────────────────────────────────────────────────────────────
// Creates the ProductSubstitution table (idempotent) and populates it from
// four rules:
//   A — Same attributes, different vendors (name-prefix proxy since supplierId
//       is null across the catalog)
//   B — Upgrade/downgrade compatibility (fire-rated / core type)
//   C — Jamb size adjacency (4-9/16 ↔ 4-5/8 with shim kit)
//   D — Brookfield Value Engineering xlsx
//
// Usage:  node scripts/seed-substitutions.mjs [--dry-run]
// ──────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client'
import XLSX from 'xlsx'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const SCRIPTS_DIR = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..')
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..')

const DRY_RUN = process.argv.includes('--dry-run')
const prisma = new PrismaClient()

// ── Helpers ──────────────────────────────────────────────────────────────

function cuid() {
  return 'sub_' + crypto.randomBytes(12).toString('hex')
}

function normJamb(v) {
  if (!v) return null
  return String(v).replace(/["']/g, '').trim() // "4-9/16\"" -> "4-9/16"
}

function vendorFamily(sku, name) {
  // supplierId is 100% null, so use name-prefix as a vendor surrogate.
  // First 2 chars match the catalog's origin pattern (AD, BC, DW, HW).
  if (!name) return null
  const prefix = String(name).trim().slice(0, 2).toUpperCase()
  if (/^[A-Z]{2}$/.test(prefix)) return prefix
  return null
}

function keyOf(product) {
  return [
    product.doorSize ?? '',
    (product.handing ?? '').toUpperCase(),
    (product.coreType ?? '').toLowerCase(),
    (product.panelStyle ?? '').toLowerCase(),
    (product.material ?? '').toLowerCase(),
  ].join('|')
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProductSubstitution" (
      id TEXT PRIMARY KEY,
      "primaryProductId" TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
      "substituteProductId" TEXT NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
      "substitutionType" TEXT NOT NULL,
      "priceDelta" DECIMAL,
      "compatibility" TEXT,
      "conditions" TEXT,
      "source" TEXT,
      "active" BOOLEAN DEFAULT true,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE("primaryProductId", "substituteProductId")
    );
  `)
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProductSubstitution_primary_idx" ON "ProductSubstitution"("primaryProductId");`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProductSubstitution_sub_idx" ON "ProductSubstitution"("substituteProductId");`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ProductSubstitution_source_idx" ON "ProductSubstitution"("source");`
  )
}

// Buffer inserts by primary+substitute key; skip obvious duplicates.
const pending = new Map()

function addPair(primaryId, substituteId, opts) {
  if (!primaryId || !substituteId || primaryId === substituteId) return
  const k = `${primaryId}|${substituteId}`
  const existing = pending.get(k)
  // Source priority: VE_PROPOSAL > MFR_CATALOG > MANUAL
  const rank = { VE_PROPOSAL: 3, MFR_CATALOG: 2, MANUAL: 1 }
  if (existing && (rank[existing.source] ?? 0) >= (rank[opts.source] ?? 0)) return
  pending.set(k, {
    id: cuid(),
    primaryProductId: primaryId,
    substituteProductId: substituteId,
    substitutionType: opts.substitutionType,
    priceDelta: opts.priceDelta ?? null,
    compatibility: opts.compatibility,
    conditions: opts.conditions ?? null,
    source: opts.source,
  })
}

// ── Rule A — Same attributes, different vendors ──────────────────────────

function ruleA(products) {
  // Group by (doorSize, handing, coreType, panelStyle, material). Inside each
  // group, pair products whose name-prefix (vendor surrogate) differs.
  const groups = new Map()
  for (const p of products) {
    if (!p.doorSize) continue // core identifier
    const k = keyOf(p)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(p)
  }
  let count = 0
  for (const [, grp] of groups) {
    if (grp.length < 2) continue
    for (let i = 0; i < grp.length; i++) {
      for (let j = 0; j < grp.length; j++) {
        if (i === j) continue
        const a = grp[i], b = grp[j]
        const va = vendorFamily(a.sku, a.name)
        const vb = vendorFamily(b.sku, b.name)
        if (!va || !vb || va === vb) continue
        const delta = (b.cost ?? 0) - (a.cost ?? 0)
        addPair(a.id, b.id, {
          substitutionType: 'DIRECT',
          priceDelta: delta,
          compatibility: 'IDENTICAL',
          conditions: `Same specs, vendor swap (${va} -> ${vb})`,
          source: 'MFR_CATALOG',
        })
        count++
      }
    }
  }
  return count
}

// ── Rule B — Upgrade / downgrade compatibility ───────────────────────────

function ruleB(products) {
  // Group by dimensional match (doorSize + handing + panelStyle) so a
  // fire-rated slab only pairs with a geometrically equivalent non-fire slab.
  let count = 0
  const buckets = new Map()
  for (const p of products) {
    if (!p.doorSize) continue
    const dim = `${p.doorSize}|${(p.handing ?? '').toUpperCase()}|${(p.panelStyle ?? '').toLowerCase()}`
    if (!buckets.has(dim)) buckets.set(dim, [])
    buckets.get(dim).push(p)
  }

  for (const [, grp] of buckets) {
    if (grp.length < 2) continue

    // B1: fire-rated ↔ non-fire-rated, within the same core-type
    // (we don't swap a fire-rated hollow for a solid-core non-fire door).
    const coreKey = (p) => (p.coreType ?? '').toLowerCase()
    const byCore = new Map()
    for (const p of grp) {
      const k = coreKey(p)
      if (!byCore.has(k)) byCore.set(k, [])
      byCore.get(k).push(p)
    }
    for (const [, subgrp] of byCore) {
      const fr = subgrp.filter(p => p.fireRating)
      const nonFr = subgrp.filter(p => !p.fireRating)
      for (const f of fr) for (const n of nonFr) {
        addPair(n.id, f.id, {
          substitutionType: 'UPGRADE',
          priceDelta: (f.cost ?? 0) - (n.cost ?? 0),
          compatibility: 'COMPATIBLE',
          conditions: `Upgrade to ${f.fireRating} fire rating`,
          source: 'MFR_CATALOG',
        })
        addPair(f.id, n.id, {
          substitutionType: 'DOWNGRADE',
          priceDelta: (n.cost ?? 0) - (f.cost ?? 0),
          compatibility: 'CONDITIONAL',
          conditions: `Requires approval: removes ${f.fireRating} fire rating`,
          source: 'MFR_CATALOG',
        })
        count += 2
      }
    }

    // B2: solid core ↔ hollow core within the same fire-rating status
    const sameFire = (a, b) => (a.fireRating ?? '') === (b.fireRating ?? '')
    const solids = grp.filter(p => /solid/i.test(p.coreType ?? ''))
    const hollows = grp.filter(p => /hollow/i.test(p.coreType ?? ''))
    for (const s of solids) for (const h of hollows) {
      if (!sameFire(s, h)) continue
      addPair(h.id, s.id, {
        substitutionType: 'UPGRADE',
        priceDelta: (s.cost ?? 0) - (h.cost ?? 0),
        compatibility: 'COMPATIBLE',
        conditions: 'Upgrade hollow -> solid core',
        source: 'MFR_CATALOG',
      })
      addPair(s.id, h.id, {
        substitutionType: 'DOWNGRADE',
        priceDelta: (h.cost ?? 0) - (s.cost ?? 0),
        compatibility: 'CONDITIONAL',
        conditions: 'VE alternative: solid -> hollow core (builder approval required)',
        source: 'MFR_CATALOG',
      })
      count += 2
    }
  }
  return count
}

// ── Rule C — Jamb size adjacency with shim kit ───────────────────────────

function ruleC(products) {
  // Products identical except jamb size 4-9/16 vs 4-5/8 -> shim kit required.
  // Group by (doorSize, handing, coreType, panelStyle) and pair across the
  // two jamb widths.
  let count = 0
  const buckets = new Map()
  for (const p of products) {
    if (!p.doorSize || !p.jambSize) continue
    const norm = normJamb(p.jambSize)
    if (norm !== '4-9/16' && norm !== '4-5/8') continue
    const dim = `${p.doorSize}|${(p.handing ?? '').toUpperCase()}|${(p.coreType ?? '').toLowerCase()}|${(p.panelStyle ?? '').toLowerCase()}`
    if (!buckets.has(dim)) buckets.set(dim, { '4-9/16': [], '4-5/8': [] })
    buckets.get(dim)[norm].push(p)
  }
  for (const [, pair] of buckets) {
    for (const a of pair['4-9/16']) for (const b of pair['4-5/8']) {
      addPair(a.id, b.id, {
        substitutionType: 'DIRECT',
        priceDelta: (b.cost ?? 0) - (a.cost ?? 0),
        compatibility: 'CONDITIONAL',
        conditions: 'Jamb size adjacency: requires shim kit',
        source: 'MFR_CATALOG',
      })
      addPair(b.id, a.id, {
        substitutionType: 'DIRECT',
        priceDelta: (a.cost ?? 0) - (b.cost ?? 0),
        compatibility: 'CONDITIONAL',
        conditions: 'Jamb size adjacency: requires shim kit',
        source: 'MFR_CATALOG',
      })
      count += 2
    }
  }
  return count
}

// ── Rule D — Brookfield VE proposal ──────────────────────────────────────
// Structured swaps extracted from Brookfield_Value_Engineering_Proposal_April_2026.xlsx
// Each entry identifies source + target products by SKU or fuzzy name match.

const VE_SWAPS = [
  // 1-Panel Shaker replaces 2-Panel Molded Shaker, same geometry.
  // Strict: `from` must explicitly say 2-panel; `to` must explicitly say 1-panel.
  // "shaker" alone is too loose (would match every existing shaker slab).
  {
    match: {
      fromName: ['2-panel', '2 panel'],
      fromPanelStyle: '2-panel',
      toName: ['1-panel', '1 panel'],
      toPanelStyle: '1-panel',
      categoryContains: 'door',
    },
    conditions: 'VE alternative: 2-Panel Molded -> 1-Panel Shaker (Brookfield proposal April 2026)',
  },
  // Brass hinges -> Matte Black hinges
  {
    match: {
      fromName: ['brass', 'bright brass', 'polished brass'],
      toName: ['matte black', 'black', 'flat black', 'oil rubbed black'],
      categoryContains: 'hinge',
    },
    conditions: 'VE alternative: Brass -> Matte Black hardware finish (Brookfield proposal)',
  },
  // Knotty alder barn door slab -> MDF barn door slab
  {
    match: {
      fromName: ['knotty alder', 'alder'],
      toName: ['mdf'],
      categoryContains: 'barn',
    },
    conditions: 'VE alternative: Knotty alder -> MDF barn door (warp risk eliminated)',
  },
  // Clear Pine 10-Lite -> Primed Pine 1-Lite composite
  {
    match: {
      fromName: ['clear pine', '10-lite', '10 lite'],
      toName: ['primed', '1-lite', '1 lite', 'composite'],
      categoryContains: 'lite',
    },
    conditions: 'VE alternative: Clear Pine 10-Lite -> Primed Pine 1-Lite composite',
  },
  // Particle board shelving -> MDF shelving
  {
    match: {
      fromName: ['particle board', 'particleboard', 'pb shelf'],
      toName: ['mdf'],
      categoryContains: 'shelf',
    },
    conditions: 'VE alternative: Particle board -> MDF shelving (same price, stronger)',
  },
]

function matchesAny(haystack, needles) {
  if (!haystack) return false
  const h = String(haystack).toLowerCase()
  return needles.some(n => h.includes(String(n).toLowerCase()))
}

function ruleD(products) {
  let count = 0
  for (const swap of VE_SWAPS) {
    const { match } = swap
    // Strict category scoping. Only match categoryContains against category /
    // subcategory (NOT name) — product names routinely mention "Hinge" or
    // "Shelf" inside descriptions of unrelated doors.
    const candidates = match.categoryContains
      ? products.filter(p =>
          matchesAny(p.category, [match.categoryContains]) ||
          matchesAny(p.subcategory, [match.categoryContains])
        )
      : products
    const froms = candidates.filter(p => {
      const byName = matchesAny(p.name, match.fromName)
      const byStyle = match.fromPanelStyle && matchesAny(p.panelStyle, [match.fromPanelStyle])
      return byName || byStyle
    })
    const tos = candidates.filter(p => {
      const byName = matchesAny(p.name, match.toName)
      const byStyle = match.toPanelStyle && matchesAny(p.panelStyle, [match.toPanelStyle])
      return byName || byStyle
    })
    for (const f of froms) for (const t of tos) {
      if (f.id === t.id) continue
      // Dimensional gates so we don't produce mass N^2 pairs.
      if (f.doorSize || t.doorSize) {
        if (f.doorSize !== t.doorSize) continue
      }
      if (f.handing && t.handing && f.handing !== t.handing) continue
      if (f.coreType && t.coreType &&
          String(f.coreType).toLowerCase() !== String(t.coreType).toLowerCase()) continue
      addPair(f.id, t.id, {
        substitutionType: 'VE',
        priceDelta: (t.cost ?? 0) - (f.cost ?? 0),
        compatibility: 'COMPATIBLE',
        conditions: swap.conditions,
        source: 'VE_PROPOSAL',
      })
      count++
    }
  }

  // Additionally: parse the spreadsheet's explicit SKU/size table in "Door Style Analysis"
  // Rows 5-14 list door sizes with old vs new cost. Since the catalog uses size-only
  // identifiers rather than SKU in those rows, Rule D1 above covers the swap; the xlsx
  // is parsed below only for notes / provenance.
  try {
    const fp = path.resolve(ABEL_FOLDER, 'Brookfield', 'Brookfield_Value_Engineering_Proposal_April_2026.xlsx')
    const wb = XLSX.readFile(fp, { cellDates: true })
    if (wb.SheetNames.includes('Door Style Analysis')) {
      const ws = wb.Sheets['Door Style Analysis']
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
      const sizeRows = rows.slice(5, 15).filter(r => r && r[0] && r[0] !== 'AVERAGE')
      // For each size in the xlsx, look for a 2-panel ↔ 1-panel pair in the catalog
      for (const r of sizeRows) {
        const size = String(r[0]).trim()
        const hand = r[1] ? String(r[1]).trim().toUpperCase() : null
        const twoP = products.find(p => p.doorSize === size &&
                                        (!hand || (p.handing ?? '').toUpperCase() === hand || hand === 'TWIN') &&
                                        matchesAny(p.panelStyle, ['2-panel', '2 panel']))
        const oneP = products.find(p => p.doorSize === size &&
                                        (!hand || (p.handing ?? '').toUpperCase() === hand || hand === 'TWIN') &&
                                        matchesAny(p.panelStyle, ['1-panel', '1 panel', 'shaker']))
        if (twoP && oneP && twoP.id !== oneP.id) {
          addPair(twoP.id, oneP.id, {
            substitutionType: 'VE',
            priceDelta: (oneP.cost ?? 0) - (twoP.cost ?? 0),
            compatibility: 'COMPATIBLE',
            conditions: `Brookfield VE ${size}: 2-Panel -> 1-Panel Shaker, COGS save $${((twoP.cost ?? 0) - (oneP.cost ?? 0)).toFixed(2)}`,
            source: 'VE_PROPOSAL',
          })
          count++
        }
      }
    }
  } catch (e) {
    console.warn('[ruleD] xlsx parse skipped:', e.message)
  }
  return count
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seed-substitutions] DRY_RUN=${DRY_RUN}`)
  await ensureTable()
  console.log('[seed-substitutions] table ensured')

  const products = await prisma.$queryRawUnsafe(`
    SELECT id, sku, name, category, subcategory,
           "doorSize", handing, "coreType", "panelStyle", "jambSize",
           material, "fireRating", "hardwareFinish", cost, "supplierId"
    FROM "Product"
    WHERE active = true
  `)
  console.log(`[seed-substitutions] loaded ${products.length} active products`)

  const a = ruleA(products)
  console.log(`[seed-substitutions] Rule A (different-vendor direct): ${a} candidate pairs`)
  const b = ruleB(products)
  console.log(`[seed-substitutions] Rule B (fire/core upgrade/downgrade): ${b} candidate pairs`)
  const c = ruleC(products)
  console.log(`[seed-substitutions] Rule C (jamb adjacency): ${c} candidate pairs`)
  const d = ruleD(products)
  console.log(`[seed-substitutions] Rule D (Brookfield VE): ${d} candidate pairs`)

  const pairs = [...pending.values()]
  console.log(`[seed-substitutions] total unique pairs (post-merge): ${pairs.length}`)

  // Breakdown by source/type
  const bySource = pairs.reduce((m, p) => { m[p.source] = (m[p.source] ?? 0) + 1; return m }, {})
  const byType = pairs.reduce((m, p) => { m[p.substitutionType] = (m[p.substitutionType] ?? 0) + 1; return m }, {})
  console.log('[seed-substitutions] by source:', bySource)
  console.log('[seed-substitutions] by type:', byType)

  if (DRY_RUN) {
    console.log('[seed-substitutions] DRY_RUN — skipping inserts')
    return
  }

  let inserted = 0
  let updated = 0
  const CHUNK = 400
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK)
    // Build a multi-row INSERT ... ON CONFLICT ... DO UPDATE
    const values = []
    const params = []
    let idx = 1
    for (const p of chunk) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, true, NOW(), NOW())`)
      params.push(
        p.id,
        p.primaryProductId,
        p.substituteProductId,
        p.substitutionType,
        p.priceDelta,
        p.compatibility,
        p.conditions,
        p.source,
      )
    }
    const sql = `
      INSERT INTO "ProductSubstitution"
        (id, "primaryProductId", "substituteProductId", "substitutionType",
         "priceDelta", "compatibility", "conditions", "source", "active",
         "createdAt", "updatedAt")
      VALUES ${values.join(', ')}
      ON CONFLICT ("primaryProductId", "substituteProductId")
      DO UPDATE SET
        "substitutionType" = EXCLUDED."substitutionType",
        "priceDelta"       = EXCLUDED."priceDelta",
        "compatibility"    = EXCLUDED."compatibility",
        "conditions"       = EXCLUDED."conditions",
        "source"           = EXCLUDED."source",
        "active"           = true,
        "updatedAt"        = NOW()
      RETURNING (xmax = 0) AS inserted
    `
    const res = await prisma.$queryRawUnsafe(sql, ...params)
    for (const r of res) {
      if (r.inserted) inserted++
      else updated++
    }
    console.log(`[seed-substitutions] upserted ${i + chunk.length}/${pairs.length}`)
  }
  console.log(`[seed-substitutions] DONE — inserted=${inserted} updated=${updated}`)
}

main()
  .catch(e => {
    console.error('[seed-substitutions] ERROR', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
