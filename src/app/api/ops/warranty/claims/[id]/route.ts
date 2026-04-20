export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, audit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { sendWarrantyUpdateEmail } from '@/lib/email'
import { checkStaffAuth } from '@/lib/api-auth'

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['UNDER_REVIEW', 'DENIED', 'CLOSED'],
  UNDER_REVIEW: ['INSPECTION_SCHEDULED', 'APPROVED', 'DENIED', 'CLOSED'],
  INSPECTION_SCHEDULED: ['UNDER_REVIEW', 'APPROVED', 'DENIED'],
  APPROVED: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  DENIED: ['UNDER_REVIEW', 'CLOSED'],
  CLOSED: [],
}

// GET /api/ops/warranty/claims/[id] — Get single claim with inspections
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const claims = await prisma.$queryRawUnsafe(
      `SELECT wc.*,
              s."firstName" || ' ' || s."lastName" as "assignedToName",
              sb."firstName" || ' ' || sb."lastName" as "submittedByName",
              rs."firstName" || ' ' || rs."lastName" as "resolvedByName",
              wp."name" as "policyName",
              wp."durationMonths" as "policyDuration"
       FROM "WarrantyClaim" wc
       LEFT JOIN "Staff" s ON wc."assignedTo" = s."id"
       LEFT JOIN "Staff" sb ON wc."submittedById" = sb."id"
       LEFT JOIN "Staff" rs ON wc."resolvedById" = rs."id"
       LEFT JOIN "WarrantyPolicy" wp ON wc."policyId" = wp."id"
       WHERE wc."id" = $1`,
      params.id
    ) as any[]

    if (!claims || claims.length === 0) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    }

    // Get inspections for this claim
    const inspections = await prisma.$queryRawUnsafe(
      `SELECT wi.*,
              s."firstName" || ' ' || s."lastName" as "inspectorName"
       FROM "WarrantyInspection" wi
       LEFT JOIN "Staff" s ON wi."inspectorId" = s."id"
       WHERE wi."claimId" = $1
       ORDER BY wi."scheduledDate" DESC`,
      params.id
    )

    return NextResponse.json({ claim: claims[0], inspections })
  } catch (error: any) {
    console.error('GET /api/ops/warranty/claims/[id] error:', error)
    return NextResponse.json({ error: 'Failed to fetch claim' }, { status: 500 })
  }
}

// PATCH /api/ops/warranty/claims/[id] — Update claim (status transition, assign, resolve)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { status: newStatus, assignedTo, priority, resolutionType, resolutionNotes, resolutionCost, creditAmount, replacementOrderId, internalNotes } = body

    audit(request, 'UPDATE', 'WarrantyClaim', params.id, { method: 'PATCH' }).catch(() => {})

    // Get current claim
    const currentClaim = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WarrantyClaim" WHERE "id" = $1`,
      params.id
    ) as any[]

    if (!currentClaim || currentClaim.length === 0) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    }

    const claim = currentClaim[0]
    const setClauses: string[] = ['"updatedAt" = NOW()']
    const sqlParams: any[] = []
    let idx = 1

    // Status transition validation
    if (newStatus && newStatus !== claim.status) {
      const allowed = VALID_TRANSITIONS[claim.status] || []
      if (!allowed.includes(newStatus)) {
        return NextResponse.json({
          error: `Cannot transition from ${claim.status} to ${newStatus}. Allowed: ${allowed.join(', ')}`
        }, { status: 400 })
      }
      setClauses.push(`"status" = $${idx}`)
      sqlParams.push(newStatus)
      idx++

      // Handle resolution fields when resolving
      if (newStatus === 'RESOLVED') {
        setClauses.push(`"resolvedAt" = NOW()`)
        setClauses.push(`"resolvedById" = $${idx}`)
        sqlParams.push(staffId)
        idx++
      }
    }

    // Assignee
    if (assignedTo !== undefined) {
      setClauses.push(`"assignedTo" = $${idx}`)
      sqlParams.push(assignedTo || null)
      idx++
    }

    // Priority
    if (priority) {
      setClauses.push(`"priority" = $${idx}`)
      sqlParams.push(priority)
      idx++
    }

    // Resolution details
    if (resolutionType !== undefined) {
      setClauses.push(`"resolutionType" = $${idx}`)
      sqlParams.push(resolutionType)
      idx++
    }
    if (resolutionNotes !== undefined) {
      setClauses.push(`"resolutionNotes" = $${idx}`)
      sqlParams.push(resolutionNotes)
      idx++
    }
    if (resolutionCost !== undefined) {
      setClauses.push(`"resolutionCost" = $${idx}`)
      sqlParams.push(resolutionCost)
      idx++
    }
    if (creditAmount !== undefined) {
      setClauses.push(`"creditAmount" = $${idx}`)
      sqlParams.push(creditAmount)
      idx++
    }
    if (replacementOrderId !== undefined) {
      setClauses.push(`"replacementOrderId" = $${idx}`)
      sqlParams.push(replacementOrderId)
      idx++
    }
    if (internalNotes !== undefined) {
      setClauses.push(`"internalNotes" = $${idx}`)
      sqlParams.push(internalNotes)
      idx++
    }

    sqlParams.push(params.id)

    await prisma.$executeRawUnsafe(
      `UPDATE "WarrantyClaim" SET ${setClauses.join(', ')} WHERE "id" = $${idx}`,
      ...sqlParams
    )

    // Notifications
    if (newStatus && newStatus !== claim.status) {
      // Notify assigned staff of status change
      if (claim.assignedTo) {
        createNotification({
          staffId: claim.assignedTo,
          type: 'SYSTEM',
          title: `Warranty Claim ${newStatus.replace(/_/g, ' ')}`,
          message: `${claim.claimNumber}: ${claim.subject}`,
          link: `/ops/warranty/claims?id=${params.id}`
        }).catch(() => {})
      }

      // Email the builder about the status change
      if (claim.builderId) {
        try {
          const builders: any[] = await prisma.$queryRawUnsafe(
            `SELECT "email", "companyName", "contactName" FROM "Builder" WHERE "id" = $1`,
            claim.builderId
          ) as any[]
          if (builders.length > 0) {
            const builder = builders[0]
            const builderEmail = builder.email
            if (builderEmail) {
              sendWarrantyUpdateEmail({
                to: builderEmail,
                builderName: builder.companyName || builder.contactName || 'Builder',
                claimNumber: claim.claimNumber,
                subject: claim.subject,
                oldStatus: claim.status,
                newStatus,
                resolutionNotes: resolutionNotes || undefined,
              }).catch(() => {})
            }
          }
        } catch (e) {
          // Don't block on email failure
        }
      }
    }

    if (assignedTo && assignedTo !== claim.assignedTo) {
      createNotification({
        staffId: assignedTo,
        type: 'TASK_ASSIGNED',
        title: 'Warranty Claim Assigned to You',
        message: `${claim.claimNumber}: ${claim.subject}`,
        link: `/ops/warranty/claims?id=${params.id}`
      }).catch(() => {})
    }

    await logAudit({
      staffId,
      action: newStatus ? 'STATUS_CHANGE' : 'UPDATE',
      entity: 'WarrantyClaim',
      entityId: params.id,
      details: {
        claimNumber: claim.claimNumber,
        previousStatus: claim.status,
        newStatus: newStatus || claim.status,
        ...body
      },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('PATCH /api/ops/warranty/claims/[id] error:', error)
    return NextResponse.json({ error: 'Failed to update claim' }, { status: 500 })
  }
}
