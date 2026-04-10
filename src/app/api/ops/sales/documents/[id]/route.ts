export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/documents/[id] — Single document request
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const docId = params.id

    const docResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT dr.*, rb."firstName" AS "requestedByFirstName", rb."lastName" AS "requestedByLastName",
              d."companyName" AS "dealCompanyName", d."dealNumber"
       FROM "DocumentRequest" dr
       LEFT JOIN "Staff" rb ON rb."id" = dr."requestedById"
       LEFT JOIN "Deal" d ON d."id" = dr."dealId"
       WHERE dr."id" = $1`,
      docId
    )

    if (!docResult.length) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    const doc = docResult[0]
    doc.requestedBy = {
      id: doc.requestedById,
      firstName: doc.requestedByFirstName,
      lastName: doc.requestedByLastName,
    }

    if (doc.dealId) {
      doc.deal = {
        id: doc.dealId,
        companyName: doc.dealCompanyName,
        dealNumber: doc.dealNumber,
      }
    }

    return NextResponse.json(doc)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/ops/sales/documents/[id] — Update document request
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const docId = params.id
    const body = await request.json()
    const { status, fileUrl, fileName, notes, receivedDate, expiresDate, reminderDate, reminderSent } = body

    // Check if document exists
    const existingDoc: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "DocumentRequest" WHERE "id" = $1`,
      docId
    )
    if (!existingDoc.length) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    // Build update query
    const updates: string[] = []
    const updateParams: any[] = []
    let paramIdx = 1

    if (status !== undefined) {
      updates.push(`"status" = $${paramIdx}::"DocumentRequestStatus"`)
      updateParams.push(status)
      paramIdx++
    }
    if (fileUrl !== undefined) {
      updates.push(`"fileUrl" = $${paramIdx}`)
      updateParams.push(fileUrl)
      paramIdx++
    }
    if (fileName !== undefined) {
      updates.push(`"fileName" = $${paramIdx}`)
      updateParams.push(fileName)
      paramIdx++
    }
    if (notes !== undefined) {
      updates.push(`"notes" = $${paramIdx}`)
      updateParams.push(notes)
      paramIdx++
    }
    if (receivedDate !== undefined) {
      updates.push(`"receivedDate" = $${paramIdx}`)
      updateParams.push(receivedDate ? new Date(receivedDate) : null)
      paramIdx++
    }
    if (expiresDate !== undefined) {
      updates.push(`"expiresDate" = $${paramIdx}`)
      updateParams.push(expiresDate ? new Date(expiresDate) : null)
      paramIdx++
    }
    if (reminderDate !== undefined) {
      updates.push(`"reminderDate" = $${paramIdx}`)
      updateParams.push(reminderDate ? new Date(reminderDate) : null)
      paramIdx++
    }
    if (reminderSent !== undefined) {
      updates.push(`"reminderSent" = $${paramIdx}`)
      updateParams.push(reminderSent)
      paramIdx++
    }

    updates.push(`"updatedAt" = NOW()`)

    const updateQuery = `UPDATE "DocumentRequest" SET ${updates.join(', ')} WHERE "id" = $${paramIdx} RETURNING *`
    updateParams.push(docId)

    await prisma.$queryRawUnsafe(updateQuery, ...updateParams)

    // Fetch with full info
    const docResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT dr.*, rb."firstName" AS "requestedByFirstName", rb."lastName" AS "requestedByLastName",
              d."companyName" AS "dealCompanyName", d."dealNumber"
       FROM "DocumentRequest" dr
       LEFT JOIN "Staff" rb ON rb."id" = dr."requestedById"
       LEFT JOIN "Deal" d ON d."id" = dr."dealId"
       WHERE dr."id" = $1`,
      docId
    )

    const doc = docResult[0]
    doc.requestedBy = {
      id: doc.requestedById,
      firstName: doc.requestedByFirstName,
      lastName: doc.requestedByLastName,
    }

    if (doc.dealId) {
      doc.deal = {
        id: doc.dealId,
        companyName: doc.dealCompanyName,
        dealNumber: doc.dealNumber,
      }
    }

    return NextResponse.json(doc)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/ops/sales/documents/[id] — Delete document request
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const docId = params.id
    const staffId = request.headers.get('x-staff-id')

    if (!staffId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if document exists
    const existingDoc: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "DocumentRequest" WHERE "id" = $1`,
      docId
    )

    if (!existingDoc.length) {
      return NextResponse.json({ error: 'Document request not found' }, { status: 404 })
    }

    await prisma.$queryRawUnsafe(
      `DELETE FROM "DocumentRequest" WHERE "id" = $1`,
      docId
    )

    return NextResponse.json({ message: 'Document request deleted' })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
