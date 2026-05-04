/**
 * POST /api/admin/builders/[id]/invite — Send portal invite to an existing builder.
 *
 * Use case: Brookfield, Bloomfield, Toll, etc. were data-imported from
 * InFlow. They have a Builder row but no passwordHash. Staff triggers
 * this endpoint from /admin/builders/[id] to onboard them to the portal.
 *
 * Flow:
 *   1. Verify staff auth (ADMIN/MANAGER/SALES_REP can invite).
 *   2. Look up Builder. Reject if already has a passwordHash AND status=ACTIVE
 *      (they're already onboarded — use password-reset instead). Reject if no
 *      email (can't deliver the invite).
 *   3. Generate a 32-byte invite token (hex). Store on Builder row with a
 *      48h expiry. Set status=ACTIVE so they can log in immediately after
 *      setting their password.
 *   4. Send invite email via Resend with link to /reset-password?token=...&invite=true.
 *      The /reset-password page already understands the token flow — clicking
 *      sets the password, and they can log in right away.
 *   5. Audit log INVITE action (CRITICAL).
 *   6. Return { ok, emailSent, emailId? }.
 *
 * Idempotency: each call generates a fresh token. Old tokens for the same
 * builder are overwritten — only the most recent invite is valid.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { sendBuilderInviteEmail, getPublicAppUrl } from '@/lib/email'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { id } = params

  try {
    // Look up builder
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName", "contactName", email, status, "passwordHash"
         FROM "Builder" WHERE id = $1 LIMIT 1`,
      id,
    )
    const builder = rows?.[0]
    if (!builder) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }
    if (!builder.email) {
      return NextResponse.json(
        { error: 'Builder has no email on file. Add one before inviting.' },
        { status: 400 },
      )
    }
    if (builder.passwordHash && builder.status === 'ACTIVE') {
      return NextResponse.json(
        {
          error:
            'This builder already has a password and is ACTIVE. Use the password-reset flow instead.',
        },
        { status: 409 },
      )
    }

    // Generate fresh invite token (48h expiry)
    const token = randomBytes(32).toString('hex')

    await prisma.$executeRawUnsafe(
      `UPDATE "Builder"
          SET "resetToken" = $1,
              "resetTokenExpiry" = NOW() + INTERVAL '48 hours',
              status = 'ACTIVE',
              "updatedAt" = NOW()
        WHERE id = $2`,
      token,
      id,
    )

    // Send invite email — fire-and-forget but capture the result so we can
    // tell the admin UI whether delivery succeeded.
    const inviteUrl = `${getPublicAppUrl()}/reset-password?token=${token}&invite=true`
    let emailSent = false
    let emailId: string | undefined
    let emailError: string | undefined
    try {
      const result = await sendBuilderInviteEmail({
        to: builder.email,
        contactName: builder.contactName || 'there',
        companyName: builder.companyName,
        inviteUrl,
      })
      emailSent = result.success
      emailId = result.id
      emailError = result.error
    } catch (err: any) {
      emailError = err?.message || String(err)
      logger.warn('builder_invite_email_failed', { msg: emailError, builderId: id })
    }

    await audit(
      request,
      'INVITE',
      'Builder',
      id,
      {
        builderId: id,
        email: builder.email,
        emailSent,
        emailId,
        priorStatus: builder.status,
        priorHasPassword: !!builder.passwordHash,
      },
      'CRITICAL',
    ).catch(() => {})

    return NextResponse.json({
      ok: true,
      builderId: id,
      emailSent,
      emailId,
      emailError,
      // Don't echo the token to the admin response — it's a credential.
      // The token only travels via email to the builder's inbox.
    })
  } catch (err: any) {
    logger.error('builder_invite_error', err, { builderId: id })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
