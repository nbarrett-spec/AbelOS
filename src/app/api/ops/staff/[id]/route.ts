export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth, requireStaffAuth } from '@/lib/api-auth'
import { hashPassword } from '@/lib/staff-auth'
import { randomUUID } from 'crypto'
import { sendInviteEmail, sendStaffPasswordResetEmail, getPublicAppUrl } from '@/lib/email'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/staff/[id] — Get single staff member with roles
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    const staffRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        s."id", s."firstName", s."lastName", s."email", s."phone", s."role"::text, s."department"::text,
        s."title", s."avatar", s."active", s."hireDate",
        s."hourlyRate", s."salary", s."payType"::text AS "payType",
        s."employmentType"::text AS "employmentType", s."employeeId",
        s."managerId", m."firstName" || ' ' || m."lastName" AS "managerName",
        s."createdAt", s."updatedAt"
      FROM "Staff" s
      LEFT JOIN "Staff" m ON s."managerId" = m.id
      WHERE s."id" = $1`,
      id
    )

    if (staffRows.length === 0) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
    }

    const staff = staffRows[0]

    let assignedJobs: any[] = []
    try {
      assignedJobs = await prisma.$queryRawUnsafe(
        `SELECT "id", "jobNumber", "status"::text, "builderName", "jobAddress", "createdAt"
         FROM "Job" WHERE "assignedPMId" = $1`, id
      )
    } catch (e: any) {
      console.warn('[Staff GET] Failed to fetch assignedJobs:', e?.message || e)
    }

    let tasks: any[] = []
    try {
      tasks = await prisma.$queryRawUnsafe(
        `SELECT "id", "title", "status"::text, "priority"::text, "dueDate", "createdAt"
         FROM "Task" WHERE "assignedToId" = $1 ORDER BY "createdAt" DESC LIMIT 10`, id
      )
    } catch (e: any) {
      console.warn('[Staff GET] Failed to fetch tasks:', e?.message || e)
    }

    let activities: any[] = []
    try {
      activities = await prisma.$queryRawUnsafe(
        `SELECT "id", "type", "description", "createdAt"
         FROM "Activity" WHERE "staffId" = $1 ORDER BY "createdAt" DESC LIMIT 10`, id
      )
    } catch (e: any) {
      console.warn('[Staff GET] Failed to fetch activities:', e?.message || e)
    }

    let roles: string[] = [staff.role]
    try {
      const roleRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "role"::text FROM "StaffRoles" WHERE "staffId" = $1 ORDER BY "assignedAt"`, id
      )
      if (roleRows.length > 0) roles = roleRows.map((r: any) => r.role)
    } catch (e: any) {
      console.warn('[Staff GET] Failed to fetch StaffRoles:', e?.message || e)
    }

    return NextResponse.json({
      staff: { ...staff, assignedJobs, tasks, activities, roles },
    })
  } catch (error) {
    console.error('Failed to fetch staff member:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/staff/[id] — Update staff member
// ──────────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // R7 — explicit role check: only ADMIN/MANAGER mutate Staff records.
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    // Audit log
    audit(request, 'UPDATE', 'Staff', undefined, { method: 'PATCH' }).catch(() => {})

    const { id } = params
    const body = await request.json()

    const {
      firstName, lastName, email, phone, role,
      roles, department, title, avatar, active, hireDate,
      portalOverrides, managerId, salary, hourlyRate, payType, employmentType, employeeId,
    } = body

    // Build update data
    const updateData: Record<string, any> = {}
    if (firstName !== undefined) updateData.firstName = firstName
    if (lastName !== undefined) updateData.lastName = lastName
    if (email !== undefined) updateData.email = email
    if (phone !== undefined) updateData.phone = phone
    if (department !== undefined) updateData.department = department
    if (title !== undefined) updateData.title = title
    if (avatar !== undefined) updateData.avatar = avatar
    if (active !== undefined) updateData.active = active
    if (hireDate !== undefined) updateData.hireDate = hireDate ? new Date(hireDate) : null
    if (managerId !== undefined) updateData.managerId = managerId || null
    if (salary !== undefined) updateData.salary = salary
    if (hourlyRate !== undefined) updateData.hourlyRate = hourlyRate
    if (payType !== undefined) updateData.payType = payType
    if (employmentType !== undefined) updateData.employmentType = employmentType
    if (employeeId !== undefined) updateData.employeeId = employeeId

    // Handle roles
    const allRoles: string[] | null = roles && Array.isArray(roles) && roles.length > 0 ? roles : null
    if (allRoles) {
      updateData.role = allRoles[0]
    } else if (role !== undefined) {
      updateData.role = role
    }

    // Validate role
    const validRoles = [
      'ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP',
      'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER',
      'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER',
    ]
    if (updateData.role && !validRoles.includes(updateData.role)) {
      return NextResponse.json({ error: `Invalid role` }, { status: 400 })
    }
    if (allRoles) {
      for (const r of allRoles) {
        if (!validRoles.includes(r)) {
          return NextResponse.json({ error: `Invalid role: ${r}` }, { status: 400 })
        }
      }
    }

    // Validate department
    if (updateData.department) {
      const validDepartments = [
        'EXECUTIVE', 'SALES', 'BUSINESS_DEVELOPMENT', 'ESTIMATING', 'PROJECT_MANAGEMENT',
        'OPERATIONS', 'MANUFACTURING', 'PRODUCTION', 'WAREHOUSE', 'LOGISTICS',
        'DELIVERY', 'INSTALLATION', 'ACCOUNTING', 'PURCHASING',
      ]
      if (!validDepartments.includes(updateData.department)) {
        return NextResponse.json({ error: `Invalid department` }, { status: 400 })
      }
    }

    // Validate payType
    if (updateData.payType && !['SALARY', 'HOURLY'].includes(updateData.payType)) {
      return NextResponse.json({ error: 'Invalid payType' }, { status: 400 })
    }

    // Validate employmentType
    if (updateData.employmentType && !['FULL_TIME_EXEMPT', 'FULL_TIME_NON_EXEMPT', 'PART_TIME', 'CONTRACT'].includes(updateData.employmentType)) {
      return NextResponse.json({ error: 'Invalid employmentType' }, { status: 400 })
    }

    // Build dynamic SET clause
    const setClauses: string[] = []
    const sqlParams: any[] = [id]
    let paramIndex = 2

    if (updateData.firstName !== undefined) {
      setClauses.push(`"firstName" = $${paramIndex}`)
      sqlParams.push(updateData.firstName)
      paramIndex++
    }
    if (updateData.lastName !== undefined) {
      setClauses.push(`"lastName" = $${paramIndex}`)
      sqlParams.push(updateData.lastName)
      paramIndex++
    }
    if (updateData.email !== undefined) {
      setClauses.push(`"email" = $${paramIndex}`)
      sqlParams.push(updateData.email)
      paramIndex++
    }
    if (updateData.phone !== undefined) {
      setClauses.push(`"phone" = $${paramIndex}`)
      sqlParams.push(updateData.phone)
      paramIndex++
    }
    if (updateData.role !== undefined) {
      setClauses.push(`"role" = $${paramIndex}::"StaffRole"`)
      sqlParams.push(updateData.role)
      paramIndex++
    }
    if (updateData.department !== undefined) {
      setClauses.push(`"department" = $${paramIndex}::"Department"`)
      sqlParams.push(updateData.department)
      paramIndex++
    }
    if (updateData.title !== undefined) {
      setClauses.push(`"title" = $${paramIndex}`)
      sqlParams.push(updateData.title)
      paramIndex++
    }
    if (updateData.avatar !== undefined) {
      setClauses.push(`"avatar" = $${paramIndex}`)
      sqlParams.push(updateData.avatar)
      paramIndex++
    }
    if (updateData.active !== undefined) {
      setClauses.push(`"active" = $${paramIndex}`)
      sqlParams.push(updateData.active)
      paramIndex++
    }
    if (updateData.hireDate !== undefined) {
      setClauses.push(`"hireDate" = $${paramIndex}::timestamptz`)
      sqlParams.push(updateData.hireDate)
      paramIndex++
    }

    if (updateData.managerId !== undefined) {
      setClauses.push(`"managerId" = $${paramIndex}`)
      sqlParams.push(updateData.managerId)
      paramIndex++
    }
    if (updateData.salary !== undefined) {
      setClauses.push(`"salary" = $${paramIndex}`)
      sqlParams.push(updateData.salary)
      paramIndex++
    }
    if (updateData.hourlyRate !== undefined) {
      setClauses.push(`"hourlyRate" = $${paramIndex}`)
      sqlParams.push(updateData.hourlyRate)
      paramIndex++
    }
    if (updateData.payType !== undefined) {
      setClauses.push(`"payType" = $${paramIndex}::"PayType"`)
      sqlParams.push(updateData.payType)
      paramIndex++
    }
    if (updateData.employmentType !== undefined) {
      setClauses.push(`"employmentType" = $${paramIndex}::"EmploymentType"`)
      sqlParams.push(updateData.employmentType)
      paramIndex++
    }
    if (updateData.employeeId !== undefined) {
      setClauses.push(`"employeeId" = $${paramIndex}`)
      sqlParams.push(updateData.employeeId)
      paramIndex++
    }

    if (portalOverrides !== undefined) {
      setClauses.push(`"portalOverrides" = $${paramIndex}::jsonb`)
      sqlParams.push(JSON.stringify(portalOverrides))
      paramIndex++
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    setClauses.push('"updatedAt" = NOW()')

    const updateSql = `
      UPDATE "Staff"
      SET ${setClauses.join(', ')}
      WHERE "id" = $1
      RETURNING
        "id", "firstName", "lastName", "email", "phone", "role"::text, "department"::text,
        "title", "avatar", "active", "hireDate", "hourlyRate", "salary",
        "payType"::text, "employmentType"::text, "employeeId", "managerId",
        "portalOverrides", "createdAt", "updatedAt"
    `

    const updatedRows: any[] = await prisma.$queryRawUnsafe(updateSql, ...sqlParams)

    if (updatedRows.length === 0) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
    }

    const updatedStaff = updatedRows[0]

    // Sync StaffRoles if roles array was provided
    if (allRoles) {
      try {
        await prisma.$executeRawUnsafe(`DELETE FROM "StaffRoles" WHERE "staffId" = $1`, id)
        for (const r of allRoles) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "StaffRoles" ("id", "staffId", "role", "assignedAt")
             VALUES (gen_random_uuid()::text, $1, $2::"StaffRole", NOW())
             ON CONFLICT ("staffId", "role") DO NOTHING`,
            id, r
          )
        }
      } catch (e) {
        console.warn('Failed to sync StaffRoles:', e)
      }
    }

    // Fetch final roles
    let finalRoles: string[] = [updatedStaff.role]
    try {
      const roleRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "role"::text FROM "StaffRoles" WHERE "staffId" = $1 ORDER BY "assignedAt"`, id
      )
      if (roleRows.length > 0) finalRoles = roleRows.map((r: any) => r.role)
    } catch (e: any) {
      console.warn('[Staff PATCH] Failed to fetch final StaffRoles:', e?.message || e)
    }

    // Audit logging (non-blocking). staffName is not a column on AuditLog —
    // stash it inside details so the name is preserved without breaking the insert.
    try {
      const rawStaffId = request.headers.get('x-staff-id') || ''
      const staffIdForDb = !rawStaffId || rawStaffId === 'unknown' ? null : rawStaffId
      const staffName = (
        (request.headers.get('x-staff-firstname') || '') +
        ' ' +
        (request.headers.get('x-staff-lastname') || '')
      ).trim() || null
      const auditDetails = staffName ? { ...updateData, staffName } : updateData
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AuditLog" ("id", "staffId", "action", "entity", "entityId", "details", "severity", "createdAt")
         VALUES (gen_random_uuid()::text, $1, 'UPDATE', 'Staff', $2, $3::jsonb, 'INFO', NOW())`,
        staffIdForDb,
        id,
        JSON.stringify(auditDetails)
      )
    } catch (e) {
      // Audit failure is non-blocking
      console.warn('[Staff PATCH] AuditLog insert failed:', (e as any)?.message || e)
    }

    return NextResponse.json({
      staff: { ...updatedStaff, roles: finalRoles },
    })
  } catch (error: any) {
    console.error('Failed to update staff member:', error)

    if (error.code === '23505' && error.message?.includes('email')) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Internal server error'},
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/staff/[id] — Resend invite or reset password
// ──────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // R7 — explicit role check: only ADMIN/MANAGER may resend invites or reset.
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    // Audit log
    audit(request, 'CREATE', 'Staff', undefined, { method: 'POST' }).catch(() => {})

    const { id } = params
    const body = await request.json()
    const { action } = body

    // Verify staff exists
    const staffRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "firstName", "lastName", email, role::text FROM "Staff" WHERE id = $1`,
      id
    )

    if (staffRows.length === 0) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
    }

    const member = staffRows[0]

    if (action === 'resend-invite') {
      // Generate a new invite token (7-day expiry)
      const inviteToken = randomUUID()
      const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET
          "inviteToken" = $1,
          "inviteTokenExpiry" = $2,
          "updatedAt" = NOW()
        WHERE id = $3`,
        inviteToken,
        inviteTokenExpiry,
        id
      )

      const inviteUrl = `${getPublicAppUrl()}/ops/setup-account?token=${inviteToken}`

      // Send email (non-blocking)
      try {
        await sendInviteEmail({
          to: member.email,
          firstName: member.firstName,
          inviteUrl,
        })
      } catch (emailErr) {
        console.warn('Failed to send invite email:', emailErr)
      }

      return NextResponse.json({
        success: true,
        data: { inviteUrl, inviteToken, inviteTokenExpiry },
      })
    }

    if (action === 'reset-password') {
      const resetToken = randomUUID()
      const resetTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET
          "resetToken" = $1,
          "resetTokenExpiry" = $2,
          "updatedAt" = NOW()
        WHERE id = $3`,
        resetToken,
        resetTokenExpiry,
        id
      )

      const resetUrl = `${getPublicAppUrl()}/ops/reset-password?token=${resetToken}`

      // Send email (non-blocking)
      try {
        await sendStaffPasswordResetEmail({
          to: member.email,
          firstName: member.firstName,
          resetUrl,
        })
      } catch (emailErr) {
        console.warn('Failed to send reset email:', emailErr)
      }

      return NextResponse.json({
        success: true,
        data: { resetUrl },
      })
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "resend-invite" or "reset-password".' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('Staff action error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
