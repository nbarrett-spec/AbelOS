export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { processBlueprint } from '@/lib/takeoff-engine'

/**
 * Match a takeoff item to a real Abel product in the database.
 * Handles all categories: doors, hardware, trim, closet, window, specialty, misc.
 */
async function matchProduct(category: string, subcategory: string | undefined, description: string): Promise<string | null> {
  const desc = description.toLowerCase()

  // Try exact SKU match first
  const skuPattern = '%' + description.substring(0, 20) + '%'
  const bySku = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "Product" WHERE "sku" ILIKE $1 AND "active" = true LIMIT 1',
    skuPattern
  )
  if (bySku.length > 0) return bySku[0].id

  // ─── INTERIOR DOORS ────────────────────────────────────────────
  if (category === 'Interior Door') {
    let sql = 'SELECT "id" FROM "Product" WHERE "active" = true AND "category" ILIKE $1'
    const params: any[] = ['%Door%']
    let paramIndex = 2

    // Door size (4-digit codes like 2868, 2668, 4068)
    const sizeMatch = desc.match(/(\d{4})/)
    if (sizeMatch) {
      sql += ` AND "doorSize" LIKE $${paramIndex}`
      params.push(sizeMatch[1])
      paramIndex++
    }

    // Handing
    if (desc.includes(' lh') || desc.includes(' lh ') || desc.includes(' lh,')) {
      sql += ` AND "handing" ILIKE $${paramIndex}`
      params.push('%LH%')
      paramIndex++
    } else if (desc.includes(' rh') || desc.includes(' rh ') || desc.includes(' rh,')) {
      sql += ` AND "handing" ILIKE $${paramIndex}`
      params.push('%RH%')
      paramIndex++
    }

    // Core type
    if (desc.includes('hollow') || desc.includes(' hc')) {
      sql += ` AND "coreType" ILIKE $${paramIndex}`
      params.push('%Hollow%')
      paramIndex++
    } else if (desc.includes('solid') || desc.includes(' sc ') || desc.includes(' sc,')) {
      sql += ` AND "coreType" ILIKE $${paramIndex}`
      params.push('%Solid%')
      paramIndex++
    }

    // Panel style
    if (desc.includes('shaker')) {
      sql += ` AND "panelStyle" ILIKE $${paramIndex}`
      params.push('%Shaker%')
      paramIndex++
    } else if (desc.includes('flat')) {
      sql += ` AND "panelStyle" ILIKE $${paramIndex}`
      params.push('%Flat%')
      paramIndex++
    } else if (desc.includes('6-panel') || desc.includes('6 panel')) {
      sql += ` AND "panelStyle" ILIKE $${paramIndex}`
      params.push('%6-Panel%')
      paramIndex++
    }

    // Subcategory specifics
    if (subcategory === 'Bifold' || desc.includes('bifold')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Bifold%')
      paramIndex++
    }
    if (subcategory === 'Fire-Rated' || desc.includes('fire') || desc.includes('20min')) {
      sql += ` AND "fireRating" IS NOT NULL`
    }
    if (subcategory === 'Attic Access' || desc.includes('attic')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Attic%')
      paramIndex++
    }

    if (params.length > 1) {
      sql += ' LIMIT 1'
      const product = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
      if (product.length > 0) return product[0].id
    }
  }

  // ─── EXTERIOR DOORS ────────────────────────────────────────────
  if (category === 'Exterior Door') {
    let sql = 'SELECT "id" FROM "Product" WHERE "active" = true AND "category" ILIKE $1'
    const params: any[] = ['%Exterior%']
    let paramIndex = 2

    const sizeMatch = desc.match(/(\d{4})/)
    if (sizeMatch) {
      sql += ` AND "doorSize" LIKE $${paramIndex}`
      params.push(sizeMatch[1])
      paramIndex++
    }

    if (desc.includes('fiberglass')) {
      sql += ` AND "material" ILIKE $${paramIndex}`
      params.push('%Fiberglass%')
      paramIndex++
    } else if (desc.includes('steel')) {
      sql += ` AND "material" ILIKE $${paramIndex}`
      params.push('%Steel%')
      paramIndex++
    }

    if (desc.includes('sliding') || desc.includes('patio')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Sliding%')
      paramIndex++
    }
    if (desc.includes('6-panel') || desc.includes('6 panel')) {
      sql += ` AND "panelStyle" ILIKE $${paramIndex}`
      params.push('%6-Panel%')
      paramIndex++
    }

    if (params.length > 1) {
      sql += ' LIMIT 1'
      const product = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
      if (product.length > 0) return product[0].id
    }
  }

  // ─── HARDWARE ──────────────────────────────────────────────────
  if (category === 'Hardware') {
    let sql = 'SELECT "id" FROM "Product" WHERE "active" = true AND "category" ILIKE $1'
    const params: any[] = ['%Hardware%']
    let paramIndex = 2

    // Hardware type
    if (desc.includes('passage')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Passage%')
      paramIndex++
    } else if (desc.includes('privacy')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Privacy%')
      paramIndex++
    } else if (desc.includes('handleset') || desc.includes('entry handle')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Handleset%')
      paramIndex++
    } else if (desc.includes('deadbolt')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Deadbolt%')
      paramIndex++
    } else if (desc.includes('bifold knob')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Bifold%')
      paramIndex++
    } else if (desc.includes('hinge')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Hinge%')
      paramIndex++
    } else if (desc.includes('door stop') || desc.includes('door bumper')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Stop%')
      paramIndex++
    }

    // Finish
    if (desc.includes('sn') || desc.includes('satin nickel')) {
      sql += ` AND ("hardwareFinish" ILIKE $${paramIndex} OR "name" ILIKE $${paramIndex + 1})`
      params.push('%SN%', '%Satin Nickel%')
      paramIndex += 2
    } else if (desc.includes('orb') || desc.includes('oil rubbed')) {
      sql += ` AND ("hardwareFinish" ILIKE $${paramIndex} OR "name" ILIKE $${paramIndex + 1})`
      params.push('%ORB%', '%Oil Rubbed%')
      paramIndex += 2
    } else if (desc.includes('blk') || desc.includes('matte black') || desc.includes('black')) {
      sql += ` AND ("hardwareFinish" ILIKE $${paramIndex} OR "name" ILIKE $${paramIndex + 1})`
      params.push('%BLK%', '%Black%')
      paramIndex += 2
    } else if (desc.includes('chrome')) {
      sql += ` AND ("hardwareFinish" ILIKE $${paramIndex} OR "name" ILIKE $${paramIndex + 1})`
      params.push('%CHR%', '%Chrome%')
      paramIndex += 2
    }

    if (params.length > 1) {
      sql += ' LIMIT 1'
      const product = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
      if (product.length > 0) return product[0].id
    }
  }

  // ─── TRIM (base, casing, crown, shoe, chair rail, exterior) ───
  if (category === 'Trim' || category === 'Window Trim') {
    let sql = 'SELECT "id" FROM "Product" WHERE "active" = true'
    const params: any[] = []
    let paramIndex = 1

    // Try to match on trim type
    if (desc.includes('base') || subcategory === 'Base') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Base%')
      paramIndex++
    } else if (desc.includes('casing') || subcategory === 'Casing' || subcategory === 'Exterior Casing') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Casing%')
      paramIndex++
    } else if (desc.includes('crown') || subcategory === 'Crown') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Crown%')
      paramIndex++
    } else if (desc.includes('shoe') || subcategory === 'Shoe Mould') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Shoe%')
      paramIndex++
    } else if (desc.includes('chair rail') || subcategory === 'Chair Rail') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Chair Rail%')
      paramIndex++
    } else if (desc.includes('stool') || subcategory === 'Window Stool') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Stool%')
      paramIndex++
    } else if (desc.includes('apron') || subcategory === 'Window Apron') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Apron%')
      paramIndex++
    }

    // Material
    if (desc.includes('mdf') || desc.includes('primed')) {
      sql += ` AND ("material" ILIKE $${paramIndex} OR "name" ILIKE $${paramIndex + 1} OR "name" ILIKE $${paramIndex + 2})`
      params.push('%MDF%', '%MDF%', '%Primed%')
      paramIndex += 3
    } else if (desc.includes('pvc')) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%PVC%')
      paramIndex++
    } else if (desc.includes('pine')) {
      sql += ` AND ("material" ILIKE $${paramIndex} OR "name" ILIKE $${paramIndex + 1})`
      params.push('%Pine%', '%Pine%')
      paramIndex += 2
    }

    // Size (e.g., "3-1/4", "2-1/4")
    const sizeMatch = desc.match(/(\d+[\-\/]?\d*[\-\/]?\d*[""]?)/);
    if (sizeMatch) {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%' + sizeMatch[0].replace('"', '') + '%')
      paramIndex++
    }

    // Exterior vs interior
    if (desc.includes('exterior') || subcategory === 'Exterior Casing') {
      sql += ` AND "name" ILIKE $${paramIndex}`
      params.push('%Exterior%')
      paramIndex++
    }

    // Search in trim-like categories
    sql += ` AND ("category" ILIKE $${paramIndex} OR "category" ILIKE $${paramIndex + 1} OR "category" ILIKE $${paramIndex + 2})`
    params.push('%Trim%', '%Mould%', '%Casing%')
    paramIndex += 3

    if (params.length > 3) {
      sql += ' LIMIT 1'
      const product = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
      if (product.length > 0) return product[0].id
    }
  }

  // ─── CLOSET COMPONENTS ─────────────────────────────────────────
  if (category === 'Closet Component') {
    const searchTerms: string[] = []

    if (desc.includes('shelf') || desc.includes('shelving')) searchTerms.push('Shelf')
    if (desc.includes('rod') || desc.includes('closet rod')) searchTerms.push('Rod')
    if (desc.includes('pole socket')) searchTerms.push('Pole Socket')
    if (desc.includes('bracket')) searchTerms.push('Bracket')
    if (desc.includes('ventilated') || desc.includes('wire')) searchTerms.push('Wire')

    if (searchTerms.length > 0) {
      let sql = 'SELECT "id" FROM "Product" WHERE "active" = true'
      const params: any[] = []
      for (let i = 0; i < searchTerms.length; i++) {
        sql += ` AND "name" ILIKE $${i + 1}`
        params.push('%' + searchTerms[i] + '%')
      }
      sql += ' LIMIT 1'
      const product = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
      if (product.length > 0) return product[0].id
    }
  }

  // ─── SPECIALTY (mud bench, thresholds, etc.) ──────────────────
  if (category === 'Specialty' || category === 'Miscellaneous') {
    const searchTerms: string[] = []

    if (desc.includes('threshold')) searchTerms.push('Threshold')
    if (desc.includes('weatherstrip')) searchTerms.push('Weatherstrip')
    if (desc.includes('door sweep')) searchTerms.push('Sweep')
    if (desc.includes('bead board') || desc.includes('wainscot')) searchTerms.push('Bead')
    if (desc.includes('coat hook')) searchTerms.push('Hook')

    if (searchTerms.length > 0) {
      let sql = 'SELECT "id" FROM "Product" WHERE "active" = true AND ('
      const params: any[] = []
      for (let i = 0; i < searchTerms.length; i++) {
        if (i > 0) sql += ' OR '
        sql += `"name" ILIKE $${i + 1}`
        params.push('%' + searchTerms[i] + '%')
      }
      sql += ') LIMIT 1'
      const product = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
      if (product.length > 0) return product[0].id
    }
  }

  // ─── FALLBACK: broad name search ──────────────────────────────
  const searchTerms = description.split(/[\s—\-,]+/).filter(t => t.length > 2).slice(0, 3)
  if (searchTerms.length > 0) {
    let sql = 'SELECT "id" FROM "Product" WHERE "active" = true AND ('
    const params: any[] = []
    for (let i = 0; i < searchTerms.length; i++) {
      if (i > 0) sql += ' OR '
      sql += `"name" ILIKE $${i + 1}`
      params.push('%' + searchTerms[i] + '%')
    }
    sql += ') LIMIT 1'
    const fallback = await prisma.$queryRawUnsafe<Array<{ id: string }>>(sql, ...params)
    if (fallback.length > 0) return fallback[0].id
  }

  return null
}

