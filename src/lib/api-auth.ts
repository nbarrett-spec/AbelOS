import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession, StaffSessionPayload } from './staff-auth'
import { canAccessAPI, StaffRole, parseRoles } from './permissions'
import { logSecurityEvent } from './security-events'

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

// ──────────────────────────────────────────────────────────────────────────
// API Route Auth Helper (multi-role aware)
// ──────────────────────────────────────────────────────────────────────────
// Use in API route handlers for authentication + authorization.
//
// Usage:
//   const auth = await requireStaffAuth(request)
//   if (auth.error) return auth.error
//   const { session } = auth
//   // session.staffId, session.role, session.roles, etc.
// ──────────────────────────────────────────────────────────────────────────

interface AuthSuccess {
  session: StaffSessionPayload
  error: null
}

interface AuthFailure {
  session: null
  error: NextResponse
}

type AuthResult = AuthSuccess | AuthFailure

/**
 * Require staff authentication. Returns the session or an error response.
 * Optionally checks if the staff member's role is allowed for the current API path.
 * Now multi-role aware: checks ALL roles, access = union.
 */
export async function requireStaffAuth(
  request: NextRequest,
  options?: { allowedRoles?: StaffRole[] }
): Promise<AuthResult> {
  // First try to get session from headers (set by middleware)
  const staffId = request.headers.get('x-staff-id')
  const staffRole = request.headers.get('x-staff-role')
  const staffRolesStr = request.headers.get('x-staff-roles')
  const staffDept = request.headers.get('x-staff-department')
  const staffEmail = request.headers.get('x-staff-email')

  // If middleware set the headers, we can trust them
  if (staffId && staffRole && staffDept && staffEmail) {
    // Parse all roles (multi-role support)
    const allRoles = parseRoles(staffRolesStr || staffRole)

    const session: StaffSessionPayload = {
      staffId,
      email: staffEmail,
      firstName: '', // Not available from headers
      lastName: '',
      role: staffRole,
      roles: allRoles.join(','),
      department: staffDept,
      title: null,
    }

    // Check role-based access (multi-role: ANY role matches = allowed)
    const pathname = new URL(request.url).pathname
    if (options?.allowedRoles && options.allowedRoles.length > 0) {
      const hasAdmin = allRoles.includes('ADMIN')
      const hasAllowedRole = allRoles.some(r => options.allowedRoles!.includes(r as StaffRole))
      if (!hasAdmin && !hasAllowedRole) {
        logSecurityEvent({
          kind: 'AUTH_FAIL',
          path: pathname,
          method: request.method,
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent'),
          requestId: request.headers.get('x-request-id'),
          details: {
            reason: 'insufficient_role',
            staffId,
            roles: allRoles,
            requiredRoles: options.allowedRoles,
          },
        })
        return {
          session: null,
          error: NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 }
          ),
        }
      }
    }

    // Auto-check API path access (multi-role aware)
    if (!canAccessAPI(allRoles as StaffRole[], pathname)) {
      logSecurityEvent({
        kind: 'AUTH_FAIL',
        path: pathname,
        method: request.method,
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        requestId: request.headers.get('x-request-id'),
        details: {
          reason: 'path_not_allowed',
          staffId,
          roles: allRoles,
        },
      })
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Access denied for your role' },
          { status: 403 }
        ),
      }
    }

    return { session, error: null }
  }

  // Fallback: read session from cookie directly (for cases where middleware didn't run)
  const pathname = new URL(request.url).pathname
  const session = await getStaffSession()
  if (!session) {
    logSecurityEvent({
      kind: 'AUTH_FAIL',
      path: pathname,
      method: request.method,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
      details: { reason: 'no_cookie_session' },
    })
    return {
      session: null,
      error: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      ),
    }
  }

  // Parse all roles from session
  const allRoles = parseRoles(session.roles || session.role)

  // Check role (multi-role)
  if (options?.allowedRoles && options.allowedRoles.length > 0) {
    const hasAdmin = allRoles.includes('ADMIN')
    const hasAllowedRole = allRoles.some(r => options.allowedRoles!.includes(r as StaffRole))
    if (!hasAdmin && !hasAllowedRole) {
      logSecurityEvent({
        kind: 'AUTH_FAIL',
        path: pathname,
        method: request.method,
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        requestId: request.headers.get('x-request-id'),
        details: {
          reason: 'insufficient_role_cookie_path',
          staffId: session.staffId,
          roles: allRoles,
          requiredRoles: options.allowedRoles,
        },
      })
      return {
        session: null,
        error: NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        ),
      }
    }
  }

  return { session, error: null }
}

/**
 * Quick check: is this user an admin?
 */
export function isAdmin(session: StaffSessionPayload): boolean {
  const roles = parseRoles(session.roles || session.role)
  return roles.includes('ADMIN')
}

/**
 * Quick check: is this user a manager or admin?
 */
export function isManagerOrAbove(session: StaffSessionPayload): boolean {
  const roles = parseRoles(session.roles || session.role)
  return roles.includes('ADMIN') || roles.includes('MANAGER')
}

/**
 * Guard for dev/seed/debug endpoints.
 * Blocks access in production AND requires ADMIN auth in all environments.
 * Returns null if allowed, or a 4xx NextResponse to return immediately.
 */
