export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/sales/contracts/[id] — Single contract
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const contractId = params.id

    const contractResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT c.*, cb."firstName" AS "createdByFirstName", cb."lastName" AS "createdByLastName",
              d."companyName" AS "dealCompanyName", d."dealNumber"
       FROM "Contract" c
       LEFT JOIN "Staff" cb ON cb."id" = c."createdById"
       LEFT JOIN "Deal" d ON d."id" = c."dealId"
       WHERE c."id" = $1`,
      contractId
    )

    if (!contractResult.length) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractResult[0]
    contract.createdBy = {
      id: contract.createdById,
      firstName: contract.createdByFirstName,
      lastName: contract.createdByLastName,
    }

    if (contract.dealId) {
      contract.deal = {
        id: contract.dealId,
        companyName: contract.dealCompanyName,
        dealNumber: contract.dealNumber,
      }
    }

    return NextResponse.json(contract)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/ops/sales/contracts/[id] — Update contract
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const contractId = params.id
    const body = await request.json()
    const { title, status, type, paymentTerm, creditLimit, estimatedAnnual, discountPercent, terms, specialClauses, startDate, endDate, sentDate, signedDate, expiresDate, documentUrl } = body

    // Check if contract exists
    const existingContract: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Contract" WHERE "id" = $1`,
      contractId
    )
    if (!existingContract.length) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    // Build update query
    const updates: string[] = []
    const updateParams: any[] = []
    let paramIdx = 1

    if (title !== undefined) {
      updates.push(`"title" = $${paramIdx}`)
      updateParams.push(title)
      paramIdx++
    }
    if (status !== undefined) {
      updates.push(`"status" = $${paramIdx}::"ContractStatus"`)
      updateParams.push(status)
      paramIdx++
    }
    if (type !== undefined) {
      updates.push(`"type" = $${paramIdx}::"ContractType"`)
      updateParams.push(type)
      paramIdx++
    }
    if (paymentTerm !== undefined) {
      updates.push(`"paymentTerm" = $${paramIdx}::"PaymentTerm"`)
      updateParams.push(paymentTerm)
      paramIdx++
    }
    if (creditLimit !== undefined) {
      updates.push(`"creditLimit" = $${paramIdx}`)
      updateParams.push(creditLimit)
      paramIdx++
    }
    if (estimatedAnnual !== undefined) {
      updates.push(`"estimatedAnnual" = $${paramIdx}`)
      updateParams.push(estimatedAnnual)
      paramIdx++
    }
    if (discountPercent !== undefined) {
      updates.push(`"discountPercent" = $${paramIdx}`)
      updateParams.push(discountPercent)
      paramIdx++
    }
    if (terms !== undefined) {
      updates.push(`"terms" = $${paramIdx}`)
      updateParams.push(terms)
      paramIdx++
    }
    if (specialClauses !== undefined) {
      updates.push(`"specialClauses" = $${paramIdx}`)
      updateParams.push(specialClauses)
      paramIdx++
    }
    if (startDate !== undefined) {
      updates.push(`"startDate" = $${paramIdx}`)
      updateParams.push(startDate ? new Date(startDate) : null)
      paramIdx++
    }
    if (endDate !== undefined) {
      updates.push(`"endDate" = $${paramIdx}`)
      updateParams.push(endDate ? new Date(endDate) : null)
      paramIdx++
    }
    if (sentDate !== undefined) {
      updates.push(`"sentDate" = $${paramIdx}`)
      updateParams.push(sentDate ? new Date(sentDate) : null)
      paramIdx++
    }
    if (signedDate !== undefined) {
      updates.push(`"signedDate" = $${paramIdx}`)
      updateParams.push(signedDate ? new Date(signedDate) : null)
      paramIdx++
    }
    if (expiresDate !== undefined) {
      updates.push(`"expiresDate" = $${paramIdx}`)
      updateParams.push(expiresDate ? new Date(expiresDate) : null)
      paramIdx++
    }
    if (documentUrl !== undefined) {
      updates.push(`"documentUrl" = $${paramIdx}`)
      updateParams.push(documentUrl)
      paramIdx++
    }

    updates.push(`"updatedAt" = NOW()`)

    const updateQuery = `UPDATE "Contract" SET ${updates.join(', ')} WHERE "id" = $${paramIdx} RETURNING *`
    updateParams.push(contractId)

    const updatedContract: any[] = await prisma.$queryRawUnsafe(updateQuery, ...updateParams)

    // Fetch with full info
    const contractResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT c.*, cb."firstName" AS "createdByFirstName", cb."lastName" AS "createdByLastName",
              d."companyName" AS "dealCompanyName", d."dealNumber"
       FROM "Contract" c
       LEFT JOIN "Staff" cb ON cb."id" = c."createdById"
       LEFT JOIN "Deal" d ON d."id" = c."dealId"
       WHERE c."id" = $1`,
      contractId
    )

    const contract = contractResult[0]
    contract.createdBy = {
      id: contract.createdById,
      firstName: contract.createdByFirstName,
      lastName: contract.createdByLastName,
    }

    if (contract.dealId) {
      contract.deal = {
        id: contract.dealId,
        companyName: contract.dealCompanyName,
        dealNumber: contract.dealNumber,
      }
    }

    return NextResponse.json(contract)
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/ops/sales/contracts/[id] — Delete contract
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const contractId = params.id
    const staffId = request.headers.get('x-staff-id')

    if (!staffId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if contract exists and get its status
    const contractResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "status" FROM "Contract" WHERE "id" = $1`,
      contractId
    )

    if (!contractResult.length) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    }

    const contract = contractResult[0]

    if (contract.status === 'SIGNED' || contract.status === 'COMPLETED') {
      return NextResponse.json(
        { error: 'Cannot delete a signed contract' },
        { status: 400 }
      )
    }

    await prisma.$queryRawUnsafe(
      `DELETE FROM "Contract" WHERE "id" = $1`,
      contractId
    )

    return NextResponse.json({ message: 'Contract deleted' })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
