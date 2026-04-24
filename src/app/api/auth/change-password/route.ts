export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { getSession, verifyPassword, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { authLimiter, checkRateLimit } from '@/lib/rate-limit';
import { logger, getRequestId } from '@/lib/logger';
import { logAudit } from '@/lib/audit';

// Fire-and-forget audit call. logAudit() internally try/catches + returns ''
// on any failure, and we attach .catch(() => {}) defensively so a rejected
// promise can never bubble up and break the auth response. Audit logging
// MUST NOT fail the request. Not awaited — keeps response timing unchanged.
function getIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const ipAddress = getIp(request);
  const userAgent = request.headers.get('user-agent') || 'unknown';
  try {
    // Get builder session
    const session = await getSession();
    if (!session || !session.builderId) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_UNAUTHORIZED',
        entity: 'auth',
        details: { route: 'change-password', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {});
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
    if (limited) {
      logAudit({
        staffId: `builder:${session.builderId}`,
        action: 'FAIL_RATE_LIMIT',
        entity: 'auth',
        entityId: session.builderId,
        details: { route: 'change-password', userId: session.builderId, ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {});
      return limited;
    }

    // Parse request body
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      logAudit({
        staffId: `builder:${session.builderId}`,
        action: 'FAIL_VALIDATION',
        entity: 'auth',
        entityId: session.builderId,
        details: { route: 'change-password', userId: session.builderId, ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {});
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
      logAudit({
        staffId: `builder:${session.builderId}`,
        action: 'FAIL_USER_NOT_FOUND',
        entity: 'auth',
        entityId: session.builderId,
        details: { route: 'change-password', userId: session.builderId, ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {});
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      );
    }

    const { passwordHash } = result[0];

    // Verify current password
    const isPasswordValid = await verifyPassword(currentPassword, passwordHash);
    if (!isPasswordValid) {
      logAudit({
        staffId: `builder:${session.builderId}`,
        action: 'FAIL_WRONG_PASSWORD',
        entity: 'auth',
        entityId: session.builderId,
        details: { route: 'change-password', userId: session.builderId, ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {});
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

    logAudit({
      staffId: `builder:${session.builderId}`,
      action: 'CHANGE_PASSWORD',
      entity: 'auth',
      entityId: session.builderId,
      details: { userId: session.builderId, ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('change_password_error', error, { requestId });

    if (error instanceof SyntaxError) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_BAD_JSON',
        entity: 'auth',
        details: { route: 'change-password', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {});
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    logAudit({
      staffId: 'unknown',
      action: 'FAIL_ERROR',
      entity: 'auth',
      details: { route: 'change-password', ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {});
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    );
  }
}
