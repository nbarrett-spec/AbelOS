export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import * as XLSX from 'xlsx'

// ──────────────────────────────────────────────────────────────────
// SHIPPING FORECAST XLSX GENERATOR
// ──────────────────────────────────────────────────────────────────
// Generates a multi-tab Excel report using SheetJS (works on Vercel)
//   Tab 1: BOM Component Totals
//   Tab 2: BOM by Order
//   Tab 3: Orders Summary
//   Tab 4: Line Items Detail
//   Tab 5: ADT Assembled Doors
//   Tab 6: By Ship Date
// ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    const dt = new Date(iso)
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return String(iso).slice(0, 10) }
}

function fmtCurrency(n: number): string {
  return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map(w => ({ wch: w }))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const days = parseInt(request.nextUrl.searchParams.get('days') || '14')

  try {
    const now = new Date()
    const endDate = new Date(now.getTime() + days * 86400000)
    const nowISO = now.toISOString()
    const endISO = endDate.toISOString()

    // ── Fetch all data ──
    const orders: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."id", o."orderNumber", b."companyName" AS "customer",
             o."deliveryDate" AS "shipDate",
             COALESCE(o."subtotal", 0)::float AS "subtotal",
             COALESCE(o."taxAmount", 0)::float AS "tax",
             COALESCE(o."total", 0)::float AS "total",
             o."status"::text,
             COUNT(oi."id")::int AS "productCount"
      FROM "Order" o
      JOIN "Builder" b ON o."builderId" = b."id"
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      WHERE o."deliveryDate" >= $1::date AND o."deliveryDate" <= $2::date
        AND o."status"::text NOT IN ('CANCELLED', 'DRAFT')
      GROUP BY o."id", o."orderNumber", b."companyName", o."deliveryDate",
               o."subtotal", o."taxAmount", o."total", o."status"
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC
    `, nowISO, endISO)

    const orderIds = orders.map((o: any) => o.id)
    if (orderIds.length === 0) {
      return NextResponse.json({ error: 'No orders found in the specified date range' }, { status: 404 })
    }

    const lineItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."orderNumber", b."companyName" AS "customer", o."deliveryDate" AS "shipDate",
             p."sku", p."name" AS "productName",
             CASE WHEN p."name" LIKE 'ADT %' THEN 'Assembled Door (ADT)'
                  WHEN p."name" ILIKE '%labor%' THEN 'Labor'
                  ELSE 'Material / Supply' END AS "type",
             oi."quantity"::int AS "qty",
             COALESCE(oi."unitPrice", p."cost", 0)::float AS "unitPrice",
             (oi."quantity" * COALESCE(oi."unitPrice", p."cost", 0))::float AS "lineTotal"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Builder" b ON o."builderId" = b."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."id" = ANY($1::text[])
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC, p."name" ASC
    `, orderIds)

    const adtDoors: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."orderNumber", b."companyName" AS "customer", o."deliveryDate" AS "shipDate",
             p."sku", p."name" AS "adtProductName", oi."quantity"::int AS "qty",
             COALESCE(oi."unitPrice", p."cost", 0)::float AS "unitPrice",
             (oi."quantity" * COALESCE(oi."unitPrice", p."cost", 0))::float AS "lineTotal",
             COALESCE(p."description", '') AS "bomNote"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Builder" b ON o."builderId" = b."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."id" = ANY($1::text[]) AND p."name" LIKE 'ADT %'
      ORDER BY o."deliveryDate" ASC, o."orderNumber" ASC
    `, orderIds)

    const bomByOrder: any[] = await prisma.$queryRawUnsafe(`
      SELECT o."orderNumber", p."name" AS "adtProduct", oi."quantity"::int AS "qty",
             CASE WHEN p."name" ILIKE '%fire%' OR p."name" ILIKE '%20 min%' THEN 'fire_rated'
                  WHEN p."name" ILIKE '%fiberglass%' OR p."name" ILIKE '% FG %' THEN 'exterior'
                  ELSE 'interior' END AS "doorType",
             CASE WHEN p."name" ILIKE '%twin%' THEN
               CASE WHEN p."name" ILIKE '%T-AST%' THEN 'twin_tast' ELSE 'twin_bc' END
               ELSE 'single' END AS "config",
             cp."name" AS "component",
             be."quantity"::float AS "componentQtyPerDoor"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      JOIN "BomEntry" be ON be."parentId" = p."id"
      JOIN "Product" cp ON be."componentId" = cp."id"
      WHERE o."id" = ANY($1::text[]) AND p."name" LIKE 'ADT %'
      ORDER BY o."orderNumber" ASC, p."name" ASC, cp."name" ASC
    `, orderIds)

    const bomTotals: any[] = await prisma.$queryRawUnsafe(`
      SELECT cp."name" AS "component",
             SUM(be."quantity" * oi."quantity")::float AS "totalNeeded"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      JOIN "BomEntry" be ON be."parentId" = p."id"
      JOIN "Product" cp ON be."componentId" = cp."id"
      WHERE o."id" = ANY($1::text[]) AND p."name" LIKE 'ADT %'
      GROUP BY cp."name"
      ORDER BY "totalNeeded" DESC
    `, orderIds)

    const totalDoorsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(oi."quantity"), 0)::int AS "count"
      FROM "OrderItem" oi JOIN "Order" o ON oi."orderId" = o."id"
      JOIN "Product" p ON oi."productId" = p."id"
      WHERE o."id" = ANY($1::text[]) AND p."name" LIKE 'ADT %'
    `, orderIds)
    const totalDoors = totalDoorsResult[0]?.count || 0

    // ── Build workbook ──
    const wb = XLSX.utils.book_new()

    // ════════════════════════════════════════════════════════════════
    // TAB 1: BOM Component Totals
    // ════════════════════════════════════════════════════════════════
    const bomRows: any[][] = [
      [`BOM Component Material Needs — Next ${days} Days`],
      [`Based on ${totalDoors} assembled doors across all shipping orders`],
      [],
      ['Category', 'Component', 'Quantity Needed', 'Unit'],
    ]

    // Categorize BOM
    const categories: Record<string, any[]> = {}
    for (const item of bomTotals) {
      const n = item.component.toLowerCase()
      let cat = 'OTHER'
      if (n.includes('slab') || n.includes('door slab')) cat = 'DOOR SLABS'
      else if (n.includes('fj jamb')) cat = 'JAMB SETS (Interior FJ Jamb)'
      else if (n.includes('frame') || n.includes('mahogany jamb')) cat = 'FRAME SETS (Exterior/Fire-Rated)'
      else if (n.includes('3-1/2') && n.includes('hinge')) cat = 'HINGES (Interior 3-1/2")'
      else if (n.includes('4 x 4') && n.includes('hinge')) cat = 'HINGES (Exterior/Fire-Rated 4x4)'
      else if (n.includes('weatherstrip')) cat = 'WEATHERSTRIPPING'
      else if (n.includes('threshold') || n.includes('sweep') || n.includes('sill')) cat = 'THRESHOLDS & SWEEPS'
      else if (n.includes('flip') || n.includes('astragal') || n.includes('mullion')) cat = 'TWIN DOOR HARDWARE'
      else if (n.includes('hinge')) cat = 'HINGES (Other)'
      if (!categories[cat]) categories[cat] = []
      categories[cat].push(item)
    }

    const catOrder = ['DOOR SLABS', 'JAMB SETS (Interior FJ Jamb)', 'FRAME SETS (Exterior/Fire-Rated)',
      'HINGES (Interior 3-1/2")', 'HINGES (Exterior/Fire-Rated 4x4)', 'HINGES (Other)',
      'WEATHERSTRIPPING', 'THRESHOLDS & SWEEPS', 'TWIN DOOR HARDWARE', 'OTHER']

    for (const cat of catOrder) {
      if (!categories[cat]) continue
      const items = categories[cat].sort((a: any, b: any) => a.component.localeCompare(b.component))
      bomRows.push([`▸ ${cat}`, '', '', ''])
      let catTotal = 0
      for (const item of items) {
        bomRows.push(['', item.component, item.totalNeeded, 'ea.'])
        catTotal += item.totalNeeded
      }
      bomRows.push([`  ${cat} Subtotal`, '', catTotal, ''])
      bomRows.push([])
    }
    bomRows.push([])
    bomRows.push(['', 'TOTAL ASSEMBLED DOORS', totalDoors, ''])

    const ws1 = XLSX.utils.aoa_to_sheet(bomRows)
    setColWidths(ws1, [40, 50, 18, 8])
    XLSX.utils.book_append_sheet(wb, ws1, 'BOM Component Totals')

    // ════════════════════════════════════════════════════════════════
    // TAB 2: BOM by Order
    // ════════════════════════════════════════════════════════════════
    const bom2Rows: any[][] = [
      ['BOM Component Detail by ADT Product'],
      [],
      ['Order #', 'ADT Product', 'Qty', 'Door Type', 'Config', 'Component', 'Comp Qty/Door'],
    ]
    for (const item of bomByOrder) {
      bom2Rows.push([
        item.orderNumber, item.adtProduct, item.qty,
        item.doorType, item.config, item.component, item.componentQtyPerDoor,
      ])
    }
    const ws2 = XLSX.utils.aoa_to_sheet(bom2Rows)
    setColWidths(ws2, [14, 55, 6, 14, 12, 40, 14])
    XLSX.utils.book_append_sheet(wb, ws2, 'BOM by Order')

    // ════════════════════════════════════════════════════════════════
    // TAB 3: Orders Summary
    // ════════════════════════════════════════════════════════════════
    const ordRows: any[][] = [
      ['Order #', 'Customer', 'Ship Date', 'Subtotal', 'Tax', 'Total', '# Products', 'Status'],
    ]
    let grandSub = 0, grandTax = 0, grandTotal = 0
    for (const o of orders) {
      ordRows.push([
        o.orderNumber, o.customer, fmtDate(o.shipDate),
        o.subtotal, o.tax, o.total, o.productCount, o.status || '',
      ])
      grandSub += o.subtotal || 0
      grandTax += o.tax || 0
      grandTotal += o.total || 0
    }
    ordRows.push([])
    ordRows.push(['GRAND TOTAL', '', '', grandSub, grandTax, grandTotal, '', ''])

    const ws3 = XLSX.utils.aoa_to_sheet(ordRows)
    setColWidths(ws3, [14, 26, 16, 14, 12, 14, 12, 16])
    // Format currency columns
    const currCols3 = [3, 4, 5] // D, E, F (0-indexed)
    for (let r = 1; r <= orders.length + 2; r++) {
      for (const c of currCols3) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (ws3[addr] && typeof ws3[addr].v === 'number') {
          ws3[addr].z = '$#,##0.00'
        }
      }
    }
    XLSX.utils.book_append_sheet(wb, ws3, 'Orders Summary')

    // ════════════════════════════════════════════════════════════════
    // TAB 4: Line Items Detail
    // ════════════════════════════════════════════════════════════════
    const liRows: any[][] = [
      ['Order #', 'Customer', 'Ship Date', 'SKU', 'Product Name', 'Type', 'Qty', 'Unit Price', 'Line Total'],
    ]
    for (const li of lineItems) {
      liRows.push([
        li.orderNumber, li.customer, fmtDate(li.shipDate),
        li.sku || '', li.productName, li.type, li.qty, li.unitPrice, li.lineTotal,
      ])
    }
    const ws4 = XLSX.utils.aoa_to_sheet(liRows)
    setColWidths(ws4, [14, 24, 16, 14, 55, 22, 6, 12, 14])
    for (let r = 1; r <= lineItems.length; r++) {
      for (const c of [7, 8]) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (ws4[addr] && typeof ws4[addr].v === 'number') ws4[addr].z = '$#,##0.00'
      }
    }
    XLSX.utils.book_append_sheet(wb, ws4, 'Line Items Detail')

    // ════════════════════════════════════════════════════════════════
    // TAB 5: ADT Assembled Doors
    // ════════════════════════════════════════════════════════════════
    const adtRows: any[][] = [
      ['Order #', 'Customer', 'Ship Date', 'SKU', 'ADT Product Name', 'Qty', 'Unit Price', 'Line Total', 'BOM Note'],
    ]
    let adtTotalQty = 0, adtTotalValue = 0
    for (const d of adtDoors) {
      adtRows.push([
        d.orderNumber, d.customer, fmtDate(d.shipDate),
        d.sku || '', d.adtProductName, d.qty, d.unitPrice, d.lineTotal, d.bomNote || '',
      ])
      adtTotalQty += d.qty || 0
      adtTotalValue += d.lineTotal || 0
    }
    adtRows.push([])
    adtRows.push(['TOTAL', '', '', '', '', adtTotalQty, '', adtTotalValue, ''])

    const ws5 = XLSX.utils.aoa_to_sheet(adtRows)
    setColWidths(ws5, [14, 24, 16, 14, 55, 6, 12, 14, 40])
    for (let r = 1; r <= adtDoors.length + 2; r++) {
      for (const c of [6, 7]) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (ws5[addr] && typeof ws5[addr].v === 'number') ws5[addr].z = '$#,##0.00'
      }
    }
    XLSX.utils.book_append_sheet(wb, ws5, 'ADT Assembled Doors')

    // ════════════════════════════════════════════════════════════════
    // TAB 6: By Ship Date
    // ════════════════════════════════════════════════════════════════
    const sdRows: any[][] = [
      ['Ship Date', 'Order #', 'Customer', 'Total', '# Products'],
    ]
    let currentDate = ''
    let dateTotal = 0, dateProducts = 0
    for (const o of orders) {
      const ship = fmtDate(o.shipDate)
      if (currentDate && ship !== currentDate) {
        sdRows.push(['', `${currentDate} Subtotal`, '', dateTotal, dateProducts])
        dateTotal = 0
        dateProducts = 0
      }
      currentDate = ship
      sdRows.push([ship, o.orderNumber, o.customer, o.total, o.productCount])
      dateTotal += o.total || 0
      dateProducts += o.productCount || 0
    }
    if (currentDate) {
      sdRows.push(['', `${currentDate} Subtotal`, '', dateTotal, dateProducts])
    }
    sdRows.push([])
    const allTotal = orders.reduce((s: number, o: any) => s + (o.total || 0), 0)
    const allProds = orders.reduce((s: number, o: any) => s + (o.productCount || 0), 0)
    sdRows.push(['GRAND TOTAL', '', '', allTotal, allProds])

    const ws6 = XLSX.utils.aoa_to_sheet(sdRows)
    setColWidths(ws6, [16, 14, 26, 14, 12])
    for (let r = 1; r < sdRows.length; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 3 })
      if (ws6[addr] && typeof ws6[addr].v === 'number') ws6[addr].z = '$#,##0.00'
    }
    XLSX.utils.book_append_sheet(wb, ws6, 'By Ship Date')

    // ── Generate buffer ──
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const dateStr = now.toISOString().slice(0, 10)
    const fileName = `Sales Orders Shipping Next ${days} Days - ${dateStr}.xlsx`

    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': buf.length.toString(),
      },
    })
  } catch (err: any) {
    console.error('Report generation error:', err)
    return NextResponse.json({ error: err.message || 'Generation failed' }, { status: 500 })
  }
}
