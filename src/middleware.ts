import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production')
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production'
)

/**
 * Generate or retrieve request ID for distributed tracing
 * Enables request tracking across logs and error monitoring (Sentry)
 */
function getOrCreateRequestId(request: NextRequest): string {
  const existing = request.headers.get('x-request-id')
  if (existing) {
    return existing
  }
  // Generate a UUID using Web Crypto API
  const uuid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  return uuid
}

// ──────────────────────────────────────────────────────────────────────────
// Builder (customer) routes
// ──────────────────────────────────────────────────────────────────────────
const builderProtectedRoutes = ['/dashboard', '/projects']
const builderAuthRoutes = ['/login', '/signup', '/forgot-password', '/reset-password']

// ──────────────────────────────────────────────────────────────────────────
// Staff (internal ops) routes
// ──────────────────────────────────────────────────────────────────────────
const STAFF_COOKIE = 'abel_staff_session'
const BUILDER_COOKIE = 'abel_session'

// Public ops routes that don't need auth
const opsPublicRoutes = ['/ops/login', '/ops/forgot-password', '/ops/reset-password', '/ops/setup-account']

/**
 * Add security headers to response
 * @deprecated Most headers are now set via next.config.js headers() function
 * Kept here for additional middleware-level security headers
 */
function addSecurityHeaders(response: NextResponse, requestId?: string): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (requestId) {
    response.headers.set('X-Request-ID', requestId)
  }
  return response
}

/**
 * Add request ID to response and headers for distributed tracing
 */
function addRequestIdToResponse(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('X-Request-ID', requestId)
  return response
}

/**
 * Wrap any NextResponse (next, redirect, json) with the request ID header so
 * every branch of the middleware propagates tracing consistently. Safe to call
 * on responses we didn't originate.
 */
function withRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('X-Request-ID', requestId)
  return response
}

/**
 * Build a new Headers object that forwards the incoming request headers plus
 * an x-request-id header, so downstream route handlers can read it without
 * repeating header-manipulation boilerplate.
 */
function forwardWithRequestId(request: NextRequest, requestId: string): Headers {
  const headers = new Headers(request.headers)
  headers.set('x-request-id', requestId)
  return headers
}

/**
 * Fire-and-forget security event log from Edge middleware.
 * Emits structured console.warn (visible in Vercel logs immediately)
 * and POSTs to the internal logging endpoint for DB persistence.
 */
