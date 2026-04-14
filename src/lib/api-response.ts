import { NextResponse } from 'next/server'
import { logger } from './logger'

// ──────────────────────────────────────────────────────────────────────────
// Standardized API Response Helpers
// ──────────────────────────────────────────────────────────────────────────
// All API routes should use these helpers for consistent response shape.
// Client code can always expect: { error?: string, data?: any, ... }
// ──────────────────────────────────────────────────────────────────────────

interface ApiErrorOptions {
  status?: number
  code?: string
  details?: string
}

/**
 * Return a standardized error response.
 * Shape: { error: string, code?: string, details?: string }
 */
export function apiError(message: string, opts: ApiErrorOptions = {}) {
  const { status = 500, code, details } = opts
  const body: Record<string, any> = { error: message }
  if (code) body.code = code
  if (details) body.details = details
  return NextResponse.json(body, { status })
}

/**
 * Return a standardized success response.
 * Shape: { success: true, ...data }
 */
export function apiSuccess(data: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status })
}

/**
 * Wrap an async handler to catch unhandled errors and return a clean 500.
 * Logs with structured logger.
 */
export function withErrorHandler(prefix: string, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  return handler().catch((error: any) => {
    logger.error(`unhandled_error_in_${prefix}`, error)
    return apiError('Internal server error', { status: 500, details: error?.message })
  })
}

/**
 * Validate required fields on a request body.
 * Returns an error response if any are missing, or null if all present.
 */
export function validateRequired(body: Record<string, any>, fields: string[]): NextResponse | null {
  const missing = fields.filter(f => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length > 0) {
    return apiError(`Missing required fields: ${missing.join(', ')}`, { status: 400, code: 'MISSING_FIELDS' })
  }
  return null
}

/**
 * Clamp pagination parameters to safe ranges.
 */
export function safePagination(params: URLSearchParams, defaults = { page: 1, limit: 50, maxLimit: 200 }) {
  const page = Math.max(1, parseInt(params.get('page') || String(defaults.page)))
  const limit = Math.max(1, Math.min(parseInt(params.get('limit') || String(defaults.limit)), defaults.maxLimit))
  const offset = (page - 1) * limit
  return { page, limit, offset }
}
