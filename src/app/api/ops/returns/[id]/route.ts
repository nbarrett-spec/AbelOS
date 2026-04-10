export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/returns/[id]
 * Get full return details with items and vendor/PO information
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const returnId = params.id

    // Get return details with vendor and PO info
    const returnQuery = `
      SELECT
        vr."id",
        vr."returnNumber",
        vr."purchaseOrderId",
        vr."vendorId",
        vr."status",
        vr."reason",
        vr."returnType",
        vr."totalAmount",
        vr."creditReceived",
        vr."trackingNumber",
        vr."rmaNumber",
        vr."createdById",
        vr."approvedById",
        vr."shippedAt",
        vr."resolvedAt",
        vr."notes",
        vr."createdAt",
        vr."updatedAt",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code",
          'contactName', v."contactName",
          'email', v."email",
          'phone', v."phone"
        ) as "vendor",
        json_build_object(
          'id', po."id",
          'poNumber', po."poNumber",
          'status', po."status"
        ) as "purchaseOrder",
        json_build_object(
          'id', createdBy."id",
          'firstName', createdBy."firstName",
          'lastName', createdBy."lastName",
          'email', createdBy."email"
        ) as "createdBy",
        json_build_object(
          'id', approvedBy."id",
          'firstName', approvedBy."firstName",
          'lastName', approvedBy."lastName",
          'email', approvedBy."email"
        ) as "approvedBy"
      FROM "VendorReturn" vr
      LEFT JOIN "Vendor" v ON vr."vendorId" = v."id"
      LEFT JOIN "PurchaseOrder" po ON vr."purchaseOrderId" = po."id"
      LEFT JOIN "Staff" createdBy ON vr."createdById" = createdBy."id"
      LEFT JOIN "Staff" approvedBy ON vr."approvedById" = approvedBy."id"
      WHERE vr."id" = $1
    `

    // Get return items
    const itemsQuery = `
      SELECT
        vri."id",
        vri."vendorReturnId",
        vri."purchaseOrderItemId",
        vri."productId",
        vri."description",
        vri."quantity",
        vri."unitCost",
        vri."lineTotal",
        vri."reason",
        vri."condition"
      FROM "VendorReturnItem" vri
      WHERE vri."vendorReturnId" = $1
      ORDER BY vri."createdAt" ASC
    `

    const [returns, items] = await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(returnQuery, returnId),
      prisma.$queryRawUnsafe<Array<any>>(itemsQuery, returnId),
    ])

    if (!returns || returns.length === 0) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    const vendorReturn = returns[0]

    return NextResponse.json({
      ...vendorReturn,
      items,
    })
  } catch (error) {
    console.error('Failed to fetch return:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/ops/returns/[id]
 * Update return status, tracking, RMA number, or credit received
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const returnId = params.id
    const body = await request.json()
    const {
      status,
      trackingNumber,
      rmaNumber,
      creditReceived,
      approvedById,
      shippedAt,
      resolvedAt,
      notes,
    } = body

    // Get staff ID from headers for audit trail
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Staff ID required' }, { status: 400 })
    }

    // Get current return to check status transitions and get vendor info
    const currentQuery = `
      SELECT "id", "vendorId", "totalAmount", "status", "creditReceived"
      FROM "VendorReturn"
      WHERE "id" = $1
    `
    const [currentReturn] = await prisma.$queryRawUnsafe<Array<any>>(currentQuery, returnId)

    if (!currentReturn) {
      return NextResponse.json({ error: 'Return not found' }, { status: 404 })
    }

    // Build update query dynamically
    const updateFields: string[] = []
    const updateValues: any[] = []
    let paramIndex = 1

    if (status !== undefined) {
      updateFields.push(`"status" = $${paramIndex}`)
      updateValues.push(status)
      paramIndex++
    }

    if (trackingNumber !== undefined) {
      updateFields.push(`"trackingNumber" = $${paramIndex}`)
      updateValues.push(trackingNumber)
      paramIndex++
    }

    if (rmaNumber !== undefined) {
      updateFields.push(`"rmaNumber" = $${paramIndex}`)
      updateValues.push(rmaNumber)
      paramIndex++
    }

    if (creditReceived !== undefined) {
      updateFields.push(`"creditReceived" = $${paramIndex}`)
      updateValues.push(creditReceived)
      paramIndex++
    }

    if (approvedById !== undefined) {
      updateFields.push(`"approvedById" = $${paramIndex}`)
      updateValues.push(approvedById)
      paramIndex++
    }

    if (shippedAt !== undefined) {
      updateFields.push(`"shippedAt" = $${paramIndex}`)
      updateValues.push(shippedAt)
      paramIndex++
    }

    if (resolvedAt !== undefined) {
      updateFields.push(`"resolvedAt" = $${paramIndex}`)
      updateValues.push(resolvedAt)
      paramIndex++
    }

    if (notes !== undefined) {
      updateFields.push(`"notes" = $${paramIndex}`)
      updateValues.push(notes)
      paramIndex++
    }

    // Always update updatedAt
    updateFields.push(`"updatedAt" = NOW()`)

    if (updateFields.length === 1) {
      // Only updatedAt, nothing to update
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    updateValues.push(returnId)

    const updateQuery = `
      UPDATE "VendorReturn"
      SET ${updateFields.join(', ')}
      WHERE "id" = $${paramIndex}
      RETURNING *
    `

    const [updatedReturn] = await prisma.$queryRawUnsafe<Array<any>>(updateQuery, ...updateValues)

    // Handle vendor credit when status changes to CREDIT_ISSUED
    if (status === 'CREDIT_ISSUED' && currentReturn.status !== 'CREDIT_ISSUED') {
      // Get vendor's current creditUsed
      const vendorQuery = `
        SELECT "creditUsed" FROM "Vendor" WHERE "id" = $1
      `
      const [vendorResult] = await prisma.$queryRawUnsafe<Array<{ creditUsed: number | null }>>(
        vendorQuery,
        currentReturn.vendorId
      )

      // Update vendor creditUsed (reduce/apply the credit)
      const currentCredit = vendorResult?.creditUsed || 0
      const newCredit = currentCredit - (creditReceived || currentReturn.totalAmount)

      const updateVendorQuery = `
        UPDATE "Vendor"
        SET "creditUsed" = $1, "updatedAt" = NOW()
        WHERE "id" = $2
      `
      await prisma.$queryRawUnsafe(updateVendorQuery, newCredit, currentReturn.vendorId)
    }

    return NextResponse.json({
      ...updatedReturn,
      message: 'Return updated successfully',
    })
  } catch (error) {
    console.error('Failed to update return:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
