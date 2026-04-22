/**
 * Employee Seed Script — Abel Lumber Launch Day
 *
 * Run via: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/seed-employees.ts
 * Or via: npx tsx scripts/seed-employees.ts
 *
 * Requires DATABASE_URL in environment.
 *
 * This script:
 * 1. Upserts all 24 employees with correct roles, departments, hire dates, and pay
 * 2. Generates invite tokens for everyone who doesn't have a password set
 * 3. Does NOT send emails (use /api/ops/staff/bulk-invite for that)
 * 4. Skips employees who already exist (by email match)
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

interface EmployeeRecord {
  firstName: string
  lastName: string
  email: string
  phone?: string
  role: string // StaffRole enum value
  roles?: string // comma-separated multi-role
  department: string // Department enum value
  title: string
  hireDate?: string // ISO date
  hourlyRate?: number // null for salaried (store annual/2080 if needed)
  sensitive?: boolean // true = restrict portal access
}

const EMPLOYEES: EmployeeRecord[] = [
  // ── LEADERSHIP ──
  {
    firstName: 'Nate',
    lastName: 'Barrett',
    email: 'n.barrett@abellumber.com',
    role: 'ADMIN',
    roles: 'ADMIN,MANAGER',
    department: 'EXECUTIVE',
    title: 'Owner / General Manager',
    sensitive: false,
  },
  {
    firstName: 'Clint',
    lastName: 'Vinson',
    email: 'c.vinson@abellumber.com',
    role: 'MANAGER',
    roles: 'MANAGER,ADMIN',
    department: 'EXECUTIVE',
    title: 'COO / Co-Owner',
    hireDate: '2024-01-01',
    sensitive: false,
  },
  {
    firstName: 'Joshua',
    lastName: 'Barrett',
    email: 'j.barrett@abellumber.com',
    role: 'SALES_REP',
    department: 'SALES',
    title: 'Sales (Transitional)',
    hireDate: '2021-05-01',
    sensitive: false,
  },
  {
    firstName: 'Dawn',
    lastName: 'Meehan',
    email: 'd.meehan@abellumber.com',
    role: 'ACCOUNTING',
    roles: 'ACCOUNTING,MANAGER',
    department: 'ACCOUNTING',
    title: 'Accounting Manager',
    hireDate: '2025-10-06',
    sensitive: false,
  },
  {
    firstName: 'Dalton',
    lastName: 'Whatley',
    email: 'd.whatley@abellumber.com',
    role: 'SALES_REP',
    roles: 'SALES_REP,MANAGER',
    department: 'SALES',
    title: 'Business Development Manager',
    hireDate: '2025-06-02',
    sensitive: false,
  },

  // ── CUSTOMER EXPERIENCE & ESTIMATING ──
  {
    firstName: 'Sean',
    lastName: 'Phillips',
    email: 's.phillips@abellumber.com',
    role: 'MANAGER',
    department: 'OPERATIONS',
    title: 'Customer Experience Manager',
    hireDate: '2025-07-01',
    sensitive: false,
  },
  {
    firstName: 'Lisa',
    lastName: 'Adams',
    email: 'l.adams@abellumber.com',
    role: 'ESTIMATOR',
    department: 'ESTIMATING',
    title: 'Estimator',
    hireDate: '2025-06-18',
    sensitive: false,
  },

  // ── PROJECT MANAGERS ──
  {
    firstName: 'Chad',
    lastName: 'Zeh',
    email: 'c.zeh@abellumber.com',
    role: 'PROJECT_MANAGER',
    department: 'OPERATIONS',
    title: 'Project Manager',
    hireDate: '2026-01-26',
    sensitive: false,
  },
  {
    firstName: 'Brittney',
    lastName: 'Werner',
    email: 'b.werner@abellumber.com',
    role: 'PROJECT_MANAGER',
    department: 'OPERATIONS',
    title: 'Project Manager',
    hireDate: '2026-01-26',
    sensitive: false,
  },
  {
    firstName: 'Thomas',
    lastName: 'Robinson',
    email: 't.robinson@abellumber.com',
    role: 'PROJECT_MANAGER',
    department: 'OPERATIONS',
    title: 'Project Manager',
    hireDate: '2026-01-19',
    sensitive: false,
  },
  {
    firstName: 'Ben',
    lastName: 'Wilson',
    email: 'b.wilson@abellumber.com',
    role: 'PROJECT_MANAGER',
    department: 'OPERATIONS',
    title: 'Project Manager',
    hireDate: '2024-04-15',
    sensitive: false,
  },

  // ── DELIVERY & LOGISTICS ──
  {
    firstName: 'Jordyn',
    lastName: 'Steider',
    email: 'j.steider@abellumber.com',
    role: 'MANAGER',
    department: 'DELIVERY',
    title: 'Delivery Logistical Supervisor',
    hireDate: '2025-06-16',
    hourlyRate: 26,
    sensitive: false,
  },
  {
    firstName: 'Austin',
    lastName: 'Collett',
    email: 'a.collett@abellumber.com',
    role: 'DRIVER',
    department: 'DELIVERY',
    title: 'Delivery Driver',
    hireDate: '2026-02-02',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Aaron',
    lastName: 'Treadaway',
    email: 'a.treadaway@abellumber.com',
    role: 'DRIVER',
    department: 'DELIVERY',
    title: 'Delivery Driver',
    hireDate: '2025-07-22',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Jack',
    lastName: 'Zenker',
    email: 'j.zenker@abellumber.com',
    role: 'DRIVER',
    department: 'DELIVERY',
    title: 'Delivery Driver',
    hireDate: '2026-04-09',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Noah',
    lastName: 'Ridge',
    email: 'n.ridge@abellumber.com',
    role: 'DRIVER',
    department: 'DELIVERY',
    title: 'Delivery Driver',
    hireDate: '2026-04-20',
    hourlyRate: 22,
    sensitive: false,
  },

  // ── PRODUCTION ──
  {
    firstName: 'Gunner',
    lastName: 'Hacker',
    email: 'g.hacker@abellumber.com',
    role: 'WAREHOUSE_LEAD',
    department: 'MANUFACTURING',
    title: 'Production Lead',
    hireDate: '2024-05-13',
    hourlyRate: 23,
    sensitive: false,
  },
  {
    firstName: 'Tiffany',
    lastName: 'Brooks',
    email: 't.brooks@abellumber.com',
    role: 'WAREHOUSE_TECH',
    department: 'MANUFACTURING',
    title: 'Production',
    hireDate: '2025-08-04',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Julio',
    lastName: 'Castro',
    email: 'j.castro@abellumber.com',
    role: 'WAREHOUSE_TECH',
    department: 'MANUFACTURING',
    title: 'Production',
    hireDate: '2025-07-30',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Marcus',
    lastName: 'Trevino',
    email: 'm.trevino@abellumber.com',
    role: 'WAREHOUSE_TECH',
    department: 'MANUFACTURING',
    title: 'Production',
    hireDate: '2025-05-27',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Cody',
    lastName: 'Prichard',
    email: 'c.prichard@abellumber.com',
    role: 'WAREHOUSE_TECH',
    department: 'MANUFACTURING',
    title: 'Assembly Table (Production Line)',
    hireDate: '2026-04-20',
    hourlyRate: 22,
    sensitive: false,
  },
  {
    firstName: 'Wyatt',
    lastName: 'Tanner',
    email: 'w.tanner@abellumber.com',
    role: 'WAREHOUSE_TECH',
    department: 'MANUFACTURING',
    title: 'Assembly Carpenter (Production Line)',
    hireDate: '2026-04-20',
    hourlyRate: 20,
    sensitive: false,
  },
  {
    firstName: 'Michael',
    lastName: 'TBD',
    email: 'm.assembly@abellumber.com',
    role: 'WAREHOUSE_TECH',
    department: 'MANUFACTURING',
    title: 'Assembly Carpenter (Production Line)',
    hireDate: '2026-04-20',
    hourlyRate: 20,
    sensitive: false,
  },
]

// Role-based portal access restrictions
// These define what each role CANNOT see (deny list)
const SENSITIVE_ROUTES: Record<string, string[]> = {
  // Finance pages — only ADMIN, MANAGER, ACCOUNTING
  FINANCE: [
    '/ops/finance', '/ops/finance/ap', '/ops/finance/ar', '/ops/finance/cash',
    '/ops/finance/bank', '/ops/finance/health', '/ops/finance/modeler',
    '/ops/finance/optimization', '/ops/finance/command-center',
    '/ops/executive/financial', '/ops/cash-flow-optimizer',
    '/ops/revenue-intelligence',
  ],
  // HR/Staff pages — only ADMIN
  HR: ['/ops/staff'],
  // Admin pages — only ADMIN
  ADMIN: [
    '/ops/admin/ai-usage', '/ops/admin/crons', '/ops/admin/data-quality',
    '/ops/admin/trends', '/ops/integrations', '/ops/settings',
    '/ops/audit', '/ops/sync-health',
  ],
}

// Roles that should NOT have access to sensitive sections
const RESTRICT_FINANCE = [
  'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'WAREHOUSE_LEAD',
  'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'VIEWER',
]
const RESTRICT_HR = [
  'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING',
  'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER',
  'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER',
]
const RESTRICT_ADMIN = [
  'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING',
  'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER',
  'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER',
]

function buildPortalOverrides(role: string): Record<string, boolean> {
  const overrides: Record<string, boolean> = {}

  if (RESTRICT_FINANCE.includes(role)) {
    SENSITIVE_ROUTES.FINANCE.forEach(route => { overrides[route] = false })
  }
  if (RESTRICT_HR.includes(role)) {
    SENSITIVE_ROUTES.HR.forEach(route => { overrides[route] = false })
  }
  if (RESTRICT_ADMIN.includes(role)) {
    SENSITIVE_ROUTES.ADMIN.forEach(route => { overrides[route] = false })
  }

  return overrides
}

async function main() {
  console.log('=== Abel Lumber Employee Seed ===')
  console.log(`Processing ${EMPLOYEES.length} employees...\n`)

  let created = 0
  let skipped = 0
  let updated = 0

  for (const emp of EMPLOYEES) {
    const email = emp.email.toLowerCase().trim()

    // Check if exists
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "firstName", "lastName", "passwordSetAt" FROM "Staff" WHERE email = $1`,
      email
    )

    if (existing.length > 0) {
      const staff = existing[0]
      // Update title, role, department if changed — but don't touch password or invite
      await prisma.$queryRawUnsafe(
        `UPDATE "Staff" SET
          "firstName" = $1,
          "lastName" = $2,
          role = $3::"StaffRole",
          department = $4::"Department",
          title = $5,
          "hireDate" = $6,
          ${emp.hourlyRate !== undefined ? `"hourlyRate" = ${emp.hourlyRate},` : ''}
          ${emp.roles ? `roles = '${emp.roles}',` : ''}
          "portalOverrides" = $7,
          "updatedAt" = NOW()
        WHERE id = $8`,
        emp.firstName,
        emp.lastName,
        emp.role,
        emp.department,
        emp.title,
        emp.hireDate ? new Date(emp.hireDate) : null,
        JSON.stringify(buildPortalOverrides(emp.role)),
        staff.id
      )
      console.log(`  ✓ Updated: ${emp.firstName} ${emp.lastName} (${email}) — ${emp.role}`)
      updated++
      continue
    }

    // Create new employee
    const staffId = randomUUID()
    const inviteToken = randomUUID()
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    const tempPasswordHash = await bcrypt.hash(randomUUID(), 10)
    const portalOverrides = buildPortalOverrides(emp.role)

    await prisma.$queryRawUnsafe(
      `INSERT INTO "Staff" (
        id, "firstName", "lastName", email, "passwordHash", phone,
        role, roles, department, title, "hireDate", "hourlyRate",
        "inviteToken", "inviteTokenExpiry", "portalOverrides",
        active, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7::"StaffRole", $8, $9::"Department", $10, $11, $12,
        $13, $14, $15,
        true, NOW(), NOW()
      )`,
      staffId,
      emp.firstName,
      emp.lastName,
      email,
      tempPasswordHash,
      emp.phone || null,
      emp.role,
      emp.roles || emp.role,
      emp.department,
      emp.title,
      emp.hireDate ? new Date(emp.hireDate) : null,
      emp.hourlyRate || null,
      inviteToken,
      inviteTokenExpiry,
      JSON.stringify(portalOverrides)
    )

    console.log(`  + Created: ${emp.firstName} ${emp.lastName} (${email}) — ${emp.role} / ${emp.department}`)
    created++
  }

  console.log(`\n=== Summary ===`)
  console.log(`  Created: ${created}`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Skipped: ${skipped}`)
  console.log(`  Total:   ${EMPLOYEES.length}`)
  console.log(`\nNext steps:`)
  console.log(`  1. Verify emails are correct for each employee`)
  console.log(`  2. Hit POST /api/ops/staff/bulk-invite to send setup emails`)
  console.log(`  3. Each employee visits their invite link, sets password, signs handbook`)
  console.log(`  4. Portal access is automatically restricted by role`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Seed failed:', e)
  prisma.$disconnect()
  process.exit(1)
})
