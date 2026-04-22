export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { hashPassword } from '@/lib/staff-auth'
import { randomUUID } from 'crypto'

/**
 * POST /api/ops/staff/seed
 *
 * Seeds all Abel Lumber employees from the master roster.
 * ADMIN-only. Skips employees who already exist (by email).
 * Generates invite tokens so bulk-invite can send emails afterward.
 *
 * Body: { dryRun?: boolean }
 */

interface EmployeeDef {
  firstName: string
  lastName: string
  email: string
  role: string
  roles?: string
  department: string
  title: string
  hireDate?: string
  hourlyRate?: number | null
}

// ── Master roster ──────────────────────────────────────────────────────
const ROSTER: EmployeeDef[] = [
  // Leadership
  { firstName: 'Nate', lastName: 'Barrett', email: 'n.barrett@abellumber.com', role: 'ADMIN', roles: 'ADMIN,MANAGER', department: 'EXECUTIVE', title: 'Owner / General Manager' },
  { firstName: 'Clint', lastName: 'Vinson', email: 'c.vinson@abellumber.com', role: 'MANAGER', roles: 'MANAGER,ADMIN', department: 'EXECUTIVE', title: 'COO / Co-Owner', hireDate: '2024-01-01' },
  { firstName: 'Joshua', lastName: 'Barrett', email: 'j.barrett@abellumber.com', role: 'SALES_REP', department: 'SALES', title: 'Sales (Transitional)', hireDate: '2021-05-01' },
  { firstName: 'Dawn', lastName: 'Meehan', email: 'd.meehan@abellumber.com', role: 'ACCOUNTING', roles: 'ACCOUNTING,MANAGER', department: 'ACCOUNTING', title: 'Accounting Manager', hireDate: '2025-10-06' },
  { firstName: 'Dalton', lastName: 'Whatley', email: 'd.whatley@abellumber.com', role: 'SALES_REP', roles: 'SALES_REP,MANAGER', department: 'SALES', title: 'Business Development Manager', hireDate: '2025-06-02' },
  // CX & Estimating
  { firstName: 'Sean', lastName: 'Phillips', email: 's.phillips@abellumber.com', role: 'MANAGER', department: 'OPERATIONS', title: 'Customer Experience Manager', hireDate: '2025-07-01' },
  { firstName: 'Lisa', lastName: 'Adams', email: 'l.adams@abellumber.com', role: 'ESTIMATOR', department: 'ESTIMATING', title: 'Estimator', hireDate: '2025-06-18' },
  // Project Managers
  { firstName: 'Chad', lastName: 'Zeh', email: 'c.zeh@abellumber.com', role: 'PROJECT_MANAGER', department: 'OPERATIONS', title: 'Project Manager', hireDate: '2026-01-26' },
  { firstName: 'Brittney', lastName: 'Werner', email: 'b.werner@abellumber.com', role: 'PROJECT_MANAGER', department: 'OPERATIONS', title: 'Project Manager', hireDate: '2026-01-26' },
  { firstName: 'Thomas', lastName: 'Robinson', email: 't.robinson@abellumber.com', role: 'PROJECT_MANAGER', department: 'OPERATIONS', title: 'Project Manager', hireDate: '2026-01-19' },
  { firstName: 'Ben', lastName: 'Wilson', email: 'b.wilson@abellumber.com', role: 'PROJECT_MANAGER', department: 'OPERATIONS', title: 'Project Manager', hireDate: '2024-04-15' },
  // Delivery
  { firstName: 'Jordyn', lastName: 'Steider', email: 'j.steider@abellumber.com', role: 'MANAGER', department: 'DELIVERY', title: 'Delivery Logistical Supervisor', hireDate: '2025-06-16', hourlyRate: 26 },
  { firstName: 'Austin', lastName: 'Collett', email: 'a.collett@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Driver', hireDate: '2026-02-02', hourlyRate: 22 },
  { firstName: 'Aaron', lastName: 'Treadaway', email: 'a.treadaway@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Driver', hireDate: '2025-07-22', hourlyRate: 22 },
  { firstName: 'Jack', lastName: 'Zenker', email: 'j.zenker@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Driver', hireDate: '2026-04-09', hourlyRate: 22 },
  { firstName: 'Noah', lastName: 'Ridge', email: 'n.ridge@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Driver', hireDate: '2026-04-20', hourlyRate: 22 },
  // Production
  { firstName: 'Gunner', lastName: 'Hacker', email: 'g.hacker@abellumber.com', role: 'WAREHOUSE_LEAD', department: 'MANUFACTURING', title: 'Production Lead', hireDate: '2024-05-13', hourlyRate: 23 },
  { firstName: 'Tiffany', lastName: 'Brooks', email: 't.brooks@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Production', hireDate: '2025-08-04', hourlyRate: 22 },
  { firstName: 'Julio', lastName: 'Castro', email: 'j.castro@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Production', hireDate: '2025-07-30', hourlyRate: 22 },
  { firstName: 'Marcus', lastName: 'Trevino', email: 'm.trevino@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Production', hireDate: '2025-05-27', hourlyRate: 22 },
  { firstName: 'Cody', lastName: 'Prichard', email: 'c.prichard@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Assembly Table', hireDate: '2026-04-20', hourlyRate: 22 },
  { firstName: 'Wyatt', lastName: 'Tanner', email: 'w.tanner@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Assembly Carpenter', hireDate: '2026-04-20', hourlyRate: 20 },
  { firstName: 'Michael', lastName: 'TBD', email: 'm.assembly@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Assembly Carpenter', hireDate: '2026-04-20', hourlyRate: 20 },
]

