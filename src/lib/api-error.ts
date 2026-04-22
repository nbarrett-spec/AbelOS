import { NextResponse } from 'next/server'

/**
 * Centralized API error response helper.
 * Logs the real error server-side, returns a safe generic message to the client.
 *
 * Usage:
 *   return apiError(error, 'Failed to load orders', 500, 'GET /api/ops/orders')
 */
export function apiError(
  error: unknown,
  fallbackMessage = 'Internal server error',
  status = 500,
  context?: string,
): NextResponse {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[API Error]${context ? ` [${context}]` : ''}: ${msg}`)
  return NextResponse.json({ error: fallbackMessage }, { status })
}

/**
 * Type guard for catching unknown errors and extracting a message for logging.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
