/**
 * scripts/etl-supplier-research.ts
 *
 * Loads vendor research workbooks into Aegis as PROSPECT vendors
 * (Vendor.active = false, since the schema has no VendorStatus enum).
 *
 * Sources:
 *   - ../Abel_Supplier_Research_Non-China.xlsx    (Supplier Directory sheet — CLEAN)
 *   - ../Abel_Alibaba_Sourcing_Analysis.xlsx       (SKIPPED — no supplier roster,
 *                                                   only product-level duty analysis)
 *
 * Non-China / Supplier Directory structure:
 *   Country sections ("VIETNAM — ...", "MALAYSIA — ...", "CHILE ...", "BRAZIL ...")
 *   each followed by a header row and supplier rows:
 *     [Supplier, Country, Products, Website/Contact, Alibaba Price, MOQ, Verification, Notes]
 *
 * Design:
 *   - Tag source via Vendor.code:  PROSPECT-NC-<SLUG>    (filterable / purgeable)
 *   - Tag source via Vendor.address prefix:
 *       "[SOURCE=SUPPLIER_RESEARCH_NON_CHINA] Country: ... | Products: ... | Price: ... | MOQ: ... | Verification: ... | Notes: ..."
 *     Address is the only free-text field on Vendor; we pack metadata here.
 *   - Vendor.active = false  (prospects, not operational)
 *   - Skip blank rows, section headers, summary/disclaimer rows
 *   - Skip generic "Various ... Exporters" entries (not a real vendor)
 *   - Match existing vendors by case-insensitive name:
 *       if a vendor already exists, SKIP (do not overwrite operational data)
 *   - No VendorProduct rows — the workbook has supplier-level MOQ/price buckets,
 *     not clean SKU-per-vendor pricing. Product matching would be guesswork.
 *
 * Modes:
 *   (default)  DRY-RUN — parse, resolve, print samples, write nothing
 *   --commit   apply (one tx per vendor via upsert-skip semantics)
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')

const NON_CHINA_FILE = path.resolve(__dirname, '..', '..', 'Abel_Supplier_Research_Non-China.xlsx')
const ALIBABA_FILE = path.resolve(__dirname, '..', '..', 'Abel_Alibaba_Sourcing_Analysis.xlsx')

const SOURCE_TAG = 'SUPPLIER_RESEARCH_NON_CHINA'
const CODE_PREFIX = 'PROSPECT-NC-'

type Parsed = {
  name: string
  country: string | null
  products: string | null
  contact: string | null
  price: string | null
  moq: string | null
  verification: string | null
  notes: string | null
  // derived
  email: string | null
  website: string | null
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function slug(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 16)
}

// Lines that look like section headers or summary rows, not actual vendors.
function looksLikeSection(name: string): boolean {
  if (!name) return true
  const upper = name.toUpperCase()
  if (upper.includes('—') && /[A-Z]{3,}/.test(upper.split('—')[0])) {
    // "VIETNAM — Recommended ..." kind of line
    if (/VIETNAM|MALAYSIA|CHILE|BRAZIL|CHINA|INDIA|MEXICO|INDONESIA|THAILAND|SOUTH AMERICA|CAUTION/.test(upper)) return true
  }
  if (upper === 'SUPPLIER') return true // the header row
  return false
}

function extractEmail(contact: string | null): string | null {
  if (!contact) return null
  const m = contact.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)
  return m ? m[0] : null
}

function extractWebsite(contact: string | null): string | null {
  if (!contact) return null
  // first token that looks like a domain
  const parts = contact.split(/[\s\n]+/)
  for (const p of parts) {
    const t = p.trim().replace(/[),]+$/, '')
    if (/\.(com|net|org|io|co|vn|my)(\/|$)/i.test(t) && !t.includes('@')) return t
  }
  return null
}

function truncate(s: string | null, n: number): string | null {
  if (s == null) return null
  const t = s.trim()
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

function buildAddressBlob(p: Parsed): string {
  const parts: string[] = [`[SOURCE=${SOURCE_TAG}]`]
  if (p.country) parts.push(`Country: ${p.country}`)
  if (p.products) parts.push(`Products: ${p.products}`)
  if (p.price) parts.push(`Price: ${p.price}`)
  if (p.moq) parts.push(`MOQ: ${p.moq}`)
  if (p.verification) parts.push(`Verification: ${p.verification}`)
  if (p.notes) parts.push(`Notes: ${p.notes}`)
  // Vendor.address is String? with no explicit length cap in schema, but keep
  // it reasonable for UI.
  return truncate(parts.join(' | '), 1800) ?? ''
}

function parseNonChina(file: string): Parsed[] {
  const wb = XLSX.readFile(file)
  const ws = wb.Sheets['Supplier Directory']
  if (!ws) throw new Error(`Sheet "Supplier Directory" not found in ${file}`)
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { defval: null, header: 1 })

  const out: Parsed[] = []
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    const [supplier, country, products, contact, price, moq, verification, notes] = r
    const name = supplier == null ? '' : String(supplier).trim()
    if (!name) continue
    if (looksLikeSection(name)) continue
    // Skip generic non-vendor entries like "Various Brazilian Exporters"
    if (/^various\b/i.test(name)) continue
    // Must have at least a country OR some products to count as a vendor row.
    if (country == null && products == null && contact == null) continue

    const contactStr = contact == null ? null : String(contact).trim()
    out.push({
      name,
      country: country == null ? null : String(country).trim(),
      products: products == null ? null : String(products).trim(),
      contact: contactStr,
      price: price == null ? null : String(price).trim(),
      moq: moq == null ? null : String(moq).trim(),
      verification: verification == null ? null : String(verification).trim(),
      notes: notes == null ? null : String(notes).trim(),
      email: extractEmail(contactStr),
      website: extractWebsite(contactStr),
    })
  }
  return out
}

async function main() {
  console.log(`ETL Supplier Research — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SOURCE_TAG}`)
  console.log(`Code prefix: ${CODE_PREFIX}`)

  // Alibaba file check — report, skip (no clean supplier directory)
  if (fs.existsSync(ALIBABA_FILE)) {
    const wb = XLSX.readFile(ALIBABA_FILE)
    console.log(
      `\nAlibaba file present with sheets: [${wb.SheetNames.join(', ')}] — SKIPPED`
    )
    console.log(
      `  Reason: workbook is product-level duty analysis (no supplier roster).`
    )
  } else {
    console.log(`\nAlibaba file not found at ${ALIBABA_FILE} — skipped.`)
  }

  if (!fs.existsSync(NON_CHINA_FILE)) throw new Error(`Not found: ${NON_CHINA_FILE}`)
  const parsed = parseNonChina(NON_CHINA_FILE)
  console.log(`\nParsed ${parsed.length} supplier rows from Non-China/Supplier Directory.`)
  console.log('\n--- Sample parsed rows ---')
  for (const p of parsed.slice(0, 3)) {
    console.log(JSON.stringify(p, null, 2))
  }
  if (parsed.length > 3) console.log(`... (${parsed.length - 3} more)`)

  const prisma = new PrismaClient()
  try {
    // Existing vendors: case-insensitive name index
    const existing = await prisma.vendor.findMany({ select: { id: true, name: true, code: true } })
    const byName = new Map(existing.map(v => [normName(v.name), v]))
    const existingCodes = new Set(existing.map(v => v.code))

    let toCreate = 0
    let skippedExisting = 0
    const codeCollisions = new Set<string>()
    type Plan = { parsed: Parsed; code: string; address: string }
    const plans: Plan[] = []

    for (const p of parsed) {
      const key = normName(p.name)
      if (byName.has(key)) {
        skippedExisting++
        continue
      }
      // Generate stable code
      let base = CODE_PREFIX + slug(p.name)
      let code = base
      let n = 1
      while (existingCodes.has(code) || plans.some(pl => pl.code === code)) {
        n++
        code = `${base}-${n}`
        if (n > 9) {
          codeCollisions.add(p.name)
          break
        }
      }
      existingCodes.add(code)
      plans.push({ parsed: p, code, address: buildAddressBlob(p) })
      toCreate++
    }

    console.log(`\n--- Plan ---`)
    console.log(`  to create:            ${toCreate}`)
    console.log(`  skipped (name exists): ${skippedExisting}`)
    if (codeCollisions.size) {
      console.log(`  code collisions (>9 retries): ${[...codeCollisions].join(', ')}`)
    }

    console.log(`\n--- Sample planned upserts ---`)
    for (const pl of plans.slice(0, 3)) {
      console.log({
        name: pl.parsed.name,
        code: pl.code,
        email: pl.parsed.email,
        website: pl.parsed.website,
        active: false,
        address_preview: pl.address.slice(0, 120) + (pl.address.length > 120 ? '…' : ''),
      })
    }

    if (DRY_RUN) {
      console.log(`\nDRY-RUN complete. No writes performed.`)
      return
    }

    console.log(`\n--- Applying ---`)
    let created = 0
    for (const pl of plans) {
      await prisma.vendor.create({
        data: {
          name: pl.parsed.name,
          code: pl.code,
          email: pl.parsed.email,
          website: pl.parsed.website,
          address: pl.address,
          active: false,
        },
      })
      created++
    }
    console.log(`  vendors created: ${created}`)
    console.log(`  vendors skipped (already exist): ${skippedExisting}`)
    console.log(`\nCOMMIT complete.`)
    console.log(
      `\nTo purge these later:  DELETE FROM "Vendor" WHERE "code" LIKE '${CODE_PREFIX}%';`
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