// POST - run AI takeoff on a blueprint
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const { blueprintId, projectId, sqFootage, includeWindowTrim, includeClosetComponents, includeSpecialty } = await request.json()

    // Verify ownership
    const blueprintCheck = await prisma.$queryRawUnsafe<Array<{ id: string; fileUrl: string; fileType: string; pageCount: number | null }>>(
      `SELECT b."id", b."fileUrl", b."fileType", b."pageCount"
       FROM "Blueprint" b
       JOIN "Project" p ON b."projectId" = p."id"
       WHERE b."id" = $1 AND p."id" = $2 AND p."builderId" = $3
       LIMIT 1`,
      blueprintId,
      projectId,
      session.builderId
    )
    if (blueprintCheck.length === 0) {
      return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
    }
    const blueprint = blueprintCheck[0]

    // Update status
    await prisma.$executeRawUnsafe(
      'UPDATE "Blueprint" SET "processingStatus" = $1 WHERE "id" = $2',
      'PROCESSING',
      blueprintId
    )

    await prisma.$executeRawUnsafe(
      'UPDATE "Project" SET "status" = $1 WHERE "id" = $2',
      'TAKEOFF_PENDING',
      projectId
    )

    // Run AI takeoff engine
    const result = await processBlueprint({
      blueprintUrl: blueprint.fileUrl,
      blueprintType: blueprint.fileType,
      pageCount: blueprint.pageCount ?? undefined,
      sqFootage,
      includeWindowTrim: includeWindowTrim !== false,
      includeClosetComponents: includeClosetComponents !== false,
      includeSpecialty: includeSpecialty !== false,
    })

    // Match each takeoff item to a real product in the database
    const itemsWithProducts = await Promise.all(
      result.items.map(async (item) => {
        const productId = await matchProduct(item.category, item.subcategory, item.description)
        return {
          category: item.category,
          description: `${item.subcategory ? `[${item.subcategory}] ` : ''}${item.description}`,
          location: item.location,
          quantity: item.quantity,
          confidence: item.confidence,
          aiNotes: [item.notes, `Unit: ${item.unit}`].filter(Boolean).join(' | '),
          productId,
        }
      })
    )

    const matchedCount = itemsWithProducts.filter(i => i.productId).length

    // Create takeoff record with items
    const takeoffId = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "Takeoff" ("id", "projectId", "blueprintId", "status", "confidence", "rawResult", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING "id"`,
      projectId,
      blueprintId,
      result.confidence > 0.9 ? 'APPROVED' : 'NEEDS_REVIEW',
      result.confidence,
      JSON.stringify(JSON.parse(JSON.stringify(result)))
    )
    const newTakeoffId = takeoffId[0].id

    // Create takeoff items
    const itemInsertPromises = itemsWithProducts.map(item =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "TakeoffItem" ("id", "takeoffId", "category", "description", "location", "quantity", "confidence", "aiNotes", "productId", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        newTakeoffId,
        item.category,
        item.description,
        item.location,
        item.quantity,
        item.confidence,
        item.aiNotes,
        item.productId
      )
    )
    await Promise.all(itemInsertPromises)

    // Fetch the created takeoff with items
    const takeoffRows = await prisma.$queryRawUnsafe<Array<{ id: string; projectId: string; blueprintId: string; status: string; confidence: number; rawResult: string; createdAt: Date; updatedAt: Date }>>(
      'SELECT * FROM "Takeoff" WHERE "id" = $1',
      newTakeoffId
    )
    const takeoff = {
      ...takeoffRows[0],
      items: await prisma.$queryRawUnsafe(
        'SELECT * FROM "TakeoffItem" WHERE "takeoffId" = $1 ORDER BY "createdAt"',
        newTakeoffId
      )
    }

    // Update statuses
    await prisma.$executeRawUnsafe(
      'UPDATE "Blueprint" SET "processingStatus" = $1, "processedAt" = NOW() WHERE "id" = $2',
      'COMPLETE',
      blueprintId
    )

    await prisma.$executeRawUnsafe(
      'UPDATE "Project" SET "status" = $1 WHERE "id" = $2',
      'TAKEOFF_COMPLETE',
      projectId
    )

    return NextResponse.json({
      takeoff,
      summary: result.summary,
      processingTimeMs: result.processingTimeMs,
      notes: [
        ...result.notes,
        `Matched ${matchedCount} of ${itemsWithProducts.length} items to real Abel products`,
        matchedCount < itemsWithProducts.length
          ? `${itemsWithProducts.length - matchedCount} items need manual product assignment`
          : 'All items matched to products!',
      ],
    })
  } catch (error) {
    console.error('Takeoff error:', error)
    return NextResponse.json({ error: 'Takeoff processing failed' }, { status: 500 })
  }
}

// GET - get takeoff for a project
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const takeoffs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t.*, b."fileName"
     FROM "Takeoff" t
     JOIN "Blueprint" b ON t."blueprintId" = b."id"
     JOIN "Project" p ON t."projectId" = p."id"
     WHERE t."projectId" = $1 AND p."builderId" = $2
     ORDER BY t."createdAt" DESC`,
    projectId,
    session.builderId
  )

  // For each takeoff, fetch items with product info
  const takeoffsWithItems = await Promise.all(
    takeoffs.map(async (takeoff: any) => {
      const items = await prisma.$queryRawUnsafe(
        `SELECT ti.*, p.*
         FROM "TakeoffItem" ti
         LEFT JOIN "Product" p ON ti."productId" = p."id"
         WHERE ti."takeoffId" = $1
         ORDER BY ti."createdAt"`,
        takeoff.id
      )
      return {
        ...takeoff,
        items,
        blueprint: { fileName: takeoff.fileName }
      }
    })
  )

  return NextResponse.json({ takeoffs: takeoffsWithItems })
}
