#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// parse-catalog-specs.mjs
// ──────────────────────────────────────────────────────────────────────────
// Parse manufacturer + supplier spec catalogs (PDF) and enrich the Product
// table with doorSize / handing / coreType / panelStyle / jambSize /
// material / fireRating. Two passes:
//
//   Pass 1 — self-extract: every Product already ships with the spec
//   encoded in name (e.g. "ADT 3068 LH 2 Panel Square Top 1-3/4\" S/C
//   4-5/8\" NO CASE BLK Hinges"). Regex those out for NULL fields. This
//   is by far the biggest yield.
//
//   Pass 2 — catalog supplement: pull text from manufacturer + supplier
//   PDFs, look for product-name / SKU matches, and fill any fields still
//   NULL from the catalog wording (useful for brand-specific jargon like
//   "MDF composite" or "45-min WHI" that isn't always on our own name).
//
// Only fills NULL columns — never overwrites human-entered values.
//
// Usage:
//   node scripts/parse-catalog-specs.mjs            # dry run
//   node scripts/parse-catalog-specs.mjs --commit   # apply
// ──────────────────────────────────────────────────────────────────────────

import { neon } from '@neondatabase/serverless'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env (simple parser — just DATABASE_URL)
const __filename = fileURLToPath(import.meta.url)
const SCRIPTS_DIR = path.dirname(__filename)
const ROOT = path.resolve(SCRIPTS_DIR, '..')
const ABEL = path.resolve(ROOT, '..')
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const COMMIT = process.argv.includes('--commit')
const sql = neon(process.env.DATABASE_URL)

const COLS = ['doorSize', 'handing', 'coreType', 'panelStyle', 'jambSize', 'material', 'fireRating']

// ── Regex extractors ──────────────────────────────────────────────────────
//
// All regex run against a normalized string (uppercased, single-spaced).

