import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

// In production, JWT_SECRET must be set to a strong random value
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production')
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production'
)

const STAFF_COOKIE_NAME = 'abel_staff_session'
const TOKEN_EXPIRY = '12h' // Staff sessions shorter than builder sessions

// ──────────────────────────────────────────────────────────────────────────
// Staff Session Payload — includes role + department for RBAC
// ──────────────────────────────────────────────────────────────────────────

export interface StaffSessionPayload {
  staffId: string
  email: string
  firstName: string
  lastName: string
  role: string      // Primary StaffRole enum value (backward compat)
  roles: string     // Comma-separated list of ALL roles (multi-role support)
  department: string // Department enum value
  title: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Token helpers
// ──────────────────────────────────────────────────────────────────────────

export async function createStaffToken(payload: StaffSessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET)
}

export async function verifyStaffToken(
  token: string
): Promise<StaffSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as StaffSessionPayload
  } catch {
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Cookie management
// ──────────────────────────────────────────────────────────────────────────

export async function setStaffSessionCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(STAFF_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: 60 * 60 * 12, // 12 hours
    path: '/',
  })
}

export async function getStaffSession(): Promise<StaffSessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(STAFF_COOKIE_NAME)?.value
  if (!token) return null
  return verifyStaffToken(token)
}

export async function clearStaffSession() {
  const cookieStore = await cookies()
  cookieStore.delete(STAFF_COOKIE_NAME)
}

// ──────────────────────────────────────────────────────────────────────────
// Password helpers (re-exported for convenience)
// ──────────────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ──────────────────────────────────────────────────────────────────────────
// Export cookie name for middleware use
// ──────────────────────────────────────────────────────────────────────────

export const STAFF_COOKIE = STAFF_COOKIE_NAME
