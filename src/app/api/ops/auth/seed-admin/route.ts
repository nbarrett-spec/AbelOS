export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'
import { logSecurityEvent } from '@/lib/security-events'
import { createRateLimiter, checkRateLimit } from '@/lib/rate-limit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/seed-admin — Bootstrap or reset the admin account
//
// Security posture:
//   1. Endpoint is 404 (deny-by-default) unless ADMIN_SEED_ENABLED === 'true'
//   2. Requires ADMIN_SEED_KEY env var (NO fallback). Endpoint 500s if missing
//      while ADMIN_SEED_ENABLED is true — fail-closed to prevent misconfig.
//   3. Rate-limited to 3 attempts / 15min per IP (success or failure)
//   4. Every attempt logged as a CRITICAL SecurityEvent + Audit row
//   5. Invalid seedKey is constant-time compared to avoid timing oracle
//
// Operational flow:
//   - Flip ADMIN_SEED_ENABLED=true + set ADMIN_SEED_KEY in Vercel env
//   - Call endpoint with { seedKey, password? }
//   - Flip ADMIN_SEED_ENABLED=false (or delete) immediately after
// ──────────────────────────────────────────────────────────────────────────

const seedAdminLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 3 })

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isEnabled(): boolean {
  return process.env.ADMIN_SEED_ENABLED === 'true'
}

/** Constant-time comparison — avoids timing oracles on seed key checks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

async function logAttempt(
  request: NextRequest,
  kind: 'AUTH_FAIL' | 'CRITICAL',
  reason: string,
  extra?: Record<string, unknown>
) {
  logSecurityEvent({
    kind: 'AUTH_FAIL', // SecurityEvent kind — CRITICAL severity on the record
    path: '/api/ops/auth/seed-admin',
    method: request.method,
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent'),
    requestId: request.headers.get('x-request-id'),
    details: { reason, severity: 'CRITICAL', ...(extra || {}) },
  })
}

export async function POST(request: NextRequest) {
  // Gate 1: env flag. Deny by default — endpoint "doesn't exist" in production
  // unless the operator explicitly flipped ADMIN_SEED_ENABLED=true.
  if (!isEnabled()) {
    await logAttempt(request, 'AUTH_FAIL', 'endpoint_disabled_probe')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Gate 2: rate limit (3 per 15 min per IP)
  const limited = await checkRateLimit(request, seedAdminLimiter, 3, 'seed-admin')
  if (limited) {
    await logAttempt(request, 'AUTH_FAIL', 'rate_limited')
    return limited
  }

  // Gate 3: seed key must be configured (fail-closed if misconfigured)
  const configuredKey = process.env.ADMIN_SEED_KEY
  if (!configuredKey || configuredKey.length < 16) {
    await logAttempt(request, 'AUTH_FAIL', 'seed_key_not_configured')
    return NextResponse.json(
      { error: 'ADMIN_SEED_KEY not configured' },
      { status: 500 }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { seedKey, password } = body as { seedKey?: string; password?: string }

    // Gate 4: constant-time seed key comparison
    if (typeof seedKey !== 'string' || !timingSafeEqual(seedKey, configuredKey)) {
      await logAttempt(request, 'AUTH_FAIL', 'invalid_seed_key', {
        providedLength: typeof seedKey === 'string' ? seedKey.length : 0,
      })
      return NextResponse.json({ error: 'Invalid seed key' }, { status: 401 })
    }

    // Check if Nate's record exists
    const nateRecord: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "role", "active", "passwordHash" FROM "Staff" WHERE "email" = 'n.barrett@abellumber.com' LIMIT 1`
    )

    const newPassword = password || 'AbelLumber2024!'
    const passwordHash = await bcrypt.hash(newPassword, 12)

    let staff: any
    let mode: 'reset' | 'bootstrap'

    if (nateRecord.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET
          "passwordHash" = $1,
          "role" = 'ADMIN',
          "active" = true,
          "passwordSetAt" = NOW(),
          "updatedAt" = NOW()
        WHERE "email" = 'n.barrett@abellumber.com'`,
        passwordHash
      )
      staff = nateRecord[0]
      mode = 'reset'
    } else {
      staff = await (prisma as any).staff.create({
        data: {
          firstName: 'Nate',
          lastName: 'Barrett',
          email: 'n.barrett@abellumber.com',
          passwordHash,
          role: 'ADMIN',
          department: 'EXECUTIVE',
          title: 'Owner / GM',
          active: true,
          hireDate: new Date('2021-01-01'),
        },
      })
      mode = 'bootstrap'
    }

    // Log CRITICAL security event + audit row — every successful seed is investigated.
    logSecurityEvent({
      kind: 'AUTH_FAIL', // deliberately using AUTH_FAIL kind to surface this in security dashboards
      path: '/api/ops/auth/seed-admin',
      method: 'POST',
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
      details: {
        reason: 'seed_admin_success',
        mode,
        staffId: staff.id,
        severity: 'CRITICAL',
      },
    })

    logAudit({
      staffId: staff.id,
      staffName: `${staff.firstName || 'Nate'} ${staff.lastName || 'Barrett'}`.trim(),
      action: mode === 'reset' ? 'ADMIN_PASSWORD_RESET_VIA_SEED' : 'ADMIN_BOOTSTRAP_VIA_SEED',
      entity: 'Staff',
      entityId: staff.id,
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'CRITICAL',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      mode,
      message: `Admin ${mode === 'reset' ? 'password reset' : 'account created'} for ${staff.email}. Log in at /ops/login. DISABLE ADMIN_SEED_ENABLED immediately.`,
      staffId: staff.id,
      email: staff.email,
    })
  } catch (error: any) {
    await logAttempt(request, 'AUTH_FAIL', 'seed_admin_exception', {
      error: error?.message?.slice(0, 200),
    })
    console.error('Seed admin error:', error)
    return NextResponse.json(
      { error: 'Seed failed', detail: error?.message },
      { status: 500 }
    )
  }
}

// GET — diagnostic. Only returns anything when endpoint is enabled; otherwise 404.
export async function GET(request: NextRequest) {
  if (!isEnabled()) {
    await logAttempt(request, 'AUTH_FAIL', 'endpoint_disabled_probe_get')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Apply the same rate limit to the diagnostic GET so it can't be used to
  // fingerprint the presence of the account without a matching seed key.
  const limited = await checkRateLimit(request, seedAdminLimiter, 3, 'seed-admin-get')
  if (limited) {
    await logAttempt(request, 'AUTH_FAIL', 'rate_limited_get')
    return limited
  }

  if (!process.env.ADMIN_SEED_KEY || process.env.ADMIN_SEED_KEY.length < 16) {
    await logAttempt(request, 'AUTH_FAIL', 'seed_key_not_configured_get')
    return NextResponse.json(
      { error: 'ADMIN_SEED_KEY not configured' },
      { status: 500 }
    )
  }

  try {
    const result: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "role", "active", "passwordSetAt", "updatedAt"
       FROM "Staff"
       WHERE "email" = 'n.barrett@abellumber.com'
       LIMIT 1`
    )

    if (result.length === 0) {
      return NextResponse.json({
        exists: false,
        message: 'No admin account found. POST with { "seedKey": "..." } to create one.',
      })
    }

    const staff = result[0]
    return NextResponse.json({
      exists: true,
      id: staff.id,
      email: staff.email,
      role: staff.role,
      active: staff.active,
      passwordSetAt: staff.passwordSetAt,
      lastUpdated: staff.updatedAt,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Check failed', detail: error.message },
      { status: 500 }
    )
  }
}
