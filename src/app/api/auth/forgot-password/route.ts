export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { sendPasswordResetEmail } from '@/lib/email'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logger, getRequestId } from '@/lib/logger'

// POST /api/auth/forgot-password — generate a reset token
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    const limited = await checkRateLimit(request, authLimiter, 10, 'builder-reset')
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
      // Find builder by email
      const builderRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "contactName" FROM "Builder" WHERE email = $1`,
        normalizedEmail
      )

      if (builderRows.length === 0) {
        return successResponse // Don't reveal whether email exists
      }

      const builder = builderRows[0]

      // Generate a secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex')
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      // Store token in database using raw SQL
      await prisma.$executeRawUnsafe(
        `UPDATE "Builder" SET "resetToken" = $1, "resetTokenExpiry" = $2 WHERE id = $3`,
        resetToken,
        resetTokenExpiry,
        builder.id
      )

      // Build reset URL.
      // Fallback chain matches src/lib/email.ts so a missing NEXT_PUBLIC_APP_URL
      // doesn't silently produce a relative /reset-password?... link that breaks
      // when opened from Gmail/Outlook. Warn in logs so the real fix (setting
      // the env var) stays visible until done.
      if (!process.env.NEXT_PUBLIC_APP_URL) {
        console.warn(
          '[forgot-password:builder] NEXT_PUBLIC_APP_URL is unset — reset links will use fallback.'
        )
      }
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.NODE_ENV === 'production'
          ? 'https://app.abellumber.com'
          : 'http://localhost:3000')
      const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`

      // Send password reset email (logs to console if RESEND_API_KEY not set)
      await sendPasswordResetEmail({
        to: builder.email,
        name: builder.contactName,
        resetUrl,
      })

      return successResponse
    } catch (dbError) {
      logger.error('forgot_password_db_error', dbError, { requestId })
      return successResponse // Still return success response to prevent enumeration
    }
  } catch (error: any) {
    logger.error('forgot_password_error', error, { requestId })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
