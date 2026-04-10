export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// SHIPPING FORECAST REPORT
// ──────────────────────────────────────────────────────────────────
// GET ?format=json  — returns raw data for UI
// GET ?format=xlsx  — generates downloadable multi-tab Excel report
// GET ?days=14      — look-ahead window (default 14)
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = request.nextUrl
  const format = url.searchParams.get('format') || 'json'
  const days = parseInt(url.searchParams.get('days') || '14')

  try {
    const now = new Date()
    const endDate = new Date(now.getTime() + days * 86400000)
    const nowISO = now.toISOString()
    const endISO = endDate.toISOString()

    // ── 1. Orders shipping in the window ──
    const orders: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        o."id",
        o."orderNumber",
        b."companyName" AS "customer",
        o."deliveryDate" AS "shipDate",
        o."subtotal"::float,
        o."taxAmount"::float AS "tax",
        o."total"::float,
        o."status"::text,
        COUNT(oi."id")::int AS "productCount"
      FROM "Order" o
      JOIN "Builder" b ON o."builderId" = b."id"
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."deliveryDate" >= $1::date
        AND o."deliveryDate" <= $2::date
        AND o."status"::text NOT IN ('CANCELLED', 'DRAFT')
      GROUP BY o."id", o."orderNumber", b."companyName", o."deliveryDate",
               o."subtotal", o."taxAmount", o."total", o."status"
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC
    `, nowISO, endISO)

    if (orders.length === 0 && format === 'json') {
      return safeJson({ orders: [], lineItems: [], adtDoors: [], bomByOrder: [], bomTotals: [], byShipDate: [] })
    }

    const orderIds = orders.map((o: any) => o.id)

    // ── 2. Line items detail ──
    const lineItems: any[] = orderIds.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT
        o."orderNumber",
        b."companyName" AS "customer",
        o."deliveryDate" AS "shipDate",
        p."sku",
        p."name" AS "productName",
        CASE
          WHEN p."sku" LIKE 'ADT%' OR p."name" LIKE 'ADT %' THEN 'Assembled Door (ADT)'
          WHEN p."name" ILIKE '%labor%' THEN 'Labor'
          ELSE 'Material / Supply'
        END AS "type",
        oi."quantity"::int AS "qty",
        COALESCE(oi."unitPrice", p."cost")::float AS "unitPrice",
        (oi."quantity" * COALESCE(oi."unitPrice", p."cost"))::float AS "lineTotal"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Builder" b ON o."builderId" = b."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."id" = ANY($1::text[])
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC, p."name" ASC
    `, orderIds) : []

    // ── 3. ADT Assembled Doors only ──
    const adtDoors: any[] = orderIds.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT
        o."orderNumber",
        b."companyName" AS "customer",
        o."deliveryDate" AS "shipDate",
        p."sku",
        p."name" AS "adtProductName",
        oi."quantity"::int AS "qty",
        COALESCE(oi."unitPrice", p."cost")::float AS "unitPrice",
        (oi."quantity" * COALESCE(oi."unitPrice", p."cost"))::float AS "lineTotal",
        p."description" AS "bomNote"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Builder" b ON o."builderId" = b."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."id" = ANY($1::text[])
        AND (p."sku" LIKE 'ADT%' OR p."sku" LIKE 'BC%ADT%' OR p."name" LIKE 'ADT %')
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC
    `, orderIds) : []

    // ── 4. BOM explosion by order ──
    const bomByOrder: any[] = orderIds.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT
        o."orderNumber",
        p."name" AS "adtProduct",
        oi."quantity"::int AS "qty",
        CASE
          WHEN p."name" ILIKE '%fire%' OR p."name" ILIKE '%20 min%' THEN 'fire_rated'
          WHEN p."name" ILIKE '%fiberglass%' OR p."name" ILIKE '% FG %' THEN 'exterior'
          ELSE 'interior'
        END AS "doorType",
        CASE
          WHEN p."name" ILIKE '%twin%' OR p."name" ILIKE '%pair%' THEN
            CASE WHEN p."name" ILIKE '%T-AST%' OR p."name" ILIKE '%astragal%' THEN 'twin_tast'
                 ELSE 'twin_bc' END
          ELSE 'single'
        END AS "config",
        cp."name" AS "component",
        be."quantity"::float AS "componentQtyPerDoor"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      JOIN "BomEntry" be ON be."parentId" = p."id"
      JOIN "Product" cp ON be."componentId" = cp."id"
      WHERE o."id" = ANY($1::text[])
        AND (p."sku" LIKE 'ADT%' OR p."sku" LIKE 'BC%ADT%' OR p."name" LIKE 'ADT %')
      ORDER BY o."orderNumber" ASC, p."name" ASC, cp."name" ASC
    `, orderIds) : []

    // ── 5. BOM component totals (aggregated) ──
    const bomTotals: any[] = orderIds.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT
        cp."name" AS "component",
        SUM(be."quantity" * oi."quantity")::float AS "totalNeeded"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      JOIN "BomEntry" be ON be."parentId" = p."id"
      JOIN "Product" cp ON be."componentId" = cp."id"
      WHERE o."id" = ANY($1::text[])
        AND (p."sku" LIKE 'ADT%' OR p."sku" LIKE 'BC%ADT%' OR p."name" LIKE 'ADT %')
      GROUP BY cp."name"
      ORDER BY "totalNeeded" DESC
    `, orderIds) : []

    // ── 6. By ship date grouping ──
    const byShipDate: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        o."deliveryDate" AS "shipDate",
        o."orderNumber",
        b."companyName" AS "customer",
        o."total"::float,
        COUNT(oi."id")::int AS "productCount"
      FROM "Order" o
      JOIN "Builder" b ON o."builderId" = b."id"
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."deliveryDate" >= $1::date
        AND o."deliveryDate" <= $2::date
        AND o."status"::text NOT IN ('CANCELLED', 'DRAFT')
      GROUP BY o."deliveryDate", o."orderNumber", b."companyName", o."total"
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC
    `, nowISO, endISO)

    // Total assembled doors
    const doorCount: any[] = orderIds.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(oi."quantity"), 0)::int AS "totalDoors"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."id" = ANY($1::text[])
        AND (p."sku" LIKE 'ADT%' OR p."sku" LIKE 'BC%ADT%' OR p."name" LIKE 'ADT %')
    `, orderIds) : [{ totalDoors: 0 }]

    const totalAssembledDoors = doorCount[0]?.totalDoors || 0

    if (format === 'json') {
      return safeJson({
        meta: { days, orderCount: orders.length, totalAssembledDoors, generatedAt: nowISO },
        orders,
        lineItems,
        adtDoors,
        bomByOrder,
        bomTotals,
        byShipDate,
      })
    }

    // ── XLSX generation ──
    // Return the JSON data with a flag for client-side xlsx generation
    // (The heavy xlsx formatting happens client-side or via a dedicated generator endpoint)
    return safeJson({
      format: 'xlsx_data',
      meta: { days, orderCount: orders.length, totalAssembledDoors, generatedAt: nowISO },
      orders,
      lineItems,
      adtDoors,
      bomByOrder,
      bomTotals,
      byShipDate,
    })

  } catch (err: any) {
    console.error('Shipping forecast error:', err)
    return NextResponse.json({ error: err.message || 'Report generation failed' }, { status: 500 })
  }
}
