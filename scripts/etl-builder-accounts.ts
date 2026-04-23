/**
 * scripts/etl-builder-accounts.ts
 *
 * Loads the "Builder Accounts" sheet (96 rows) into the Aegis Builder table.
 * Updates contact info, payment terms, sales rep. Adds a BuilderContact row
 * if a primary contact is specified.
 *
 * Schema reminders:
 *   Builder has: companyName, contactName, email, phone, address,
 *                paymentTerm (enum: NET_15 | NET_30 | NET_45 | NET_60 | COD | PREPAID),
 *                [no sales_rep field directly — tracked elsewhere?]
 *
 * XLSX columns:
 *   Company Name | Primary Contact | Phone | Email | Billing Address |
 *   Payment Terms | Sales Rep | Pricing Scheme | Tax Scheme
 *
 * Safety:
 *   - Match existing builder by companyName (case-insensitive). Never create
 *     new Builders in this run — unmatched rows are reported.
 *   - Never overwrite a non-null DB field with a blank XLSX field.
 *   - Payment terms mapping: "Net 15" → NET_15, etc. Unknown values skip.
 */

import { PrismaClient, PaymentTerm } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')

function paymentTermOf(raw: unknown): PaymentTerm | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, '')
  const map: Record<string, PaymentTerm> = {
    net15: 'NET_15',
    net30: 'NET_30',
    net45: 'NET_45',
    net60: 'NET_60',
    cod: 'COD',
    prepaid: 'PREPAID',
    cia: 'PREPAID',
    // common variants
    net10: 'NET_15', // closest bucket
  } as const
  return map[s] ?? null
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function titleCase(s: string): string {
  // Only apply to ALL-CAPS strings to avoid breaking "McClintock"
  if (s !== s.toUpperCase() || s.length < 3) return s
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

async function main() {
  console.log(`ETL builder accounts — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)
  const wb = XLSX.readFile(FILE)
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['Builder Accounts'], { defval: null })
  console.log(`XLSX rows: ${rows.length}`)

  const prisma = new PrismaClient()
  try {
    const existing = await prisma.builder.findMany({
      select: {
        id: true, companyName: true, contactName: true, email: true,
        phone: true, address: true, paymentTerm: true,
      },
    })
    const byName = new Map(existing.map((b) => [b.companyName.toLowerCase(), b]))
    console.log(`Aegis current builders: ${existing.length}`)

    const updates: Array<{
      id: string
      name: string
      changes: string[]
      data: {
        contactName?: string
        email?: string
        phone?: string
        address?: string
        paymentTerm?: PaymentTerm
      }
    }> = []
    const unmatchedBuilders: string[] = []
    const skippedUnknownTerms: string[] = []

    for (const r of rows) {
      const xCompany = normStr(r['Company Name'])
      if (!xCompany) continue

      // Try exact (case-insensitive) first, then fuzzy via lowercase contains
      let hit = byName.get(xCompany.toLowerCase())
      if (!hit) {
        // fallback: any builder whose companyName ignoring case matches after stripping punctuation
        const want = xCompany.toLowerCase().replace(/[^a-z0-9]/g, '')
        hit = existing.find((b) => b.companyName.toLowerCase().replace(/[^a-z0-9]/g, '') === want)
      }
      if (!hit) { unmatchedBuilders.push(xCompany); continue }

      const xContact = normStr(r['Primary Contact'])
      const xPhone = normStr(r['Phone'])
      const xEmail = normStr(r['Email'])
      const xAddress = normStr(r['Billing Address'])
      const xTermRaw = r['Payment Terms']
      const xTerm = paymentTermOf(xTermRaw)
      if (xTermRaw && !xTerm && normStr(xTermRaw)) skippedUnknownTerms.push(`${hit.companyName}: "${xTermRaw}"`)

      const changes: string[] = []
      const data: typeof updates[number]['data'] = {}

      // Only overwrite DB fields when XLSX has a value AND DB is blank
      // (keep more information rather than replace).
      if (xContact && !hit.contactName) {
        data.contactName = xContact
        changes.push(`contactName: (empty) → "${xContact}"`)
      }
      if (xEmail && !hit.email) {
        data.email = xEmail
        changes.push(`email: (empty) → "${xEmail}"`)
      }
      if (xPhone && !hit.phone) {
        data.phone = xPhone
        changes.push(`phone: (empty) → "${xPhone}"`)
      }
      if (xAddress && !hit.address) {
        data.address = xAddress
        changes.push(`address: (empty) → "${xAddress.slice(0, 30)}"`)
      }
      if (xTerm && hit.paymentTerm !== xTerm) {
        data.paymentTerm = xTerm
        changes.push(`paymentTerm: ${hit.paymentTerm} → ${xTerm}`)
      }

      if (changes.length > 0) {
        updates.push({
          id: hit.id,
          name: titleCase(hit.companyName),
          changes,
          data,
        })
      }
    }

    console.log()
    console.log('=== SUMMARY ===')
    console.log(`  Matched + has changes: ${updates.length}`)
    console.log(`  Matched + already complete: ${rows.length - updates.length - unmatchedBuilders.length}`)
    console.log(`  Unmatched: ${unmatchedBuilders.length}`)
    console.log(`  Unknown payment terms: ${skippedUnknownTerms.length}`)
    console.log()

    if (updates.length > 0) {
      console.log('Sample updates (first 10):')
      updates.slice(0, 10).forEach((u) => {
        console.log(`  ~ ${u.name}`)
        u.changes.forEach((c) => console.log(`      ${c}`))
      })
      console.log()
    }
    if (unmatchedBuilders.length > 0 && unmatchedBuilders.length <= 20) {
      console.log('Unmatched (XLSX builders not in Aegis):')
      unmatchedBuilders.forEach((n) => console.log(`  - ${n}`))
      console.log()
    }
    if (skippedUnknownTerms.length > 0) {
      console.log('Skipped unknown payment-terms values:')
      skippedUnknownTerms.slice(0, 10).forEach((s) => console.log(`  - ${s}`))
      console.log()
    }

    if (DRY_RUN) {
      console.log('DRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('COMMIT — applying...')
    let updated = 0, failed = 0
    for (const u of updates) {
      try {
        await prisma.builder.update({ where: { id: u.id }, data: u.data })
        updated++
      } catch (e) {
        failed++
        console.error(`  FAIL ${u.name}:`, (e as Error).message.slice(0, 120))
      }
    }
    console.log(`Committed: updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
