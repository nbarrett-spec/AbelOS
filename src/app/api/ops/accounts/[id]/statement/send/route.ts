export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// POST /api/ops/accounts/[id]/statement/send
//
// Renders a builder account statement PDF and emails it to the builder.
//
// Body (all optional):
//   recipientEmail?: string  // override the to-address
//   since?: string           // ISO date — start of the statement window (default: 90 days ago)
//   message?: string         // free-form message body inserted into the email
//
// Resolution order for `to`:
//   1. body.recipientEmail
//   2. Builder.email
//   3. first BuilderContact.email (active, isPrimary first, then any)
//   4. 400 if none
//
// Auth: staff only (checkStaffAuth handles the role gate).
//
// Side effects:
//   • Generates a real PDF (jspdf + jspdf-autotable, same stack as
//     /api/invoices/[id]/pdf).
//   • Sends via Resend REST API with the PDF as a base64 attachment
//     (the @/lib/email helper doesn't support attachments yet, so we
//     post directly with the same env vars / kill-switch behavior).
//   • Writes an EmailEvent row (kind=STATEMENT) for outbound tracking.
//     The table is auto-created if missing — same defensive pattern
//     audit.ts uses for AuditLog. This is non-destructive.
//   • Audit log entry under entity:'Account', action:'CREATE'.

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Abel Lumber <billing@abellumber.com>'

