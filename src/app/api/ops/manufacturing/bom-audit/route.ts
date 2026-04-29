export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

interface MissingBomProduct {
  productId: string
  sku: string
  name: string
  category: string
}

interface BrokenComponent {
  parentSku: string
  componentSku: string
  issue: string
}

interface BomCoverageResponse {
  missingBom: MissingBomProduct[]
  brokenComponents: BrokenComponent[]
  coverage: {
    total: number
    withBom: number
    percentage: number
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Find all active products that are assemblies, bundles, or kits
    const assemblyProducts: any[] = await prisma.$queryRawUnsafe(`
      SELECT p."id", p."sku", p."name", p."category", p."productType"
      FROM "Product" p
      WHERE p."active" = true
        AND p."productType" IN ('ASSEMBLY', 'BUNDLE', 'KIT')
      ORDER BY p."sku"
    `)

    const total = assemblyProducts.length
    let withBom = 0
    const missingBom: MissingBomProduct[] = []
    const brokenComponents: BrokenComponent[] = []

    // For each assembly, check if it has BomEntry records
    for (const product of assemblyProducts) {
      const bomEntries: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS count
        FROM "BomEntry"
        WHERE "parentId" = $1
      `, product.id)

      const hasBom = (bomEntries[0]?.count || 0) > 0

      if (hasBom) {
        withBom++

        // Now check if all components are active and in inventory
        const componentIssues: any[] = await prisma.$queryRawUnsafe(`
          SELECT
            be."id",
            be."componentId",
            comp."sku" AS "componentSku",
            comp."active" AS "componentActive",
            comp."inStock" AS "componentInStock"
          FROM "BomEntry" be
          LEFT JOIN "Product" comp ON comp."id" = be."componentId"
          WHERE be."parentId" = $1
            AND (comp."active" = false OR comp."inStock" = false OR comp."id" IS NULL)
        `, product.id)

        for (const issue of componentIssues) {
          let problemDescription = ''
          if (!issue.componentId) {
            problemDescription = 'Component product not found'
          } else if (!issue.componentActive) {
            problemDescription = 'Component is inactive'
          } else if (!issue.componentInStock) {
            problemDescription = 'Component not in stock'
          }

          brokenComponents.push({
            parentSku: product.sku,
            componentSku: issue.componentSku || 'UNKNOWN',
            issue: problemDescription,
          })
        }
      } else {
        missingBom.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category,
        })
      }
    }

    const coverage = {
      total,
      withBom,
      percentage: total > 0 ? (withBom / total) * 100 : 0,
    }

    return NextResponse.json({
      missingBom,
      brokenComponents,
      coverage,
    } as BomCoverageResponse)
  } catch (error) {
    console.error('GET /api/ops/manufacturing/bom-audit error:', error)
    return NextResponse.json(
      { error: 'Failed to audit BOM coverage' },
      { status: 500 }
    )
  }
}
