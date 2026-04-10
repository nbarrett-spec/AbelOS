/**
 * Environment variable validation for Abel Builder Platform.
 * Import this in server-side code to ensure required vars are set.
 * Throws at startup if critical vars are missing.
 */

const requiredVars = [
  'DATABASE_URL',
  'JWT_SECRET',
] as const

const optionalVars = [
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_APP_NAME',
  'UPLOAD_DIR',
  'MAX_FILE_SIZE_MB',
  'ANTHROPIC_API_KEY',
] as const

type RequiredVar = typeof requiredVars[number]
type OptionalVar = typeof optionalVars[number]

function validateEnv() {
  const missing: string[] = []

  for (const key of requiredVars) {
    if (!process.env[key]) {
      missing.push(key)
    }
  }

  // BLOCK startup if JWT_SECRET is weak in production
  if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET) {
    const knownDefaults = [
      'dev-secret-change-in-production',
      'abel-builder-platform-jwt-secret-2026-change-in-prod',
    ]
    if (knownDefaults.includes(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32) {
      throw new Error(
        'FATAL: JWT_SECRET is set to a known default or is too short (<32 chars). ' +
        'Generate a strong secret: openssl rand -base64 48'
      )
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables:\n  ${missing.join('\n  ')}\n\nSee .env.example for reference.`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message)
    } else {
      console.warn(`⚠️  ${message}`)
    }
  }
}

export function getEnv(key: RequiredVar): string
export function getEnv(key: OptionalVar): string | undefined
export function getEnv(key: RequiredVar | OptionalVar): string | undefined {
  return process.env[key]
}

// Run validation on import
validateEnv()
