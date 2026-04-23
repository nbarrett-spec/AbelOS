/**
 * scripts/etl-staff-v2.ts
 *
 * Second-pass staff loader. Consumes TWO workbooks from the Abel OneDrive:
 *   - Abel Lumber - Company Directory.xlsx      (public directory, March 2026)
 *   - Abel_Lumber_Employee_Directory_CONFIDENTIAL.xlsx (April 22 2026, fresher)
 *
 * The CONFIDENTIAL file contains PII (salary, bank, SSN, DOB, address, etc.).
 * This script NEVER reads those columns. It only pulls:
 *   firstName, lastName, email, phone, role, department, title, hireDate,
 *   employmentType, employeeId, active status.
 *
 * Behavior:
 *   - CREATE Staff rows for people in the xlsx(s) whose email is not yet in
 *     the DB (email is @unique).
 *   - UPDATE existing Staff rows conservatively — only fills blank fields.
 *   - If CONFIDENTIAL and Company Directory disagree on a value, CONFIDENTIAL
 *     wins (it's newer), but we still never read PII.
 *
 * Modes:
 *   (default)   DRY-RUN: print counts only, write nothing
 *   --commit    apply create+update
 *
 * Usage:
 *   npx tsx scripts/etl-staff-v2.ts
 *   npx tsx scripts/etl-staff-v2.ts --commit
 *
 * PII SAFETY:
 *   - Any column whose header matches /salary|comp|ssn|social|dob|birth|
 *     address|bank|wage|pay rate|hourly|annual|bonus|stipend|allowance|
 *     w-?4|filing|routing|account[ _]?(num|#)/i is skipped at read time.
 *   - Dry-run output prints NO row-level PII (names, emails, phones, hire
 *     dates are allowed — anything comp-related is off limits and never
 *     extracted in the first place).
 */

import { PrismaClient, Department, StaffRole, EmploymentType } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const DRY_RUN = !process.argv.includes('--commit')

const FILE_DIR = 'C:/Users/natha/OneDrive/Abel Lumber/Abel Lumber - Company Directory.xlsx'
const FILE_CONF = 'C:/Users/natha/OneDrive/Abel Lumber/Abel_Lumber_Employee_Directory_CONFIDENTIAL.xlsx'