function normalize(s) {
  return String(s ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
}

const DOOR_SIZE_RE = /\b(1068|1268|1468|1668|1868|2068|2268|2468|2668|2868|3068|3268|2080|2480|2680|2880|3080|4068|4080|4868|5068|5080|6068|6080)\b/
// Note: handing is tricky — LHIS/RHIS/LHOS/RHOS must win over plain LH/RH.
const HANDING_RE = /\b(LHIS|RHIS|LHOS|RHOS|LH|RH)\b/

const CORE_SC = /\b(S\/?C|SOLID CORE|SOLID|SC SLAB)\b/
const CORE_HC = /\b(H\/?C|HOLLOW CORE|HOLLOW|HC SLAB)\b/

const PANEL_2P = /\b(2[- ]?PANEL|2PANEL|TWO[- ]?PANEL)\b/
const PANEL_6P = /\b(6[- ]?PANEL|6PANEL|SIX[- ]?PANEL)\b/
const PANEL_5P = /\b(5[- ]?PANEL|5PANEL|FIVE[- ]?PANEL)\b/
const PANEL_1P = /\b(1[- ]?PANEL|1PANEL|ONE[- ]?PANEL)\b/
const PANEL_3P = /\b(3[- ]?PANEL|3PANEL)\b/
const PANEL_4P = /\b(4[- ]?PANEL|4PANEL)\b/
const PANEL_SHAKER = /\bSHAKER\b/
const PANEL_FLUSH = /\b(FLUSH|FLAT)\b/
// Some catalogs call the 2-panel shape "Square Top" or "Round Top" — panel
// count not encoded there, but we can see "X Panel" nearby.

const JAMB_RE = /\b(4[- ]?5\/8|4[- ]?9\/16|6[- ]?5\/8|6[- ]?9\/16)"?/

const MATERIAL_MDF = /\b(MDF)\b/
const MATERIAL_PINE = /\b(CLEAR PINE|PONDEROSA PINE|PINE)\b/
const MATERIAL_FJ = /\b(FJ|FINGER ?JOINT|FINGER[- ]?JOINTED)\b/
const MATERIAL_COMP = /\b(COMPOSITE)\b/
const MATERIAL_POPLAR = /\bPOPLAR\b/
const MATERIAL_OAK = /\bOAK\b/
const MATERIAL_MAHOGANY = /\bMAHOG(?:ANY)?\b/
const MATERIAL_PRIMED = /\bPRIMED\b/

const FIRE_20 = /\b20[- ]?MIN(?:UTE)?\b/
const FIRE_45 = /\b45[- ]?MIN(?:UTE)?\b/
const FIRE_60 = /\b60[- ]?MIN(?:UTE)?\b/
const FIRE_90 = /\b90[- ]?MIN(?:UTE)?\b/

function extractDoorSize(text) {
  const m = text.match(DOOR_SIZE_RE)
  return m ? m[1] : null
}

function extractHanding(text) {
  const m = text.match(HANDING_RE)
  return m ? m[1] : null
}

function extractCoreType(text) {
  if (CORE_SC.test(text)) return 'Solid'
  if (CORE_HC.test(text)) return 'Hollow'
  return null
}

function extractPanelStyle(text) {
  if (PANEL_SHAKER.test(text) && PANEL_1P.test(text)) return '1-Panel Shaker'
  if (PANEL_2P.test(text)) return '2-Panel'
  if (PANEL_6P.test(text)) return '6-Panel'
  if (PANEL_5P.test(text)) return '5-Panel'
  if (PANEL_4P.test(text)) return '4-Panel'
  if (PANEL_3P.test(text)) return '3-Panel'
  if (PANEL_1P.test(text)) return '1-Panel'
  if (PANEL_SHAKER.test(text)) return 'Shaker'
  if (PANEL_FLUSH.test(text)) return 'Flush'
  return null
}

function extractJambSize(text) {
  const m = text.match(JAMB_RE)
  if (!m) return null
  // Normalize: "4 5/8" / "4-5/8" → "4-5/8"
  return m[1].replace(/\s+/g, '-').replace(/-+/g, '-')
}

function extractMaterial(text) {
  if (MATERIAL_MDF.test(text)) return 'MDF'
  if (MATERIAL_FJ.test(text)) return 'FJ'
  if (MATERIAL_COMP.test(text)) return 'Composite'
  if (MATERIAL_POPLAR.test(text)) return 'Poplar'
  if (MATERIAL_OAK.test(text)) return 'Oak'
  if (MATERIAL_MAHOGANY.test(text)) return 'Mahogany'
  if (MATERIAL_PINE.test(text)) return 'Pine'
  if (MATERIAL_PRIMED.test(text)) return 'Primed'
  return null
}

function extractFireRating(text) {
  if (FIRE_90.test(text)) return '90min'
  if (FIRE_60.test(text)) return '60min'
  if (FIRE_45.test(text)) return '45min'
  if (FIRE_20.test(text)) return '20min'
  return null
}

function extractAll(text) {
  const t = normalize(text)
  return {
    doorSize: extractDoorSize(t),
    handing: extractHanding(t),
    coreType: extractCoreType(t),
    panelStyle: extractPanelStyle(t),
    jambSize: extractJambSize(t),
    material: extractMaterial(t),
    fireRating: extractFireRating(t),
  }
}

// ── PDF harvesting ────────────────────────────────────────────────────────
//
// We pull text from every PDF in the two catalog trees, concatenate with a
// marker, and use it as a supplemental corpus when a Product name alone
// doesn't yield a given field. Catalog language is noisy — we match a
// Product to a catalog snippet by SKU substring or (if SKU is opaque) by
// the last two "token" words of the product name.

async function harvestPdfs() {
  const dirs = [
    path.join(ABEL, 'Manufacturer_Catalogs'),
    path.join(ABEL, 'Supplier_Catalogs'),
  ]
  const corpus = [] // { file, text }
  let loadErr = null
  let PDFParse = null
  try {
    ({ PDFParse } = await import('pdf-parse'))
  } catch (e) {
    loadErr = e
  }
  if (!PDFParse) {
    console.warn('[parse-catalog] pdf-parse unavailable, skipping PDF pass:', loadErr?.message)
    return corpus
  }

  function walk(dir) {
    const out = []
    if (!fs.existsSync(dir)) return out
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) out.push(...walk(full))
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.pdf')) out.push(full)
    }
    return out
  }

  const pdfs = []
  for (const d of dirs) pdfs.push(...walk(d))
  console.log(`[parse-catalog] found ${pdfs.length} PDFs`)

  let parsed = 0, failed = 0
  for (const fp of pdfs) {
    try {
      const buf = fs.readFileSync(fp)
      const parser = new PDFParse({ data: buf })
      const res = await parser.getText()
      const text = res.text ?? ''
      if (text.length > 50) {
        corpus.push({ file: fp, text })
        parsed++
      } else {
        console.warn(`[parse-catalog] skipping ${path.basename(fp)} (empty text)`)
      }
    } catch (e) {
      failed++
      console.warn(`[parse-catalog] FAILED ${path.basename(fp)}: ${e.message}`)
    }
  }
  console.log(`[parse-catalog] parsed ${parsed} / failed ${failed}`)
  return corpus
}

