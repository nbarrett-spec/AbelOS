/**
 * Integration configuration guards.
 *
 * Returns a clear 503 response when an integration is not configured,
 * rather than letting routes silently fail or throw cryptic errors.
 *
 * Usage:
 *   import { requireIntegration } from '@/lib/integration-guard'
 *   const guard = requireIntegration('stripe')
 *   if (guard) return guard  // 503 with clear message
 */
import { NextResponse } from 'next/server'

interface IntegrationConfig {
  name: string
  envVars: string[]
  docsUrl?: string
}

const INTEGRATIONS: Record<string, IntegrationConfig> = {
  stripe: {
    name: 'Stripe Payments',
    envVars: ['STRIPE_SECRET_KEY'],
    docsUrl: 'https://dashboard.stripe.com/apikeys',
  },
  resend: {
    name: 'Resend Email',
    envVars: ['RESEND_API_KEY'],
    docsUrl: 'https://resend.com/api-keys',
  },
  anthropic: {
    name: 'Claude AI',
    envVars: ['ANTHROPIC_API_KEY'],
    docsUrl: 'https://console.anthropic.com/',
  },
  // curri: REMOVED 2026-04-22 — integration deferred; see
  // memory/projects/delivery-partners.md. In-house drivers handle all
  // deliveries. Callers that still invoke requireIntegration('curri')
  // will fall through to the null-return "unknown integration" branch
  // and continue (safer than locking out a feature that was never live).
  gmail: {
    name: 'Gmail Sync',
    envVars: ['GOOGLE_SERVICE_ACCOUNT_KEY'],
  },
  // twilio: REMOVED 2026-04-22 — Twilio placeholder removed from .env.example.
  // /api/agent/sms now returns 501 Not Implemented until Twilio is wired for
  // real. Bring this entry back when SMS is a real feature.
  inflow: {
    name: 'InFlow Inventory',
    envVars: ['INFLOW_API_KEY'],
  },
  bolt: {
    name: 'ECI Bolt',
    envVars: ['BOLT_API_URL', 'BOLT_API_KEY'],
  },
}

/**
 * Check if an integration is configured. Returns null if configured,
 * or a 503 NextResponse if missing required env vars.
 */
export function requireIntegration(key: string): NextResponse | null {
  const config = INTEGRATIONS[key]
  if (!config) return null // Unknown integration, let it through

  const missing = config.envVars.filter(v => !process.env[v])
  if (missing.length === 0) return null

  return NextResponse.json(
    {
      error: `${config.name} is not configured`,
      message: `Missing environment variable(s): ${missing.join(', ')}. Contact your administrator.`,
      integration: key,
      configured: false,
    },
    { status: 503 }
  )
}

/**
 * Check if an integration is configured (boolean).
 * Useful for conditional logic without returning an error.
 */
export function isIntegrationConfigured(key: string): boolean {
  const config = INTEGRATIONS[key]
  if (!config) return true
  return config.envVars.every(v => !!process.env[v])
}

/**
 * Get status of all integrations.
 * Useful for admin dashboard / health checks.
 */
export function getAllIntegrationStatus(): Record<string, { name: string; configured: boolean; missing: string[] }> {
  const result: Record<string, { name: string; configured: boolean; missing: string[] }> = {}
  for (const [key, config] of Object.entries(INTEGRATIONS)) {
    const missing = config.envVars.filter(v => !process.env[v])
    result[key] = {
      name: config.name,
      configured: missing.length === 0,
      missing,
    }
  }
  return result
}
