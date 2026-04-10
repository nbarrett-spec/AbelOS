export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// GET /api/invoices/[id]/pdf — Generate branded invoice PDF
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session?.builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const invoiceId = params.id

    // Fetch invoice with builder info
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i.id, i."invoiceNumber", i.status::text as status,
             i.subtotal, i."taxAmount", i.total, i."amountPaid", i."balanceDue",
             i."paymentTerm", i."issuedAt", i."dueDate", i."paidAt", i.notes,
             b."companyName", b."contactName", b.email, b.phone,
             b.address, b.city, b.state, b.zip,
             o."orderNumber", o."poNumber"
      FROM "Invoice" i
      JOIN "Builder" b ON i."builderId" = b.id
      LEFT JOIN "Order" o ON i."orderId" = o.id
      WHERE i.id = $1 AND i."builderId" = $2
    `, invoiceId, session.builderId)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const inv = rows[0]

    // Fetch line items
    let lineItems: any[] = []
    try {
      lineItems = await prisma.$queryRawUnsafe(`
        SELECT ii.description, ii.quantity, ii."unitPrice", ii.total,
               p.sku, p.name as "productName"
        FROM "InvoiceItem" ii
        LEFT JOIN "Product" p ON ii."productSku" = p.sku
        WHERE ii."invoiceId" = $1
        ORDER BY ii.id
      `, invoiceId)
    } catch {
      // Try order items if no InvoiceItem table
      try {
        lineItems = await prisma.$queryRawUnsafe(`
          SELECT oi.description, oi.quantity, oi."unitPrice", oi.total,
                 p.sku, p.name as "productName"
          FROM "OrderItem" oi
          LEFT JOIN "Product" p ON oi."productSku" = p.sku
          WHERE oi."orderId" = (SELECT "orderId" FROM "Invoice" WHERE id = $1)
          ORDER BY oi.id
        `, invoiceId)
      } catch (e: any) { console.warn('[Invoice PDF] Failed to fetch line items:', e?.message) }
    }

    // Generate PDF
    const doc = new jsPDF()
    const NAVY = [27, 79, 114] as [number, number, number]
    const ORANGE = [230, 126, 34] as [number, number, number]
    const pageWidth = doc.internal.pageSize.getWidth()

    // Header background
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, pageWidth, 42, 'F')

    // Logo block
    doc.setFillColor(...ORANGE)
    doc.roundedRect(14, 10, 22, 22, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text('AB', 19.5, 24)

    // Company name
    doc.setFontSize(18)
    doc.text('Abel Lumber', 42, 20)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text('Door & Trim Specialists  |  Gainesville, TX', 42, 28)

    // "INVOICE" title
    doc.setFontSize(28)
    doc.setFont('helvetica', 'bold')
    doc.text('INVOICE', pageWidth - 14, 24, { align: 'right' })

    // Invoice info section
    let y = 52

    // Left: Bill To
    doc.setTextColor(...NAVY)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('BILL TO', 14, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)
    doc.setFontSize(10)
    doc.text(inv.companyName || '', 14, y + 6)
    doc.setFontSize(9)
    doc.text(inv.contactName || '', 14, y + 12)
    if (inv.address) doc.text(inv.address, 14, y + 18)
    if (inv.city) doc.text(`${inv.city}, ${inv.state || ''} ${inv.zip || ''}`, 14, y + 24)
    if (inv.email) doc.text(inv.email, 14, y + 30)
    if (inv.phone) doc.text(inv.phone, 14, y + 36)

    // Right: Invoice details
    const rightX = pageWidth - 14
    doc.setTextColor(...NAVY)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('INVOICE DETAILS', rightX, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60, 60, 60)

    const details = [
      ['Invoice #:', inv.invoiceNumber || '—'],
      ['Date:', inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('en-US') : '—'],
      ['Due Date:', inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-US') : '—'],
      ['Status:', (inv.status || '').replace(/_/g, ' ')],
      ['Payment Terms:', inv.paymentTerm || '—'],
    ]
    if (inv.orderNumber) details.push(['Order #:', inv.orderNumber])
    if (inv.poNumber) details.push(['PO #:', inv.poNumber])

    details.forEach((d, i) => {
      doc.setFont('helvetica', 'bold')
      doc.text(d[0], rightX - 45, y + 6 + i * 6)
      doc.setFont('helvetica', 'normal')
      doc.text(d[1], rightX, y + 6 + i * 6, { align: 'right' })
    })

    // Line items table
    y = 102

    // Orange divider
    doc.setDrawColor(...ORANGE)
    doc.setLineWidth(1)
    doc.line(14, y, pageWidth - 14, y)
    y += 4

    const fmtCurrency = (n: number) => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

    const tableBody = lineItems.length > 0
      ? lineItems.map((li, i) => [
          String(i + 1),
          li.sku || '—',
          li.productName || li.description || '—',
          String(li.quantity || 1),
          fmtCurrency(Number(li.unitPrice || 0)),
          fmtCurrency(Number(li.total || 0)),
        ])
      : [['1', '—', 'See order for details', '—', '—', fmtCurrency(Number(inv.subtotal || inv.total))]]

    autoTable(doc, {
      startY: y,
      head: [['#', 'SKU', 'Description', 'Qty', 'Unit Price', 'Total']],
      body: tableBody,
      margin: { left: 14, right: 14 },
      headStyles: {
        fillColor: NAVY,
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 25 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 25, halign: 'right' },
        5: { cellWidth: 25, halign: 'right' },
      },
      alternateRowStyles: { fillColor: [245, 248, 252] },
      theme: 'grid',
      styles: { lineColor: [220, 220, 220], lineWidth: 0.2 },
    })

    // Totals section
    const finalY = (doc as any).lastAutoTable?.finalY || y + 40
    let totY = finalY + 10
    const labelX = pageWidth - 75

    const drawTotalRow = (label: string, value: string, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 11 : 9)
      doc.setTextColor(bold ? NAVY[0] : 80, bold ? NAVY[1] : 80, bold ? NAVY[2] : 80)
      doc.text(label, labelX, totY)
      doc.text(value, rightX, totY, { align: 'right' })
      totY += bold ? 8 : 6
    }

    drawTotalRow('Subtotal:', fmtCurrency(Number(inv.subtotal || 0)))
    drawTotalRow('Tax:', fmtCurrency(Number(inv.taxAmount || 0)))

    doc.setDrawColor(...ORANGE)
    doc.setLineWidth(0.5)
    doc.line(labelX, totY - 2, rightX, totY - 2)
    totY += 2

    drawTotalRow('TOTAL:', fmtCurrency(Number(inv.total || 0)), true)

    if (Number(inv.amountPaid) > 0) {
      drawTotalRow('Amount Paid:', fmtCurrency(Number(inv.amountPaid)))
    }
    if (Number(inv.balanceDue) > 0) {
      doc.setTextColor(231, 76, 60)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text('Balance Due:', labelX, totY)
      doc.text(fmtCurrency(Number(inv.balanceDue)), rightX, totY, { align: 'right' })
      totY += 8
    }

    // Notes
    if (inv.notes) {
      totY += 6
      doc.setTextColor(...NAVY)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.text('Notes:', 14, totY)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(80, 80, 80)
      doc.setFontSize(8)
      const noteLines = doc.splitTextToSize(inv.notes, pageWidth - 28)
      doc.text(noteLines, 14, totY + 5)
    }

    // Footer
    const footerY = doc.internal.pageSize.getHeight() - 16
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.3)
    doc.line(14, footerY - 4, pageWidth - 14, footerY - 4)
    doc.setTextColor(150, 150, 150)
    doc.setFontSize(7)
    doc.text('Abel Lumber  •  Door & Trim Specialists  •  Gainesville, TX  •  abellumber.com', pageWidth / 2, footerY, { align: 'center' })
    doc.text(`Generated ${new Date().toLocaleDateString('en-US')}`, pageWidth / 2, footerY + 4, { align: 'center' })

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'))

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Invoice-${inv.invoiceNumber || inv.id}.pdf"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error: any) {
    console.error('Invoice PDF error:', error)
    return NextResponse.json({ error: error.message || 'Failed to generate PDF' }, { status: 500 })
  }
}
