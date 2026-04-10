export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { pickId, scannedSku } = await request.json()

    if (!pickId || !scannedSku) {
      return NextResponse.json(
        { error: 'pickId and scannedSku are required' },
        { status: 400 }
      )
    }

    // Get the MaterialPick and its associated Product
    const pickQuery = `
      SELECT
        mp.id,
        mp."jobId",
        mp."productId",
        mp.sku as "pick_sku",
        p.sku as "product_sku",
        p.name as "product_name"
      FROM "MaterialPick" mp
      LEFT JOIN "Product" p ON p.id = mp."productId"
      WHERE mp.id = $1
    `

    const pickResult: any = await prisma.$queryRawUnsafe(pickQuery, pickId)

    if (!pickResult || pickResult.length === 0) {
      return NextResponse.json(
        { error: 'Pick not found' },
        { status: 404 }
      )
    }

    const pick = pickResult[0]
    const expectedSku = pick.product_sku || pick.pick_sku
    const scannedSkuNormalized = scannedSku.trim().toUpperCase()
    const expectedSkuNormalized = (expectedSku || '').trim().toUpperCase()

    const verified = scannedSkuNormalized === expectedSkuNormalized

    if (verified) {
      // Update pick status to VERIFIED
      const updateQuery = `
        UPDATE "MaterialPick"
        SET status = 'VERIFIED', "verifiedAt" = NOW()
        WHERE id = $1
      `
      await prisma.$executeRawUnsafe(updateQuery, pickId)

      // Log activity
      const staffId = request.headers.get('x-staff-id') || 'unknown'
      const logQuery = `
        INSERT INTO "Activity" (id, "staffId", "jobId", "activityType", "subject", "notes", "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, 'NOTE', 'Pick Verified', $3, NOW())
      `
      await prisma.$executeRawUnsafe(
        logQuery,
        staffId,
        pick.jobId,
        `SKU ${expectedSku} verified for pick ${pickId}`
      )

      return NextResponse.json({
        verified: true,
        message: 'Pick verified successfully',
      })
    } else {
      return NextResponse.json({
        verified: false,
        expected: expectedSku,
        scanned: scannedSku,
        message: `SKU mismatch: expected ${expectedSku}, scanned ${scannedSku}`,
      })
    }
  } catch (error) {
    console.error('Pick verify error:', error)
    return NextResponse.json(
      { error: 'Failed to verify pick' },
      { status: 500 }
    )
  }
}
