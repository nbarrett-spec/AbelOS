export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Roles that can see cost basis and margin data
const MARGIN_VISIBLE_ROLES = ['ADMIN', 'MANAGER', 'ESTIMATOR', 'PURCHASING']

function canSeeMargins(request: NextRequest): boolean {
  const roles = (request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || '')
    .split(',').map(r => r.trim())
  return roles.some(r => MARGIN_VISIBLE_ROLES.includes(r))
}

// Ops-side pricing — staff auth via cookie (no builder session needed)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Verify builder exists with raw SQL
    const builderResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Builder"
      WHERE id = $1
      `,
      id
    )

    if (builderResult.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Get custom pricing for this builder with raw SQL
    const pricing = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        bp.id,
        bp."builderId",
        bp."productId",
        bp."customPrice",
        bp.margin,
        bp."createdAt",
        bp."updatedAt",
        p.id as "product.id",
        p.sku as "product.sku",
        p.name as "product.name",
        p.category as "product.category",
        p."basePrice" as "product.basePrice",
        COALESCE(bom_cost(p.id), p.cost) as "product.cost",
        p.cost as "product.storedCost"
      FROM "BuilderPricing" bp
      JOIN "Product" p ON bp."productId" = p.id
      WHERE bp."builderId" = $1
      ORDER BY p.sku ASC
      `,
      id
    )

    // Map rows to structured response — margin/cost only visible to privileged roles
    const showMargins = canSeeMargins(request)
    const mappedPricing = pricing.map((row: any) => ({
      id: row.id,
      builderId: row.builderId,
      productId: row.productId,
      customPrice: row.customPrice,
      ...(showMargins ? { margin: row.margin } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      product: {
        id: row['product.id'],
        sku: row['product.sku'],
        name: row['product.name'],
        category: row['product.category'],
        basePrice: row['product.basePrice'],
        ...(showMargins ? { cost: row['product.cost'] } : {}),
      },
    }))

    return NextResponse.json({ pricing: mappedPricing })
  } catch (error) {
    console.error('Failed to fetch pricing:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Account', undefined, { method: 'POST' }).catch(() => {})

    const { id } = params
    const body = await request.json()
    const { productId, customPrice } = body

    // Validate required fields
    if (!productId || customPrice === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: productId, customPrice' },
        { status: 400 }
      )
    }

    // Verify builder exists with raw SQL
    const builderResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "Builder"
      WHERE id = $1
      `,
      id
    )

    if (builderResult.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Verify product exists and get cost (BOM-aware) with raw SQL
    const productResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, COALESCE(bom_cost(id), cost) as cost FROM "Product"
      WHERE id = $1
      `,
      productId
    )

    if (productResult.length === 0) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const product = productResult[0]

    // Calculate margin
    const margin =
      customPrice > 0
        ? ((customPrice - (product.cost || 0)) / customPrice) * 100
        : 0

    // Check if pricing already exists
    const existingPricing = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id FROM "BuilderPricing"
      WHERE "builderId" = $1 AND "productId" = $2
      `,
      id,
      productId
    )

    const now = new Date()

    if (existingPricing.length > 0) {
      // Update existing pricing
      await prisma.$executeRawUnsafe(
        `
        UPDATE "BuilderPricing"
        SET "customPrice" = $1, margin = $2, "updatedAt" = $3
        WHERE "builderId" = $4 AND "productId" = $5
        `,
        customPrice,
        margin,
        now,
        id,
        productId
      )
    } else {
      // Create new pricing
      const pricingId = `bp_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`

      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "BuilderPricing" (id, "builderId", "productId", "customPrice", margin, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        pricingId,
        id,
        productId,
        customPrice,
        margin,
        now,
        now
      )
    }

    // Fetch the updated/created pricing with product details
    const pricingResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        bp.id,
        bp."builderId",
        bp."productId",
        bp."customPrice",
        bp.margin,
        bp."createdAt",
        bp."updatedAt",
        p.id as "product.id",
        p.sku as "product.sku",
        p.name as "product.name",
        p.category as "product.category",
        p."basePrice" as "product.basePrice",
        COALESCE(bom_cost(p.id), p.cost) as "product.cost"
      FROM "BuilderPricing" bp
      JOIN "Product" p ON bp."productId" = p.id
      WHERE bp."builderId" = $1 AND bp."productId" = $2
      `,
      id,
      productId
    )

    const pricing = pricingResult[0]
      ? {
          id: pricingResult[0].id,
          builderId: pricingResult[0].builderId,
          productId: pricingResult[0].productId,
          customPrice: pricingResult[0].customPrice,
          margin: pricingResult[0].margin,
          createdAt: pricingResult[0].createdAt,
          updatedAt: pricingResult[0].updatedAt,
          product: {
            id: pricingResult[0]['product.id'],
            sku: pricingResult[0]['product.sku'],
            name: pricingResult[0]['product.name'],
            category: pricingResult[0]['product.category'],
            basePrice: pricingResult[0]['product.basePrice'],
            cost: pricingResult[0]['product.cost'],
          },
        }
      : null

    return NextResponse.json({ pricing }, { status: 201 })
  } catch (error: any) {
    console.error('Failed to create/update pricing:', error)

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Account', undefined, { method: 'PATCH' }).catch(() => {})

    const { id } = params
    const body = await request.json()
    const { pricingId, customPrice } = body

    if (!pricingId || customPrice === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: pricingId, customPrice' },
        { status: 400 }
      )
    }

    // Verify pricing belongs to this builder with raw SQL
    const pricingResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT bp.id, bp."builderId", COALESCE(bom_cost(p.id), p.cost) as "productCost"
      FROM "BuilderPricing" bp
      JOIN "Product" p ON bp."productId" = p.id
      WHERE bp.id = $1 AND bp."builderId" = $2
      `,
      pricingId,
      id
    )

    if (pricingResult.length === 0) {
      return NextResponse.json(
        { error: 'Pricing not found' },
        { status: 404 }
      )
    }

    const pricing = pricingResult[0]

    // Calculate new margin
    const margin =
      customPrice > 0
        ? ((customPrice - (pricing.productCost || 0)) / customPrice) * 100
        : 0

    const now = new Date()

    // Update pricing with raw SQL
    await prisma.$executeRawUnsafe(
      `
      UPDATE "BuilderPricing"
      SET "customPrice" = $1, margin = $2, "updatedAt" = $3
      WHERE id = $4
      `,
      customPrice,
      margin,
      now,
      pricingId
    )

    // Fetch the updated pricing with product details
    const updatedResult = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        bp.id,
        bp."builderId",
        bp."productId",
        bp."customPrice",
        bp.margin,
        bp."createdAt",
        bp."updatedAt",
        p.id as "product.id",
        p.sku as "product.sku",
        p.name as "product.name",
        p.category as "product.category",
        p."basePrice" as "product.basePrice",
        COALESCE(bom_cost(p.id), p.cost) as "product.cost"
      FROM "BuilderPricing" bp
      JOIN "Product" p ON bp."productId" = p.id
      WHERE bp.id = $1
      `,
      pricingId
    )

    const updated = updatedResult[0]
      ? {
          id: updatedResult[0].id,
          builderId: updatedResult[0].builderId,
          productId: updatedResult[0].productId,
          customPrice: updatedResult[0].customPrice,
          margin: updatedResult[0].margin,
          createdAt: updatedResult[0].createdAt,
          updatedAt: updatedResult[0].updatedAt,
          product: {
            id: updatedResult[0]['product.id'],
            sku: updatedResult[0]['product.sku'],
            name: updatedResult[0]['product.name'],
            category: updatedResult[0]['product.category'],
            basePrice: updatedResult[0]['product.basePrice'],
            cost: updatedResult[0]['product.cost'],
          },
        }
      : null

    return NextResponse.json({ pricing: updated })
  } catch (error: any) {
    console.error('Failed to update pricing:', error)

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
