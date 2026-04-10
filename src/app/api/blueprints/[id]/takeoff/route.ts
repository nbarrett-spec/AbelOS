export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { Prisma } from '@prisma/client'

/**
 * POST /api/blueprints/[id]/takeoff
 *
 * Generate a takeoff from a completed blueprint analysis.
 * This is the customer-facing equivalent of /api/ops/blueprints/generate-takeoff.
 * Reuses the same product matching logic.
 *
 * Builder auth required.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { analysis } = body

    if (!analysis) {
      return NextResponse.json(
        { error: 'Analysis data is required' },
        { status: 400 }
      )
    }

    // Fetch blueprint and verify ownership
    const blueprint = await prisma.blueprint.findUnique({
      where: { id: params.id },
      include: {
        project: { select: { id: true, builderId: true } },
      },
    })

    if (!blueprint) {
      return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
    }

    if (blueprint.project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Create takeoff record
    const takeoff = await prisma.takeoff.create({
      data: {
        projectId: blueprint.project.id,
        blueprintId: blueprint.id,
        status: 'NEEDS_REVIEW',
        confidence: (analysis.confidence || 85) / 100,
        rawResult: analysis as unknown as Prisma.JsonObject,
      },
    })

    // Extract items from analysis
    const items: Array<{
      category: string
      description: string
      quantity: number
      unit: string
      location?: string
    }> = []

    // Normalize door type from AI → proper category name
    const normalizeDoorCategory = (type: string): string => {
      const t = (type || 'interior').toLowerCase().trim()
      if (t.includes('exterior') || t.includes('entry') || t.includes('patio') || t.includes('storm')) return 'Exterior Door'
      if (t.includes('bifold') || t.includes('bi-fold')) return 'Closet Door'
      if (t.includes('pocket')) return 'Pocket Door'
      if (t.includes('barn')) return 'Interior Door'
      if (t.includes('french')) return 'Interior Door'
      if (t.includes('sliding') && !t.includes('closet')) return 'Exterior Door'
      if (t.includes('closet')) return 'Closet Door'
      return 'Interior Door' // default
    }

    // Map rooms → doors, windows, closets
    if (analysis.rooms) {
      for (const room of analysis.rooms) {
        if (room.doors) {
          for (const door of room.doors) {
            const doorCategory = normalizeDoorCategory(door.type)
            items.push({
              category: doorCategory,
              description: `${door.type || 'Interior'} door ${door.width ? `(${door.width}W)` : ''}`.trim(),
              quantity: door.quantity || 1,
              unit: 'ea',
              location: room.name,
            })
          }
        }
        if (room.windows) {
          for (const window of room.windows) {
            items.push({
              category: 'Window',
              description: `${window.type || ''} window`,
              quantity: window.quantity || 1,
              unit: 'ea',
              location: room.name,
            })
          }
        }
        if (room.closets) {
          for (const closet of room.closets) {
            items.push({
              category: 'Closet System',
              description: `${closet.type || ''} closet ${closet.width ? `(${closet.width}W)` : ''}`,
              quantity: 1,
              unit: 'ea',
              location: room.name,
            })
          }
        }
      }
    }

    // Add trim estimate
    if (analysis.summary?.estimatedTrimLF > 0) {
      items.push({
        category: 'Trim',
        description: 'Base and casing trim (estimated)',
        quantity: analysis.summary.estimatedTrimLF,
        unit: 'lf',
      })
    }

    // Add hardware estimates — one hinge set + one lever/handle + one stop per door
    const totalDoors = analysis.summary?.totalDoors || 0
    if (totalDoors > 0) {
      // Count door types for hardware differentiation
      const interiorDoorCount = items.filter(i => i.category === 'Interior Door').reduce((s, i) => s + i.quantity, 0)
      const exteriorDoorCount = items.filter(i => i.category === 'Exterior Door').reduce((s, i) => s + i.quantity, 0)
      const closetDoorCount = items.filter(i => i.category === 'Closet Door').reduce((s, i) => s + i.quantity, 0)

      // Estimate bathroom count from rooms for privacy vs passage split
      const bathroomCount = (analysis.rooms || []).filter((r: any) =>
        /bath|powder|restroom/i.test(r.type || r.name || '')
      ).length

      // Interior door hardware
      if (interiorDoorCount > 0) {
        items.push({
          category: 'Hardware',
          description: 'Hinge 3-1/2" x 3-1/2" SN (3-pack)',
          quantity: interiorDoorCount,
          unit: 'ea',
        })
        // Privacy levers for bathrooms, passage for other rooms
        if (bathroomCount > 0) {
          items.push({
            category: 'Hardware',
            description: 'Privacy Lever — Satin Nickel',
            quantity: Math.min(bathroomCount, interiorDoorCount),
            unit: 'ea',
          })
        }
        const passageCount = Math.max(0, interiorDoorCount - bathroomCount)
        if (passageCount > 0) {
          items.push({
            category: 'Hardware',
            description: 'Passage Lever — Satin Nickel',
            quantity: passageCount,
            unit: 'ea',
          })
        }
        items.push({
          category: 'Hardware',
          description: 'Door Stop Wall Mount SN',
          quantity: interiorDoorCount,
          unit: 'ea',
        })
      }

      // Exterior door hardware
      if (exteriorDoorCount > 0) {
        items.push({
          category: 'Hardware',
          description: 'Entry Handleset — Oil Rubbed Bronze',
          quantity: exteriorDoorCount,
          unit: 'ea',
        })
        items.push({
          category: 'Hardware',
          description: 'Single Cylinder Deadbolt ORB',
          quantity: exteriorDoorCount,
          unit: 'ea',
        })
        items.push({
          category: 'Hardware',
          description: '4" x 4" Ball Bearing Hinge ORB (3-pack)',
          quantity: exteriorDoorCount,
          unit: 'ea',
        })
      }

      // Bifold/closet door hardware
      if (closetDoorCount > 0) {
        items.push({
          category: 'Hardware',
          description: 'Bifold Track Hardware Kit',
          quantity: closetDoorCount,
          unit: 'ea',
        })
        items.push({
          category: 'Hardware',
          description: 'Bifold Knob — Satin Nickel',
          quantity: closetDoorCount,
          unit: 'ea',
        })
      }
    }

    // Match each item to a catalog product
    const takeoffItems = []
    for (const item of items) {
      const matched = await findProductMatches(item.category, item.description)
      const product = matched[0] || null

      const takeoffItem = await prisma.takeoffItem.create({
        data: {
          takeoffId: takeoff.id,
          category: item.category,
          description: item.description,
          location: item.location,
          quantity: item.quantity,
          productId: product?.id || null,
          confidence: product ? 0.7 : 0.5,
          aiNotes: product
            ? `Matched to ${product.name} | Unit: ${item.unit}`
            : `No matching product found | Unit: ${item.unit}`,
        },
      })
      takeoffItems.push({
        ...takeoffItem,
        product,
      })
    }

    // Calculate totals
    const matchedCount = takeoffItems.filter((i) => i.product).length
    const estimatedTotal = takeoffItems.reduce((sum, item) => {
      if (item.product) return sum + item.product.basePrice * item.quantity
      return sum
    }, 0)

    return NextResponse.json({
      takeoff: {
        id: takeoff.id,
        projectId: takeoff.projectId,
        blueprintId: takeoff.blueprintId,
        status: takeoff.status,
        confidence: takeoff.confidence,
        createdAt: takeoff.createdAt.toISOString(),
      },
      items: takeoffItems.map((item) => ({
        id: item.id,
        category: item.category,
        description: item.description,
        location: item.location,
        quantity: item.quantity,
        confidence: item.confidence,
        aiNotes: item.aiNotes,
        product: item.product
          ? { id: item.product.id, name: item.product.name, sku: item.product.sku, basePrice: item.product.basePrice }
          : null,
      })),
      summary: {
        totalItems: takeoffItems.length,
        matchedCount,
        estimatedTotal,
        totalDoors: analysis.summary?.totalDoors || 0,
        totalWindows: analysis.summary?.totalWindows || 0,
        totalClosets: analysis.summary?.totalClosets || 0,
        estimatedTrimLF: analysis.summary?.estimatedTrimLF || 0,
      },
    })
  } catch (error: any) {
    console.error('POST /api/blueprints/[id]/takeoff error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Find matching products in the catalog.
 *
 * Strategy:
 *  1. Try exact description keywords against product name (best match)
 *  2. Fall back to category + subcategory search
 *  3. Fall back to broad category search
 *
 * The AI analysis returns door types like "interior", "bifold", "pocket", etc.
 * DB categories use plural forms: "Interior Doors", "Exterior Doors", "Trim & Moulding".
 */
