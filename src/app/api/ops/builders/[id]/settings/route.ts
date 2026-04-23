export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/builders/[id]/settings — read lifecycle/notification toggles.
// Keeps the main builder PATCH endpoint focused on core fields while letting
// the settings UI edit per-flag toggles independently.
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
         "id",
         "companyName",
         "autoInvoiceOnDelivery",
         "notifyEmail",
         "notifySms",
         "notifyDeliveryUpdates",
         "notifyInvoiceReady",
         "notifyPaymentReceived"
       FROM "Builder"
       WHERE "id" = $1`,
      params.id
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const b = rows[0]
    return NextResponse.json({
      settings: {
        autoInvoiceOnDelivery: b.autoInvoiceOnDelivery ?? true,
        notifyEmail: b.notifyEmail ?? true,
        notifySms: b.notifySms ?? false,
        notifyDeliveryUpdates: b.notifyDeliveryUpdates ?? true,
        notifyInvoiceReady: b.notifyInvoiceReady ?? true,
        notifyPaymentReceived: b.notifyPaymentReceived ?? true,
      },
      builder: { id: b.id, companyName: b.companyName },
    })
  } catch (err) {
    console.error('Failed to fetch builder settings:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH /api/ops/builders/[id]/settings — update one or more toggles.
// Accepts a partial body; unset fields are left alone. Returns the updated
// settings so the UI can re-sync without re-fetching.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()

    const booleanFields = [
      'autoInvoiceOnDelivery',
      'notifyEmail',
      'notifySms',
      'notifyDeliveryUpdates',
      'notifyInvoiceReady',
      'notifyPaymentReceived',
    ] as const

    const setClauses: string[] = []
    const queryParams: any[] = [params.id]
    let paramIndex = 2

    for (const field of booleanFields) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'boolean') {
          return NextResponse.json(
            { error: `${field} must be a boolean` },
            { status: 400 }
          )
        }
        setClauses.push(`"${field}" = $${paramIndex}`)
        queryParams.push(body[field])
        paramIndex++
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json(
        { error: 'No toggle fields provided' },
        { status: 400 }
      )
    }

    setClauses.push(`"updatedAt" = NOW()`)

    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "Builder" SET ${setClauses.join(', ')}
       WHERE "id" = $1
       RETURNING "id", "companyName", "autoInvoiceOnDelivery",
                 "notifyEmail", "notifySms", "notifyDeliveryUpdates",
                 "notifyInvoiceReady", "notifyPaymentReceived"`,
      ...queryParams
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const b = updated[0]
    await audit(request, 'BUILDER_SETTINGS_UPDATE', 'Builder', params.id, body)

    return NextResponse.json({
      settings: {
        autoInvoiceOnDelivery: b.autoInvoiceOnDelivery ?? true,
        notifyEmail: b.notifyEmail ?? true,
        notifySms: b.notifySms ?? false,
        notifyDeliveryUpdates: b.notifyDeliveryUpdates ?? true,
        notifyInvoiceReady: b.notifyInvoiceReady ?? true,
        notifyPaymentReceived: b.notifyPaymentReceived ?? true,
      },
    })
  } catch (err) {
    console.error('Failed to update builder settings:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
