/**
 * POST /api/ops/staff/bulk-invite
 *
 * Sends invitation emails to all staff who haven't been invited yet
 * (no password set, no invite token). Generates a unique invite token
 * for each, stores it, and sends the email.
 *
 * Query params:
 *   ?dryRun=true — preview who would be invited without sending
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { sendInviteEmail } from '@/lib/email'
import { randomBytes } from 'crypto'
import { audit } from '@/lib/audit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true'

  try {
    // Audit log
    audit(request, 'CREATE', 'Staff', undefined, { method: 'POST' }).catch(() => {})

    // Find all active staff without a password (never set up their account)
    // or with an expired/null invite token
    const uninvited: any[] = await prisma.$queryRawUnsafe(
      `SELECT s.id, s."firstName", s."lastName", s.email, s.role::text, s.department::text,
              s."inviteToken", s."inviteTokenExpiry", s."passwordHash"
       FROM "Staff" s
       WHERE s.active = true
         AND s.email IS NOT NULL
         AND s.email != ''
         AND (s."passwordHash" IS NULL OR s."passwordHash" = '')
       ORDER BY s."firstName" ASC`
    )

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        message: `${uninvited.length} staff members would be invited`,
        staff: uninvited.map(s => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          email: s.email,
          role: s.role,
          department: s.department,
          hasExistingToken: !!s.inviteToken,
          tokenExpired: s.inviteTokenExpiry ? new Date(s.inviteTokenExpiry) < new Date() : true,
        })),
      })
    }

    // Ensure invite columns exist
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT`)
      await prisma.$executeRawUnsafe(`ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "inviteTokenExpiry" TIMESTAMPTZ`)
    } catch (e: any) {
      console.warn('[BulkInvite] Column migration:', e?.message)
    }

    const results: { name: string; email: string; status: string; error?: string }[] = []

    for (const staff of uninvited) {
      try {
        // Generate unique invite token (7-day expiry)
        const token = randomBytes(32).toString('hex')
        const expiry = new Date()
        expiry.setDate(expiry.getDate() + 7)

        // Store token on staff record
        await prisma.$executeRawUnsafe(
          `UPDATE "Staff" SET
            "inviteToken" = $1,
            "inviteTokenExpiry" = $2::timestamptz,
            "updatedAt" = NOW()
          WHERE id = $3`,
          token, expiry, staff.id
        )

        // Build invite URL
        const inviteUrl = `${APP_URL}/ops/auth/setup?token=${token}`

        // Send email
        const emailResult = await sendInviteEmail({
          to: staff.email,
          firstName: staff.firstName,
          inviteUrl,
        })

        if (emailResult.success) {
          results.push({ name: `${staff.firstName} ${staff.lastName}`, email: staff.email, status: 'sent' })
        } else {
          results.push({ name: `${staff.firstName} ${staff.lastName}`, email: staff.email, status: 'email_failed', error: emailResult.error })
        }

        // Small delay between emails to avoid rate limits
        await new Promise(r => setTimeout(r, 200))
      } catch (err: any) {
        results.push({
          name: `${staff.firstName} ${staff.lastName}`,
          email: staff.email,
          status: 'error',
          error: err.message,
        })
      }
    }

    const sent = results.filter(r => r.status === 'sent').length
    const failed = results.filter(r => r.status !== 'sent').length

    return NextResponse.json({
      success: true,
      message: `${sent} invitations sent, ${failed} failed out of ${uninvited.length} staff`,
      sent,
      failed,
      total: uninvited.length,
      results,
    })
  } catch (error: any) {
    console.error('[BulkInvite]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
