export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'
import { audit } from '@/lib/audit'

interface RouteParams {
  params: { id: string }
}

/**
 * POST /api/ops/purchasing/[id]/send
 * Emails the PO to the vendor via Resend. Body: { to?: string, cc?: string }
 * If no `to` is provided, falls back to vendor.email.
 * Does NOT change status — caller should PATCH status=SENT_TO_VENDOR separately,
 * which keeps the action composable from the UI.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json().catch(() => ({} as any))
    const override = typeof body?.to === 'string' ? body.to.trim() : ''

    const poRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT po."poNumber", po.total, po."expectedDate", po.notes,
              v.name as "vendorName", v.email as "vendorEmail", v."contactName"
         FROM "PurchaseOrder" po
         LEFT JOIN "Vendor" v ON po."vendorId" = v.id
        WHERE po.id = $1`,
      id,
    )

    if (!poRows || poRows.length === 0) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    const po = poRows[0]
    const to = override || po.vendorEmail
    if (!to) {
      return NextResponse.json({ error: 'No vendor email on file and no override provided' }, { status: 400 })
    }

    const items = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "vendorSku", description, quantity, "unitCost", "lineTotal"
         FROM "PurchaseOrderItem"
        WHERE "purchaseOrderId" = $1
        ORDER BY "createdAt" ASC`,
      id,
    )

    const fmtMoney = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))

    const rows = items
      .map(
        (i) => `<tr>
            <td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace">${i.vendorSku ?? ''}</td>
            <td style="padding:8px;border-bottom:1px solid #eee">${i.description ?? ''}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${i.quantity ?? 0}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmtMoney(i.unitCost)}</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmtMoney(i.lineTotal)}</td>
          </tr>`,
      )
      .join('')

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#111;max-width:640px">
        <h2 style="margin:0 0 4px">Abel Lumber Purchase Order ${po.poNumber}</h2>
        <p style="color:#555;margin:0 0 16px">Vendor: <strong>${po.vendorName ?? ''}</strong>${
          po.contactName ? ` · ${po.contactName}` : ''
        }</p>
        ${po.expectedDate ? `<p style="margin:0 0 16px">Expected: <strong>${new Date(po.expectedDate).toLocaleDateString()}</strong></p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f6f6f6">
              <th style="padding:8px;text-align:left">SKU</th>
              <th style="padding:8px;text-align:left">Description</th>
              <th style="padding:8px;text-align:right">Qty</th>
              <th style="padding:8px;text-align:right">Unit</th>
              <th style="padding:8px;text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:18px;font-size:13px"><strong>Total: ${fmtMoney(po.total)}</strong></p>
        ${po.notes ? `<p style="margin-top:16px;color:#555;font-size:12px;white-space:pre-wrap">${po.notes}</p>` : ''}
        <p style="margin-top:24px;color:#888;font-size:11px">Abel Lumber · app.abellumber.com</p>
      </div>
    `

    const result = await sendEmail({
      to,
      subject: `Abel Lumber PO ${po.poNumber}`,
      html,
    })

    // Audit log — best effort
    audit(request, 'SEND_EMAIL', 'PurchaseOrder', id, {
      to,
      result: result.success ? 'ok' : result.error,
    }).catch(() => {})

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 })
    }

    return NextResponse.json({ ok: true, emailId: result.id, to })
  } catch (err: any) {
    console.error('POST /api/ops/purchasing/[id]/send error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to send' }, { status: 500 })
  }
}
