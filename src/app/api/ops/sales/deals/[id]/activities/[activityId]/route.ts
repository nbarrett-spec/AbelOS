export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// PATCH /api/ops/sales/deals/[id]/activities/[activityId]
//
// Update an existing DealActivity. Used by the deal detail page to mark
// follow-ups done and tweak notes/outcomes after the fact. The frontend
// expects the full updated deal back (so it can re-render activities).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; activityId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id: dealId, activityId } = params

    const body = await request.json().catch(() => ({}))
    const { followUpDone, followUpDate, notes, outcome, subject, type } =
      body ?? {}

    // Verify activity exists and belongs to this deal.
    const existing: Array<{ id: string; dealId: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT "id", "dealId" FROM "DealActivity" WHERE "id" = $1`,
        activityId
      )
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Activity not found' },
        { status: 404 }
      )
    }
    if (existing[0].dealId !== dealId) {
      return NextResponse.json(
        { error: 'Activity does not belong to this deal' },
        { status: 400 }
      )
    }

    // Build the SET clause from supplied fields.
    const updates: string[] = []
    const values: any[] = []
    let idx = 1

    if (followUpDone !== undefined) {
      updates.push(`"followUpDone" = $${idx}`)
      values.push(Boolean(followUpDone))
      idx++
    }
    if (followUpDate !== undefined) {
      updates.push(`"followUpDate" = $${idx}`)
      values.push(followUpDate ? new Date(followUpDate) : null)
      idx++
    }
    if (notes !== undefined) {
      updates.push(`"notes" = $${idx}`)
      values.push(notes === null || notes === '' ? null : String(notes))
      idx++
    }
    if (outcome !== undefined) {
      updates.push(`"outcome" = $${idx}`)
      values.push(outcome === null || outcome === '' ? null : String(outcome))
      idx++
    }
    if (subject !== undefined) {
      if (typeof subject !== 'string' || !subject.trim()) {
        return NextResponse.json(
          { error: 'subject cannot be blank' },
          { status: 400 }
        )
      }
      updates.push(`"subject" = $${idx}`)
      values.push(subject.trim())
      idx++
    }
    if (type !== undefined) {
      updates.push(`"type" = $${idx}::"DealActivityType"`)
      values.push(String(type))
      idx++
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields supplied' },
        { status: 400 }
      )
    }

    values.push(activityId)
    await prisma.$executeRawUnsafe(
      `UPDATE "DealActivity" SET ${updates.join(', ')} WHERE "id" = $${idx}`,
      ...values
    )

    audit(request, 'UPDATE', 'DealActivity', activityId, {
      method: 'PATCH',
      dealId,
      fields: Object.keys(body ?? {}),
    }).catch(() => {})

    // Return the full updated deal so the frontend can re-render — mirrors
    // the GET response shape from /api/ops/sales/deals/[id].
    const dealRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName", s."email" AS "ownerEmail"
         FROM "Deal" d
    LEFT JOIN "Staff" s ON s."id" = d."ownerId"
        WHERE d."id" = $1`,
      dealId
    )
    if (dealRows.length === 0) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }
    const deal = dealRows[0]
    deal.owner = {
      id: deal.ownerId,
      firstName: deal.firstName,
      lastName: deal.lastName,
      email: deal.ownerEmail,
    }

    const activities: any[] = await prisma.$queryRawUnsafe(
      `SELECT da.*, s."firstName", s."lastName"
         FROM "DealActivity" da
    LEFT JOIN "Staff" s ON s."id" = da."staffId"
        WHERE da."dealId" = $1
     ORDER BY da."createdAt" DESC`,
      dealId
    )
    deal.activities = activities.map((a) => ({
      ...a,
      staff: {
        id: a.staffId,
        firstName: a.firstName,
        lastName: a.lastName,
      },
    }))

    const contracts: any[] = await prisma.$queryRawUnsafe(
      `SELECT c.*, cb."firstName" AS "createdByFirstName", cb."lastName" AS "createdByLastName"
         FROM "Contract" c
    LEFT JOIN "Staff" cb ON cb."id" = c."createdById"
        WHERE c."dealId" = $1`,
      dealId
    )
    deal.contracts = contracts.map((c) => ({
      ...c,
      createdBy: {
        id: c.createdById,
        firstName: c.createdByFirstName,
        lastName: c.createdByLastName,
      },
    }))

    const documents: any[] = await prisma.$queryRawUnsafe(
      `SELECT dr.*, rb."firstName" AS "requestedByFirstName", rb."lastName" AS "requestedByLastName"
         FROM "DocumentRequest" dr
    LEFT JOIN "Staff" rb ON rb."id" = dr."requestedById"
        WHERE dr."dealId" = $1`,
      dealId
    )
    deal.documentRequests = documents.map((d) => ({
      ...d,
      requestedBy: {
        id: d.requestedById,
        firstName: d.requestedByFirstName,
        lastName: d.requestedByLastName,
      },
    }))

    return NextResponse.json(deal)
  } catch (error: any) {
    console.error('[deals/activities] PATCH failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/ops/sales/deals/[id]/activities/[activityId]
//
// Hard-delete an activity. Useful for removing erroneous entries.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; activityId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id: dealId, activityId } = params

    const existing: Array<{ id: string; dealId: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT "id", "dealId" FROM "DealActivity" WHERE "id" = $1`,
        activityId
      )
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Activity not found' },
        { status: 404 }
      )
    }
    if (existing[0].dealId !== dealId) {
      return NextResponse.json(
        { error: 'Activity does not belong to this deal' },
        { status: 400 }
      )
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM "DealActivity" WHERE "id" = $1`,
      activityId
    )

    audit(request, 'DELETE', 'DealActivity', activityId, {
      method: 'DELETE',
      dealId,
    }).catch(() => {})

    return NextResponse.json({ message: 'Activity deleted' })
  } catch (error: any) {
    console.error('[deals/activities] DELETE failed:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
