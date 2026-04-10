import { NextRequest, NextResponse } from 'next/server';

/**
 * CSRF protection for mutation endpoints.
 * Validates that the Origin header matches the expected host.
 * Returns null if valid, or a 403 NextResponse if the check fails.
 *
 * Usage in API routes:
 *   const csrfError = checkCsrf(request);
 *   if (csrfError) return csrfError;
 */
export function checkCsrf(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();

  // Only check mutations
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return null;
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // Allow requests with no origin (same-origin form submissions, curl, etc.)
  // The httpOnly cookie requirement already prevents CSRF from foreign JS
  if (!origin) {
    return null;
  }

  // Parse origin to get hostname
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host; // includes port

    // Check if origin matches the host
    if (originHost === host) {
      return null;
    }

    // Allow localhost variants during development
    if (
      process.env.NODE_ENV === 'development' &&
      (originHost.startsWith('localhost') || originHost.startsWith('127.0.0.1'))
    ) {
      return null;
    }
  } catch {
    // Invalid origin header
  }

  return NextResponse.json(
    { error: 'CSRF validation failed: origin mismatch' },
    { status: 403 }
  );
}
