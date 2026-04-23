/**
 * scripts/etl-staff.ts
 *
 * Loads Abel Employee Contact List.xlsx (Sheet1, 32 rows) into the Aegis Staff
 * table. Updates contact info (phone), title, department, role — and flips
 * `active=true` for any matched row. Never creates new Staff — unmatched rows
 * are reported for manual review.
 *
 * Modes:
 *   (default)   — DRY-RUN: compute the diff, print summary, write nothing
 *   --commit    — actually apply updates
 *
 * Usage:
 *   npx tsx scripts/etl-staff.ts
 *   npx tsx scripts/etl-staff.ts --commit
 *
 * Schema reminders (Staff model):
 *   firstName, lastName, email (@unique), phone, role (StaffRole enum),
 *   department (Department enum), title, active
 *
 * XLSX columns (Sheet1):
 *   Employee | Title | Department | Email  | Phone Number
 *
 * Safety:
 *   - Match existing Staff by email (case-insensitive). If no exact hit, fall
 *     back to first/last name match. Never create new Staff rows — unmatched
 *     rows are reported.
 *   - Never overwrite a non-null DB field with a blank/TBD XLSX value.
 *   - Phone "TBD" is treated as blank.
 *   - Title/Department/Role come from the XLSX only when they differ and the
 *     XLSX value is a clean, known mapping.
 */

import { PrismaClient, Department, StaffRole } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel Employee Contact List.xlsx')

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function cleanPhone(raw: unknown): string {
  const s = normStr(raw)
  if (!s) return ''
  if (s.toUpperCase() === 'TBD') return ''
  return s
}

