export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { BlueprintAnalysis } from '@/lib/blueprint-ai'
import { Prisma } from '@prisma/client'

interface GenerateTakeoffRequest {
  blueprintId: string
  analysis: BlueprintAnalysis
  builderId?: string // Optional, inferred from blueprint's project if not provided
}

interface ProductMatch {
  productId: string
  name: string
  basePrice: number
  category: string
  quantity: number
  unit: string
}

/**
 * POST /api/ops/blueprints/generate-takeoff
 *
 * Generate a takeoff with line items from a blueprint analysis
 * Maps AI-detected items to actual products in the catalog
 * Creates Takeoff and TakeoffItem records
 *
 * Staff auth required.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body: GenerateTakeoffRequest = await request.json()

    if (!body.blueprintId || !body.analysis) {
      return NextResponse.json(
        { error: 'Must provide blueprintId and analysis' },
        { status: 400 }
      )
    }

    // Fetch blueprint and project
    const blueprint = await prisma.blueprint.findUnique({
      where: { id: body.blueprintId },
      include: { project: true },
    })

    if (!blueprint) {
      return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
    }

    const project = blueprint.project
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Create takeoff record
    const takeoff = await prisma.takeoff.create({
      data: {
        projectId: project.id,
        blueprintId: blueprint.id,
        status: 'NEEDS_REVIEW',
        confidence: body.analysis.confidence / 100, // Store 0-1
        rawResult: body.analysis as unknown as Prisma.JsonObject,
      },
    })

    const items: Array<{ category: string; description: string; quantity: number; unit: string; location?: string }> = []

    // Map doors
    for (const room of body.analysis.rooms) {
      for (const door of room.doors) {
        items.push({
          category: `${door.type} Door`,
          description: `${door.type} door ${door.width ? `(${door.width}W)` : ''}`,
          quantity: door.quantity,
          unit: 'ea',
          location: room.name,
        })
      }

      // Map windows
      for (const window of room.windows) {
        items.push({
          category: 'Window',
          description: `${window.type} window`,
          quantity: window.quantity,
          unit: 'ea',
          location: room.name,
        })
      }

      // Map closets
      for (const closet of room.closets) {
        items.push({
          category: 'Closet System',
          description: `${closet.type} closet ${closet.width ? `(${closet.width}W)` : ''}`,
          quantity: 1,
          unit: 'ea',
          location: room.name,
        })
      }
    }

    // Add trim estimate
    if (body.analysis.summary.estimatedTrimLF > 0) {
      items.push({
        category: 'Trim',
        description: 'Base and casing trim (estimated)',
        quantity: body.analysis.summary.estimatedTrimLF,
        unit: 'lf',
      })
    }

    // Add hardware (rough estimate: 3 hinges + 1 handle + 1 lock per door)
    const totalDoors = body.analysis.summary.totalDoors
    if (totalDoors > 0) {
      items.push({
        category: 'Hardware',
        description: 'Hinges (3-pack, estimated)',
        quantity: Math.ceil(totalDoors / 2), // Conservative estimate
        unit: 'set',
      })
      items.push({
        category: 'Hardware',
        description: 'Door handles/levers (estimated)',
        quantity: totalDoors,
        unit: 'ea',
      })
      items.push({
        category: 'Hardware',
        description: 'Door stops (estimated)',
        quantity: totalDoors,
        unit: 'ea',
      })
    }

    // Now match items to products
    const takeoffItems = []

    for (const item of items) {
      // Find best matching product(s) in catalog
      const matchedProducts = await findProductMatches(item.category, item.description)

      if (matchedProducts.length > 0) {
        // Use best match (first result)
        const product = matchedProducts[0]
        const takeoffItem = await prisma.takeoffItem.create({
          data: {
            takeoffId: takeoff.id,
            category: item.category,
            description: item.description,
            location: item.location,
            quantity: item.quantity,
            productId: product.id,
            confidence: 0.7, // Medium confidence from AI matching
            aiNotes: `Matched to ${product.name}`,
          },
        })
        takeoffItems.push(takeoffItem)
      } else {
        // Create item without product match
        const takeoffItem = await prisma.takeoffItem.create({
          data: {
            takeoffId: takeoff.id,
            category: item.category,
            description: item.description,
            location: item.location,
            quantity: item.quantity,
            confidence: 0.5, // Lower confidence if no match found
            aiNotes: 'No matching product found in catalog',
          },
        })
        takeoffItems.push(takeoffItem)
      }
    }

    return NextResponse.json({
      takeoff: {
        id: takeoff.id,
        projectId: takeoff.projectId,
        blueprintId: takeoff.blueprintId,
        status: takeoff.status,
        confidence: takeoff.confidence,
        itemCount: takeoffItems.length,
        matchedCount: takeoffItems.filter((i) => i.productId).length,
        createdAt: takeoff.createdAt,
      },
      items: takeoffItems,
      analysisUsed: {
        totalDoors: body.analysis.summary.totalDoors,
        totalWindows: body.analysis.summary.totalWindows,
        totalClosets: body.analysis.summary.totalClosets,
        estimatedTrimLF: body.analysis.summary.estimatedTrimLF,
        floorPlanSqFt: body.analysis.summary.floorPlanSqFt,
      },
    })
  } catch (error: any) {
    console.error('POST /api/ops/blueprints/generate-takeoff error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Find matching products in the catalog by category and description.
 * Searches ALL category alternatives, uses subcategory, and falls back broadly.
 * Returns up to 5 best matches.
 */
async function findProductMatches(
  category: string,
  description: string
): Promise<Array<{ id: string; name: string; basePrice: number }>> {
  try {
    // Map generic categories to product catalog categories (plural DB names)
    const categoryMap: Record<string, string[]> = {
      'Interior Door': ['Interior Doors', 'Interior Door'],
      'Exterior Door': ['Exterior Doors', 'Exterior Door'],
      'Closet Door': ['Interior Doors', 'Bifold'],
      'Pocket Door': ['Interior Doors', 'Specialty Doors'],
      Window: ['Glass & Inserts', 'Window'],
      'Closet System': ['Door Frames & Components', 'Miscellaneous'],
      Trim: ['Trim & Moulding', 'Trim'],
      Hardware: ['Hardware', 'Miscellaneous'],
    }

    const searchCategories = categoryMap[category] || [category]

    // Try each category alternative until we find matches
    for (const searchCat of searchCategories) {
      const products: Array<{ id: string; name: string; basePrice: number }> = await prisma.$queryRawUnsafe(
        `SELECT "id", "name", "basePrice"
         FROM "Product"
         WHERE "active" = true
           AND ("category" ILIKE $1 OR "subcategory" ILIKE $1 OR "name" ILIKE $1)
         ORDER BY "basePrice" ASC
         LIMIT 5`,
        `%${searchCat}%`
      )
      if (products.length > 0) return products
    }

    // Last-resort broad search
    const broadProducts: Array<{ id: string; name: string; basePrice: number }> = await prisma.$queryRawUnsafe(
      `SELECT "id", "name", "basePrice"
       FROM "Product"
       WHERE "active" = true
         AND ("category" ILIKE $1 OR "name" ILIKE $1)
       ORDER BY "basePrice" ASC
       LIMIT 5`,
      `%${category.replace(/\s*Door$/i, '').replace(/\s*System$/i, '')}%`
    )

    return broadProducts
  } catch (error: any) {
    console.error('Error finding product matches:', error)
    return []
  }
}
