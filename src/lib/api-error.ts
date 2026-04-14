import { NextResponse } from 'next/server'
import { logger } from './logger'

/**
 * Standard API error response helper.
 * Use in API route catch blocks for consistent error formatting.
 */
export function apiError(error: unknown, context?: string) {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const code = error instanceof Error && 'code' in error ? (error as any).code : undefined

  // Log with context
  logger.error(`api_error${context ? ': ' + context : ''}`, error)

  // Don't expose internal errors in production
  const isProduction = process.env.NODE_ENV === 'production'

  // Database connection errors
  if (code === 'P1001' || code === 'P1002' || message.includes('connect')) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable. Please try again.' },
      { status: 503 }
    )
  }

  // Unique constraint violations
  if (code === 'P2002') {
    return NextResponse.json(
      { error: 'A record with this value already exists.' },
      { status: 409 }
    )
  }

  // Record not found
  if (code === 'P2025') {
    return NextResponse.json(
      { error: 'Record not found.' },
      { status: 404 }
    )
  }

  return NextResponse.json(
    { error: isProduction ? 'Internal server error' : message },
    { status: 500 }
  )
}