function splitName(full: string): { firstName: string; lastName: string } {
  const s = full.trim().replace(/\s+/g, ' ')
  if (!s) return { firstName: '', lastName: '' }
  const parts = s.split(' ')
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function nameKey(first: string, last: string): string {
  return (first + ' ' + last).toLowerCase().replace(/[^a-z]/g, '')
}

// Department mapping from XLSX free-text to Prisma enum
function mapDepartment(raw: string): Department | null {
  const s = raw.trim().toLowerCase()
  const m: Record<string, Department> = {
    'all': 'EXECUTIVE', // C-suite / "All" = executive team
    'sales': 'SALES',
    'sales/pm': 'SALES',
    'pm': 'PROJECT_MANAGEMENT',
    'it': 'OPERATIONS',
    'receiving': 'WAREHOUSE',
    'accounting': 'ACCOUNTING',
    'purchasing': 'PURCHASING',
    'business development': 'BUSINESS_DEVELOPMENT',
    'estimating': 'ESTIMATING',
    'logistics': 'LOGISTICS',
    'production': 'PRODUCTION',
    'delivery': 'DELIVERY',
  }
  return m[s] ?? null
}

// Role inferred from Title + Department in XLSX
function inferRole(title: string, dept: Department | null): StaffRole | null {
  const t = title.toLowerCase()
  if (!t) return null
  if (t.includes('cfo') || t.includes('coo') || t === 'gm') return 'ADMIN'
  if (t.includes('director of project')) return 'MANAGER'
  if (t.includes('project manager')) return 'PROJECT_MANAGER'
  if (t.includes('customer experience')) return 'MANAGER'
  if (t.includes('sales consultant') || t === 'sales' || t.includes('bizdev')) return 'SALES_REP'
  if (t.includes('system implementation')) return 'ADMIN'
  if (t.includes('driver')) return 'DRIVER'
  if (t.includes('purchasing')) return 'PURCHASING'
  if (t.includes('accountant') || t === 'accounting' || t.includes('cfo')) return 'ACCOUNTING'
  if (t.includes('estimator')) return 'ESTIMATOR'
  if (t.includes('logistics')) return 'MANAGER'
  if (t.includes('line lead')) return 'WAREHOUSE_LEAD'
  if (t === 'production') return 'WAREHOUSE_TECH'
  if (dept === 'PRODUCTION') return 'WAREHOUSE_TECH'
  if (dept === 'DELIVERY') return 'DRIVER'
  return null
}

async function main() {
  console.log(`ETL staff — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)

  const wb = XLSX.readFile(FILE)
  const sheetName = wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { defval: null })
  console.log(`XLSX sheet: "${sheetName}" — rows: ${rows.length}`)
  if (rows.length === 0) { console.log('No rows — aborting.'); return }

  const prisma = new PrismaClient()
  try {
    const existing = await prisma.staff.findMany({
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, title: true, department: true, role: true, active: true,
      },
    })
    console.log(`Aegis current staff: ${existing.length}`)

    const byEmail = new Map(existing.map((s) => [s.email.toLowerCase(), s]))
    const byName = new Map<string, typeof existing[number]>()
    for (const s of existing) {
      const k = nameKey(s.firstName, s.lastName)
      // If two rows share a name, prefer the one with more info (phone != null)
      const prev = byName.get(k)
      if (!prev) byName.set(k, s)
      else if (!prev.phone && s.phone) byName.set(k, s)
    }

    type UpdateData = {
      phone?: string
      title?: string
      department?: Department
      role?: StaffRole
      active?: boolean
    }

    const updates: Array<{
      id: string
      name: string
      matchedBy: 'email' | 'name'
      changes: string[]
      data: UpdateData
    }> = []
    const unmatched: string[] = []
    const skippedUnknownDept: string[] = []

    for (const r of rows) {
      const xFullName = normStr(r['Employee'])
      if (!xFullName) continue
      const xEmail = normStr(r['Email ']).toLowerCase() // header has trailing space
      const xTitle = normStr(r['Title'])
      const xDeptRaw = normStr(r['Department'])
      const xPhone = cleanPhone(r['Phone Number'])

      const { firstName: xFirst, lastName: xLast } = splitName(xFullName)

      // Match by email first, then by normalized full name
      let hit = xEmail ? byEmail.get(xEmail) : undefined
      let matchedBy: 'email' | 'name' = 'email'
      if (!hit) {
        const k = nameKey(xFirst, xLast)
        hit = byName.get(k)
        matchedBy = 'name'
      }
      if (!hit) { unmatched.push(`${xFullName} <${xEmail || '(no email)'}>`); continue }

      const xDept = xDeptRaw ? mapDepartment(xDeptRaw) : null
      if (xDeptRaw && !xDept) skippedUnknownDept.push(`${xFullName}: "${xDeptRaw}"`)
      const xRole = inferRole(xTitle, xDept)

      const changes: string[] = []
      const data: UpdateData = {}

      // Phone: fill in if DB is blank, don't overwrite existing
      if (xPhone && !hit.phone) {
        data.phone = xPhone
        changes.push(`phone: (empty) → "${xPhone}"`)
      }

      // Title: fill in if DB is blank OR is a placeholder ("", full-name string).
      // Also replace DB title when it equals the employee's own name (seed noise)
      // but never overwrite a meaningful title.
      const dbTitleLooksLikeName =
        !!hit.title &&
        hit.title.trim().toLowerCase() === xFullName.toLowerCase()
      if (xTitle && (!hit.title || hit.title.trim() === '' || dbTitleLooksLikeName)) {
        data.title = xTitle
        changes.push(`title: "${hit.title ?? ''}" → "${xTitle}"`)
      }

      // Department: set only if DB has a default/placeholder value
      // (VIEWER seed commonly puts people under OPERATIONS). Only overwrite
      // OPERATIONS when XLSX gives a more specific dept.
      if (xDept && hit.department !== xDept) {
        // Be conservative: only overwrite if current dept is OPERATIONS (the
        // default catch-all in seed data) or matches by coincidence.
        if (hit.department === 'OPERATIONS' && xDept !== 'OPERATIONS') {
          data.department = xDept
          changes.push(`department: ${hit.department} → ${xDept}`)
        }
      }

      // Role: only bump VIEWER → something more specific if we inferred one
      if (xRole && hit.role === 'VIEWER' && xRole !== 'VIEWER') {
        data.role = xRole
        changes.push(`role: ${hit.role} → ${xRole}`)
      }

      // Active: XLSX is the current roster — mark active if not already
      if (hit.active !== true) {
        data.active = true
        changes.push(`active: ${hit.active} → true`)
      }

      if (changes.length > 0) {
        updates.push({
          id: hit.id,
          name: `${hit.firstName} ${hit.lastName}`.trim(),
          matchedBy,
          changes,
          data,
        })
      }
    }

    console.log()
    console.log('=== SUMMARY ===')
    console.log(`  Matched + has changes: ${updates.length}`)
    console.log(`  Matched + already complete: ${rows.length - updates.length - unmatched.length}`)
    console.log(`  Unmatched (no Aegis Staff row): ${unmatched.length}`)
    console.log(`  Unknown department values: ${skippedUnknownDept.length}`)
    console.log(`  Creates: 0 (this script never creates Staff)`)
    console.log()

    // Per-field change counters
    const fieldCounts: Record<string, number> = {}
    for (const u of updates) {
      for (const c of u.changes) {
        const key = c.split(':')[0]
        fieldCounts[key] = (fieldCounts[key] ?? 0) + 1
      }
    }
    if (Object.keys(fieldCounts).length > 0) {
      console.log('Per-field change counts:')
      for (const [k, v] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k}: ${v}`)
      }
      console.log()
    }

    if (updates.length > 0) {
      console.log('Sample updates (first 15):')
      updates.slice(0, 15).forEach((u) => {
        console.log(`  ~ ${u.name} [matched by ${u.matchedBy}]`)
        u.changes.forEach((c) => console.log(`      ${c}`))
      })
      console.log()
    }

    if (unmatched.length > 0) {
      console.log(`Unmatched (${unmatched.length}) — XLSX employees not found in Aegis:`)
      unmatched.forEach((n) => console.log(`  - ${n}`))
      console.log()
    }

    if (skippedUnknownDept.length > 0) {
      console.log('Skipped unknown department values:')
      skippedUnknownDept.forEach((s) => console.log(`  - ${s}`))
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
        await prisma.staff.update({ where: { id: u.id }, data: u.data })
        updated++
      } catch (e) {
        failed++
        console.error(`  FAIL ${u.name}:`, (e as Error).message.slice(0, 160))
      }
    }
    console.log(`Committed: updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
