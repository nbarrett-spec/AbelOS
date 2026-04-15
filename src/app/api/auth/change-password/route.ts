export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { getSession, verifyPassword, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { authLimiter, checkRateLimit } from '@/lib/rate-limit';
import { logger, getRequestId } from '@/lib/logger';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    // Get builder session
    const session = await getSession();
    if (!session || !session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Rate limit password changes (per-session key so one attacker can't
    // lock out a victim by flooding their builder id).
    const limited = await checkRateLimit(
      request,
      authLimiter,
      10,
      `password-change:${session.builderId}`
    );
    if (limited) return limited;

    // Parse request body
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'currentPassword and newPassword are required' },
        { status: 400 }
      );
    }

    // Fetch current password hash from database
    const result = await prisma.$queryRawUnsafe<{ passwordHash: string }[]>(
      'SELECT "passwordHash" FROM "Builder" WHERE "id" = $1',
      session.builderId
    );

    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      );
    }

    const { passwordHash } = result[0];

    // Verify current password
    const isPasswordValid = await verifyPassword(currentPassword, passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 400 }
      );
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password in database
    await prisma.$executeRawUnsafe(
      'UPDATE "Builder" SET "passwordHash" = $1 WHERE "id" = $2',
      newPasswordHash,
      session.builderId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('change_password_error', error, { requestId });

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
