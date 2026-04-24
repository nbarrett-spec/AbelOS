export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { sendEmail, getPublicAppUrl } from '@/lib/email'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'

// POST /api/ops/auth/forgot-password — generate a reset token for staff
export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, authLimiter, 10, 'staff-reset')
    if (limited) return limited

    const { email } = await request.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
    })

    try {
      // Find staff by email
      const staffRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "firstName", "lastName" FROM "Staff" WHERE email = $1 AND active = true`,
        normalizedEmail
      )

      if (staffRows.length === 0) {
        return successResponse
      }

      const staff = staffRows[0]

      // Generate a secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex')
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      // Store token in database
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET "resetToken" = $1, "resetTokenExpiry" = $2 WHERE id = $3`,
        resetToken,
        resetTokenExpiry,
        staff.id
      )

      // Audit: someone initiated a password reset for this staff account.
      // CRITICAL severity so it surfaces on the security dashboard — abuse
      // of this flow is a classic phishing vector.
      logAudit({
        staffId: staff.id,
        staffName: `${staff.firstName} ${staff.lastName}`.trim(),
        action: 'REQUEST_PASSWORD_RESET',
        entity: 'Staff',
        entityId: staff.id,
        ipAddress:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          request.headers.get('x-real-ip') ||
          undefined,
        userAgent: request.headers.get('user-agent') || undefined,
        severity: 'CRITICAL',
      }).catch(() => {})

      // Build reset URL via getPublicAppUrl() — this refuses any vercel.app /
      // per-deployment URL from NEXT_PUBLIC_APP_URL and falls back to the
      // canonical https://app.abellumber.com alias. See src/lib/email.ts for
      // the full rationale (DEPLOYMENT_NOT_FOUND breakage in April 2026).
      const baseUrl = getPublicAppUrl()
      const resetUrl = `${baseUrl}/ops/reset-password?token=${resetToken}`

      // Send password reset email
      const APP_URL = baseUrl
      await sendEmail({
        to: staff.email,
        subject: 'Reset Your Abel Operations Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
            <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <div style="background-color: #0f2a3e; padding: 24px 32px; text-align: left;">
                <table><tr>
                  <td style="background-color: #C6A24E; border-radius: 8px; width: 36px; height: 36px; text-align: center; vertical-align: middle; font-weight: bold; color: white; font-size: 14px;">AB</td>
                  <td style="padding-left: 12px; color: white; font-size: 18px; font-weight: 600;">Abel Operations</td>
                </tr></table>
              </div>
              <div style="padding: 32px;">
                <h2 style="color: #0f2a3e; margin-top: 0;">Reset Your Password</h2>
                <p style="color: #333; font-size: 15px; line-height: 1.6;">
                  Hi ${staff.firstName},
                </p>
                <p style="color: #333; font-size: 15px; line-height: 1.6;">
                  We received a request to reset your staff portal password. Click the button below to create a new one:
                </p>
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${resetUrl}" style="background-color: #C6A24E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
                    Reset Password
                  </a>
                </div>
                <p style="color: #666; font-size: 13px; line-height: 1.6;">
                  This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
                </p>
                <p style="color: #999; font-size: 12px; margin-top: 24px;">
                  Can't click the button? Copy and paste this link: <br>
                  <a href="${resetUrl}" style="color: #C6A24E; word-break: break-all;">${resetUrl}</a>
                </p>
              </div>
              <div style="padding: 24px 32px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee;">
                <p>Abel Lumber &middot; Door &amp; Trim Specialists</p>
              </div>
            </div>
          </body>
          </html>
        `,
      })

      return successResponse
    } catch (dbError) {
      console.error('Database error during staff forgot password:', dbError)
      return successResponse
    }
  } catch (error: any) {
    console.error('Staff forgot password error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
