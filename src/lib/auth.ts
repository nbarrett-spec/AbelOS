import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

// JWT_SECRET is required in every environment. No dev fallback — a missing
// value should crash the app loudly rather than silently sign tokens with a
// known-public default. Set it in `.env` locally and in Vercel for deployed
// envs. Generate with: `openssl rand -base64 48`.
if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is required. ' +
    'Set it in .env (local) or your hosting provider (prod). ' +
    'Generate with: openssl rand -base64 48'
  )
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

const COOKIE_NAME = 'abel_session'
const TOKEN_EXPIRY = '7d'

export interface SessionPayload {
  builderId: string
  email: string
  companyName: string
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET)
}

export async function verifyToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function setSessionCookie(token: string, rememberMe = false) {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    maxAge: rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7, // 30 days if remembered, 7 days default
    path: '/',
  })
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function clearSession() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}
