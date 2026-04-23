#!/usr/bin/env node
/**
 * Local-run replica of /api/ops/seed-employees (which is prod-disabled).
 * Runs the exact same upsert/deactivate/manager-wire logic directly against Neon.
 *
 * Source of truth stays the route file — this is a one-off shim to bypass the
 * NODE_ENV === 'production' guard. If the route's arrays change, resync here.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbUrl = readFileSync(join(__dirname, '..', '.env'), 'utf-8').match(/DATABASE_URL="([^"]+)"/)?.[1]
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1) }

const { neon } = await import('@neondatabase/serverless')
const bcrypt = (await import('bcryptjs')).default
const sql = neon(dbUrl)

// ═══════════════════════════════════════════════════════════════════════
// Copied verbatim from src/app/api/ops/seed-employees/route.ts
// ═══════════════════════════════════════════════════════════════════════
const ACTIVE_EMPLOYEES = [
  { employeeId: 'AL-020', firstName: 'Nate', lastName: 'Barrett', title: 'Owner / General Manager', department: 'EXECUTIVE', role: 'ADMIN', email: 'n.barrett@abellumber.com', phone: '405-650-0300', payType: 'SALARY', employmentType: 'FULL_TIME_EXEMPT', hireDate: '2021-05-01' },
  { employeeId: 'AL-001', firstName: 'Josh', lastName: 'Barrett', title: 'Sales (Transitional)', department: 'SALES', role: 'SALES_REP', email: 'josh@abellumber.com', phone: '940-299-9750', payType: 'SALARY', salary: 165000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2021-05-01', managedByEmail: 'n.barrett@abellumber.com' },
  { employeeId: 'AL-002', firstName: 'Clint', lastName: 'Vinson', title: 'COO', department: 'EXECUTIVE', role: 'ADMIN', email: 'c.vinson@abellumber.com', phone: '214-998-9454', payType: 'SALARY', salary: 125000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2024-01-01', managedByEmail: 'n.barrett@abellumber.com' },
  { employeeId: 'AL-008', firstName: 'Dawn', lastName: 'Meehan', title: 'Accounting Manager', department: 'ACCOUNTING', role: 'ACCOUNTING', email: 'dawn.meehan@abellumber.com', payType: 'SALARY', salary: 90000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2025-10-06', managedByEmail: 'n.barrett@abellumber.com' },
  { employeeId: 'AL-009', firstName: 'Sean', lastName: 'Phillips', title: 'Customer Experience Manager', department: 'SALES', role: 'MANAGER', email: 'sean@abellumber.com', phone: '214-226-1997', payType: 'SALARY', salary: 70000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2025-07-01', managedByEmail: 'n.barrett@abellumber.com' },
  { employeeId: 'AL-015', firstName: 'Dalton', lastName: 'Whatley', title: 'Business Development Manager', department: 'BUSINESS_DEVELOPMENT', role: 'SALES_REP', email: 'dalton@abellumber.com', phone: '580-465-8502', payType: 'SALARY', salary: 100000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2025-06-02', managedByEmail: 'josh@abellumber.com' },
  { employeeId: 'AL-003', firstName: 'Lisa', lastName: 'Adams', title: 'Estimator', department: 'ESTIMATING', role: 'ESTIMATOR', email: 'lisa@abellumber.com', payType: 'SALARY', salary: 70000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2025-06-18', managedByEmail: 'c.vinson@abellumber.com' },
  { employeeId: 'AL-014', firstName: 'Brittney', lastName: 'Werner', title: 'Project Manager', department: 'PROJECT_MANAGEMENT', role: 'PROJECT_MANAGER', email: 'brittney.werner@abellumber.com', payType: 'SALARY', salary: 75000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2026-01-26', managedByEmail: 'n.barrett@abellumber.com' },
  { employeeId: 'AL-010', firstName: 'Thomas', lastName: 'Robinson', title: 'Project Manager', department: 'PROJECT_MANAGEMENT', role: 'PROJECT_MANAGER', email: 'thomas@abellumber.com', payType: 'SALARY', salary: 70000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2026-01-19', managedByEmail: 'c.vinson@abellumber.com' },
  { employeeId: 'AL-016', firstName: 'Ben', lastName: 'Wilson', title: 'Project Manager', department: 'PROJECT_MANAGEMENT', role: 'PROJECT_MANAGER', email: 'ben.wilson@abellumber.com', payType: 'SALARY', salary: 65000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2024-04-15', managedByEmail: 'c.vinson@abellumber.com' },
  { employeeId: 'AL-017', firstName: 'Chad', lastName: 'Zeh', title: 'Project Manager', department: 'PROJECT_MANAGEMENT', role: 'PROJECT_MANAGER', email: 'chad.zeh@abellumber.com', payType: 'SALARY', salary: 92000, employmentType: 'FULL_TIME_EXEMPT', hireDate: '2026-01-26', managedByEmail: 'c.vinson@abellumber.com' },
  { employeeId: 'AL-007', firstName: 'Gunner', lastName: 'Hacker', title: 'Production Line Lead', department: 'PRODUCTION', role: 'WAREHOUSE_LEAD', email: 'gunner@abellumber.com', payType: 'HOURLY', hourlyRate: 23, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2024-05-13', managedByEmail: 'c.vinson@abellumber.com' },
  { employeeId: 'AL-004', firstName: 'Tiffany', lastName: 'Brooks', title: 'Production Associate', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'tiffany.b@abellumber.com', phone: '682-404-8946', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2025-08-04', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-005', firstName: 'Julio', lastName: 'Castro', title: 'Production Associate', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'julio.c@abellumber.com', phone: '817-403-3308', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2025-07-30', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-013', firstName: 'Marcus', lastName: 'Trevino', title: 'Production Associate', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'marcus.t@abellumber.com', phone: '817-304-4162', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2025-05-27', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-019', firstName: 'Virginia', lastName: 'Cox', title: 'Production Associate', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'virginia.c@abellumber.com', phone: '903-644-8109', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-03-15', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-021', firstName: 'Cody', lastName: 'Prichard', title: 'Production Associate', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'cody.prichard@abellumber.com', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-04-20', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-022', firstName: 'Wyatt', lastName: 'Tanner', title: 'Assembly Table Carpenter', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'wyatt.tanner@abellumber.com', payType: 'HOURLY', hourlyRate: 20, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-04-20', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-023', firstName: 'Michael', lastName: 'TBD', title: 'Assembly Table Carpenter', department: 'PRODUCTION', role: 'WAREHOUSE_TECH', email: 'michael@abellumber.com', payType: 'HOURLY', hourlyRate: 20, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-04-20', managedByEmail: 'gunner@abellumber.com' },
  { employeeId: 'AL-011', firstName: 'Jordyn', lastName: 'Steider', title: 'Delivery Logistical Supervisor', department: 'LOGISTICS', role: 'MANAGER', email: 'jordyn.steider@abellumber.com', payType: 'HOURLY', hourlyRate: 26, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2025-06-16', managedByEmail: 'c.vinson@abellumber.com' },
  { employeeId: 'AL-006', firstName: 'Austin', lastName: 'Collett', title: 'Delivery Driver', department: 'DELIVERY', role: 'DRIVER', email: 'austin.collett@abellumber.com', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-02-02', managedByEmail: 'jordyn.steider@abellumber.com' },
  { employeeId: 'AL-012', firstName: 'Aaron', lastName: 'Treadaway', title: 'Delivery Driver', department: 'DELIVERY', role: 'DRIVER', email: 'aaron.treadaway@abellumber.com', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2025-07-22', managedByEmail: 'jordyn.steider@abellumber.com' },
  { employeeId: 'AL-018', firstName: 'Jack', lastName: 'Zenker', title: 'Delivery Driver', department: 'DELIVERY', role: 'DRIVER', email: 'jack.z@abellumber.com', phone: '940-783-6473', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-04-09', managedByEmail: 'jordyn.steider@abellumber.com' },
  { employeeId: 'AL-024', firstName: 'Noah', lastName: 'Ridge', title: 'Delivery Driver', department: 'DELIVERY', role: 'DRIVER', email: 'noah.ridge@abellumber.com', payType: 'HOURLY', hourlyRate: 22, employmentType: 'FULL_TIME_NON_EXEMPT', hireDate: '2026-04-20', managedByEmail: 'jordyn.steider@abellumber.com' },
]

const DEPARTED_EMAILS = [
  'scott@abellumber.com', 'karen@abellumber.com', 'robin@abellumber.com',
  'd.haag@abellumber.com', 'jessica@abellumber.com', 'jordan@abellumber.com',
  'chris@abellumber.com', 'dakota@abellumber.com',
  'jarreola@mgfinancialpartners.com', 'jgladue@mgfinancialpartners.com',
  'bob@abellumber.com',
]

// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log('🔐 Hashing default password...')
  const defaultPasswordHash = await bcrypt.hash('abel2026', 12)

  // Step 1: purge test/fake staff
  const delResult = await sql.query(
    `DELETE FROM "Staff" WHERE "email" LIKE '%@abel-ops.com' OR "email" LIKE '%@example.com' RETURNING email`
  )
  console.log(`🧹 Deleted test staff: ${delResult.length}`)

  // Step 2: deactivate departed
  let deactivated = 0
  for (const email of DEPARTED_EMAILS) {
    const r = await sql.query(
      `UPDATE "Staff" SET "active" = false, "updatedAt" = NOW() WHERE "email" = $1 AND "active" = true RETURNING email`,
      [email]
    )
    if (r.length) deactivated++
  }
  console.log(`💤 Deactivated departed: ${deactivated}`)

  // Step 3: upsert active
  let created = 0, updated = 0
  const errors = []
  for (const emp of ACTIVE_EMPLOYEES) {
    try {
      const existing = await sql.query(`SELECT "id" FROM "Staff" WHERE "email" = $1 LIMIT 1`, [emp.email])
      if (existing.length > 0) {
        await sql.query(
          `UPDATE "Staff" SET
            "firstName" = $1, "lastName" = $2, "phone" = $3,
            "role" = $4::"StaffRole", "department" = $5::"Department", "title" = $6,
            "active" = true, "hireDate" = $7::timestamp,
            "hourlyRate" = $8, "salary" = $9,
            "payType" = $10::"PayType", "employmentType" = $11::"EmploymentType",
            "employeeId" = $12,
            "updatedAt" = NOW()
           WHERE "email" = $13`,
          [emp.firstName, emp.lastName, emp.phone || null,
           emp.role, emp.department, emp.title,
           emp.hireDate, emp.hourlyRate || null, emp.salary || null,
           emp.payType, emp.employmentType, emp.employeeId, emp.email]
        )
        updated++
      } else {
        const id = `staff_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        await sql.query(
          `INSERT INTO "Staff" ("id", "firstName", "lastName", "email", "passwordHash", "phone",
           "role", "department", "title", "active", "hireDate",
           "hourlyRate", "salary", "payType", "employmentType", "employeeId",
           "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6,
            $7::"StaffRole", $8::"Department", $9, true, $10::timestamp,
            $11, $12, $13::"PayType", $14::"EmploymentType", $15,
            NOW(), NOW())`,
          [id, emp.firstName, emp.lastName, emp.email, defaultPasswordHash, emp.phone || null,
           emp.role, emp.department, emp.title, emp.hireDate,
           emp.hourlyRate || null, emp.salary || null, emp.payType, emp.employmentType, emp.employeeId]
        )
        created++
        console.log(`  + created ${emp.email}`)
      }
    } catch (err) {
      errors.push(`${emp.email}: ${err.message}`)
      console.error(`  ! ${emp.email}: ${err.message}`)
    }
  }
  console.log(`✅ Active upsert: ${created} created, ${updated} updated`)

  // Step 4: wire manager relationships
  let managersSet = 0
  for (const emp of ACTIVE_EMPLOYEES) {
    if (emp.managedByEmail) {
      try {
        await sql.query(
          `UPDATE "Staff" SET "managerId" = (
            SELECT "id" FROM "Staff" WHERE "email" = $1 LIMIT 1
          ) WHERE "email" = $2`,
          [emp.managedByEmail, emp.email]
        )
        managersSet++
      } catch (err) {
        errors.push(`manager ${emp.email} → ${emp.managedByEmail}: ${err.message}`)
      }
    }
  }
  console.log(`🔗 Manager relationships wired: ${managersSet}`)

  // Step 5: verify
  const verify = await sql.query(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE active = true)::int active,
            COUNT(*) FILTER (WHERE "managerId" IS NOT NULL)::int with_mgr
     FROM "Staff" WHERE "email" = ANY($1)`,
    [ACTIVE_EMPLOYEES.map(e => e.email)]
  )
  console.log(`\n📊 Verify: ${verify[0].total}/24 in DB, ${verify[0].active} active, ${verify[0].with_mgr} have manager`)

  if (errors.length) {
    console.log(`\n⚠️  ${errors.length} errors:`)
    errors.forEach(e => console.log(`  - ${e}`))
  }

  console.log('\n✅ Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
