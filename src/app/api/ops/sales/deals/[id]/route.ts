export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notifications'
import { logAudit, audit } from '@/lib/audit'
import { executeWorkflows } from '@/lib/workflows'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/deals/[id] — Single deal with activities, contracts, documents
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const dealId = params.id

    // Fetch deal
    const dealResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName", s."email" AS "ownerEmail"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."id" = $1`,
      dealId
    )

    if (!dealResult.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const deal = dealResult[0]
    deal.owner = {
      id: deal.ownerId,
      firstName: deal.firstName,
      lastName: deal.lastName,
      email: deal.ownerEmail,
    }

    // Fetch activities
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
      staff: { id: a.staffId, firstName: a.firstName, lastName: a.lastName },
    }))

    // Fetch contracts
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

    // Fetch document requests
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
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/ops/sales/deals/[id] — Update deal
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const dealId = params.id
    const body = await request.json()
    const { companyName, contactName, contactEmail, contactPhone, address, city, state, zip, stage, probability, dealValue, source, expectedCloseDate, actualCloseDate, lostReason, ownerId, lostDate, description } = body

    audit(request, 'UPDATE', 'Deal', dealId, { method: 'PUT' }).catch(() => {})

    // Check if deal exists
    const existingDeal: any[] = await prisma.$queryRawUnsafe(`SELECT "id", "stage" FROM "Deal" WHERE "id" = $1`, dealId)
    if (!existingDeal.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    const previousStage = existingDeal[0].stage
    const newStage = stage || previousStage

    // Build update query
    const updates: string[] = []
    const updateParams: any[] = []
    let paramIdx = 1

    if (companyName !== undefined) {
      updates.push(`"companyName" = $${paramIdx}`)
      updateParams.push(companyName)
      paramIdx++
    }
    if (contactName !== undefined) {
      updates.push(`"contactName" = $${paramIdx}`)
      updateParams.push(contactName)
      paramIdx++
    }
    if (contactEmail !== undefined) {
      updates.push(`"contactEmail" = $${paramIdx}`)
      updateParams.push(contactEmail)
      paramIdx++
    }
    if (contactPhone !== undefined) {
      updates.push(`"contactPhone" = $${paramIdx}`)
      updateParams.push(contactPhone)
      paramIdx++
    }
    if (address !== undefined) {
      updates.push(`"address" = $${paramIdx}`)
      updateParams.push(address)
      paramIdx++
    }
    if (city !== undefined) {
      updates.push(`"city" = $${paramIdx}`)
      updateParams.push(city)
      paramIdx++
    }
    if (state !== undefined) {
      updates.push(`"state" = $${paramIdx}`)
      updateParams.push(state)
      paramIdx++
    }
    if (zip !== undefined) {
      updates.push(`"zip" = $${paramIdx}`)
      updateParams.push(zip)
      paramIdx++
    }
    if (stage !== undefined) {
      updates.push(`"stage" = $${paramIdx}::"DealStage"`)
      updateParams.push(stage)
      paramIdx++
    }
    if (probability !== undefined) {
      updates.push(`"probability" = $${paramIdx}`)
      updateParams.push(probability)
      paramIdx++
    }
    if (dealValue !== undefined) {
      updates.push(`"dealValue" = $${paramIdx}`)
      updateParams.push(dealValue)
      paramIdx++
    }
    if (source !== undefined) {
      updates.push(`"source" = $${paramIdx}::"DealSource"`)
      updateParams.push(source)
      paramIdx++
    }
    if (expectedCloseDate !== undefined) {
      updates.push(`"expectedCloseDate" = $${paramIdx}`)
      updateParams.push(expectedCloseDate ? new Date(expectedCloseDate) : null)
      paramIdx++
    }
    if (actualCloseDate !== undefined) {
      updates.push(`"actualCloseDate" = $${paramIdx}`)
      updateParams.push(actualCloseDate ? new Date(actualCloseDate) : null)
      paramIdx++
    }
    if (lostReason !== undefined) {
      updates.push(`"lostReason" = $${paramIdx}`)
      updateParams.push(lostReason)
      paramIdx++
    }
    if (ownerId !== undefined) {
      updates.push(`"ownerId" = $${paramIdx}`)
      updateParams.push(ownerId)
      paramIdx++
    }
    if (lostDate !== undefined) {
      updates.push(`"lostDate" = $${paramIdx}`)
      updateParams.push(lostDate ? new Date(lostDate) : null)
      paramIdx++
    }
    if (description !== undefined) {
      updates.push(`"description" = $${paramIdx}`)
      updateParams.push(description)
      paramIdx++
    }

    updates.push(`"updatedAt" = NOW()`)

    // Perform update
    const updateQuery = `UPDATE "Deal" SET ${updates.join(', ')} WHERE "id" = $${paramIdx} RETURNING *`
    updateParams.push(dealId)

    const updatedDeal: any[] = await prisma.$queryRawUnsafe(updateQuery, ...updateParams)

    // If stage changed, create DealActivity record and notification
    if (newStage !== previousStage) {
      const stageActId = 'act' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$queryRawUnsafe(
        `INSERT INTO "DealActivity" ("id", "dealId", "staffId", "type", "subject", "notes", "createdAt")
         VALUES ($1, $2, $3, 'STAGE_CHANGE'::"DealActivityType", $4, $5, NOW())`,
        stageActId,
        dealId,
        staffId,
        `Deal moved from ${previousStage} to ${newStage}`,
        `Previous stage: ${previousStage}`
      )

      // Create notification for deal owner
      const dealOwnerResult: any[] = await prisma.$queryRawUnsafe(`SELECT "ownerId" FROM "Deal" WHERE "id" = $1`, dealId)
      if (dealOwnerResult.length > 0 && dealOwnerResult[0].ownerId) {
        await createNotification({
          staffId: dealOwnerResult[0].ownerId,
          type: 'STAGE_CHANGE',
          title: `Deal stage updated to ${newStage}`,
          message: `${updatedDeal[0].companyName} moved to ${newStage}`,
          link: `/ops/sales/${dealId}`,
        })
      }
    }

    // Audit log (fire-and-forget)
    logAudit({
      staffId,
      action: newStage !== previousStage ? 'STAGE_CHANGE' : 'UPDATE',
      entity: 'Deal',
      entityId: dealId,
      details: { changes: body, previousStage, newStage: newStage || previousStage },
    }).catch(() => {})

    // Trigger workflows on stage change
    if (newStage !== previousStage) {
      const event = newStage === 'WON' ? 'DEAL_WON' : newStage === 'LOST' ? 'DEAL_LOST' : 'DEAL_STAGE_CHANGE'
      executeWorkflows(event, {
        dealId,
        staffId,
        oldStage: previousStage,
        newStage,
        dealData: updatedDeal[0],
      }).catch(() => {})
    }

    // Fetch with owner info
    const enrichedDeal: any[] = await prisma.$queryRawUnsafe(
      `SELECT d.*, s."firstName", s."lastName", s."email" AS "ownerEmail"
       FROM "Deal" d
       LEFT JOIN "Staff" s ON s."id" = d."ownerId"
       WHERE d."id" = $1`,
      dealId
    )

    const deal = enrichedDeal[0]
    deal.owner = {
      id: deal.ownerId,
      firstName: deal.firstName,
      lastName: deal.lastName,
      email: deal.ownerEmail,
    }

    return NextResponse.json(deal)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/ops/sales/deals/[id] — Soft-delete deal
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const dealId = params.id

    audit(request, 'DELETE', 'Deal', dealId, { method: 'DELETE' }).catch(() => {})

    // Check if deal exists
    const existingDeal: any[] = await prisma.$queryRawUnsafe(`SELECT "id" FROM "Deal" WHERE "id" = $1`, dealId)
    if (!existingDeal.length) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
    }

    // Soft delete by clearing associations and archiving
    await prisma.$queryRawUnsafe(
      `UPDATE "Deal" SET "ownerId" = NULL, "stage" = 'LOST'::"DealStage", "lostDate" = NOW(), "lostReason" = 'Archived' WHERE "id" = $1`,
      dealId
    )

    return NextResponse.json({ message: 'Deal archived' })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