export function requireDevAdmin(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is disabled in production' },
      { status: 403 }
    )
  }

  const staffId = request.headers.get('x-staff-id')
  const staffRole = request.headers.get('x-staff-role')
  const staffRolesStr = request.headers.get('x-staff-roles')

  if (!staffId || !staffRole) {
    return NextResponse.json(
      { error: 'Admin authentication required' },
      { status: 401 }
    )
  }

  const allRoles = parseRoles(staffRolesStr || staffRole)
  if (!allRoles.includes('ADMIN')) {
    return NextResponse.json(
      { error: 'Only ADMIN can access this endpoint' },
      { status: 403 }
    )
  }

  return null
}

/**
 * Simple auth check for ops API routes (multi-role aware).
 * Returns null if authorized, or a 403 NextResponse if not.
 *
 * Usage in any /api/ops/* route:
 *   const authError = checkStaffAuth(request)
 *   if (authError) return authError
 */
export function checkStaffAuth(request: NextRequest): NextResponse | null {
  const staffRole = request.headers.get('x-staff-role')
  const staffRolesStr = request.headers.get('x-staff-roles')
  const staffId = request.headers.get('x-staff-id')
  const { pathname } = new URL(request.url)

  if (!staffId || !staffRole) {
    logSecurityEvent({
      kind: 'AUTH_FAIL',
      path: pathname,
      method: request.method,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
      details: { reason: 'no_session' },
    })
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // Parse all roles
  const allRoles = parseRoles(staffRolesStr || staffRole) as StaffRole[]

  if (!canAccessAPI(allRoles, pathname)) {
    logSecurityEvent({
      kind: 'AUTH_FAIL',
      path: pathname,
      method: request.method,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
      details: {
        reason: 'insufficient_permissions',
        staffId,
        roles: allRoles,
      },
    })
    return NextResponse.json(
      { error: 'Access denied. Insufficient permissions.' },
      { status: 403 }
    )
  }

  return null // Authorized
}

<<<<<<< HEAD
/**
 * Async version of checkStaffAuth with cookie fallback.
 * Use for routes where middleware may not inject x-staff-* headers
 * (e.g. /api/admin/*). Tries headers first, then falls back to
 * reading the staff session cookie directly.
 */
export async function checkStaffAuthWithFallback(request: NextRequest): Promise<NextResponse | null> {
  // ── Primary path: trust headers set by middleware ──
  const staffRole = request.headers.get('x-staff-role')
  const staffId = request.headers.get('x-staff-id')
  if (staffId && staffRole) {
    return checkStaffAuth(request)
  }

  // ── Fallback: read cookie directly ──
  const { pathname } = new URL(request.url)
  const session = await getStaffSession()
  if (!session) {
    logSecurityEvent({
      kind: 'AUTH_FAIL',
      path: pathname,
      method: request.method,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
      details: { reason: 'no_session_cookie_fallback' },
    })
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const allRoles = parseRoles(session.roles || session.role) as StaffRole[]

  if (!canAccessAPI(allRoles, pathname)) {
    logSecurityEvent({
      kind: 'AUTH_FAIL',
      path: pathname,
      method: request.method,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      requestId: request.headers.get('x-request-id'),
      details: {
        reason: 'insufficient_permissions_cookie',
        staffId: session.staffId,
        roles: allRoles,
      },
    })
    return NextResponse.json(
      { error: 'Access denied. Insufficient permissions.' },
      { status: 403 }
    )
  }

  return null // Authorized via cookie fallback
}
=======
export async function checkStaffAuthWithFallback(request: NextRequest): Promise<NextResponse | null> {
    const staffRole = request.headers.get('x-staff-role')
      const staffId = request.headers.get('x-staff-id')
        if (staffId && staffRole) {
              return checkStaffAuth(request)
        }

          const { pathname } = new URL(request.url)
            const session = await getStaffSession()
              if (!session) {
                    logSecurityEvent({
                            kind: 'AUTH_FAIL',
                                  path: pathname,
                                        method: request.method,
                                              ip: clientIp(request),
                                                    userAgent: request.headers.get('user-agent'),
                                                          requestId: request.headers.get('x-request-id'),
                                                                details: { reason: 'no_session_cookie_fallback' },
                    })
                        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
                  }

                    const allRoles = parseRoles(session.roles || session.role) as StaffRole[]

                      if (!canAccessAPI(allRoles, pathname)) {
                            logSecurityEvent({
                                    kind: 'AUTH_FAIL',
                                          path: pathname,
                                                method: request.method,
                                                      ip: clientIp(request),
                                                            userAgent: request.headers.get('user-agent'),
                                                                  requestId: request.headers.get('x-request-id'),
                                                                        details: {
                                                                                  reason: 'insufficient_permissions_cookie',
                                                                                          staffId: session.staffId,
                                                                                                  roles: allRoles,
                                                                        },
                                                                      })
                                                                          return NextResponse.json(
                                                                                  { error: 'Access denied. Insufficient permissions.' },
                                                                                        { status: 403 }
                                                                          )
                                                                        }

                                                                          return null // Authorized via cookie fallback
                                                                      }
                                                                      
>>>>>>> 9d76f996784d979611a7e66763fb90558cbdd664