function logSecurityEventFromEdge(
  request: NextRequest,
  requestId: string,
  kind: string,
  details?: Record<string, unknown>
): void {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.ip || null
  const payload = {
    kind,
    path: request.nextUrl.pathname,
    method: request.method,
    ip,
    userAgent: request.headers.get('user-agent'),
    requestId,
    details: details || null,
  }

  // 1) Structured log for Vercel's log drain (immediate)
  console.warn(JSON.stringify({ level: 'warn', msg: 'security_event', ...payload }))

  // 2) POST to internal endpoint for DB persistence (fire-and-forget)
  const secret = process.env.INTERNAL_LOG_SECRET
  if (secret) {
    const url = new URL('/api/internal/security-event', request.url)
    fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, secret }),
    }).catch(() => {
      // swallow — never delay a rejection response for logging
    })
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ────────────────────────────────────────────────────────────────────
  // REQUEST ID TRACKING — all routes
  // ────────────────────────────────────────────────────────────────────
  const requestId = getOrCreateRequestId(request)

  // ────────────────────────────────────────────────────────────────────
  // STAFF OPS ROUTES — /ops/*
  // ────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/ops')) {
    // Allow public ops routes
    if (opsPublicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
      // Setup-account should always be accessible (even if logged in — employee may be resetting)
      if (pathname.startsWith('/ops/setup-account')) {
        const res = NextResponse.next()
        return addRequestIdToResponse(res, requestId)
      }
      // If already logged in, redirect to main ops page (login, forgot-password)
      const staffCookie = request.cookies.get(STAFF_COOKIE)
      if (staffCookie) {
        const res = NextResponse.redirect(new URL('/ops', request.url))
        return addRequestIdToResponse(res, requestId)
      }
      const res = NextResponse.next()
      return addRequestIdToResponse(res, requestId)
    }

    // All other /ops routes require staff session
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      const loginUrl = new URL('/ops/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return withRequestId(NextResponse.redirect(loginUrl), requestId)
    }

    // Verify the JWT is valid (basic check — role checks happen at page/API level)
    try {
      await jwtVerify(staffCookie.value, JWT_SECRET)
    } catch {
      // Invalid/expired token — clear and redirect to login
      const loginUrl = new URL('/ops/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete(STAFF_COOKIE)
      return withRequestId(response, requestId)
    }

    return withRequestId(
      NextResponse.next({ request: { headers: forwardWithRequestId(request, requestId) } }),
      requestId
    )
  }

  // ────────────────────────────────────────────────────────────────────
  // SALES PORTAL ROUTES — /sales/*
  // ────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/sales')) {
    // Allow sales login page
    if (pathname === '/sales/login') {
      const staffCookie = request.cookies.get(STAFF_COOKIE)
      if (staffCookie) {
        try {
          await jwtVerify(staffCookie.value, JWT_SECRET)
          return withRequestId(NextResponse.redirect(new URL('/sales', request.url)), requestId)
        } catch {
          // Invalid token, let them see login
        }
      }
      return withRequestId(NextResponse.next(), requestId)
    }

    // All other /sales routes require staff session
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      return withRequestId(NextResponse.redirect(new URL('/sales/login', request.url)), requestId)
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      // Attach staff info to headers for the sales portal pages
      const requestHeaders = forwardWithRequestId(request, requestId)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')
      return withRequestId(
        NextResponse.next({ request: { headers: requestHeaders } }),
        requestId
      )
    } catch {
      const loginUrl = new URL('/sales/login', request.url)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete(STAFF_COOKIE)
      return withRequestId(response, requestId)
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // STAFF API ROUTES — /api/ops/*
  // ────────────────────────────────────────────────────────────────────
  // Webhook endpoints are public (InFlow, Gmail Pub/Sub, Hyphen)
  if (pathname.startsWith('/api/webhooks')) {
    return withRequestId(
      NextResponse.next({ request: { headers: forwardWithRequestId(request, requestId) } }),
      requestId
    )
  }

  // ────────────────────────────────────────────────────────────────
  // CSRF PROTECTION — all API mutations
  // (Skip for agent-hub routes with Bearer auth — server-to-server)
  // ────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    // Skip CSRF for internal logging endpoints (middleware → itself, secret-authed)
    if (pathname.startsWith('/api/internal/')) {
      return withRequestId(
        NextResponse.next({ request: { headers: forwardWithRequestId(request, requestId) } }),
        requestId
      )
    }
    // Skip CSRF for agent-hub Bearer token requests (server-to-server, no browser origin)
    const authHeader = request.headers.get('authorization')
    if (pathname.startsWith('/api/agent-hub') && authHeader?.startsWith('Bearer ')) {
      // CSRF not applicable for API key auth — validated in agent-hub section
    } else {
    const origin = request.headers.get('origin')
    const host = request.headers.get('host')
    if (origin) {
      try {
        const originHost = new URL(origin).host
        if (originHost !== host) {
          // In development allow localhost variants
          const isDev = originHost.startsWith('localhost') || originHost.startsWith('127.0.0.1')
          const hostIsDev = host?.startsWith('localhost') || host?.startsWith('127.0.0.1')
          if (!(isDev && hostIsDev)) {
            logSecurityEventFromEdge(request, requestId, 'CSRF', {
              origin,
              host,
              reason: 'origin_mismatch',
            })
            return withRequestId(
              NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 }),
              requestId
            )
          }
        }
      } catch {
        logSecurityEventFromEdge(request, requestId, 'CSRF', {
          origin: request.headers.get('origin'),
          reason: 'invalid_origin_header',
        })
        return withRequestId(
          NextResponse.json({ error: 'Invalid origin header' }, { status: 403 }),
          requestId
        )
      }
    }
    } // end else (non-agent CSRF check)
  }

  if (pathname.startsWith('/api/ops')) {
    // Auth endpoints and handbook are public
    if ((pathname.startsWith('/api/ops/auth') && !pathname.startsWith('/api/ops/auth/permissions')) ||
        pathname === '/api/ops/handbook') {
      return withRequestId(
        NextResponse.next({ request: { headers: forwardWithRequestId(request, requestId) } }),
        requestId
      )
    }

    // All other API ops routes need a valid staff session
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'missing_staff_cookie',
        scope: 'ops_api',
      })
      return withRequestId(
        NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        requestId
      )
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      // Attach staff info to request headers for downstream use
      const requestHeaders = forwardWithRequestId(request, requestId)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')

      return addSecurityHeaders(
        NextResponse.next({ request: { headers: requestHeaders } }),
        requestId
      )
    } catch {
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'invalid_or_expired_jwt',
        scope: 'ops_api',
      })
      return withRequestId(
        NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }),
        requestId
      )
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // ADMIN API ROUTES — /api/admin/*
  // Staff cookie auth (same pattern as /api/ops). These endpoints use
  // checkStaffAuth() which reads x-staff-id / x-staff-role headers.
  // Without this block the headers are never set and every admin API
  // call returns 401 "Not authenticated".
  // ────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/admin')) {
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'missing_staff_cookie',
        scope: 'admin_api',
      })
      return withRequestId(
        NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
        requestId
      )
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      const requestHeaders = forwardWithRequestId(request, requestId)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')

      return addSecurityHeaders(
        NextResponse.next({ request: { headers: requestHeaders } }),
        requestId
      )
    } catch {
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'invalid_or_expired_jwt',
        scope: 'admin_api',
      })
      return withRequestId(
        NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }),
        requestId
      )
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // AGENT HUB API ROUTES — /api/agent-hub/*
  // Supports TWO auth methods:
  //   1. Bearer API key (for NUC agent cluster)
  //   2. Staff cookie (for web dashboard)
  // ────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/agent-hub')) {
    const authHeader = request.headers.get('authorization')
    const agentApiKey = process.env.AGENT_HUB_API_KEY

    // Method 1: Bearer API key auth (NUC agents)
    if (authHeader?.startsWith('Bearer ') && agentApiKey) {
      const token = authHeader.slice(7)
      if (token === agentApiKey) {
        const agentRole = request.headers.get('x-agent-role') || 'COORDINATOR'
        const agentName = request.headers.get('x-agent-name') || 'Abel Agent'
        const requestHeaders = forwardWithRequestId(request, requestId)
        requestHeaders.set('x-staff-id', `agent-${agentRole.toLowerCase()}`)
        requestHeaders.set('x-staff-role', 'ADMIN')
        requestHeaders.set('x-staff-roles', 'ADMIN')
        requestHeaders.set('x-staff-department', 'AGENT_CLUSTER')
        requestHeaders.set('x-staff-email', `${agentRole.toLowerCase()}@agent.abel`)
        requestHeaders.set('x-staff-firstname', agentName)
        requestHeaders.set('x-staff-lastname', '')
        requestHeaders.set('x-agent-authenticated', 'true')

        return addSecurityHeaders(
          NextResponse.next({ request: { headers: requestHeaders } }),
          requestId
        )
      }
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'invalid_agent_api_key',
        scope: 'agent_hub',
      })
      return withRequestId(
        NextResponse.json({ error: 'Invalid API key' }, { status: 401 }),
        requestId
      )
    }

    // Method 2: Staff cookie auth (web dashboard)
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'missing_credentials',
        scope: 'agent_hub',
      })
      return withRequestId(
        NextResponse.json(
          { error: 'Authentication required. Provide Bearer API key or staff session.' },
          { status: 401 }
        ),
        requestId
      )
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      const requestHeaders = forwardWithRequestId(request, requestId)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')

      return addSecurityHeaders(
        NextResponse.next({ request: { headers: requestHeaders } }),
        requestId
      )
    } catch {
      logSecurityEventFromEdge(request, requestId, 'AUTH_FAIL', {
        reason: 'invalid_or_expired_jwt',
        scope: 'agent_hub',
      })
      return withRequestId(
        NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }),
        requestId
      )
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // BUILDER ROUTES — existing logic
  // ────────────────────────────────────────────────────────────────────
  const sessionCookie = request.cookies.get(BUILDER_COOKIE)

  // Redirect authenticated builders away from auth pages
  if (builderAuthRoutes.some((route) => pathname.startsWith(route))) {
    if (sessionCookie) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next()
  }

  // Redirect unauthenticated builders to login
  if (builderProtectedRoutes.some((route) => pathname.startsWith(route))) {
    if (!sessionCookie) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Add security headers and request ID to all matched responses
  const finalResponse = addSecurityHeaders(NextResponse.next(), requestId)
  return addRequestIdToResponse(finalResponse, requestId)
}

export const config = {
  matcher: [
    // Builder routes
    '/dashboard/:path*',
    '/projects/:path*',
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    // Staff ops routes
    '/ops/:path*',
    // Sales portal routes
    '/sales/:path*',
    // API routes (CSRF + auth)
    '/api/:path*',
  ],
}