// ── Portal access restrictions by role ────────────────────────────────
const FINANCE_ROUTES = [
  '/ops/finance', '/ops/finance/ap', '/ops/finance/ar', '/ops/finance/cash',
  '/ops/finance/bank', '/ops/finance/health', '/ops/finance/modeler',
  '/ops/finance/optimization', '/ops/finance/command-center',
  '/ops/executive/financial', '/ops/cash-flow-optimizer', '/ops/revenue-intelligence',
]
const ADMIN_ROUTES = [
  '/ops/staff', '/ops/admin/ai-usage', '/ops/admin/crons', '/ops/admin/data-quality',
  '/ops/admin/trends', '/ops/integrations', '/ops/settings', '/ops/audit', '/ops/sync-health',
]

function buildOverrides(role: string): Record<string, boolean> {
  const deny: Record<string, boolean> = {}
  const needsFinance = ['ADMIN', 'MANAGER', 'ACCOUNTING'].includes(role)
  const needsAdmin = ['ADMIN'].includes(role)

  if (!needsFinance) FINANCE_ROUTES.forEach(r => { deny[r] = false })
  if (!needsAdmin) ADMIN_ROUTES.forEach(r => { deny[r] = false })

  return deny
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // ADMIN only
  const role = request.headers.get('x-staff-role')
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'ADMIN only' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dryRun === true

    await audit(request, 'CREATE', 'Staff', 'seed', { dryRun, count: ROSTER.length })

    const results: { email: string; action: string; name: string }[] = []

    for (const emp of ROSTER) {
      const email = emp.email.toLowerCase().trim()

      // Check existing
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, "firstName", "lastName", "passwordSetAt" FROM "Staff" WHERE email = $1`,
        email
      )

      if (existing.length > 0) {
        if (!dryRun) {
          // Update role, department, title, hire date, portal overrides
          await prisma.$queryRawUnsafe(
            `UPDATE "Staff" SET
              "firstName" = $1, "lastName" = $2,
              role = $3::"StaffRole", department = $4::"Department",
              title = $5, "hireDate" = $6,
              ${emp.roles ? `roles = '${emp.roles}',` : ''}
              ${emp.hourlyRate != null ? `"hourlyRate" = ${emp.hourlyRate},` : ''}
              "portalOverrides" = $7,
              "updatedAt" = NOW()
            WHERE id = $8`,
            emp.firstName, emp.lastName, emp.role, emp.department,
            emp.title, emp.hireDate ? new Date(emp.hireDate) : null,
            JSON.stringify(buildOverrides(emp.role)),
            existing[0].id
          )
        }
        results.push({ email, action: 'updated', name: `${emp.firstName} ${emp.lastName}` })
        continue
      }

      if (!dryRun) {
        const staffId = randomUUID()
        const inviteToken = randomUUID()
        const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        const tempHash = await hashPassword(randomUUID())

        await prisma.$queryRawUnsafe(
          `INSERT INTO "Staff" (
            id, "firstName", "lastName", email, "passwordHash", phone,
            role, roles, department, title, "hireDate", "hourlyRate",
            "inviteToken", "inviteTokenExpiry", "portalOverrides",
            active, "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, NULL,
            $6::"StaffRole", $7, $8::"Department", $9, $10, $11,
            $12, $13, $14,
            true, NOW(), NOW()
          )`,
          staffId, emp.firstName, emp.lastName, email, tempHash,
          emp.role, emp.roles || emp.role, emp.department, emp.title,
          emp.hireDate ? new Date(emp.hireDate) : null, emp.hourlyRate ?? null,
          inviteToken, inviteExpiry, JSON.stringify(buildOverrides(emp.role))
        )
      }
      results.push({ email, action: 'created', name: `${emp.firstName} ${emp.lastName}` })
    }

    const created = results.filter(r => r.action === 'created').length
    const updated = results.filter(r => r.action === 'updated').length

    return NextResponse.json({
      dryRun,
      total: ROSTER.length,
      created,
      updated,
      results,
      nextStep: dryRun
        ? 'Run again without dryRun to create employees'
        : 'Now call POST /api/ops/staff/bulk-invite to send setup emails to all employees',
    })
  } catch (error: any) {
    console.error('Employee seed error:', error)
    return NextResponse.json({ error: 'Seed failed', details: error.message }, { status: 500 })
  }
}
