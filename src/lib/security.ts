// ──────────────────────────────────────────────────────────────────────────
// Security Utilities for Abel Builder Platform
// ──────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

// ──────────────────────────────────────────────────────────────────────────
// Input Sanitization
// ──────────────────────────────────────────────────────────────────────────

/** Strip potential XSS from user input */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Strip angle brackets
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/data:text\/html/gi, '')
    .trim()
}

/** Validate and sanitize an email address */
export function sanitizeEmail(email: string): string | null {
  const cleaned = email.toLowerCase().trim()
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return emailRegex.test(cleaned) ? cleaned : null
}

/** Validate UUID format */
export function isValidUUID(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,}$/.test(id)
}

/** Validate a date string */
export function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr)
  return !isNaN(d.getTime())
}

/** Sanitize SQL identifier to prevent injection via column/table names */
export function sanitizeSQLIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '')
}

// ──────────────────────────────────────────────────────────────────────────
// Security Headers
// ──────────────────────────────────────────────────────────────────────────

export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  }
}

/** Add security headers to a NextResponse */
export function withSecurityHeaders(response: NextResponse): NextResponse {
  const headers = securityHeaders()
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
}

// ──────────────────────────────────────────────────────────────────────────
// CSRF Protection
// ──────────────────────────────────────────────────────────────────────────

/** Check CSRF - verify origin matches for mutation requests */
export function checkCSRF(request: Request): boolean {
  const method = request.method.toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true

  const origin = request.headers.get('origin')
  const host = request.headers.get('host')

  // If no origin header (same-origin requests), allow
  if (!origin) return true

  // Check origin matches host
  try {
    const originUrl = new URL(origin)
    return originUrl.host === host
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Password Validation
// ──────────────────────────────────────────────────────────────────────────

export interface PasswordValidation {
  valid: boolean
  errors: string[]
}

export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = []

  if (password.length < 8) errors.push('Must be at least 8 characters')
  if (!/[A-Z]/.test(password)) errors.push('Must contain an uppercase letter')
  if (!/[a-z]/.test(password)) errors.push('Must contain a lowercase letter')
  if (!/[0-9]/.test(password)) errors.push('Must contain a number')
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('Must contain a special character')

  return { valid: errors.length === 0, errors }
}

// ──────────────────────────────────────────────────────────────────────────
// Audit Logging
// ──────────────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED'
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'APPROVE' | 'REJECT'
  | 'EXPORT' | 'IMPORT'
  | 'DELEGATION_CREATE' | 'DELEGATION_CANCEL'
  | 'PERMISSION_CHANGE' | 'SETTINGS_CHANGE'

export interface AuditLogEntry {
  action: AuditAction
  entityType: string
  entityId?: string
  staffId: string
  staffEmail?: string
  details?: string
  ipAddress?: string
}

/** Log a security-relevant action (writes to console in dev, should go to DB in prod) */
export function logAuditEvent(entry: AuditLogEntry): void {
  const timestamp = new Date().toISOString()
  const log = {
    ...entry,
    timestamp,
    environment: process.env.NODE_ENV,
  }

  // In development, log to console
  console.log(`[AUDIT] ${timestamp} | ${entry.action} | ${entry.entityType} | staff:${entry.staffId} | ${entry.details || ''}`)

  // In production, this would write to an audit log table
  // TODO: Write to AuditLog table when in production
}
