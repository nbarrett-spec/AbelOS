import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production')
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production'
)

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

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ────────────────────────────────────────────────────────────────────
  // STAFF OPS ROUTES — /ops/*
  // ────────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/ops')) {
    // Allow public ops routes
    if (opsPublicRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
      // Setup-account should always be accessible (even if logged in — employee may be resetting)
      if (pathname.startsWith('/ops/setup-account')) {
        return NextResponse.next()
      }
      // If already logged in, redirect to main ops page (login, forgot-password)
      const staffCookie = request.cookies.get(STAFF_COOKIE)
      if (staffCookie) {
        return NextResponse.redirect(new URL('/ops', request.url))
      }
      return NextResponse.next()
    }

    // All other /ops routes require staff session
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      const loginUrl = new URL('/ops/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
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
      return response
    }

    return NextResponse.next()
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
          return NextResponse.redirect(new URL('/sales', request.url))
        } catch {
          // Invalid token, let them see login
        }
      }
      return NextResponse.next()
    }

    // All other /sales routes require staff session
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      return NextResponse.redirect(new URL('/sales/login', request.url))
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      // Attach staff info to headers for the sales portal pages
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')
      return NextResponse.next({ request: { headers: requestHeaders } })
    } catch {
      const loginUrl = new URL('/sales/login', request.url)
      const response = NextResponse.redirect(loginUrl)
      response.cookies.delete(STAFF_COOKIE)
      return response
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // STAFF API ROUTES — /api/ops/*
  // ────────────────────────────────────────────────────────────────────
  // Webhook endpoints are public (InFlow, Gmail Pub/Sub, Hyphen)
  if (pathname.startsWith('/api/webhooks')) {
    return NextResponse.next()
  }

  // ────────────────────────────────────────────────────────────────
  // CSRF PROTECTION — all API mutations
  // (Skip for agent-hub routes with Bearer auth — server-to-server)
  // ────────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
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
            return NextResponse.json(
              { error: 'CSRF validation failed' },
              { status: 403 }
            )
          }
        }
      } catch {
        return NextResponse.json(
          { error: 'Invalid origin header' },
          { status: 403 }
        )
      }
    }
    } // end else (non-agent CSRF check)
  }

  if (pathname.startsWith('/api/ops')) {
    // Auth endpoints and handbook are public
    if ((pathname.startsWith('/api/ops/auth') && !pathname.startsWith('/api/ops/auth/permissions')) ||
        pathname === '/api/ops/handbook') {
      return NextResponse.next()
    }

    // All other API ops routes need a valid staff session
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      // Attach staff info to request headers for downstream use
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')

      return addSecurityHeaders(NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }))
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
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
        const requestHeaders = new Headers(request.headers)
        requestHeaders.set('x-staff-id', `agent-${agentRole.toLowerCase()}`)
        requestHeaders.set('x-staff-role', 'ADMIN')
        requestHeaders.set('x-staff-roles', 'ADMIN')
        requestHeaders.set('x-staff-department', 'AGENT_CLUSTER')
        requestHeaders.set('x-staff-email', `${agentRole.toLowerCase()}@agent.abel`)
        requestHeaders.set('x-staff-firstname', agentName)
        requestHeaders.set('x-staff-lastname', '')
        requestHeaders.set('x-agent-authenticated', 'true')

        return addSecurityHeaders(NextResponse.next({
          request: { headers: requestHeaders },
        }))
      }
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      )
    }

    // Method 2: Staff cookie auth (web dashboard)
    const staffCookie = request.cookies.get(STAFF_COOKIE)
    if (!staffCookie) {
      return NextResponse.json(
        { error: 'Authentication required. Provide Bearer API key or staff session.' },
        { status: 401 }
      )
    }

    try {
      const { payload } = await jwtVerify(staffCookie.value, JWT_SECRET)
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-staff-id', payload.staffId as string)
      requestHeaders.set('x-staff-role', payload.role as string)
      requestHeaders.set('x-staff-roles', (payload.roles as string) || (payload.role as string))
      requestHeaders.set('x-staff-department', payload.department as string)
      requestHeaders.set('x-staff-email', payload.email as string)
      requestHeaders.set('x-staff-firstname', (payload.firstName as string) || '')
      requestHeaders.set('x-staff-lastname', (payload.lastName as string) || '')

      return addSecurityHeaders(NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }))
    } catch {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
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

  // Add security headers to all matched responses
  return addSecurityHeaders(NextResponse.next())
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