// For each Product with remaining NULL fields, look for a catalog snippet
// that mentions the SKU, the displayName, or a close token match. Return
// merged extraction.
function supplementFromCatalog(product, corpus, haveAlready) {
  const needed = COLS.filter(c => !haveAlready[c])
  if (!needed.length) return {}
  const needleSku = product.sku ? normalize(product.sku) : null
  // Use last 3 significant words from name as a fuzzy backup needle
  const words = normalize(product.name).split(' ').filter(w => w.length >= 4 && !/^[0-9]+$/.test(w)).slice(-3)
  const needleName = words.join(' ')

  const windows = []
  for (const { text } of corpus) {
    const big = normalize(text)
    if (needleSku && big.includes(needleSku)) {
      const idx = big.indexOf(needleSku)
      windows.push(big.slice(Math.max(0, idx - 200), Math.min(big.length, idx + 400)))
    } else if (needleName.length > 10 && big.includes(needleName)) {
      const idx = big.indexOf(needleName)
      windows.push(big.slice(Math.max(0, idx - 200), Math.min(big.length, idx + 400)))
    }
  }
  if (!windows.length) return {}
  const combined = windows.join(' | ')
  const result = {}
  for (const c of needed) {
    let v = null
    if (c === 'doorSize') v = extractDoorSize(combined)
    else if (c === 'handing') v = extractHanding(combined)
    else if (c === 'coreType') v = extractCoreType(combined)
    else if (c === 'panelStyle') v = extractPanelStyle(combined)
    else if (c === 'jambSize') v = extractJambSize(combined)
    else if (c === 'material') v = extractMaterial(combined)
    else if (c === 'fireRating') v = extractFireRating(combined)
    if (v) result[c] = v
  }
  return result
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[parse-catalog] mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  // Baseline counts
  const [baseline] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT("doorSize")::int AS "doorSize",
      COUNT("handing")::int AS "handing",
      COUNT("coreType")::int AS "coreType",
      COUNT("panelStyle")::int AS "panelStyle",
      COUNT("jambSize")::int AS "jambSize",
      COUNT("material")::int AS "material",
      COUNT("fireRating")::int AS "fireRating"
    FROM "Product" WHERE active = true
  `
  console.log('[parse-catalog] baseline:', baseline)

  // Load all products
  const products = await sql`
    SELECT id, sku, name, category,
           "doorSize", handing, "coreType", "panelStyle",
           "jambSize", material, "fireRating"
    FROM "Product" WHERE active = true
  `
  console.log(`[parse-catalog] loaded ${products.length} products`)

  // Harvest PDFs (Pass 2 only uses them if Pass 1 leaves gaps)
  const corpus = await harvestPdfs()

  // Extraction
  const perColumnFilled = Object.fromEntries(COLS.map(c => [c, 0]))
  const fromCatalog = Object.fromEntries(COLS.map(c => [c, 0]))
  const updates = [] // { id, patch }

  for (const p of products) {
    // Start from existing values
    const current = {
      doorSize: p.doorSize,
      handing: p.handing,
      coreType: p.coreType,
      panelStyle: p.panelStyle,
      jambSize: p.jambSize,
      material: p.material,
      fireRating: p.fireRating,
    }
    const patch = {}
    // Pass 1: self-extract from product name
    const haystack = [p.name, p.sku, p.category].filter(Boolean).join(' ')
    const self = extractAll(haystack)
    for (const c of COLS) {
      if (!current[c] && self[c]) {
        patch[c] = self[c]
        current[c] = self[c]
      }
    }
    // Pass 2: catalog supplement for any still-NULL fields
    if (corpus.length) {
      const sup = supplementFromCatalog(p, corpus, current)
      for (const c of COLS) {
        if (!current[c] && sup[c]) {
          patch[c] = sup[c]
          fromCatalog[c]++
          current[c] = sup[c]
        }
      }
    }
    if (Object.keys(patch).length) {
      for (const c of Object.keys(patch)) perColumnFilled[c]++
      updates.push({ id: p.id, patch })
    }
  }

  console.log('[parse-catalog] per-column fill proposed:', perColumnFilled)
  console.log('[parse-catalog] of which sourced from catalog PDFs:', fromCatalog)
  console.log(`[parse-catalog] total products with at least one fill: ${updates.length}`)

  if (!COMMIT) {
    console.log('[parse-catalog] DRY-RUN — skipping writes')
    return
  }

  // Apply per-column bulk updates in chunks. Column-at-a-time is the
  // simplest safe approach: only writes the column when current IS NULL.
  // Column name is whitelisted above (COLS) so string-interpolation is safe.
  const CHUNK = 500
  for (const col of COLS) {
    if (!COLS.includes(col)) throw new Error(`bad col ${col}`)
    const colUpdates = updates.filter(u => u.patch[col] != null).map(u => ({ id: u.id, v: u.patch[col] }))
    for (let i = 0; i < colUpdates.length; i += CHUNK) {
      const batch = colUpdates.slice(i, i + CHUNK)
      const ids = batch.map(b => b.id)
      const vals = batch.map(b => b.v)
      const q = `
        UPDATE "Product" p
        SET "${col}" = v.val, "updatedAt" = NOW()
        FROM (
          SELECT UNNEST($1::text[]) AS id, UNNEST($2::text[]) AS val
        ) v
        WHERE p.id = v.id AND p."${col}" IS NULL
      `
      await sql.query(q, [ids, vals])
    }
    console.log(`[parse-catalog] wrote ${colUpdates.length} rows for ${col}`)
  }

  // Final counts
  const [final] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT("doorSize")::int AS "doorSize",
      COUNT("handing")::int AS "handing",
      COUNT("coreType")::int AS "coreType",
      COUNT("panelStyle")::int AS "panelStyle",
      COUNT("jambSize")::int AS "jambSize",
      COUNT("material")::int AS "material",
      COUNT("fireRating")::int AS "fireRating"
    FROM "Product" WHERE active = true
  `
  const delta = {}
  for (const c of COLS) delta[c] = final[c] - baseline[c]
  console.log('[parse-catalog] final counts:', final)
  console.log('[parse-catalog] delta (final - baseline):', delta)
}

main().catch(e => {
  console.error('[parse-catalog] ERROR', e)
  process.exitCode = 1
})
