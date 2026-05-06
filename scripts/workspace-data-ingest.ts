/**
 * Workspace data ingest — pulls structured data out of the Abel Lumber
 * workspace folder and fills the biggest remaining gaps in Aegis.
 *
 * This is the Aegis-side stand-in for what the NUC Brain SHOULD be doing
 * once it's online. Everything in here is idempotent and only fills NULL
 * fields — re-run any time without risk.
 *
 * Phases:
 *   1. Communities      — upsert from bolt-communities.json (127 records),
 *                         link Jobs by name match → fills 99.6% communityId gap
 *   2. Staff enrichment — read "Abel Employee Contact List.xlsx", fill phone +
 *                         email gaps on existing Staff rows
 *   3. Vendor enrichment — read inFlow_Vendor (4).csv with all fields, fill
 *                         email/phone/address gaps
 *   4. Builder address  — try Brookfield_Trade_Partner_Directory + any other
 *                         structured vendor/builder address data we can find
 *
 * Each phase reports: candidates / matched / updated / skipped (already filled).
 *
 * Usage:
 *   npx tsx scripts/workspace-data-ingest.ts                     # DRY-RUN all
 *   npx tsx scripts/workspace-data-ingest.ts --commit            # apply all
 *   npx tsx scripts/workspace-data-ingest.ts --commit --phase=1  # just phase 1
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'

const COMMIT = process.argv.includes('--commit')
const PHASE_ARG = process.argv.find(a => a.startsWith('--phase='))?.split('=')[1] || 'all'
const PHASES = PHASE_ARG === 'all' ? new Set([1, 2, 3, 4]) : new Set([Number(PHASE_ARG)])

const prisma = new PrismaClient()
const WORKSPACE = path.resolve(__dirname, '..', '..')

function norm(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

// ─── CSV parser (handles BOM + quoted fields with newlines) ──────────────
function parseCSV(filePath: string): Array<Record<string, string>> {
  if (!fs.existsSync(filePath)) return []
  let content = fs.readFileSync(filePath, 'utf8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"') { if (content[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\r') continue
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else field += c
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  const [header, ...data] = rows
  return data
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

// ─── PHASE 1: Communities ────────────────────────────────────────────────
async function phase1Communities() {
  console.log(`\n══ PHASE 1: Communities ══`)
  const file = path.join(WORKSPACE, 'bolt-communities.json')
  if (!fs.existsSync(file)) { console.log(`  bolt-communities.json missing — skip`); return }
  const records: Array<{
    boltId: string; name: string; city?: string; customer?: string; supervisor?: string; active?: string
  }> = JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`  Loaded ${records.length} community records`)

  // Index existing builders by normalized name (for builderId resolution)
  const builders = await prisma.$queryRawUnsafe<Array<{ id: string; companyName: string }>>(
    `SELECT id, "companyName" FROM "Builder"`
  )
  const builderByName = new Map<string, string>()
  builders.forEach(b => builderByName.set(norm(b.companyName), b.id))

  // Existing communities (dedupe)
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; boltId: string | null }>>(
    `SELECT id, name, "boltId" FROM "Community"`
  )
  const existingByBolt = new Map<string, string>()
  const existingByName = new Map<string, string>()
  existing.forEach(c => {
    if (c.boltId) existingByBolt.set(String(c.boltId), c.id)
    existingByName.set(norm(c.name), c.id)
  })

  // Community.builderId is NOT NULL on the schema. For new communities whose
  // customer can't be resolved, fall back to a synthetic "Unmatched Bolt
  // Communities" Builder row that already exists for this purpose (or create
  // one). This keeps every Community linkable to *some* builder so the FK
  // never blocks ingest, while making the unresolved set easy to find later.
  const FALLBACK_NAME = 'Unmatched Bolt Communities'
  let fallbackId = builderByName.get(norm(FALLBACK_NAME)) || null
  if (!fallbackId && COMMIT) {
    const newId = rid('bld')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Builder" (id, "companyName", "contactName", email, "passwordHash",
                              "pricingTier", status, "paymentTerm", "accountBalance",
                              "taxExempt", "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, 'system', $3, 'no-login', 'STANDARD',
               'PENDING'::"AccountStatus", 'NET_15'::"PaymentTerm", 0,
               false, false, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      newId, FALLBACK_NAME, `unmatched-bolt-${newId}@internal.abellumber.com`
    )
    fallbackId = newId
  }

  let toCreate = 0, toUpdate = 0, skipped = 0
  const writes: Array<{ kind: 'create' | 'update'; sql: string; params: any[] }> = []

  for (const r of records) {
    if (!r.name) { skipped++; continue }
    const cityClean = r.city ? r.city.split(',')[0].trim() : null
    const stateClean = r.city?.includes(',') ? r.city.split(',')[1]?.trim() || null : null
    const resolved = r.customer ? builderByName.get(norm(r.customer)) || null : null
    const builderId = resolved || fallbackId
    const isActive = (r.active || '').toLowerCase() === 'yes'

    const existingId = existingByBolt.get(String(r.boltId)) || existingByName.get(norm(r.name))
    if (existingId) {
      toUpdate++
      writes.push({
        kind: 'update',
        sql: `UPDATE "Community" SET
                "boltId" = COALESCE("boltId", $1),
                "builderId" = COALESCE("builderId", $2),
                city = COALESCE(NULLIF(city, ''), $3),
                state = COALESCE(NULLIF(state, ''), $4),
                status = (CASE WHEN $5 THEN 'ACTIVE' ELSE 'INACTIVE' END)::"CommunityStatus",
                "updatedAt" = NOW()
              WHERE id = $6`,
        params: [String(r.boltId || ''), builderId, cityClean, stateClean, isActive, existingId],
      })
    } else {
      toCreate++
      writes.push({
        kind: 'create',
        sql: `INSERT INTO "Community" (
                id, "boltId", "builderId", name, city, state, status, "createdAt", "updatedAt"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7::"CommunityStatus", NOW(), NOW())
              ON CONFLICT DO NOTHING`,
        params: [rid('com'), String(r.boltId || ''), builderId, r.name, cityClean, stateClean, isActive ? 'ACTIVE' : 'INACTIVE'],
      })
    }
  }

  console.log(`  to create: ${toCreate}`)
  console.log(`  to update: ${toUpdate}`)
  console.log(`  skipped (no name): ${skipped}`)

  if (COMMIT) {
    for (let i = 0; i < writes.length; i += 50) {
      const batch = writes.slice(i, i + 50)
      await Promise.all(batch.map(w => prisma.$executeRawUnsafe(w.sql, ...w.params)))
    }
  }

  // Now backfill Job.communityId by matching Job.community text → Community.name
  console.log(`\n  Backfilling Job.communityId from Job.community text...`)
  const before = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
    `SELECT COUNT(*)::bigint c FROM "Job" WHERE "communityId" IS NULL AND community IS NOT NULL AND community != ''`
  )
  console.log(`  Jobs with text community but NULL communityId: ${Number(before[0].c)}`)

  if (COMMIT) {
    // Two-step linkage to avoid the FK race where the bulk UPDATE references
    // a community_id that's mid-creation in another batch:
    //   1. Pull all Communities (post-insert) into a name → id map in Node
    //   2. Loop unique j.community values and run targeted UPDATEs by name
    const allCommunities = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `SELECT id, name FROM "Community"`
    )
    const idByName = new Map<string, string>()
    for (const c of allCommunities) {
      const k = norm(c.name)
      if (!idByName.has(k)) idByName.set(k, c.id)
    }
    console.log(`  Community name → id map: ${idByName.size} entries`)

    const distinctJobCommunities = await prisma.$queryRawUnsafe<Array<{ community: string; c: bigint }>>(
      `SELECT community, COUNT(*)::bigint c
       FROM "Job"
       WHERE "communityId" IS NULL AND community IS NOT NULL AND community != ''
       GROUP BY community ORDER BY COUNT(*) DESC`
    )
    console.log(`  Distinct Job.community values needing linkage: ${distinctJobCommunities.length}`)

    // ⚠️ Schema debt: Job.communityId FK points to Community_legacy (the old
    // table, 9 rows) instead of the new Community model. A proper fix is a
    // migration to repoint the FK — that's a [NEEDS NATE] DDL change per
    // project rules. Until then, dual-write: also insert each Community
    // into Community_legacy with the same id so the FK is satisfied. This
    // lets the new Community model drive the UI (the canonical source) AND
    // lets the FK pass.
    console.log(`  Mirroring ${idByName.size} communities into Community_legacy (FK shim)...`)
    // Pull org / division to populate NOT NULL fields on Community_legacy.
    // Use any existing Community_legacy row's organizationId as the default —
    // there are only 9 historical rows and they all share the same org.
    const legOrg = await prisma.$queryRawUnsafe<Array<{ organizationId: string }>>(
      `SELECT "organizationId" FROM "Community_legacy" LIMIT 1`
    )
    const orgId = legOrg[0]?.organizationId
    if (!orgId) {
      console.log(`  ⚠️ No Community_legacy rows exist to source organizationId from. Skipping dual-write — Job.communityId can't be set until FK is migrated.`)
    } else {
      // Mirror new Community rows into Community_legacy with the same id.
      const newComms = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; city: string | null; state: string | null; zip: string | null; address: string | null }>>(
        `SELECT id, name, city, state, zip, address FROM "Community"`
      )
      let mirrored = 0
      for (const c of newComms) {
        try {
          const r = await prisma.$executeRawUnsafe(
            `INSERT INTO "Community_legacy"
               (id, "organizationId", name, city, state, zip, address, "activeLots", "completedLots", active, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, true, NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               city = COALESCE(EXCLUDED.city, "Community_legacy".city),
               state = COALESCE(EXCLUDED.state, "Community_legacy".state),
               "updatedAt" = NOW()`,
            c.id, orgId, c.name, c.city, c.state, c.zip, c.address
          )
          mirrored += Number(r)
        } catch (e: any) {
          // swallow — best effort
        }
      }
      console.log(`  Mirrored ${mirrored} rows into Community_legacy`)
    }

    let totalUpdated = 0
    let unmatchedNames = 0
    let failed = 0
    for (const r of distinctJobCommunities) {
      const id = idByName.get(norm(r.community))
      if (!id) { unmatchedNames++; continue }
      try {
        const updated = await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET "communityId" = $1, "updatedAt" = NOW()
           WHERE "communityId" IS NULL AND LOWER(TRIM(community)) = LOWER(TRIM($2))`,
          id, r.community
        )
        totalUpdated += Number(updated)
      } catch (e: any) {
        failed++
        if (failed <= 3) console.log(`    FAIL on "${r.community}" → ${id}: ${e?.message?.slice(0, 200)}`)
      }
    }
    console.log(`  Job rows linked to communityId: ${totalUpdated}`)
    console.log(`  Distinct community names with no matching Community: ${unmatchedNames}`)
    console.log(`  Distinct community names that errored: ${failed}`)
  }
}

// ─── PHASE 2: Staff enrichment from Abel Employee Contact List.xlsx ──────
async function phase2Staff() {
  console.log(`\n══ PHASE 2: Staff enrichment ══`)
  const file = path.join(WORKSPACE, 'HR & Personnel', 'Abel Employee Contact List.xlsx')
  if (!fs.existsSync(file)) { console.log(`  Employee Contact List missing — skip`); return }

  const wb = XLSX.readFile(file)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null })
  console.log(`  Loaded ${rows.length} rows from sheet "${wb.SheetNames[0]}"`)
  if (rows.length > 0) {
    console.log(`  Columns detected:`, Object.keys(rows[0]).join(', '))
    console.log(`  First row:`, JSON.stringify(rows[0]).slice(0, 200))
  }

  // We don't know the column shape ahead of time, so probe for common shapes.
  // Likely keys: Name | Employee Name | First Name + Last Name; Phone | Mobile;
  // Email; Address | Home Address.
  const findKey = (row: any, candidates: string[]) => {
    const keys = Object.keys(row)
    for (const cand of candidates) {
      const match = keys.find(k => norm(k) === norm(cand))
      if (match) return match
    }
    return null
  }
  if (rows.length === 0) { console.log(`  (empty sheet)`); return }

  const sample = rows[0]
  const nameKey = findKey(sample, ['Name', 'Employee Name', 'Employee', 'Full Name'])
  const firstKey = findKey(sample, ['First Name', 'First', 'FirstName'])
  const lastKey = findKey(sample, ['Last Name', 'Last', 'LastName', 'Surname'])
  const phoneKey = findKey(sample, ['Phone', 'Mobile', 'Cell', 'Phone Number', 'Mobile Phone'])
  const emailKey = findKey(sample, ['Email', 'Email Address', 'E-mail'])
  const addressKey = findKey(sample, ['Address', 'Home Address', 'Street'])

  console.log(`  Resolved keys: name=${nameKey}, first=${firstKey}, last=${lastKey}, phone=${phoneKey}, email=${emailKey}, address=${addressKey}`)
  if (!nameKey && !(firstKey && lastKey)) {
    console.log(`  No name column — cannot match Staff. Skipping.`)
    return
  }

  // Index existing staff by normalized full name. When a name maps to multiple
  // Staff rows (we have dups; e.g. 3 Dakota Dyers) prefer the @abellumber.com
  // one without 'agent@' in email.
  const staff = await prisma.$queryRawUnsafe<Array<{
    id: string; firstName: string; lastName: string; email: string | null; phone: string | null
  }>>(
    `SELECT id, "firstName", "lastName", email, phone FROM "Staff"`
  )
  const staffByName = new Map<string, typeof staff[0]>()
  for (const s of staff) {
    if (!s.firstName || !s.lastName) continue
    const key = norm(`${s.firstName} ${s.lastName}`)
    const existing = staffByName.get(key)
    const isPreferred = (s.email || '').endsWith('@abellumber.com') && !(s.email || '').includes('agent@')
    if (!existing || (isPreferred && !((existing.email || '').endsWith('@abellumber.com')))) {
      staffByName.set(key, s)
    }
  }

  let matched = 0, willUpdate = 0, noChange = 0, unmatched = 0
  const writes: Array<{ id: string; set: Record<string, string> }> = []

  for (const row of rows) {
    let fullName: string | null = null
    if (nameKey && row[nameKey]) fullName = String(row[nameKey])
    else if (firstKey && lastKey && row[firstKey] && row[lastKey]) fullName = `${row[firstKey]} ${row[lastKey]}`
    if (!fullName) { unmatched++; continue }

    const target = staffByName.get(norm(fullName))
    if (!target) { unmatched++; continue }
    matched++

    const set: Record<string, string> = {}
    if (phoneKey && row[phoneKey] && !target.phone) set.phone = String(row[phoneKey]).trim()
    if (emailKey && row[emailKey] && !target.email) set.email = String(row[emailKey]).trim()
    // Address column on Staff doesn't exist — skip.

    if (Object.keys(set).length === 0) { noChange++; continue }
    willUpdate++
    writes.push({ id: target.id, set })
  }

  console.log(`  matched: ${matched}`)
  console.log(`  will update: ${willUpdate}`)
  console.log(`  matched but no fillable nulls: ${noChange}`)
  console.log(`  unmatched: ${unmatched}`)

  if (COMMIT) {
    for (const w of writes) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(w.set)) {
        setParts.push(`"${k}" = $${idx++}`)
        params.push(v)
      }
      params.push(w.id)
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      )
    }
  }
}

// ─── PHASE 3: Vendor enrichment from inFlow_Vendor (4).csv ───────────────
async function phase3Vendors() {
  console.log(`\n══ PHASE 3: Vendor enrichment ══`)
  const file = path.join(WORKSPACE, 'In Flow Exports', 'inFlow_Vendor (4).csv')
  if (!fs.existsSync(file)) { console.log(`  vendor CSV missing — skip`); return }
  const rows = parseCSV(file)
  console.log(`  Loaded ${rows.length} vendor rows`)

  const vendors = await prisma.$queryRawUnsafe<Array<{
    id: string; name: string; email: string | null; phone: string | null;
    address: string | null; contactName: string | null
  }>>(
    `SELECT id, name, email, phone, address, "contactName" FROM "Vendor"`
  )
  const vendorByName = new Map<string, typeof vendors[0]>()
  vendors.forEach(v => vendorByName.set(norm(v.name), v))

  let matched = 0, willUpdate = 0, noChange = 0
  const writes: Array<{ id: string; set: Record<string, string> }> = []

  for (const r of rows) {
    const name = r['Name']?.trim()
    if (!name) continue
    const v = vendorByName.get(norm(name))
    if (!v) continue
    matched++

    const set: Record<string, string> = {}
    if (!v.email && r['Email']) set.email = r['Email'].trim()
    if (!v.phone && r['Phone']) set.phone = r['Phone'].trim()
    if (!v.contactName && r['ContactName']) set.contactName = r['ContactName'].trim()

    // Vendor.address is a single freeform field — fold city/state/zip in
    if (!v.address) {
      const addrParts = [r['Address1'], r['City'], r['State'], r['PostalCode']]
        .map(s => s?.trim()).filter(s => s && s.length > 0)
      if (addrParts.length > 0) set.address = addrParts.join(', ')
    }

    if (Object.keys(set).length === 0) { noChange++; continue }
    willUpdate++
    writes.push({ id: v.id, set })
  }

  console.log(`  matched: ${matched}`)
  console.log(`  will update: ${willUpdate}`)
  console.log(`  matched, nothing fillable: ${noChange}`)

  if (COMMIT) {
    for (const w of writes) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(w.set)) {
        setParts.push(`"${k}" = $${idx++}`)
        params.push(v)
      }
      params.push(w.id)
      await prisma.$executeRawUnsafe(
        `UPDATE "Vendor" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      )
    }
  }
}

// ─── PHASE 4: Email + contact enrichment from Brookfield directory ───────
async function phase4BuilderAddresses() {
  console.log(`\n══ PHASE 4: Builder/Vendor enrichment from Brookfield directory ══`)
  const file = path.join(WORKSPACE, 'Brookfield', 'Brookfield_Trade_Partner_Directory.xlsx')
  if (!fs.existsSync(file)) { console.log(`  directory missing — skip`); return }

  const wb = XLSX.readFile(file)
  // Sheet "Contacts" has: Name, Email, Company, Domain, Role / Dept, What the Company Does
  const contactsSheet = wb.Sheets['Contacts']
  if (!contactsSheet) { console.log(`  no "Contacts" sheet — skip`); return }
  const contacts: any[] = XLSX.utils.sheet_to_json(contactsSheet, { defval: null })
  console.log(`  Loaded ${contacts.length} contact rows`)

  // Build (companyName → first contact with email) map
  const byCompany = new Map<string, { name: string; email: string; role: string | null }>()
  for (const c of contacts) {
    const company = c['Company']?.trim()
    const email = c['Email']?.trim()
    const name = c['Name']?.trim()
    if (!company || !email || !email.includes('@')) continue
    const key = norm(company)
    if (!byCompany.has(key)) byCompany.set(key, { name, email, role: c['Role / Dept (inferred)'] || null })
  }
  console.log(`  Unique companies with email: ${byCompany.size}`)

  // Match against Builder and Vendor; fill missing contactName + email.
  const builders = await prisma.$queryRawUnsafe<Array<{
    id: string; companyName: string; contactName: string | null; email: string | null
  }>>(
    `SELECT id, "companyName", "contactName", email FROM "Builder"`
  )
  const vendors = await prisma.$queryRawUnsafe<Array<{
    id: string; name: string; contactName: string | null; email: string | null
  }>>(
    `SELECT id, name, "contactName", email FROM "Vendor"`
  )

  let builderUpdates = 0, vendorUpdates = 0
  const builderWrites: Array<{ id: string; set: Record<string, string> }> = []
  const vendorWrites: Array<{ id: string; set: Record<string, string> }> = []

  for (const b of builders) {
    const match = byCompany.get(norm(b.companyName))
    if (!match) continue
    const set: Record<string, string> = {}
    // Builder.email is NOT NULL in the schema, but some are empty string. Don't
    // overwrite a real email — only fill genuinely empty/placeholder ones.
    const isPlaceholder = !b.email || b.email.endsWith('@internal.abellumber.com')
    if (isPlaceholder && match.email) set.email = match.email
    if (!b.contactName && match.name) set.contactName = match.name
    if (Object.keys(set).length === 0) continue
    builderWrites.push({ id: b.id, set })
    builderUpdates++
  }
  for (const v of vendors) {
    const match = byCompany.get(norm(v.name))
    if (!match) continue
    const set: Record<string, string> = {}
    if (!v.email && match.email) set.email = match.email
    if (!v.contactName && match.name) set.contactName = match.name
    if (Object.keys(set).length === 0) continue
    vendorWrites.push({ id: v.id, set })
    vendorUpdates++
  }

  console.log(`  Builder rows to enrich: ${builderUpdates}`)
  console.log(`  Vendor rows to enrich: ${vendorUpdates}`)

  if (COMMIT) {
    for (const w of builderWrites) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(w.set)) { setParts.push(`"${k}" = $${idx++}`); params.push(v) }
      params.push(w.id)
      await prisma.$executeRawUnsafe(
        `UPDATE "Builder" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      )
    }
    for (const w of vendorWrites) {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(w.set)) { setParts.push(`"${k}" = $${idx++}`); params.push(v) }
      params.push(w.id)
      await prisma.$executeRawUnsafe(
        `UPDATE "Vendor" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      )
    }
    console.log(`  Applied ${builderWrites.length + vendorWrites.length} updates.`)
  }
}

async function main() {
  console.log(`══════════════════════════════════════════════════════════════════════`)
  console.log(`  WORKSPACE DATA INGEST — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'} — phases: ${[...PHASES].join(',')}`)
  console.log(`══════════════════════════════════════════════════════════════════════`)

  if (PHASES.has(1)) await phase1Communities()
  if (PHASES.has(2)) await phase2Staff()
  if (PHASES.has(3)) await phase3Vendors()
  if (PHASES.has(4)) await phase4BuilderAddresses()

  console.log(`\n══════════════════════════════════════════════════════════════════════\n`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
