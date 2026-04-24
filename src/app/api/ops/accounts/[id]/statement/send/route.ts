export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/accounts/[id]/statement/send
// Stub handler: records intent to send a builder account statement.
// The actual email-rendering + transactional send is not yet wired up
// (Resend templates for monthly statements are tracked separately).
// This endpoint exists so the "Send statement" button on /ops/accounts/[id]
// resolves cleanly instead of 404, and so audit captures who clicked when.
//
// Returns 202 Accepted with `queued: true` to make the fire-and-forget
// semantics explicit. Once the send pipeline is wired, this handler can
// dispatch the actual job without any frontend changes.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const builderId = params.id

  try {
    // Verify builder exists so a typo'd id doesn't silently no-op.
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; email: string | null; companyName: string | null }>>(
      `SELECT id, email, "companyName" FROM "Builder" WHERE id = $1 LIMIT 1`,
      builderId
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }
    const builder = rows[0]

    audit(request, 'CREATE', 'Account', builderId, {
      method: 'POST',
      action: 'statement_send_requested',
      builderEmail: builder.email,
      companyName: builder.companyName,
    }).catch(() => {})

    return NextResponse.json(
      {
        queued: true,
        builderId,
        message: 'Statement send queued. Email delivery is not yet wired up; this records the request.',
      },
      { status: 202 }
    )
  } catch (error: any) {
    console.error('POST /api/ops/accounts/[id]/statement/send error:', error)
    return NextResponse.json({ error: 'Failed to queue statement send' }, { status: 500 })
  }
}
