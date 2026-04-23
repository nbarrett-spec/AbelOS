export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

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

    // Fetch blueprint via the takeoff's blueprintId (not a stale "takeoffId" FK)
    const blueprintData: any[] = await prisma.$queryRawUnsafe(
      `SELECT "fileName", "fileUrl", "fileType" FROM "Blueprint" WHERE "id" = $1 LIMIT 1`,
      takeoff.blueprintId
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
      itemType: item.itemType ?? null,
      widthInches: item.widthInches ?? null,
      heightInches: item.heightInches ?? null,
      linearFeet: item.linearFeet ?? null,
      hardware: item.hardware ?? null,
      notes: item.notes ?? null,
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
      await audit(request, 'UPDATE', 'Takeoff', params.id, { status })
      return NextResponse.json(result[0])
    }

    // Action: update a single item (quantity, product swap, etc.)
    if (action === 'updateItem') {
      const {
        itemId, quantity, productId, description, category, location,
        itemType, widthInches, heightInches, linearFeet, hardware, notes,
      } = body
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
      if (itemType !== undefined) {
        setClauses.push(`"itemType" = $${idx}`)
        params_update.push(itemType || null)
        idx++
      }
      if (widthInches !== undefined) {
        setClauses.push(`"widthInches" = $${idx}`)
        params_update.push(widthInches == null ? null : Number(widthInches))
        idx++
      }
      if (heightInches !== undefined) {
        setClauses.push(`"heightInches" = $${idx}`)
        params_update.push(heightInches == null ? null : Number(heightInches))
        idx++
      }
      if (linearFeet !== undefined) {
        setClauses.push(`"linearFeet" = $${idx}`)
        params_update.push(linearFeet == null ? null : Number(linearFeet))
        idx++
      }
      if (hardware !== undefined) {
        setClauses.push(`"hardware" = $${idx}`)
        params_update.push(hardware || null)
        idx++
      }
      if (notes !== undefined) {
        setClauses.push(`"notes" = $${idx}`)
        params_update.push(notes || null)
        idx++
      }

      if (setClauses.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
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

      await audit(request, 'UPDATE', 'TakeoffItem', itemId, { quantity, productId })

      return NextResponse.json(item)
    }

    // Action: delete an item
    if (action === 'deleteItem') {
      const { itemId } = body
      await prisma.$executeRawUnsafe(
        `DELETE FROM "TakeoffItem" WHERE "id" = $1`,
        itemId
      )
      await audit(request, 'DELETE', 'TakeoffItem', itemId, {})
      return NextResponse.json({ success: true })
    }

    // Action: add a new item
    if (action === 'addItem') {
      const {
        category, description, location, quantity, productId,
        itemType, widthInches, heightInches, linearFeet, hardware, notes,
      } = body
      const newId = 'tki_' + Math.random().toString(36).slice(2, 14)
      const result: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "TakeoffItem"
           ("id","takeoffId","category","description","location","quantity","confidence","productId",
            "itemType","widthInches","heightInches","linearFeet","hardware","notes","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) RETURNING *`,
        newId,
        params.id,
        category || 'Miscellaneous',
        description || 'New item',
        location || null,
        quantity || 1,
        1.0,
        productId || null,
        itemType || null,
        widthInches == null ? null : Number(widthInches),
        heightInches == null ? null : Number(heightInches),
        linearFeet == null ? null : Number(linearFeet),
        hardware || null,
        notes || null,
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

      await audit(request, 'CREATE', 'TakeoffItem', item?.id, { category, description, quantity })

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

      await audit(request, 'UPDATE', 'Takeoff', params.id, { itemCount: items.length })

      return NextResponse.json({ items: results })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('PATCH /api/ops/takeoffs/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
