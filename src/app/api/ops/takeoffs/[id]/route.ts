export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/takeoffs/[id] — Get full takeoff detail with items
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Fetch takeoff with related data using raw SQL
    const takeoffs: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.* FROM "Takeoff" t WHERE t."id" = $1`,
      params.id
    )

    if (!takeoffs || takeoffs.length === 0) {
      return NextResponse.json({ error: 'Takeoff not found' }, { status: 404 })
    }

    const takeoff = takeoffs[0]

    // Fetch items with product data
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT ti.*, p."id" AS "productId", p."sku", p."name" AS "productName", p."basePrice", p."cost"
       FROM "TakeoffItem" ti
       LEFT JOIN "Product" p ON ti."productId" = p."id"
       WHERE ti."takeoffId" = $1
       ORDER BY ti."category" ASC, ti."location" ASC`,
      params.id
    )

    // Fetch blueprint if exists
    const blueprintData: any[] = await prisma.$queryRawUnsafe(
      `SELECT "fileName", "fileUrl", "fileType" FROM "Blueprint" WHERE "takeoffId" = $1 LIMIT 1`,
      params.id
    )
    takeoff.blueprint = blueprintData[0] || null

    // Fetch project with builder data
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT p.*, b."id" AS "builderId", b."companyName", b."contactName", b."email", b."paymentTerm"
       FROM "Project" p
       LEFT JOIN "Builder" b ON p."builderId" = b."id"
       WHERE p."id" = $1`,
      takeoff.projectId
    )
    takeoff.project = projects[0] || null
    if (takeoff.project?.builderId) {
      takeoff.project.builder = {
        id: takeoff.project.builderId,
        companyName: takeoff.project.companyName,
        contactName: takeoff.project.contactName,
        email: takeoff.project.email,
        paymentTerm: takeoff.project.paymentTerm,
      }
    }

    // Restructure items to match expected format
    takeoff.items = items.map(item => ({
      id: item.id,
      takeoffId: item.takeoffId,
      category: item.category,
      description: item.description,
      location: item.location,
      quantity: item.quantity,
      confidence: item.confidence,
      productId: item.productId,
      product: item.productId ? {
        id: item.productId,
        sku: item.sku,
        name: item.productName,
        basePrice: item.basePrice,
        cost: item.cost,
      } : null,
    }))

    return NextResponse.json(takeoff)
  } catch (error: any) {
    console.error('GET /api/ops/takeoffs/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/ops/takeoffs/[id] — Update takeoff status or items
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action } = body

    // Action: update takeoff status
    if (action === 'updateStatus') {
      const { status } = body
      const result: any[] = await prisma.$queryRawUnsafe(
        `UPDATE "Takeoff" SET "status" = $1 WHERE "id" = $2 RETURNING *`,
        status, params.id
      )
      return NextResponse.json(result[0])
    }

    // Action: update a single item (quantity, product swap, etc.)
    if (action === 'updateItem') {
      const { itemId, quantity, productId, description, category, location } = body
      const setClauses: string[] = []
      const params_update: any[] = [itemId]
      let idx = 2

      if (quantity !== undefined) {
        setClauses.push(`"quantity" = $${idx}`)
        params_update.push(quantity)
        idx++
      }
      if (productId !== undefined) {
        setClauses.push(`"productId" = $${idx}`)
        params_update.push(productId || null)
        idx++
      }
      if (description !== undefined) {
        setClauses.push(`"description" = $${idx}`)
        params_update.push(description)
        idx++
      }
      if (category !== undefined) {
        setClauses.push(`"category" = $${idx}`)
        params_update.push(category)
        idx++
      }
      if (location !== undefined) {
        setClauses.push(`"location" = $${idx}`)
        params_update.push(location)
        idx++
      }

      const result: any[] = await prisma.$queryRawUnsafe(
        `UPDATE "TakeoffItem" SET ${setClauses.join(', ')} WHERE "id" = $1 RETURNING *`,
        ...params_update
      )
      const item = result[0]

      // Fetch product data if productId exists
      if (item?.productId) {
        const products: any[] = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Product" WHERE "id" = $1`,
          item.productId
        )
        item.product = products[0] || null
      }

      return NextResponse.json(item)
    }

    // Action: delete an item
    if (action === 'deleteItem') {
      const { itemId } = body
      await prisma.$executeRawUnsafe(
        `DELETE FROM "TakeoffItem" WHERE "id" = $1`,
        itemId
      )
      return NextResponse.json({ success: true })
    }

    // Action: add a new item
    if (action === 'addItem') {
      const { category, description, location, quantity, productId } = body
      const result: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "TakeoffItem" ("takeoffId", "category", "description", "location", "quantity", "confidence", "productId")
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        params.id, category || 'Miscellaneous', description || 'New item', location || null,
        quantity || 1, 1.0, productId || null
      )
      const item = result[0]

      // Fetch product data if productId exists
      if (item?.productId) {
        const products: any[] = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Product" WHERE "id" = $1`,
          item.productId
        )
        item.product = products[0] || null
      }

      return NextResponse.json(item)
    }

    // Action: bulk update items (for batch saves)
    if (action === 'bulkUpdate') {
      const { items } = body
      if (!items || !Array.isArray(items)) {
        return NextResponse.json({ error: 'items array required' }, { status: 400 })
      }

      const results = []
      for (const item of items) {
        const setClauses: string[] = []
        const params_bulk: any[] = [item.id]
        let idx = 2

        if (item.quantity !== undefined) {
          setClauses.push(`"quantity" = $${idx}`)
          params_bulk.push(item.quantity)
          idx++
        }
        if (item.productId !== undefined) {
          setClauses.push(`"productId" = $${idx}`)
          params_bulk.push(item.productId || null)
          idx++
        }
        if (item.description !== undefined) {
          setClauses.push(`"description" = $${idx}`)
          params_bulk.push(item.description)
          idx++
        }

        const updated: any[] = await prisma.$queryRawUnsafe(
          `UPDATE "TakeoffItem" SET ${setClauses.join(', ')} WHERE "id" = $1 RETURNING *`,
          ...params_bulk
        )
        const updatedItem = updated[0]

        // Fetch product data if productId exists
        if (updatedItem?.productId) {
          const products: any[] = await prisma.$queryRawUnsafe(
            `SELECT * FROM "Product" WHERE "id" = $1`,
            updatedItem.productId
          )
          updatedItem.product = products[0] || null
        }

        results.push(updatedItem)
      }

      return NextResponse.json({ items: results })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('PATCH /api/ops/takeoffs/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
