export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// Helper function to escape CSV fields
function escapeCSVField(field: any): string {
  if (field === null || field === undefined) return ''
  const str = String(field)
  // Escape quotes and wrap in quotes if contains comma, newline, or quote
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"` // Escape quotes by doubling them
  }
  return str
}

// Helper to format date to ISO string
function formatDateField(date: any): string {
  if (!date) return ''
  const d = new Date(date)
  return d.toISOString().split('T')[0] // YYYY-MM-DD format
}

// Helper to format currency
function formatCurrency(amount: any): string {
  if (!amount && amount !== 0) return ''
  return String(amount)
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'deals'
    const today = new Date().toISOString().split('T')[0]

    let csv = ''
    let filename = `export-${today}.csv`

    if (type === 'deals') {
      filename = `deals-export-${today}.csv`

      // Fetch deals using raw SQL
      const deals: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT
          d."dealNumber",
          d."companyName",
          d."contactName",
          d."contactEmail",
          d."contactPhone",
          d."stage",
          d."dealValue",
          d."probability",
          d."source",
          s."firstName",
          s."lastName",
          d."expectedCloseDate",
          d."createdAt"
        FROM "Deal" d
        LEFT JOIN "Staff" s ON d."ownerId" = s."id"
        ORDER BY d."createdAt" DESC
        `
      )

      // Build CSV headers
      const headers = ['Deal Number', 'Company', 'Contact', 'Email', 'Phone', 'Stage', 'Value', 'Probability', 'Source', 'Owner', 'Expected Close', 'Created']
      csv = headers.map(h => escapeCSVField(h)).join(',') + '\n'

      // Build CSV rows
      for (const deal of deals) {
        const ownerName = deal.firstName && deal.lastName ? `${deal.firstName} ${deal.lastName}` : ''
        const row = [
          deal.dealNumber,
          deal.companyName,
          deal.contactName,
          deal.contactEmail,
          deal.contactPhone,
          deal.stage,
          formatCurrency(deal.dealValue),
          deal.probability,
          deal.source,
          ownerName,
          formatDateField(deal.expectedCloseDate),
          formatDateField(deal.createdAt),
        ]
        csv += row.map(f => escapeCSVField(f)).join(',') + '\n'
      }
    } else if (type === 'quotes') {
      filename = `quotes-export-${today}.csv`

      // Fetch quotes using raw SQL
      const quotes: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT
          q."quoteNumber",
          b."companyName" as "builderCompany",
          p."name" as "projectName",
          q."status",
          q."subtotal",
          q."total",
          q."validUntil",
          q."createdAt"
        FROM "Quote" q
        JOIN "Project" p ON q."projectId" = p."id"
        JOIN "Builder" b ON p."builderId" = b."id"
        ORDER BY q."createdAt" DESC
        `
      )

      // Build CSV headers
      const headers = ['Quote Number', 'Builder', 'Project', 'Status', 'Subtotal', 'Total', 'Valid Until', 'Created']
      csv = headers.map(h => escapeCSVField(h)).join(',') + '\n'

      // Build CSV rows
      for (const quote of quotes) {
        const row = [
          quote.quoteNumber,
          quote.builderCompany,
          quote.projectName,
          quote.status,
          formatCurrency(quote.subtotal),
          formatCurrency(quote.total),
          formatDateField(quote.validUntil),
          formatDateField(quote.createdAt),
        ]
        csv += row.map(f => escapeCSVField(f)).join(',') + '\n'
      }
    } else if (type === 'builders') {
      filename = `builders-export-${today}.csv`

      // Fetch builders using raw SQL
      const builders: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT
          "companyName",
          "contactName",
          "email",
          "phone",
          "status",
          "paymentTerm",
          "creditLimit"
        FROM "Builder"
        ORDER BY "companyName" ASC
        `
      )

      // Build CSV headers
      const headers = ['Company Name', 'Contact', 'Email', 'Phone', 'Status', 'Payment Term', 'Credit Limit']
      csv = headers.map(h => escapeCSVField(h)).join(',') + '\n'

      // Build CSV rows
      for (const builder of builders) {
        const row = [
          builder.companyName,
          builder.contactName,
          builder.email,
          builder.phone || '',
          builder.status,
          builder.paymentTerm,
          formatCurrency(builder.creditLimit),
        ]
        csv += row.map(f => escapeCSVField(f)).join(',') + '\n'
      }
    } else if (type === 'invoices') {
      filename = `invoices-export-${today}.csv`

      // Fetch invoices using raw SQL
      const invoices: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT
          i."invoiceNumber",
          i."builderId",
          i."status",
          i."subtotal",
          i."taxAmount",
          i."total",
          i."amountPaid",
          i."balanceDue",
          i."issuedAt",
          i."dueDate",
          i."paidAt",
          s."firstName",
          s."lastName"
        FROM "Invoice" i
        LEFT JOIN "Staff" s ON i."createdById" = s."id"
        ORDER BY i."createdAt" DESC
        `
      )

      // Build CSV headers
      const headers = ['Invoice Number', 'Builder ID', 'Status', 'Subtotal', 'Tax', 'Total', 'Amount Paid', 'Balance Due', 'Issued', 'Due Date', 'Paid Date', 'Created By']
      csv = headers.map(h => escapeCSVField(h)).join(',') + '\n'

      // Build CSV rows
      for (const invoice of invoices) {
        const createdByName =
          invoice.firstName && invoice.lastName
            ? `${invoice.firstName} ${invoice.lastName}`
            : ''
        const row = [
          invoice.invoiceNumber,
          invoice.builderId,
          invoice.status,
          formatCurrency(invoice.subtotal),
          formatCurrency(invoice.taxAmount),
          formatCurrency(invoice.total),
          formatCurrency(invoice.amountPaid),
          formatCurrency(invoice.balanceDue),
          formatDateField(invoice.issuedAt),
          formatDateField(invoice.dueDate),
          formatDateField(invoice.paidAt),
          createdByName,
        ]
        csv += row.map(f => escapeCSVField(f)).join(',') + '\n'
      }
    } else {
      return NextResponse.json({ error: 'Invalid export type. Use: deals, quotes, builders, or invoices' }, { status: 400 })
    }

    // Return CSV response
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error('Error exporting data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
