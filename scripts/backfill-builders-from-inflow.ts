/**
 * Backfill Builder.{phone, email, address, city, state, zip, contactName, salesOwnerId}
 * from inFlow_Customer (5).csv.
 *
 * Match strategy: case-insensitive trimmed Builder.companyName == inflow.Name
 * SalesOwner: match inflow.DefaultSalesRep "First Last" against Staff.firstName + lastName,
 *             prefer @abellumber.com email, oldest record.
 *
 * Usage:
 *   npx tsx scripts/backfill-builders-from-inflow.ts            # DRY-RUN
 *   npx tsx scripts/backfill-builders-from-inflow.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

const WORKSPACE = path.resolve(__dirname, '..', '..')
const CSV_PATH = path.join(WORKSPACE, 'inFlow_Customer (5).csv')

// ---- minimal CSV parser (handles quoted fields with commas + BOM) ----
function parseCSV(content: string): Array<Record<string, string>> {
  // strip BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)

  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\r') continue
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else field += c
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur) }

  const [header, ...data] = rows
  return data.filter(r => r.length === header.length).map(r =>
    Object.fromEntries(header.map((h, i) => [h, r[i]]))
  )
}

function norm(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/[\s,.]+/g, ' ')
}

async function main() {
  console.log(`BACKFILL BUILDERS FROM INFLOW — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`CSV: ${CSV_PATH}`)

  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV not found'); process.exit(1)
  }
  const content = fs.readFileSync(CSV_PATH, 'utf8')
  const customers = parseCSV(content)
  console.log(`Loaded ${customers.length} inFlow customer rows`)

  // Build staff lookup: "first last" -> staffId, prefer abellumber email
  const staff = await prisma.$queryRawUnsafe<Array<{
    id: string; firstName: string; lastName: string; email: string; createdAt: Date
  }>>(`SELECT id, "firstName", "lastName", email, "createdAt" FROM "Staff"`)

  const staffByName = new Map<string, { id: string; score: number }>()
  for (const s of staff) {
    if (!s.firstName || !s.lastName) continue
    const key = norm(`${s.firstName} ${s.lastName}`)
    const score =
      (s.email?.endsWith('@abellumber.com') ? 100 : 0) +
      (s.email?.includes('agent@') ? -50 : 0) +
      (1 / (Date.now() - new Date(s.createdAt).getTime() + 1)) // older = lower; we want oldest = highest score
    // simpler: prefer @abellumber, ignore "@agritecint" / mgfinancialpartners
    const cleanScore = s.email?.endsWith('@abellumber.com') && !s.email.includes('agent@') ? 100 : 0
    const existing = staffByName.get(key)
    if (!existing || cleanScore > existing.score) {
      staffByName.set(key, { id: s.id, score: cleanScore })
    }
  }
  console.log(`Built staff lookup: ${staffByName.size} unique names`)

  // Pull current builders
  const builders = await prisma.$queryRawUnsafe<Array<{
    id: string; companyName: string; email: string; phone: string;
    address: string; city: string; state: string; zip: string;
    contactName: string; salesOwnerId: string;
  }>>(`
    SELECT id, "companyName", email, phone, address, city, state, zip, "contactName", "salesOwnerId"
    FROM "Builder"
  `)
  console.log(`Aegis builders: ${builders.length}`)

  const builderByName = new Map<string, typeof builders[0]>()
  builders.forEach(b => builderByName.set(norm(b.companyName), b))

  let matched = 0
  let updates = 0
  let salesOwnerSet = 0
  const writes: Array<Promise<any>> = []
  const sample: string[] = []

  for (const c of customers) {
    const key = norm(c['Name'])
    if (!key) continue
    const b = builderByName.get(key)
    if (!b) continue
    matched++

    const set: Record<string, string | null> = {}
    if (!b.email && c['Email']) set.email = c['Email'].trim()
    if (!b.phone && c['Phone']) set.phone = c['Phone'].trim()
    if (!b.contactName && c['ContactName']) set.contactName = c['ContactName'].trim()

    // Use shipping address if available, else billing
    const addr = c['ShippingAddress1']?.trim() || c['BillingAddress1']?.trim()
    const city = c['ShippingCity']?.trim() || c['BillingCity']?.trim()
    const state = c['ShippingState']?.trim() || c['BillingState']?.trim()
    const zip = c['ShippingPostalCode']?.trim() || c['BillingPostalCode']?.trim()
    if (!b.address && addr) set.address = addr
    if (!b.city && city) set.city = city
    if (!b.state && state) set.state = state
    if (!b.zip && zip) set.zip = zip

    // Sales owner
    const rep = c['DefaultSalesRep']?.trim()
    if (!b.salesOwnerId && rep) {
      const s = staffByName.get(norm(rep))
      if (s) { set.salesOwnerId = s.id; salesOwnerSet++ }
    }

    if (Object.keys(set).length === 0) continue
    updates++
    if (sample.length < 12) {
      sample.push(`  ${b.companyName.slice(0, 30).padEnd(30)} ← ${Object.keys(set).join(', ')}`)
    }

    if (COMMIT) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(set)) {
        setParts.push(`"${k}" = $${idx++}`)
        params.push(v)
      }
      params.push(b.id)
      writes.push(prisma.$executeRawUnsafe(
        `UPDATE "Builder" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      ))
    }
  }

  if (COMMIT && writes.length) {
    console.log(`\n  Applying ${writes.length} updates...`)
    await Promise.all(writes)
  }

  console.log(`\nSample updates:`)
  sample.forEach(s => console.log(s))

  console.log(`\n══ RESULT ══`)
  console.log(`  matched by name:        ${matched}`)
  console.log(`  builders updated:       ${updates}`)
  console.log(`  salesOwner assigned:    ${salesOwnerSet}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