async function findProductMatches(
  category: string,
  description: string
): Promise<Array<{ id: string; name: string; sku: string; basePrice: number }>> {
  try {
    // Map AI-generated categories → DB category patterns (plural / actual names)
    const categoryMap: Record<string, string[]> = {
      'Interior Door': ['Interior Doors', 'Interior Door'],
      'interior Door': ['Interior Doors', 'Interior Door'],
      'Exterior Door': ['Exterior Doors', 'Exterior Door'],
      'exterior Door': ['Exterior Doors', 'Exterior Door'],
      'Closet Door': ['Interior Doors', 'Bifold'],
      'closet Door': ['Interior Doors', 'Bifold'],
      'Pocket Door': ['Interior Doors', 'Specialty Doors'],
      'pocket Door': ['Interior Doors', 'Specialty Doors'],
      'bifold Door': ['Interior Doors'],
      'sliding Door': ['Exterior Doors', 'Specialty Doors'],
      'french Door': ['Exterior Doors', 'Interior Doors'],
      'barn Door': ['Interior Doors', 'Specialty Doors'],
      Window: ['Glass & Inserts', 'Window'],
      'Closet System': ['Door Frames & Components', 'Miscellaneous'],
      Trim: ['Trim & Moulding', 'Trim'],
      Hardware: ['Hardware', 'Miscellaneous'],
    }

    const searchCategories = categoryMap[category] || [category]

    // Extract useful keywords from description for name matching
    // e.g. "interior door (36W)" → extract width info
    const widthMatch = description.match(/(\d{2,4})(?:W|\s*[Ww]ide|")/)?.[1]
    // Map common widths to door size codes: 24→2468, 28→2868, 30→3068, 32→3268, 36→3668
    const doorSizeMap: Record<string, string> = {
      '24': '2468', '28': '2868', '30': '3068', '32': '3268', '36': '3668',
      '2468': '2468', '2668': '2668', '2868': '2868', '3068': '3068',
    }
    const doorSizeCode = widthMatch ? doorSizeMap[widthMatch] : null

    // Step 1: Try description-based name match (most precise)
    if (description && description.length > 3) {
      // Extract key terms from description, skip generic words
      const descTerms = description
        .replace(/[()]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !['door', 'window', 'the', 'and', 'for'].includes(w.toLowerCase()))
        .slice(0, 3)
        .join(' ')

      if (descTerms.length > 2) {
        const nameProducts: Array<{ id: string; name: string; sku: string; basePrice: number }> =
          await prisma.$queryRawUnsafe(
            `SELECT "id", "name", "sku", "basePrice"
             FROM "Product"
             WHERE "active" = true
               AND "name" ILIKE $1
             ORDER BY "basePrice" ASC
             LIMIT 5`,
            `%${descTerms}%`
          )
        if (nameProducts.length > 0) return nameProducts
      }
    }

    // Step 2: If we have a door size, search by size + category
    if (doorSizeCode) {
      const sizeProducts: Array<{ id: string; name: string; sku: string; basePrice: number }> =
        await prisma.$queryRawUnsafe(
          `SELECT "id", "name", "sku", "basePrice"
           FROM "Product"
           WHERE "active" = true
             AND ("doorSize" = $1 OR "name" ILIKE $2)
             AND "category" ILIKE $3
           ORDER BY "basePrice" ASC
           LIMIT 5`,
          doorSizeCode,
          `%${doorSizeCode}%`,
          `%${searchCategories[0]}%`
        )
      if (sizeProducts.length > 0) return sizeProducts
    }

    // Step 3: Search ALL category alternatives (not just the first one)
    for (const searchCat of searchCategories) {
      const products: Array<{ id: string; name: string; sku: string; basePrice: number }> =
        await prisma.$queryRawUnsafe(
          `SELECT "id", "name", "sku", "basePrice"
           FROM "Product"
           WHERE "active" = true
             AND ("category" ILIKE $1 OR "subcategory" ILIKE $1 OR "name" ILIKE $1)
           ORDER BY "basePrice" ASC
           LIMIT 5`,
          `%${searchCat}%`
        )
      if (products.length > 0) return products
    }

    // Step 4: Last-resort broad search on category keyword
    const broadProducts: Array<{ id: string; name: string; sku: string; basePrice: number }> =
      await prisma.$queryRawUnsafe(
        `SELECT "id", "name", "sku", "basePrice"
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