let emailEventTableEnsured = false
async function ensureEmailEventTable() {
  if (emailEventTableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EmailEvent" (
        "id" TEXT PRIMARY KEY,
        "kind" TEXT NOT NULL,
        "recipientEmail" TEXT NOT NULL,
        "builderId" TEXT,
        "subject" TEXT,
        "providerId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'SENT',
        "errorMessage" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_emailevent_builder" ON "EmailEvent" ("builderId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_emailevent_kind" ON "EmailEvent" ("kind", "createdAt" DESC)
    `)
    emailEventTableEnsured = true
  } catch {
    // Same pattern as ensureTable in audit.ts — swallow so a perms hiccup
    // doesn't break the user-facing send.
    emailEventTableEnsured = true
  }
}

interface LedgerEntry {
  date: Date
  type: 'INVOICE' | 'PAYMENT'
  reference: string
  description: string
  charges: number
  payments: number
  balance: number
}

function fmtCurrency(n: number): string {
  return '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface BuilderRow {
  id: string
  email: string | null
  companyName: string | null
  contactName: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  accountBalance: number | null
  creditLimit: number | null
  paymentTerm: string | null
}

async function generateStatementPdf(
  builder: BuilderRow,
  since: Date
): Promise<{ buffer: Buffer; summary: { totalCharges: number; totalPayments: number; balance: number } }> {
  // Pull invoices in window
  const invoices = await prisma.$queryRawUnsafe<
    Array<{ id: string; invoiceNumber: string; total: number; issuedAt: Date; description: string }>
  >(
    `SELECT i.id, i."invoiceNumber", i.total::float as total, i."issuedAt",
            CONCAT('Invoice ', i."invoiceNumber") as description
       FROM "Invoice" i
      WHERE i."builderId" = $1
        AND i."issuedAt" >= $2
        AND i."status"::text NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')
      ORDER BY i."issuedAt" ASC`,
    builder.id,
    since
  )

  // Pull payments in window
  let payments: Array<{ id: string; amount: number; receivedAt: Date; reference: string | null; invoiceNumber: string }> = []
  try {
    payments = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.amount::float as amount, p."receivedAt", p.reference,
              i."invoiceNumber"
         FROM "Payment" p
         JOIN "Invoice" i ON p."invoiceId" = i.id
        WHERE i."builderId" = $1
          AND p."receivedAt" >= $2
        ORDER BY p."receivedAt" ASC`,
      builder.id,
      since
    )
  } catch {
    // Payment table may have a different shape on some envs; degrade silently.
  }

  // Opening balance: invoices - payments before window
  const openingRows = await prisma.$queryRawUnsafe<Array<{ invoiceTotal: string; paymentTotal: string }>>(
    `SELECT
        COALESCE((SELECT SUM(total) FROM "Invoice"
                   WHERE "builderId" = $1
                     AND "issuedAt" < $2
                     AND "status"::text NOT IN ('DRAFT', 'VOID', 'WRITE_OFF')), 0)::text as "invoiceTotal",
        COALESCE((SELECT SUM(p.amount) FROM "Payment" p
                   JOIN "Invoice" i ON p."invoiceId" = i.id
                  WHERE i."builderId" = $1
                    AND p."receivedAt" < $2), 0)::text as "paymentTotal"`,
    builder.id,
    since
  )
  const opening = openingRows[0]
    ? parseFloat(opening_safe(openingRows[0].invoiceTotal)) - parseFloat(opening_safe(openingRows[0].paymentTotal))
    : 0
  let runningBalance = opening

  // Combine + sort
  const all: Array<
    | { kind: 'inv'; date: Date; invoiceNumber: string; description: string; amount: number }
    | { kind: 'pay'; date: Date; reference: string | null; invoiceNumber: string; amount: number }
  > = [
    ...invoices.map((i) => ({
      kind: 'inv' as const,
      date: new Date(i.issuedAt),
      invoiceNumber: i.invoiceNumber,
      description: i.description,
      amount: Number(i.total),
    })),
    ...payments.map((p) => ({
      kind: 'pay' as const,
      date: new Date(p.receivedAt),
      reference: p.reference,
      invoiceNumber: p.invoiceNumber,
      amount: Number(p.amount),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime())

  const ledger: LedgerEntry[] = []
  for (const txn of all) {
    if (txn.kind === 'inv') {
      runningBalance += txn.amount
      ledger.push({
        date: txn.date,
        type: 'INVOICE',
        reference: txn.invoiceNumber,
        description: txn.description,
        charges: txn.amount,
        payments: 0,
        balance: runningBalance,
      })
    } else {
      runningBalance -= txn.amount
      ledger.push({
        date: txn.date,
        type: 'PAYMENT',
        reference: txn.reference || txn.invoiceNumber,
        description: `Payment - ${txn.invoiceNumber}`,
        charges: 0,
        payments: txn.amount,
        balance: runningBalance,
      })
    }
  }

  const totalCharges = ledger.reduce((s, e) => s + e.charges, 0)
  const totalPayments = ledger.reduce((s, e) => s + e.payments, 0)

  // ── Render PDF (mirrors the look of /api/invoices/[id]/pdf)
  const doc = new jsPDF()
  const NAVY: [number, number, number] = [27, 79, 114]
  const ORANGE: [number, number, number] = [230, 126, 34]
  const pageWidth = doc.internal.pageSize.getWidth()

  // Header
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, pageWidth, 42, 'F')
  doc.setFillColor(...ORANGE)
  doc.roundedRect(14, 10, 22, 22, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('AB', 19.5, 24)
  doc.setFontSize(18)
  doc.text('Abel Lumber', 42, 20)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Door & Trim Specialists  |  Gainesville, TX', 42, 28)
  doc.setFontSize(28)
  doc.setFont('helvetica', 'bold')
  doc.text('STATEMENT', pageWidth - 14, 24, { align: 'right' })

  // Bill-to + period
  let y = 52
  doc.setTextColor(...NAVY)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('ACCOUNT', 14, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  doc.setFontSize(10)
  doc.text(builder.companyName || '', 14, y + 6)
  doc.setFontSize(9)
  if (builder.contactName) doc.text(builder.contactName, 14, y + 12)
  if (builder.address) doc.text(builder.address, 14, y + 18)
  if (builder.city) doc.text(`${builder.city}, ${builder.state || ''} ${builder.zip || ''}`, 14, y + 24)
  if (builder.email) doc.text(builder.email, 14, y + 30)
  if (builder.phone) doc.text(builder.phone, 14, y + 36)

  const rightX = pageWidth - 14
  doc.setTextColor(...NAVY)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('STATEMENT DETAILS', rightX, y, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)
  const details: Array<[string, string]> = [
    ['Statement Date:', fmtDate(new Date())],
    ['Period Start:', fmtDate(since)],
    ['Period End:', fmtDate(new Date())],
    ['Payment Terms:', builder.paymentTerm || '—'],
    ['Credit Limit:', builder.creditLimit != null ? fmtCurrency(Number(builder.creditLimit)) : '—'],
  ]
  details.forEach((d, i) => {
    doc.setFont('helvetica', 'bold')
    doc.text(d[0], rightX - 50, y + 6 + i * 6)
    doc.setFont('helvetica', 'normal')
    doc.text(d[1], rightX, y + 6 + i * 6, { align: 'right' })
  })

  // Ledger table
  y = 102
  doc.setDrawColor(...ORANGE)
  doc.setLineWidth(1)
  doc.line(14, y, pageWidth - 14, y)
  y += 4

  const body =
    ledger.length > 0
      ? [
          [
            fmtDate(since),
            'OPENING',
            '—',
            'Balance brought forward',
            '',
            '',
            fmtCurrency(opening),
          ],
          ...ledger.map((e) => [
            fmtDate(e.date),
            e.type,
            e.reference,
            e.description,
            e.charges > 0 ? fmtCurrency(e.charges) : '',
            e.payments > 0 ? fmtCurrency(e.payments) : '',
            fmtCurrency(e.balance),
          ]),
        ]
      : [
          [
            fmtDate(since),
            'OPENING',
            '—',
            'Balance brought forward',
            '',
            '',
            fmtCurrency(opening),
          ],
          ['', '', '', 'No activity in period', '', '', ''],
        ]

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Type', 'Ref', 'Description', 'Charges', 'Payments', 'Balance']],
    body,
    margin: { left: 14, right: 14 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold', halign: 'left' },
    bodyStyles: { fontSize: 8, textColor: [60, 60, 60] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 18 },
      2: { cellWidth: 22 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
    },
    alternateRowStyles: { fillColor: [245, 248, 252] },
    theme: 'grid',
    styles: { lineColor: [220, 220, 220], lineWidth: 0.2 },
  })

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

  drawTotalRow('Total Charges:', fmtCurrency(totalCharges))
  drawTotalRow('Total Payments:', fmtCurrency(totalPayments))
  doc.setDrawColor(...ORANGE)
  doc.setLineWidth(0.5)
  doc.line(labelX, totY - 2, rightX, totY - 2)
  totY += 2
  drawTotalRow('BALANCE DUE:', fmtCurrency(runningBalance), true)

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 16
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(14, footerY - 4, pageWidth - 14, footerY - 4)
  doc.setTextColor(150, 150, 150)
  doc.setFontSize(7)
  doc.text(
    'Abel Lumber  •  Door & Trim Specialists  •  Gainesville, TX  •  abellumber.com',
    pageWidth / 2,
    footerY,
    { align: 'center' }
  )
  doc.text(`Generated ${fmtDate(new Date())}`, pageWidth / 2, footerY + 4, { align: 'center' })

  const buffer = Buffer.from(doc.output('arraybuffer'))
  return { buffer, summary: { totalCharges, totalPayments, balance: runningBalance } }
}

// Defensive guard for null/undefined returned from raw SQL.
function opening_safe(v: string | null | undefined): string {
  return v == null ? '0' : String(v)
}

interface SendBody {
  recipientEmail?: string
  since?: string
  message?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const builderId = params.id

  try {
    const body: SendBody = await request.json().catch(() => ({}))

    // Load builder + addresses
    const builderRows = await prisma.$queryRawUnsafe<BuilderRow[]>(
      `SELECT id, email, "companyName", "contactName", phone, address, city, state, zip,
              "accountBalance"::float as "accountBalance",
              "creditLimit"::float as "creditLimit",
              "paymentTerm"::text as "paymentTerm"
         FROM "Builder"
        WHERE id = $1
        LIMIT 1`,
      builderId
    )
    if (builderRows.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }
    const builder = builderRows[0]

    // Resolve recipient
    let to = (body.recipientEmail || '').trim() || builder.email || null
    if (!to) {
      const contactRows = await prisma.$queryRawUnsafe<Array<{ email: string | null }>>(
        `SELECT email FROM "BuilderContact"
          WHERE "builderId" = $1
            AND active = true
            AND email IS NOT NULL
            AND email <> ''
          ORDER BY "isPrimary" DESC, "receivesInvoice" DESC, "createdAt" ASC
          LIMIT 1`,
        builderId
      )
      to = contactRows[0]?.email || null
    }
    if (!to) {
      return NextResponse.json(
        { error: 'No recipient email could be resolved (builder has no email and no active contacts with email).' },
        { status: 400 }
      )
    }

    // Determine since
    const since = body.since
      ? new Date(body.since)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    if (isNaN(since.getTime())) {
      return NextResponse.json({ error: 'Invalid since date' }, { status: 400 })
    }

    // Render PDF
    const { buffer: pdfBuffer, summary } = await generateStatementPdf(builder, since)

    // Send via Resend (REST, with attachment — @/lib/email.sendEmail
    // doesn't expose attachments today)
    const subject = `Account Statement — ${builder.companyName || 'Abel Lumber'}`
    const filename = `Abel-Statement-${builder.companyName?.replace(/[^a-z0-9]+/gi, '-') || builderId}-${new Date().toISOString().slice(0, 10)}.pdf`

    const messageBlock = body.message
      ? `<p style="color: #333; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${body.message
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
      : ''

    const html = `
      <!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
        <div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
          <div style="background:#0f2a3e;padding:24px 32px;color:#fff;">
            <div style="font-size:18px;font-weight:600;">Abel Lumber</div>
            <div style="font-size:12px;opacity:.85;">Door & Trim Specialists</div>
          </div>
          <div style="padding:32px;">
            <h2 style="color:#0f2a3e;margin-top:0;">Your Account Statement</h2>
            <p style="color:#333;font-size:15px;line-height:1.6;">
              Hi ${builder.contactName || 'there'},
            </p>
            <p style="color:#333;font-size:15px;line-height:1.6;">
              Attached is your account statement for <strong>${builder.companyName || 'your account'}</strong>
              covering activity from <strong>${fmtDate(since)}</strong> through <strong>${fmtDate(new Date())}</strong>.
            </p>
            ${messageBlock}
            <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;">
              <table style="width:100%;font-size:14px;color:#333;">
                <tr><td style="padding:6px 0;color:#666;">Total Charges</td>
                    <td style="padding:6px 0;text-align:right;font-weight:600;">${fmtCurrency(summary.totalCharges)}</td></tr>
                <tr><td style="padding:6px 0;color:#666;">Total Payments</td>
                    <td style="padding:6px 0;text-align:right;font-weight:600;">${fmtCurrency(summary.totalPayments)}</td></tr>
                <tr><td style="padding:6px 0;color:#666;">Balance Due</td>
                    <td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;color:#C6A24E;">${fmtCurrency(summary.balance)}</td></tr>
              </table>
            </div>
            <p style="color:#666;font-size:13px;line-height:1.6;">
              Questions about your statement? Reply to this email or call (940) 555-ABEL.
            </p>
          </div>
          <div style="padding:24px 32px;text-align:center;color:#999;font-size:12px;border-top:1px solid #eee;">
            Abel Lumber &middot; Gainesville, TX
          </div>
        </div>
      </body></html>
    `

    let providerId: string | null = null
    let sendOk = false
    let sendError: string | null = null

    if (process.env.EMAILS_GLOBAL_KILL === 'true') {
      sendError = 'EMAILS_GLOBAL_KILL=true — outbound email suppressed'
      logger.warn('email_global_kill_active', { to, subject })
    } else if (!RESEND_API_KEY) {
      sendError = 'Email service not configured (RESEND_API_KEY missing)'
      logger.warn('email_service_not_configured', { to, subject })
    } else {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [to],
            subject,
            html,
            reply_to: 'billing@abellumber.com',
            attachments: [
              {
                filename,
                content: pdfBuffer.toString('base64'),
              },
            ],
            tags: [
              { name: 'source', value: 'aegis' },
              { name: 'kind', value: 'statement' },
            ],
          }),
        })
        const data: any = await res.json().catch(() => ({}))
        if (!res.ok) {
          sendError = data?.message || `Resend ${res.status}`
          logger.error('statement_email_send_failed', new Error(sendError ?? 'unknown'), { to, subject })
        } else {
          sendOk = true
          providerId = String(data?.id ?? '')
        }
      } catch (e: any) {
        sendError = e?.message || String(e)
        logger.error('statement_email_send_threw', e, { to, subject })
      }
    }

    // EmailEvent row
    await ensureEmailEventTable()
    const sentAt = new Date()
    const eventId = `ee_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EmailEvent" ("id", "kind", "recipientEmail", "builderId", "subject", "providerId", "status", "errorMessage", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        eventId,
        'STATEMENT',
        to,
        builderId,
        subject,
        providerId,
        sendOk ? 'SENT' : 'FAILED',
        sendError,
        sentAt
      )
    } catch (e: any) {
      logger.error('email_event_insert_failed', e, { eventId, builderId })
    }

    audit(request, 'CREATE', 'Account', builderId, {
      method: 'POST',
      action: 'statement_sent',
      recipientEmail: to,
      providerId,
      success: sendOk,
      error: sendError,
      since: since.toISOString(),
      hasMessage: !!body.message,
      summary,
    }).catch(() => {})

    if (!sendOk) {
      return NextResponse.json(
        { ok: false, recipientEmail: to, error: sendError || 'Email send failed' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      ok: true,
      recipientEmail: to,
      sentAt: sentAt.toISOString(),
      providerId,
    })
  } catch (error: any) {
    console.error('POST /api/ops/accounts/[id]/statement/send error:', error)
    return NextResponse.json({ error: 'Failed to send statement' }, { status: 500 })
  }
}
