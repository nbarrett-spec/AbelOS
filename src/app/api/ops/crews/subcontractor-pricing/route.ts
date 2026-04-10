export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ensure table exists with latest columns
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SubcontractorPricing" (
          "id" TEXT NOT NULL,
          "crewId" TEXT NOT NULL REFERENCES "Crew"("id") ON DELETE CASCADE,
          "builderId" TEXT REFERENCES "Builder"("id") ON DELETE SET NULL,
          "pricePerSqFt" FLOAT NOT NULL DEFAULT 0,
          "pricingType" TEXT NOT NULL DEFAULT 'PER_SQFT',
          "pricePerDoor" FLOAT NOT NULL DEFAULT 0,
          "pricePerHardwareSet" FLOAT NOT NULL DEFAULT 0,
          "pricePerTrimPiece" FLOAT NOT NULL DEFAULT 0,
          "pricePerWindow" FLOAT NOT NULL DEFAULT 0,
          "flatRatePerUnit" FLOAT,
          "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "expiresAt" TIMESTAMP(3),
          "notes" TEXT,
          "active" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "SubcontractorPricing_pkey" PRIMARY KEY ("id")
        )
      `)
      // Add new columns if table already existed
      await prisma.$executeRawUnsafe(`ALTER TABLE "SubcontractorPricing" ADD COLUMN IF NOT EXISTS "pricePerSqFt" FLOAT NOT NULL DEFAULT 0`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "SubcontractorPricing" ADD COLUMN IF NOT EXISTS "pricingType" TEXT NOT NULL DEFAULT 'PER_SQFT'`)
      // Add subcontractor fields to Crew
      await prisma.$executeRawUnsafe(`ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "isSubcontractor" BOOLEAN NOT NULL DEFAULT false`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "companyName" TEXT`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT`)
    } catch (e) {
      // Columns may already exist
    }

    const searchParams = request.nextUrl.searchParams
    const crewId = searchParams.get('crewId')
    const builderId = searchParams.get('builderId')
    const activeOnly = searchParams.get('active')

    let query = `
      SELECT
        sp.id,
        sp."crewId",
        sp."builderId",
        sp."pricePerSqFt"::float,
        sp."pricingType",
        sp."pricePerDoor"::float,
        sp."pricePerHardwareSet"::float,
        sp."pricePerTrimPiece"::float,
        sp."pricePerWindow"::float,
        sp."flatRatePerUnit"::float,
        sp."effectiveDate",
        sp."expiresAt",
        sp.notes,
        sp.active,
        sp."createdAt",
        sp."updatedAt",
        c.name as "crewName",
        c."crewType"::text,
        c."isSubcontractor",
        c."companyName" as "subcontractorCompany",
        b."companyName" as "builderName"
      FROM "SubcontractorPricing" sp
      LEFT JOIN "Crew" c ON sp."crewId" = c.id
      LEFT JOIN "Builder" b ON sp."builderId" = b.id
      WHERE 1=1
    `

    const params: any[] = []
    let paramIndex = 1

    if (crewId) {
      query += ` AND sp."crewId" = $${paramIndex++}`
      params.push(crewId)
    }

    if (builderId) {
      query += ` AND sp."builderId" = $${paramIndex++}`
      params.push(builderId)
    }

    if (activeOnly === 'true') {
      query += ` AND sp.active = true`
    }

    query += ` ORDER BY sp."effectiveDate" DESC, sp."createdAt" DESC`

    const pricings = await prisma.$queryRawUnsafe(query, ...params)

    return NextResponse.json(pricings, { status: 200 })
  } catch (error: any) {
    console.error('GET /api/ops/crews/subcontractor-pricing error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pricing agreements', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      crewId,
      builderId,
      pricePerSqFt,
      pricingType,
      pricePerDoor,
      pricePerHardwareSet,
      pricePerTrimPiece,
      pricePerWindow,
      flatRatePerUnit,
      effectiveDate,
      expiresAt,
      notes,
    } = body

    if (!crewId) {
      return NextResponse.json(
        { error: 'Missing required field: crewId' },
        { status: 400 }
      )
    }

    const pricingId = crypto.randomUUID()
    const now = new Date().toISOString()
    const effDate = effectiveDate ? new Date(effectiveDate).toISOString() : now

    await prisma.$executeRawUnsafe(
      `INSERT INTO "SubcontractorPricing" (
        id, "crewId", "builderId", "pricePerSqFt", "pricingType",
        "pricePerDoor", "pricePerHardwareSet",
        "pricePerTrimPiece", "pricePerWindow", "flatRatePerUnit",
        "effectiveDate", "expiresAt", notes, active, "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $15)`,
      pricingId,
      crewId,
      builderId || null,
      parseFloat(pricePerSqFt) || 0,
      pricingType || 'PER_SQFT',
      parseFloat(pricePerDoor) || 0,
      parseFloat(pricePerHardwareSet) || 0,
      parseFloat(pricePerTrimPiece) || 0,
      parseFloat(pricePerWindow) || 0,
      flatRatePerUnit ? parseFloat(flatRatePerUnit) : null,
      effDate,
      expiresAt ? new Date(expiresAt).toISOString() : null,
      notes || null,
      now,
      now
    )

    // Fetch the created pricing agreement
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        sp.id,
        sp."crewId",
        sp."builderId",
        sp."pricePerSqFt"::float,
        sp."pricingType",
        sp."pricePerDoor"::float,
        sp."pricePerHardwareSet"::float,
        sp."pricePerTrimPiece"::float,
        sp."pricePerWindow"::float,
        sp."flatRatePerUnit"::float,
        sp."effectiveDate",
        sp."expiresAt",
        sp.notes,
        sp.active,
        sp."createdAt",
        sp."updatedAt",
        c.name as "crewName",
        c."crewType"::text,
        c."isSubcontractor",
        c."companyName" as "subcontractorCompany",
        b."companyName" as "builderName"
      FROM "SubcontractorPricing" sp
      LEFT JOIN "Crew" c ON sp."crewId" = c.id
      LEFT JOIN "Builder" b ON sp."builderId" = b.id
      WHERE sp.id = $1`,
      pricingId
    )

    return NextResponse.json(result?.[0] || null, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/crews/subcontractor-pricing error:', error)
    return NextResponse.json(
      { error: 'Failed to create pricing agreement', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const setClause: string[] = []
    const values: any[] = []
    let paramIndex = 1

    // Build dynamic UPDATE clause
    if (updates.pricePerSqFt !== undefined) {
      setClause.push(`"pricePerSqFt" = $${paramIndex++}`)
      values.push(parseFloat(updates.pricePerSqFt) || 0)
    }
    if (updates.pricingType !== undefined) {
      setClause.push(`"pricingType" = $${paramIndex++}`)
      values.push(updates.pricingType)
    }
    if (updates.pricePerDoor !== undefined) {
      setClause.push(`"pricePerDoor" = $${paramIndex++}`)
      values.push(parseFloat(updates.pricePerDoor) || 0)
    }
    if (updates.pricePerHardwareSet !== undefined) {
      setClause.push(`"pricePerHardwareSet" = $${paramIndex++}`)
      values.push(parseFloat(updates.pricePerHardwareSet) || 0)
    }
    if (updates.pricePerTrimPiece !== undefined) {
      setClause.push(`"pricePerTrimPiece" = $${paramIndex++}`)
      values.push(parseFloat(updates.pricePerTrimPiece) || 0)
    }
    if (updates.pricePerWindow !== undefined) {
      setClause.push(`"pricePerWindow" = $${paramIndex++}`)
      values.push(parseFloat(updates.pricePerWindow) || 0)
    }
    if (updates.flatRatePerUnit !== undefined) {
      setClause.push(`"flatRatePerUnit" = $${paramIndex++}`)
      values.push(updates.flatRatePerUnit ? parseFloat(updates.flatRatePerUnit) : null)
    }
    if (updates.builderId !== undefined) {
      setClause.push(`"builderId" = $${paramIndex++}`)
      values.push(updates.builderId || null)
    }
    if (updates.effectiveDate !== undefined) {
      setClause.push(`"effectiveDate" = $${paramIndex++}`)
      values.push(updates.effectiveDate ? new Date(updates.effectiveDate).toISOString() : now)
    }
    if (updates.expiresAt !== undefined) {
      setClause.push(`"expiresAt" = $${paramIndex++}`)
      values.push(updates.expiresAt ? new Date(updates.expiresAt).toISOString() : null)
    }
    if (updates.notes !== undefined) {
      setClause.push(`notes = $${paramIndex++}`)
      values.push(updates.notes || null)
    }
    if (updates.active !== undefined) {
      setClause.push(`active = $${paramIndex++}`)
      values.push(updates.active)
    }

    // Always update updatedAt
    setClause.push(`"updatedAt" = $${paramIndex++}`)
    values.push(now)
    values.push(id)

    if (setClause.length > 1) {
      await prisma.$executeRawUnsafe(
        `UPDATE "SubcontractorPricing" SET ${setClause.join(', ')} WHERE id = $${paramIndex}`,
        ...values
      )
    }

    // Fetch updated record
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        sp.id,
        sp."crewId",
        sp."builderId",
        sp."pricePerSqFt"::float,
        sp."pricingType",
        sp."pricePerDoor"::float,
        sp."pricePerHardwareSet"::float,
        sp."pricePerTrimPiece"::float,
        sp."pricePerWindow"::float,
        sp."flatRatePerUnit"::float,
        sp."effectiveDate",
        sp."expiresAt",
        sp.notes,
        sp.active,
        sp."createdAt",
        sp."updatedAt",
        c.name as "crewName",
        c."crewType"::text,
        c."isSubcontractor",
        c."companyName" as "subcontractorCompany",
        b."companyName" as "builderName"
      FROM "SubcontractorPricing" sp
      LEFT JOIN "Crew" c ON sp."crewId" = c.id
      LEFT JOIN "Builder" b ON sp."builderId" = b.id
      WHERE sp.id = $1`,
      id
    )

    return NextResponse.json(result?.[0] || null, { status: 200 })
  } catch (error: any) {
    console.error('PATCH /api/ops/crews/subcontractor-pricing error:', error)
    return NextResponse.json(
      { error: 'Failed to update pricing agreement', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required parameter: id' },
        { status: 400 }
      )
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM "SubcontractorPricing" WHERE id = $1`,
      id
    )

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('DELETE /api/ops/crews/subcontractor-pricing error:', error)
    return NextResponse.json(
      { error: 'Failed to delete pricing agreement', details: error?.message || String(error) },
      { status: 500 }
    )
  }
}
