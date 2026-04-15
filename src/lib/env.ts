/**
 * Environment variable validation for Abel Builder Platform.
 * Uses Zod for runtime type-safety and validation.
 *
 * Import this at the top of any server-side code that needs env vars.
 * Validation runs on import and throws at startup if critical vars are missing.
 */

import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════════════
// Schema Definition
// ═══════════════════════════════════════════════════════════════════════════

const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database (required)
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL must be a valid PostgreSQL URL')
    .describe('PostgreSQL connection string'),

  // Direct connection (optional, for poolers like Supabase/Neon)
  DIRECT_URL: z
    .string()
    .url('DIRECT_URL must be a valid PostgreSQL URL')
    .optional()
    .describe('Direct connection for migrations on pooled databases'),

  // Security (required)
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .describe('Secret for signing JWTs (min 32 chars, use: openssl rand -base64 48)'),

  // Cron jobs (optional, for Vercel cron authentication)
  CRON_SECRET: z
    .string()
    .optional()
    .describe('Secret for authenticating Vercel cron requests'),

  // Email (optional, Resend)
  RESEND_API_KEY: z
    .string()
    .optional()
    .describe('Resend API key for email delivery'),

  RESEND_FROM_EMAIL: z
    .string()
    .email('RESEND_FROM_EMAIL must be a valid email')
    .optional()
    .describe('From email address for Resend (e.g., Abel Lumber <noreply@abellumber.com>)'),

  // Observability alerts (optional)
  ALERT_NOTIFY_EMAILS: z
    .string()
    .optional()
    .describe(
      'Comma-separated list of recipient emails for critical incident notifications (e.g., "ops@abellumber.com,nate@abellumber.com")'
    ),

  // Payments (optional, Stripe)
  STRIPE_SECRET_KEY: z
    .string()
    .optional()
    .describe('Stripe secret key (starts with sk_)'),

  STRIPE_WEBHOOK_SECRET: z
    .string()
    .optional()
    .describe('Stripe webhook signing secret'),

  // AI (optional, Anthropic)
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .describe('Anthropic API key for Claude AI'),

  // Agent Hub (optional, server-to-server auth)
  AGENT_HUB_API_KEY: z
    .string()
    .optional()
    .describe('API key for NUC agent cluster authentication'),

  // QuickBooks (optional)
  QBWC_USERNAME: z
    .string()
    .optional()
    .describe('QuickBooks Web Connector username'),

  QBWC_PASSWORD: z
    .string()
    .optional()
    .describe('QuickBooks Web Connector password'),

  // Error monitoring (optional, Sentry)
  SENTRY_DSN: z
    .string()
    .url('SENTRY_DSN must be a valid URL')
    .optional()
    .describe('Sentry DSN for server-side error tracking'),

  SENTRY_AUTH_TOKEN: z
    .string()
    .optional()
    .describe('Sentry auth token for releases and source maps'),

  NEXT_PUBLIC_SENTRY_DSN: z
    .string()
    .url('NEXT_PUBLIC_SENTRY_DSN must be a valid URL')
    .optional()
    .describe('Sentry DSN for client-side error tracking'),

  // Rate limiting (optional, Upstash Redis)
  UPSTASH_REDIS_REST_URL: z
    .string()
    .url('UPSTASH_REDIS_REST_URL must be a valid URL')
    .optional()
    .describe('Upstash Redis REST endpoint for rate limiting'),

  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .optional()
    .describe('Upstash Redis REST API token'),

  // App configuration
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url('NEXT_PUBLIC_APP_URL must be a valid URL')
    .default('https://app.abellumber.com')
    .describe('Public-facing app URL (e.g., https://app.abellumber.com)'),

  NEXT_PUBLIC_APP_NAME: z
    .string()
    .default('Abel Builder Platform')
    .describe('App display name'),

  // File uploads (optional)
  UPLOAD_DIR: z
    .string()
    .default('./uploads')
    .describe('Directory for file uploads'),

  MAX_FILE_SIZE_MB: z
    .coerce
    .number()
    .positive()
    .default(50)
    .describe('Maximum file upload size in MB'),

  // Document storage (optional)
  DOCUMENTS_PATH: z
    .string()
    .optional()
    .describe('Path for document storage'),

  // App URL variants (optional)
  APP_URL: z
    .string()
    .url()
    .optional()
    .describe('Internal app URL (may differ from NEXT_PUBLIC_APP_URL)'),

  NEXT_PUBLIC_BASE_URL: z
    .string()
    .url()
    .optional()
    .describe('Public base URL for the app'),
})

export type Env = z.infer<typeof envSchema>

// ═══════════════════════════════════════════════════════════════════════════
// Validation Function
// ═══════════════════════════════════════════════════════════════════════════

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const issues = parsed.error.flatten().fieldErrors
    const msg = `Invalid environment configuration:\n${JSON.stringify(issues, null, 2)}`

    // In production, throw hard to fail fast
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg)
    }

    // In dev, warn but attempt to continue with defaults
    console.warn(`[env] Configuration warning:\n${msg}`)
  }

  const env = parsed.success ? parsed.data : envSchema.parse({
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-dev-secret-dev-secret-12345',
  })

  // Additional runtime checks (production only)
  if (env.NODE_ENV === 'production') {
    // JWT_SECRET cannot be a dev default
    const knownDefaults = [
      'dev-secret-change-in-production',
      'abel-builder-platform-jwt-secret-2026-change-in-prod',
      'dev-secret-dev-secret-dev-secret-12345',
    ]
    if (knownDefaults.includes(env.JWT_SECRET)) {
      throw new Error(
        'FATAL: JWT_SECRET is set to a known development default. ' +
        'Generate a strong secret:\n  openssl rand -base64 48\n' +
        'Update .env (never commit to git).'
      )
    }

    // DATABASE_URL should use production pooler in production
    if (!env.DATABASE_URL.includes('pooler') && !env.DIRECT_URL) {
      console.warn('[env] WARNING: DATABASE_URL does not appear to use a pooler. ' +
        'For production, consider using a connection pooler (Neon pooler, PgBouncer, etc.) ' +
        'and set DIRECT_URL for migrations.')
    }
  }

  return env
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported Validated Environment
// ═══════════════════════════════════════════════════════════════════════════

export const env = validateEnv()

/**
 * Helper to safely get optional env vars with proper types.
 * Use this instead of process.env to benefit from validation.
 *
 * @example
 * const apiKey = getEnv('ANTHROPIC_API_KEY') // type: string | undefined
 */
export function getEnv<K extends keyof Env>(key: K): Env[K] {
  return env[key]
}
