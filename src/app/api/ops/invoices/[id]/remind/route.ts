export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { sendEmail, wrap } from '@/lib/email'

interface RouteParams {
  params: { id: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // ── Kill switch: builder invoice emails are OFF until explicitly enabled ──
  if (process.env.BUILDER_INVOICE_EMAILS_ENABLED !== 'true') {
    return NextResponse.json({
      success: false,
      disabled: true,
      reason: 'Builder invoice emails disabled (set BUILDER_INVOICE_EMAILS_ENABLED=true to enable)',
    }, { status: 503 })
  }

  try {
    const { id } = params

    // Fetch invoice with builder details
    const invoiceRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."invoiceNumber", i."builderId", i."total",
             (i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue",
             i."status"::text AS "status", i."dueDate", i."paymentTerm"::text AS "paymentTerm",
             b."email", b."companyName"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      WHERE i."id" = $1
    `, id)

    if (invoiceRows.length === 0) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const invoice = invoiceRows[0]

    // Validate we have what we need
    if (!invoice.email) {
      return NextResponse.json(
        {
          success: false,
          method: 'mailto',
          emailData: {
            invoiceNumber: invoice.invoiceNumber,
            builderName: invoice.companyName,
            total: invoice.total,
            balanceDue: invoice.balanceDue,
            dueDate: invoice.dueDate,
            paymentTerm: invoice.paymentTerm,
          },
          message: 'No email address found for builder. Provide emailData to frontend for mailto fallback.'
        },
        { status: 400 }
      )
    }

    // Build email content
    const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(invoice.total)
    const formattedBalance = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(invoice.balanceDue)
    const dueStr = invoice.dueDate
      ? new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'Upon receipt'

    const htmlContent = wrap(`
      <h2 style="color: #0f2a3e; margin-top: 0;">Payment Reminder — Invoice ${invoice.invoiceNumber}</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${invoice.companyName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        This is a friendly reminder that invoice <strong>${invoice.invoiceNumber}</strong> has a balance due.
      </p>
      <div style="background: #fff8f0; border: 1px solid #f0d0a0; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Invoice Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${invoice.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Original Amount</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${formattedTotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Balance Due</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #C6A24E;">${formattedBalance}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Due Date</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${dueStr}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Terms</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${invoice.paymentTerm.replace(/_/g, ' ')}</td>
          </tr>
        </table>
      </div>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Please process payment at your earliest convenience. If payment has already been sent, please disregard this notice.
      </p>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Questions about this invoice? Reply to this email or call our billing team at (940) 555-ABEL.
      </p>
    `)

    // Attempt to send via email service
    const emailResult = await sendEmail({
      to: invoice.email,
      subject: `Payment Reminder — Invoice ${invoice.invoiceNumber}`,
      html: htmlContent,
      replyTo: 'billing@abellumber.com',
    })

    if (emailResult.success) {
      // Log the action
      await audit(request, 'CREATE', 'ReminderEmail', id, {
        invoiceNumber: invoice.invoiceNumber,
        builderId: invoice.builderId,
        email: invoice.email,
      })

      return NextResponse.json({
        success: true,
        method: 'email',
        emailSent: true,
        invoiceNumber: invoice.invoiceNumber,
        builderName: invoice.companyName,
        message: `Payment reminder sent to ${invoice.email}`,
      })
    } else {
      // Email service failed, return data for mailto fallback
      return NextResponse.json(
        {
          success: false,
          method: 'mailto',
          emailData: {
            invoiceNumber: invoice.invoiceNumber,
            builderName: invoice.companyName,
            builderEmail: invoice.email,
            total: invoice.total,
            balanceDue: invoice.balanceDue,
            dueDate: invoice.dueDate,
            paymentTerm: invoice.paymentTerm,
          },
          message: emailResult.error || 'Email service unavailable. Use mailto fallback.',
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('POST /api/ops/invoices/[id]/remind error:', error)
    return NextResponse.json({ error: 'Failed to send reminder' }, { status: 500 })
  }
}
