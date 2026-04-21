export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDevAdmin } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import bcrypt from 'bcryptjs'

// Real Abel Lumber employees
const REAL_EMPLOYEES = [
  { firstName: 'Josh', lastName: 'Barrett', title: 'CEO', department: 'EXECUTIVE', role: 'ADMIN', email: 'josh@abellumber.com', phone: '940-299-9750' },
  { firstName: 'Clint', lastName: 'Vinson', title: 'COO', department: 'EXECUTIVE', role: 'ADMIN', email: 'c.vinson@abellumber.com', phone: '214-998-9454' },
  { firstName: 'Nathaniel', lastName: 'Barrett', title: 'CFO', department: 'EXECUTIVE', role: 'ADMIN', email: 'n.barrett@abellumber.com', phone: '405-650-0300' },
  { firstName: 'Scott', lastName: 'Johnson', title: 'GM', department: 'OPERATIONS', role: 'MANAGER', email: 'scott@abellumber.com', phone: '940-783-0135' },
  { firstName: 'Sean', lastName: 'Phillips', title: 'Customer Experience Manager', department: 'SALES', role: 'MANAGER', email: 'sean@abellumber.com', phone: '214-226-1997' },
  { firstName: 'Karen', lastName: 'Johnson', title: 'Director of Project Management', department: 'OPERATIONS', role: 'MANAGER', email: 'karen@abellumber.com', phone: '940-783-7092' },
  { firstName: 'Darlene', lastName: 'Haag', title: 'Project Manager', department: 'OPERATIONS', role: 'PROJECT_MANAGER', email: 'd.haag@abellumber.com', phone: '940-208-6905' },
  { firstName: 'Jessica', lastName: 'Rodriguez', title: 'Project Manager', department: 'OPERATIONS', role: 'PROJECT_MANAGER', email: 'jessica@abellumber.com', phone: '214-406-1269' },
  { firstName: 'Robin', lastName: 'Howell', title: 'Project Manager', department: 'OPERATIONS', role: 'PROJECT_MANAGER', email: 'robin@abellumber.com', phone: '940-727-9884' },
  { firstName: 'Dalton', lastName: 'Whatley', title: 'Sales Consultant', department: 'SALES', role: 'SALES_REP', email: 'dalton@abellumber.com', phone: '580-465-8502' },
  { firstName: 'Jordan', lastName: 'Sena', title: 'System Implementation Coordinator', department: 'OPERATIONS', role: 'ADMIN', email: 'jordan@abellumber.com', phone: '720-544-1072' },
  { firstName: 'Chris', lastName: 'Poppert', title: 'Warehouse Manager', department: 'WAREHOUSE', role: 'WAREHOUSE_LEAD', email: 'chris@abellumber.com', phone: '940-5972474' },
  { firstName: 'Dakota', lastName: 'Dyer', title: 'Driver Lead/Receiving', department: 'DELIVERY', role: 'DRIVER', email: 'dakota@abellumber.com', phone: '940-287-4003' },
  { firstName: 'Juan', lastName: 'Arreola', title: 'Staff Accountant', department: 'ACCOUNTING', role: 'ACCOUNTING', email: 'jarreola@mgfinancialpartners.com', phone: '830-563-7276' },
  { firstName: 'James', lastName: 'Gladue', title: 'Outside CFO', department: 'ACCOUNTING', role: 'ACCOUNTING', email: 'jgladue@mgfinancialpartners.com', phone: '860-917-7873' },
  { firstName: 'Bob', lastName: 'Doebener', title: 'Purchasing', department: 'PURCHASING', role: 'PURCHASING', email: 'bob@abellumber.com', phone: '903-328-8830' },
]

export async function POST(request: NextRequest) {
  const guard = requireDevAdmin(request)
  if (guard) return guard

  audit(request, 'RUN_SEED_EMPLOYEES', 'Database', undefined, { migration: 'RUN_SEED_EMPLOYEES' }, 'CRITICAL').catch(() => {})

  try {
    const defaultPasswordHash = await bcrypt.hash('abel2026', 12)
    const today = new Date().toISOString()

    // Step 1: Delete test/fake staff
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Staff" WHERE "email" LIKE '%@abel-ops.com' OR "email" LIKE '%@example.com'`
    )

    // Step 2: Upsert all real employees
    let created = 0
    let updated = 0
    const errors: string[] = []

    for (const emp of REAL_EMPLOYEES) {
      try {
        // Check if exists
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Staff" WHERE "email" = $1 LIMIT 1`,
          emp.email
        )

        if (existing.length > 0) {
          await prisma.$executeRawUnsafe(
            `UPDATE "Staff" SET "firstName" = $1, "lastName" = $2, "phone" = $3,
             "role" = $4::"StaffRole", "department" = $5::"Department", "title" = $6,
             "active" = true, "passwordHash" = $7
             WHERE "email" = $8`,
            emp.firstName, emp.lastName, emp.phone,
            emp.role, emp.department, emp.title,
            defaultPasswordHash, emp.email
          )
          updated++
        } else {
          const id = `staff_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Staff" ("id", "firstName", "lastName", "email", "passwordHash", "phone",
             "role", "department", "title", "active", "hireDate", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7::"StaffRole", $8::"Department", $9, true, $10, NOW(), NOW())`,
            id, emp.firstName, emp.lastName, emp.email, defaultPasswordHash, emp.phone,
            emp.role, emp.department, emp.title, today
          )
          created++
        }
      } catch (err: any) {
        errors.push(`${emp.email}: ${err.message}`)
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Employee seeding completed',
      created,
      updated,
      total: REAL_EMPLOYEES.length,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 200 })
  } catch (error: any) {
    console.error('Seed employees error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'POST to /api/ops/seed-employees to seed 16 real Abel Lumber employees',
    passwordDefault: 'abel2026',
    employees: REAL_EMPLOYEES.length,
  }, { status: 200 })
}
