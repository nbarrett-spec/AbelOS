export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/contracts — List contracts
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId') || ''
    const status = searchParams.get('status') || ''

    let whereClause = `WHERE 1=1`
    const params: any[] = []
    let idx = 1

    if (orgId) {
      whereClause += ` AND ct."organizationId" = $${idx}`
      params.push(orgId)
      idx++
    }
    if (status) {
      whereClause += ` AND ct."status" = $${idx}::"ContractStatus"`
      params.push(status)
      idx++
    }

    const contracts: any[] = await prisma.$queryRawUnsafe(
      `SELECT ct.*, o."id" AS "orgId", o."name" AS "orgName", o."code" AS "orgCode"
       FROM "Contract" ct
       LEFT JOIN "BuilderOrganization" o ON o."id" = ct."organizationId"
       ${whereClause}
       ORDER BY ct."createdAt" DESC`,
      ...params
    )

    for (const contract of contracts) {
      const tiers: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "ContractPricingTier" WHERE "contractId" = $1 ORDER BY "sortOrder" ASC`,
        contract.id
      )
      contract.pricingTiers = tiers
      contract.organization = { id: contract.orgId, name: contract.orgName, code: contract.orgCode }
    }

    return NextResponse.json({ contracts })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/ops/contracts — Create a contract with pricing tiers
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { organizationId, title, description, paymentTerm, discountPercent, rebatePercent, effectiveDate, expirationDate, pricingTiers, notes } = body

    if (!organizationId || !title) {
      return NextResponse.json({ error: 'organizationId and title are required' }, { status: 400 })
    }

    // Generate contract number
    const orgs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "code" FROM "BuilderOrganization" WHERE "id" = $1`, organizationId
    )
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "Contract" WHERE "organizationId" = $1`, organizationId
    )
    const orgCode = orgs[0]?.code || 'UNK'
    const cnt = countResult[0]?.cnt || 0
    const contractNumber = `CTR-${orgCode}-${new Date().getFullYear()}-${String(cnt + 1).padStart(3, '0')}`

    const contractResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Contract" ("organizationId", "contractNumber", "title", "description", "paymentTerm", "discountPercent", "rebatePercent", "effectiveDate", "expirationDate", "notes", "status")
       VALUES ($1, $2, $3, $4, $5::"PaymentTerm", $6, $7, $8, $9, $10, 'DRAFT'::"ContractStatus") RETURNING *`,
      organizationId, contractNumber, title, description || null,
      paymentTerm || 'NET_30', discountPercent || 0, rebatePercent || 0,
      effectiveDate ? new Date(effectiveDate) : null,
      expirationDate ? new Date(expirationDate) : null,
      notes || null
    )
    const contract = contractResult[0]

    // Create pricing tiers
    if (pricingTiers?.length) {
      for (let i = 0; i < pricingTiers.length; i++) {
        const tier = pricingTiers[i]
        await prisma.$queryRawUnsafe(
          `INSERT INTO "ContractPricingTier" ("contractId", "category", "subcategory", "priceType", "fixedPrice", "discountPct", "costPlusPct", "description", "sortOrder")
           VALUES ($1, $2, $3, $4::"PriceType", $5, $6, $7, $8, $9)`,
          contract.id, tier.category, tier.subcategory || null,
          tier.priceType || 'DISCOUNT_PCT', tier.fixedPrice || null,
          tier.discountPct || null, tier.costPlusPct || null,
          tier.description || null, i
        )
      }
    }

    const tiers: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "ContractPricingTier" WHERE "contractId" = $1 ORDER BY "sortOrder"`, contract.id
    )
    contract.pricingTiers = tiers
    contract.organization = { name: orgCode, code: orgCode }

    return NextResponse.json(contract, { status: 201 })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
