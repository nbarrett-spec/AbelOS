export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PAYMENT_TERM_LABELS } from '@/lib/constants'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    // Fetch quote with all necessary relations (raw SQL to get signatureData, approvedAt, etc.)
    const quotes: any[] = await prisma.$queryRaw`
      SELECT q.*, p."name" as "projectName", p."planName", p."sqFootage",
             p."jobAddress", p."city" as "projectCity", p."state" as "projectState",
             p."lotNumber", p."subdivision",
             b."companyName", b."contactName", b."email" as "builderEmail",
             b."phone" as "builderPhone", b."address" as "builderAddress",
             b."city" as "builderCity", b."state" as "builderState",
             b."zip" as "builderZip", b."paymentTerm"
      FROM "Quote" q
      JOIN "Project" p ON p."id" = q."projectId"
      JOIN "Builder" b ON b."id" = p."builderId"
      WHERE q."id" = ${params.id} AND p."builderId" = ${session.builderId}
      LIMIT 1
    ` as any[]

    if (quotes.length === 0) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    const quoteRow = quotes[0]

    // Fetch quote items
    const quoteItems: any[] = await prisma.$queryRaw`
      SELECT * FROM "QuoteItem"
      WHERE "quoteId" = ${params.id}
      ORDER BY "sortOrder" ASC, "location" ASC
    ` as any[]

    // Build a quote-like object for backward compat with template below
    const quote = {
      ...quoteRow,
      items: quoteItems,
      project: {
        name: quoteRow.projectName,
        planName: quoteRow.planName,
        sqFootage: quoteRow.sqFootage,
        jobAddress: quoteRow.jobAddress,
        city: quoteRow.projectCity,
        state: quoteRow.projectState,
        lotNumber: quoteRow.lotNumber,
        subdivision: quoteRow.subdivision,
        builder: {
          companyName: quoteRow.companyName,
          contactName: quoteRow.contactName,
          email: quoteRow.builderEmail,
          phone: quoteRow.builderPhone,
          address: quoteRow.builderAddress,
          city: quoteRow.builderCity,
          state: quoteRow.builderState,
          zip: quoteRow.builderZip,
          paymentTerm: quoteRow.paymentTerm,
        },
      },
    }

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    // Generate PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 15
    let yPosition = margin

    // ─── TOP ACCENT BAR ────────────────────────────────
    pdf.setFillColor(230, 126, 34) // #E67E22 abel-orange
    pdf.rect(0, 0, pageWidth, 4, 'F')
    pdf.setFillColor(27, 79, 114) // #1B4F72 navy
    pdf.rect(0, 4, pageWidth, 1.5, 'F')

    yPosition = 12

    // ─── HEADER ─────────────────────────────────────────
    // Logo/Company Name
    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(28)
    pdf.setTextColor(27, 79, 114) // #1B4F72 navy
    pdf.text('ABEL LUMBER', margin, yPosition)

    // Tagline
    pdf.setFont('Helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(100, 100, 100)
    pdf.text('Building Materials & Door Solutions', margin, yPosition + 8)

    // Status badge
    const statusColors: Record<string, [number, number, number]> = {
      DRAFT: [156, 163, 175],
      SENT: [59, 130, 246],
      APPROVED: [34, 197, 94],
      REJECTED: [239, 68, 68],
    }
    const badgeColor = statusColors[quote.status] || [156, 163, 175]
    const statusLabel = quote.status
    const badgeWidth = pdf.getTextWidth(statusLabel) + 10
    pdf.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2])
    pdf.roundedRect(pageWidth - margin - badgeWidth - 55, yPosition - 7, badgeWidth + 4, 8, 2, 2, 'F')
    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(255, 255, 255)
    pdf.text(statusLabel, pageWidth - margin - badgeWidth - 53, yPosition - 1.5)

    // Quote number and date on the right
    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(27, 79, 114)
    const quoteText = `Quote #${quote.quoteNumber}`
    const quoteTextWidth = pdf.getTextWidth(quoteText)
    pdf.text(quoteText, pageWidth - margin - quoteTextWidth, yPosition)

    // Date
    pdf.setFont('Helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(100, 100, 100)
    const dateText = `Date: ${formatDate(quote.createdAt)}`
    const dateTextWidth = pdf.getTextWidth(dateText)
    pdf.text(dateText, pageWidth - margin - dateTextWidth, yPosition + 6)

    // Valid until
    const validUntilText = `Valid until: ${formatDate(quote.validUntil || new Date())}`
    const validUntilWidth = pdf.getTextWidth(validUntilText)
    pdf.text(
      validUntilText,
      pageWidth - margin - validUntilWidth,
      yPosition + 12
    )

    yPosition += 25

    // ─── BUILDER INFO SECTION ───────────────────────────
    pdf.setDrawColor(200, 200, 200)
    pdf.rect(margin, yPosition, pageWidth - 2 * margin, 0.5)
    yPosition += 3

    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(27, 79, 114)
    pdf.text('Bill To:', margin, yPosition)

    yPosition += 6

    pdf.setFont('Helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(0, 0, 0)

    if (quote.project.builder) {
      const builder = quote.project.builder
      pdf.text(builder.companyName, margin, yPosition)
      yPosition += 5
      pdf.text(builder.contactName, margin, yPosition)
      yPosition += 5

      if (builder.email) {
        pdf.text(`Email: ${builder.email}`, margin, yPosition)
        yPosition += 5
      }
      if (builder.phone) {
        pdf.text(`Phone: ${builder.phone}`, margin, yPosition)
        yPosition += 5
      }
      if (builder.address) {
        pdf.text(
          `${builder.address}, ${builder.city}, ${builder.state} ${builder.zip}`,
          margin,
          yPosition
        )
        yPosition += 5
      }
    }

    // Payment term badge
    const paymentTermLabel =
      PAYMENT_TERM_LABELS[
        quote.project.builder.paymentTerm as keyof typeof PAYMENT_TERM_LABELS
      ] || quote.project.builder.paymentTerm

    pdf.setFillColor(27, 79, 114)
    pdf.rect(
      pageWidth - margin - 45,
      yPosition - 10,
      45,
      8,
      'F'
    )
    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(255, 255, 255)
    const termTextWidth = pdf.getTextWidth(paymentTermLabel)
    pdf.text(
      paymentTermLabel,
      pageWidth - margin - 45 + (45 - termTextWidth) / 2,
      yPosition - 3
    )

    yPosition += 8

    // ─── PROJECT INFO SECTION ───────────────────────────
    yPosition += 3
    pdf.setDrawColor(200, 200, 200)
    pdf.rect(margin, yPosition, pageWidth - 2 * margin, 0.5)
    yPosition += 3

    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(27, 79, 114)
    pdf.text('Project Information:', margin, yPosition)

    yPosition += 6

    pdf.setFont('Helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(0, 0, 0)

    pdf.text(`Project: ${quote.project.name}`, margin, yPosition)
    yPosition += 5

    if (quote.project.planName) {
      pdf.text(`Plan: ${quote.project.planName}`, margin, yPosition)
      yPosition += 5
    }

    if (quote.project.sqFootage) {
      pdf.text(`Square Footage: ${quote.project.sqFootage.toLocaleString()}`, margin, yPosition)
      yPosition += 5
    }

    if (quote.project.jobAddress) {
      pdf.text(
        `Address: ${quote.project.jobAddress}, ${quote.project.city}, ${quote.project.state}`,
        margin,
        yPosition
      )
      yPosition += 5
    }

    if (quote.project.lotNumber) {
      pdf.text(`Lot #: ${quote.project.lotNumber}`, margin, yPosition)
      yPosition += 5
    }

    if (quote.project.subdivision) {
      pdf.text(`Subdivision: ${quote.project.subdivision}`, margin, yPosition)
      yPosition += 5
    }

    yPosition += 5

    // ─── LINE ITEMS TABLE ────────────────────────────────
    // Group items by location
    const itemsByLocation: Record<string, typeof quote.items> = {}
    for (const item of quote.items) {
      const location = item.location || 'General'
      if (!itemsByLocation[location]) {
        itemsByLocation[location] = []
      }
      itemsByLocation[location].push(item)
    }

    const tableData: any[] = []
    const locations = Object.keys(itemsByLocation).sort()

    for (const location of locations) {
      const items = itemsByLocation[location]

      // Add location header
      tableData.push(
        Array(4)
          .fill('')
          .map((_, i) => ({
            content: i === 0 ? location : '',
            styles: {
              fontStyle: 'bold',
              fillColor: [240, 240, 240],
              textColor: 27,
              fontSize: 10,
            },
          }))
      )

      // Add items for this location
      for (const item of items) {
        tableData.push([
          item.description,
          item.quantity.toString(),
          formatCurrency(item.unitPrice),
          formatCurrency(item.lineTotal),
        ])
      }
    }

    autoTable(pdf, {
      startY: yPosition,
      head: [['Description', 'Qty', 'Unit Price', 'Total']],
      body: tableData,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        fillColor: [27, 79, 114],
        textColor: 255,
        fontStyle: 'bold',
        halign: 'left',
      },
      bodyStyles: {
        textColor: 0,
      },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
      alternateRowStyles: {
        fillColor: [250, 250, 250],
      },
      didDrawPage: (data: any) => {
        yPosition = data.lastAutoTable.finalY
      },
    })

    yPosition = (pdf as any).lastAutoTable?.finalY || yPosition + 10

    // ─── TOTALS SECTION ─────────────────────────────────
    yPosition += 8

    const rightColX = pageWidth - margin - 60
    const labelColX = rightColX - 70

    pdf.setFont('Helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(0, 0, 0)

    // Subtotal
    pdf.text('Subtotal:', labelColX, yPosition)
    pdf.text(formatCurrency(quote.subtotal), rightColX, yPosition, {
      align: 'right',
    })
    yPosition += 5

    // Term adjustment
    if (quote.termAdjustment !== 0) {
      const adjustmentLabel =
        quote.termAdjustment < 0
          ? 'Payment Term Discount:'
          : 'Payment Term Adjustment:'
      pdf.text(adjustmentLabel, labelColX, yPosition)
      const adjustmentText =
        quote.termAdjustment < 0
          ? `-${formatCurrency(Math.abs(quote.termAdjustment))}`
          : `+${formatCurrency(quote.termAdjustment)}`
      pdf.text(adjustmentText, rightColX, yPosition, { align: 'right' })
      yPosition += 5
    }

    // Total
    pdf.setFont('Helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.setTextColor(27, 79, 114)
    pdf.text('Total:', labelColX, yPosition)
    pdf.text(formatCurrency(quote.total), rightColX, yPosition, {
      align: 'right',
    })

    // ─── SIGNATURE / APPROVAL SECTION ────────────────────
    if (quote.status === 'APPROVED' && (quote as any).signatureData) {
      yPosition += 12
      // Check if we need a new page
      if (yPosition > pageHeight - 60) {
        pdf.addPage()
        yPosition = margin
      }

      pdf.setDrawColor(34, 197, 94) // green
      pdf.setLineWidth(0.5)
      pdf.rect(margin, yPosition, pageWidth - 2 * margin, 35, 'S')

      yPosition += 6
      pdf.setFillColor(34, 197, 94)
      pdf.roundedRect(margin + 5, yPosition - 4, 22, 6, 1, 1, 'F')
      pdf.setFont('Helvetica', 'bold')
      pdf.setFontSize(7)
      pdf.setTextColor(255, 255, 255)
      pdf.text('APPROVED', margin + 7, yPosition)

      yPosition += 6
      pdf.setFont('Helvetica', 'normal')
      pdf.setFontSize(10)
      pdf.setTextColor(0, 0, 0)
      pdf.text(`Signed by: ${(quote as any).approvedBy || ''}`, margin + 5, yPosition)

      yPosition += 6
      // Signature rendering (italic for typed signature)
      pdf.setFont('Helvetica', 'italic')
      pdf.setFontSize(16)
      pdf.setTextColor(27, 79, 114)
      pdf.text((quote as any).signatureData || '', margin + 5, yPosition)

      yPosition += 7
      pdf.setFont('Helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(100, 100, 100)
      const approvedDate = (quote as any).approvedAt ? formatDate(new Date((quote as any).approvedAt)) : ''
      pdf.text(`Date approved: ${approvedDate}`, margin + 5, yPosition)
    } else if (quote.status === 'SENT' || quote.status === 'DRAFT') {
      // Signature line for unsigned quotes
      yPosition += 12
      if (yPosition > pageHeight - 45) {
        pdf.addPage()
        yPosition = margin
      }

      pdf.setDrawColor(200, 200, 200)
      pdf.line(margin, yPosition + 10, margin + 80, yPosition + 10)
      pdf.setFont('Helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(100, 100, 100)
      pdf.text('Authorized Signature', margin, yPosition + 14)

      pdf.line(pageWidth - margin - 50, yPosition + 10, pageWidth - margin, yPosition + 10)
      pdf.text('Date', pageWidth - margin - 50, yPosition + 14)
    }

    // ─── FOOTER (on every page) ────────────────────────────
    const totalPages = pdf.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i)

      // Bottom accent line
      pdf.setFillColor(230, 126, 34)
      pdf.rect(0, pageHeight - 2, pageWidth, 2, 'F')

      pdf.setFont('Helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(130, 130, 130)

      const footerY = pageHeight - 8

      pdf.text(
        'Abel Lumber  |  Building Materials & Door Solutions  |  DFW Metro Area',
        pageWidth / 2,
        footerY,
        { align: 'center' }
      )

      pdf.text(
        `Page ${i} of ${totalPages}`,
        pageWidth - margin,
        footerY,
        { align: 'right' }
      )

      pdf.setFontSize(7)
      pdf.text(
        'This quote is valid for 30 days from the date issued.',
        pageWidth / 2,
        footerY + 4,
        { align: 'center' }
      )
    }

    // Generate filename
    const filename = `${quote.quoteNumber}.pdf`

    // Return PDF as response
    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('PDF generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate PDF' },
      { status: 500 }
    )
  }
}
