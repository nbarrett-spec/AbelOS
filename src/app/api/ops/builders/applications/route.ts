export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { createNotification } from '@/lib/notifications'
import bcrypt from 'bcryptjs'
import { sendApplicationApprovedEmail } from '@/lib/email'

// GET /api/ops/builders/applications — List pending applications (staff only)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || 'PENDING_APPROVAL'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit

    // Build WHERE clause
    let whereClause = ''
    const params: any[] = []
    let paramIndex = 1

    if (status !== 'all') {
      whereClause = `WHERE "status" = $${paramIndex}`
      params.push(status)
      paramIndex++
    }

    // Get total count
    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "BuilderApplication" ${whereClause}`,
      ...params
    ) as Array<{ count: number }>

    const total = parseInt(String(countResult[0]?.count || 0))

    // Get applications
    const applications = await prisma.$queryRawUnsafe(
      `SELECT "id", "referenceNumber", "companyName", "contactName", "contactEmail", "contactPhone", "status", "createdAt", "updatedAt"
       FROM "BuilderApplication"
       ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      ...params,
      limit,
      offset
    )

    return NextResponse.json({
      applications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('GET /api/ops/builders/applications error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
      { status: 500 }
    )
  }
}

// PATCH /api/ops/builders/applications — Approve or reject application (staff only)
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get staff ID from header
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json(
        { error: 'Unauthorized: staff ID required' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { applicationId, action, reviewNotes } = body

    if (!applicationId || !action) {
      return NextResponse.json(
        { error: 'Application ID and action are required' },
        { status: 400 }
      )
    }

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be APPROVE or REJECT' },
        { status: 400 }
      )
    }

    // Get application
    const application = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BuilderApplication" WHERE "id" = $1`,
      applicationId
    ) as Array<any>

    if (!application || application.length === 0) {
      return NextResponse.json(
        { error: 'Application not found' },
        { status: 404 }
      )
    }

    const app = application[0]
    const builderId = app.builderId

    if (action === 'APPROVE') {
      // Generate temporary password
      const tempPassword = 'AbelBuilder2026!'

      // Hash password using bcrypt
      const passwordHash = await bcrypt.hash(tempPassword, 12)

      // Update Builder account status to ACTIVE and set password
      await prisma.$executeRawUnsafe(
        `UPDATE "Builder" SET "status" = $1, "passwordHash" = $2, "emailVerified" = true, "updatedAt" = NOW()
         WHERE "id" = $3`,
        'ACTIVE',
        passwordHash,
        builderId
      )

      // Update application status
      await prisma.$executeRawUnsafe(
        `UPDATE "BuilderApplication" SET "status" = $1, "reviewNotes" = $2, "reviewedBy" = $3, "reviewedAt" = NOW(), "updatedAt" = NOW()
         WHERE "id" = $4`,
        'APPROVED',
        reviewNotes || null,
        staffId,
        applicationId
      )

      // Create audit log
      const auditId = 'aud' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AuditLog" ("id", "staffId", "action", "entity", "entityId", "details", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        auditId,
        staffId,
        'BUILDER_APPROVED',
        'BuilderApplication',
        applicationId,
        JSON.stringify({ companyName: app.companyName, contactEmail: app.contactEmail })
      )

      // Queue welcome email notification for staff
      await createNotification({
        staffId: staffId,
        type: 'SYSTEM',
        title: 'Builder Approved',
        message: `${app.companyName} has been approved. Temp password: ${tempPassword}`,
        link: `/ops/builders/${builderId}`
      })

      // Send welcome email to the builder with credentials
      try {
        await sendApplicationApprovedEmail({
          to: app.contactEmail,
          contactName: app.contactName,
          companyName: app.companyName,
          tempPassword,
        })
      } catch (emailErr: any) {
        console.warn('[Builder Approve] Failed to send approval email:', emailErr?.message)
      }

      return NextResponse.json({
        success: true,
        message: 'Application approved',
        application: {
          id: applicationId,
          status: 'APPROVED',
          tempPassword: tempPassword
        }
      })
    } else {
      // REJECT action
      // Update Builder account status to CLOSED (or we could use SUSPENDED)
      await prisma.$executeRawUnsafe(
        `UPDATE "Builder" SET "status" = $1, "updatedAt" = NOW()
         WHERE "id" = $2`,
        'SUSPENDED',
        builderId
      )

      // Update application status
      await prisma.$executeRawUnsafe(
        `UPDATE "BuilderApplication" SET "status" = $1, "reviewNotes" = $2, "reviewedBy" = $3, "reviewedAt" = NOW(), "updatedAt" = NOW()
         WHERE "id" = $4`,
        'REJECTED',
        reviewNotes || null,
        staffId,
        applicationId
      )

      // Create audit log
      const auditId = 'aud' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AuditLog" ("id", "staffId", "action", "entity", "entityId", "details", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        auditId,
        staffId,
        'BUILDER_REJECTED',
        'BuilderApplication',
        applicationId,
        JSON.stringify({ companyName: app.companyName, contactEmail: app.contactEmail, reason: reviewNotes })
      )

      // Queue rejection email notification
      await createNotification({
        staffId: staffId,
        type: 'SYSTEM',
        title: 'Builder Rejected',
        message: `${app.companyName} application has been rejected`,
        link: `/ops/builders/applications/${applicationId}`
      })

      return NextResponse.json({
        success: true,
        message: 'Application rejected',
        application: {
          id: applicationId,
          status: 'REJECTED'
        }
      })
    }
  } catch (error) {
    console.error('PATCH /api/ops/builders/applications error:', error)
    return NextResponse.json(
      { error: 'Failed to process application' },
      { status: 500 }
    )
  }
}