// Broad PII gate applied at header time. These columns are NEVER read.
const PII_RE =
  /salary|\bcomp\b|compensation|ssn|\bsocial\b|dob|birth|address|bank|wage|^pay$|pay[_ ]?rate|hourly|annual|\bbonus\b|emergency|stipend|allowance|\bw[-\s]?4|filing|routing|account\s*(#|num)/i

// Only these header names are copied out of the workbook. Anything else is
// ignored (including PII columns that would also fail the PII regex).
const SAFE_COLS = new Set([
  // CONFIDENTIAL
  'Employee ID', 'Last Name', 'First Name', 'Status',
  'Department', 'Title', 'Reports To', 'Employment Type',
  'Hire Date', 'Termination Date',
  'Work Email', 'Personal Phone',
  'CDL', 'CDL Expiration', 'Certifications', 'Cert Expiration',
  // Company Directory
  'Name', 'Email',
])

type Row = {
  employeeId?: string
  firstName: string
  lastName: string
  email: string
  phone: string
  department: string
  title: string
  employmentType: string
  status: string
  hireDate: Date | null
  source: 'CONFIDENTIAL' | 'DIRECTORY'
}

function s(v: unknown): string {
  const raw = (v ?? '').toString().trim()
  if (!raw || raw === '—' || raw === '-' || raw === 'TBD' || raw.toUpperCase() === 'N/A') return ''
  return raw
}

function splitFull(full: string): { firstName: string; lastName: string } {
  const t = full.trim().replace(/\s+/g, ' ')
  if (!t) return { firstName: '', lastName: '' }
  const parts = t.split(' ')
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function parseHireDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  // xlsx dates often come back as Date already when cellDates is used, or as
  // strings like "6/18/2025" or "2025-06-18"
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const str = v.toString().trim()
  if (!str || str === '—') return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function findHeaderRow(aoa: any[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const r = aoa[i]
    if (!r) continue
    const joined = r.map((c) => (c ?? '').toString().toLowerCase()).join('|')
    const hits = ['email', 'name', 'title', 'department', 'hire'].filter((t) => joined.includes(t)).length
    if (hits >= 2) return i
  }
  return 0
}

function extractFile(
  file: string,
  sheet: string,
  source: 'CONFIDENTIAL' | 'DIRECTORY'
): { rows: Row[]; columnsReported: string[] } {
  if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`)
  const wb = XLSX.readFile(file, { cellDates: true })
  const ws = wb.Sheets[sheet]
  if (!ws) throw new Error(`Sheet not found: ${sheet}`)
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, blankrows: false })
  const hr = findHeaderRow(aoa)
  const hdr = (aoa[hr] ?? []).map((h: any) => (h ?? '').toString().trim())

  // Report redacted column list
  const columnsReported = hdr.map((h) => (PII_RE.test(h) ? '[PII-REDACTED]' : (h || '(blank)')))

  // Build index map of safe columns only
  const idxOf = (name: string): number => {
    const i = hdr.indexOf(name)
    if (i >= 0 && PII_RE.test(name)) return -1 // belt + suspenders
    if (i >= 0 && !SAFE_COLS.has(name)) return -1
    return i
  }

  const ix = {
    employeeId: idxOf('Employee ID'),
    last: idxOf('Last Name'),
    first: idxOf('First Name'),
    status: idxOf('Status'),
    dept: idxOf('Department'),
    title: idxOf('Title'),
    employmentType: idxOf('Employment Type'),
    hireDate: idxOf('Hire Date'),
    termDate: idxOf('Termination Date'),
    workEmail: idxOf('Work Email'),
    personalPhone: idxOf('Personal Phone'),
    // Directory-only
    name: idxOf('Name'),
    email: idxOf('Email'),
  }

  const rows: Row[] = []
  for (let i = hr + 1; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue

    // Detect + skip section-header rows (e.g., "LEADERSHIP" with empties)
    const nameCell = ix.name >= 0 ? s(r[ix.name]) : ''
    const firstCell = ix.first >= 0 ? s(r[ix.first]) : ''
    const lastCell = ix.last >= 0 ? s(r[ix.last]) : ''

    let firstName = firstCell
    let lastName = lastCell
    if (!firstName && !lastName && nameCell) {
      const split = splitFull(nameCell)
      firstName = split.firstName
      lastName = split.lastName
    }
    if (!firstName && !lastName) continue

    const emailRaw = ix.workEmail >= 0 ? s(r[ix.workEmail]) : (ix.email >= 0 ? s(r[ix.email]) : '')
    const titleCellRaw = ix.title >= 0 ? s(r[ix.title]) : ''
    const deptCellRaw = ix.dept >= 0 ? s(r[ix.dept]) : ''

    // Section-header detection: rows with no email AND no title AND no dept
    // are section labels (e.g. "LEADERSHIP", "Sales & BD", "HEADCOUNT SUMMARY",
    // "Production ", "Accounting "). Names of real people always have at
    // least one of: email, title, dept populated.
    if (!emailRaw && !titleCellRaw && !deptCellRaw) continue
    // Extra guard: known section labels regardless of case / dept-summary rows
    const fullJoined = `${firstName} ${lastName}`.trim()
    if (!emailRaw && /^(headcount|summary|total|leadership|sales(\s*&\s*bd)?|production|accounting|project\s*management|customer\s*experience|delivery(\s*&\s*logistics)?|logistics|business\s*development|executive)\s*$/i.test(fullJoined)) continue
    // Dept-summary row: title cell is pure numeric (headcount)
    if (!emailRaw && /^\d+$/.test(titleCellRaw)) continue
    const email = emailRaw.toLowerCase()

    const phone = ix.personalPhone >= 0 ? s(r[ix.personalPhone]) : ''
    const department = ix.dept >= 0 ? s(r[ix.dept]) : ''
    const title = ix.title >= 0 ? s(r[ix.title]) : ''
    const employmentType = ix.employmentType >= 0 ? s(r[ix.employmentType]) : ''
    const statusVal = ix.status >= 0 ? s(r[ix.status]) : ''
    const hireDate = ix.hireDate >= 0 ? parseHireDate(r[ix.hireDate]) : null
    const employeeId = ix.employeeId >= 0 ? s(r[ix.employeeId]) : ''

    // Skip unnamed rows (e.g., "Michael [TBD]" passes, but nothing-name rows don't)
    rows.push({
      employeeId: employeeId || undefined,
      firstName,
      lastName,
      email,
      phone,
      department,
      title,
      employmentType,
      status: statusVal,
      hireDate,
      source,
    })
  }

  return { rows, columnsReported }
}

function mapDepartment(raw: string): Department | null {
  const t = raw.toLowerCase().trim()
  const m: Record<string, Department> = {
    'executive': 'EXECUTIVE',
    'leadership': 'EXECUTIVE',
    'sales': 'SALES',
    'sales / pm': 'SALES',
    'sales/pm': 'SALES',
    'sales & bd': 'SALES',
    'business development': 'BUSINESS_DEVELOPMENT',
    'estimating': 'ESTIMATING',
    'project management': 'PROJECT_MANAGEMENT',
    'pm': 'PROJECT_MANAGEMENT',
    'customer experience': 'SALES',
    'operations': 'OPERATIONS',
    'manufacturing': 'MANUFACTURING',
    'production': 'PRODUCTION',
    'warehouse': 'WAREHOUSE',
    'receiving': 'WAREHOUSE',
    'logistics': 'LOGISTICS',
    'delivery': 'DELIVERY',
    'delivery & logistics': 'DELIVERY',
    'installation': 'INSTALLATION',
    'accounting': 'ACCOUNTING',
    'purchasing': 'PURCHASING',
    'it': 'OPERATIONS',
  }
  return m[t] ?? null
}

function inferRole(title: string, dept: Department | null): StaffRole {
  const t = title.toLowerCase()
  if (t.includes('owner') || t.includes('ceo') || t.includes('cfo') || t.includes('coo') || t.includes('general manager')) return 'ADMIN'
  if (t.includes('director')) return 'MANAGER'
  if (t.includes('project manager')) return 'PROJECT_MANAGER'
  if (t.includes('customer experience') || t.includes('manager') && !t.includes('project')) return 'MANAGER'
  if (t.includes('sales') || t.includes('business development')) return 'SALES_REP'
  if (t.includes('driver')) return 'DRIVER'
  if (t.includes('purchasing')) return 'PURCHASING'
  if (t.includes('accountant') || t.includes('accounting')) return 'ACCOUNTING'
  if (t.includes('estimator')) return 'ESTIMATOR'
  if (t.includes('line lead')) return 'WAREHOUSE_LEAD'
  if (t.includes('logistics')) return 'MANAGER'
  if (t.includes('carpenter') || t.includes('assembly') || t.includes('production')) return 'WAREHOUSE_TECH'
  if (dept === 'PRODUCTION' || dept === 'MANUFACTURING' || dept === 'WAREHOUSE') return 'WAREHOUSE_TECH'
  if (dept === 'DELIVERY') return 'DRIVER'
  if (dept === 'ACCOUNTING') return 'ACCOUNTING'
  if (dept === 'ESTIMATING') return 'ESTIMATOR'
  return 'VIEWER'
}

function mapEmploymentType(raw: string): EmploymentType | null {
  const t = raw.toLowerCase().trim()
  if (!t) return null
  if (t.includes('exempt') && !t.includes('non')) return 'FULL_TIME_EXEMPT'
  if (t.includes('non-exempt') || t.includes('non exempt')) return 'FULL_TIME_NON_EXEMPT'
  if (t.includes('part')) return 'PART_TIME'
  if (t.includes('contract') || t.includes('1099')) return 'CONTRACT'
  if (t.includes('full')) return 'FULL_TIME_NON_EXEMPT' // default for FT
  return null
}

function nameKey(first: string, last: string): string {
  return (first + ' ' + last).toLowerCase().replace(/[^a-z]/g, '')
}

async function main() {
  console.log(`ETL staff v2 — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  const conf = extractFile(FILE_CONF, 'Employee Directory', 'CONFIDENTIAL')
  const dir = extractFile(FILE_DIR, 'Company Directory', 'DIRECTORY')

  console.log('\nCONFIDENTIAL columns:')
  console.log('  ' + conf.columnsReported.join(' | '))
  console.log(`  (rows parsed: ${conf.rows.length})`)
  console.log('\nCompany Directory columns:')
  console.log('  ' + dir.columnsReported.join(' | '))
  console.log(`  (rows parsed: ${dir.rows.length})`)

  // Merge. CONFIDENTIAL wins; Directory fills in gaps. Match first by email,
  // then fall back to nameKey so rows with missing emails in one file still
  // merge with the corresponding entry in the other.
  const byEmailKey = new Map<string, Row>()
  const byNameKey = new Map<string, Row>()

  const addRow = (r: Row) => {
    // Try to find an existing merged row: by email, then by nameKey
    let prev: Row | undefined
    let prevKeySource: 'email' | 'name' | undefined
    if (r.email && byEmailKey.has(r.email)) { prev = byEmailKey.get(r.email); prevKeySource = 'email' }
    if (!prev) {
      const nk = nameKey(r.firstName, r.lastName)
      if (byNameKey.has(nk)) { prev = byNameKey.get(nk); prevKeySource = 'name' }
    }

    if (!prev) {
      byNameKey.set(nameKey(r.firstName, r.lastName), r)
      if (r.email) byEmailKey.set(r.email, r)
      return
    }

    // CONFIDENTIAL wins on conflict; either fills in gaps.
    const winner = prev.source === 'CONFIDENTIAL' ? prev : r
    const loser = winner === prev ? r : prev
    const merged: Row = {
      ...loser,
      ...Object.fromEntries(
        Object.entries(winner).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      ),
      source: winner.source,
    } as Row

    // Refresh maps
    byNameKey.set(nameKey(merged.firstName, merged.lastName), merged)
    if (merged.email) byEmailKey.set(merged.email, merged)
  }

  for (const r of conf.rows) addRow(r)
  for (const r of dir.rows) addRow(r)

  // Dedup: iterate byNameKey (it's the complete index)
  const rows = Array.from(byNameKey.values())
  console.log(`\nMerged unique employee rows: ${rows.length}`)

  const prisma = new PrismaClient()
  try {
    const existing = await prisma.staff.findMany({
      select: {
        id: true, firstName: true, lastName: true, email: true,
        phone: true, title: true, department: true, role: true, active: true,
        hireDate: true, employmentType: true, employeeId: true,
      },
    })

    const byEmail = new Map(existing.map((s) => [s.email.toLowerCase(), s]))
    const byName = new Map<string, typeof existing[number]>()
    for (const s of existing) {
      const k = nameKey(s.firstName, s.lastName)
      const prev = byName.get(k)
      if (!prev || (!prev.phone && s.phone)) byName.set(k, s)
    }

    type CreatePlan = {
      email: string
      firstName: string
      lastName: string
      phone?: string
      department: Department
      role: StaffRole
      title?: string
      employmentType?: EmploymentType
      employeeId?: string
      hireDate?: Date
      active: boolean
    }

    const creates: CreatePlan[] = []
    const updates: Array<{ id: string; data: Record<string, unknown>; changes: string[] }> = []
    const skippedNoEmail: string[] = []
    const skippedUnknownDept: string[] = []

    for (const r of rows) {
      // Match DB row
      let hit = r.email ? byEmail.get(r.email) : undefined
      if (!hit) hit = byName.get(nameKey(r.firstName, r.lastName))

      const deptEnum = r.department ? mapDepartment(r.department) : null
      if (r.department && !deptEnum) skippedUnknownDept.push(r.department)

      const roleEnum = inferRole(r.title, deptEnum)
      const emplTypeEnum = mapEmploymentType(r.employmentType)

      const isActive = !r.status || /active|new/i.test(r.status)

      if (!hit) {
        // CREATE path — need email (unique key)
        if (!r.email) { skippedNoEmail.push(`${r.firstName} ${r.lastName}`); continue }
        if (!deptEnum) {
          // can't create without a mapped dept; default to OPERATIONS
        }
        creates.push({
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          phone: r.phone || undefined,
          department: deptEnum ?? 'OPERATIONS',
          role: roleEnum,
          title: r.title || undefined,
          employmentType: emplTypeEnum ?? undefined,
          employeeId: r.employeeId || undefined,
          hireDate: r.hireDate ?? undefined,
          active: isActive,
        })
        continue
      }

      // UPDATE path — only fill blanks (conservative merge)
      const data: Record<string, unknown> = {}
      const changes: string[] = []

      if (r.phone && !hit.phone) { data.phone = r.phone; changes.push('phone') }
      if (r.title && (!hit.title || hit.title.trim() === '')) { data.title = r.title; changes.push('title') }
      if (deptEnum && hit.department === 'OPERATIONS' && deptEnum !== 'OPERATIONS') {
        data.department = deptEnum; changes.push('department')
      }
      if (roleEnum && hit.role === 'VIEWER' && roleEnum !== 'VIEWER') {
        data.role = roleEnum; changes.push('role')
      }
      if (r.hireDate && !hit.hireDate) { data.hireDate = r.hireDate; changes.push('hireDate') }
      if (emplTypeEnum && !hit.employmentType) { data.employmentType = emplTypeEnum; changes.push('employmentType') }
      if (r.employeeId && !hit.employeeId) { data.employeeId = r.employeeId; changes.push('employeeId') }
      if (hit.active !== isActive && isActive === true) { data.active = true; changes.push('active') }

      if (changes.length > 0) updates.push({ id: hit.id, data, changes })
    }

    // --- Summary (no row-level PII printing) ---
    console.log('\n=== PLAN ===')
    console.log(`  Creates:          ${creates.length}`)
    console.log(`  Updates:          ${updates.length}`)
    console.log(`  Skipped-no-email: ${skippedNoEmail.length}  (can't create without unique email)`)
    console.log(`  Unknown depts:    ${skippedUnknownDept.length}`)

    if (creates.length > 0) {
      console.log('\n  Creates (email only):')
      creates.forEach((c) => console.log(`    + ${c.email}  (${c.firstName} ${c.lastName}, ${c.department}, ${c.role})`))
    }

    if (updates.length > 0) {
      const counts: Record<string, number> = {}
      for (const u of updates) for (const c of u.changes) counts[c] = (counts[c] ?? 0) + 1
      console.log('\n  Update per-field counts:')
      for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${k}: ${v}`)
      }
    }

    if (skippedNoEmail.length > 0) {
      console.log('\n  Skipped (no email — can\'t create, Staff.email is unique):')
      skippedNoEmail.forEach((n) => console.log(`    - ${n}`))
    }

    if (skippedUnknownDept.length > 0) {
      const uniq = Array.from(new Set(skippedUnknownDept))
      console.log('\n  Unknown department values (defaulted to OPERATIONS on create):')
      uniq.forEach((d) => console.log(`    - "${d}"`))
    }

    if (DRY_RUN) {
      console.log('\nDRY-RUN — nothing written. Re-run with --commit to apply.')
      return
    }

    console.log('\nCOMMIT — applying...')
    let created = 0, updated = 0, failed = 0

    for (const c of creates) {
      try {
        await prisma.staff.create({
          data: {
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            passwordHash: '', // placeholder — not login-capable yet
            phone: c.phone,
            department: c.department,
            role: c.role,
            title: c.title,
            employmentType: c.employmentType,
            employeeId: c.employeeId,
            hireDate: c.hireDate,
            active: c.active,
            mustChangePassword: true,
          },
        })
        created++
      } catch (e) {
        failed++
        console.error(`  FAIL create ${c.email}:`, (e as Error).message.slice(0, 160))
      }
    }

    for (const u of updates) {
      try {
        await prisma.staff.update({ where: { id: u.id }, data: u.data as any })
        updated++
      } catch (e) {
        failed++
        console.error(`  FAIL update ${u.id}:`, (e as Error).message.slice(0, 160))
      }
    }

    console.log(`\nCommitted: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
