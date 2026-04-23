/**
 * Smoke tests for integration-guard module.
 *
 * Verifies requireIntegration returns 503 when env vars are missing,
 * null when configured, and that getAllIntegrationStatus reflects reality.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We'll dynamically import so we can manipulate env before each test
let requireIntegration: typeof import('../integration-guard')['requireIntegration']
let isIntegrationConfigured: typeof import('../integration-guard')['isIntegrationConfigured']
let getAllIntegrationStatus: typeof import('../integration-guard')['getAllIntegrationStatus']

beforeEach(async () => {
  // Reset module cache so env changes take effect
  vi.resetModules()
  const mod = await import('../integration-guard')
  requireIntegration = mod.requireIntegration
  isIntegrationConfigured = mod.isIntegrationConfigured
  getAllIntegrationStatus = mod.getAllIntegrationStatus
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('requireIntegration', () => {
  it('returns null for unknown integration key', () => {
    expect(requireIntegration('nonexistent')).toBeNull()
  })

  it('returns 503 when STRIPE_SECRET_KEY is missing', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const response = requireIntegration('stripe')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(503)
  })

  it('returns null when STRIPE_SECRET_KEY is set', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_abc123')
    const response = requireIntegration('stripe')
    expect(response).toBeNull()
  })

  it('checks multiple env vars for bolt', () => {
    vi.stubEnv('BOLT_API_URL', 'https://bolt.example')
    vi.stubEnv('BOLT_API_KEY', '') // missing
    const response = requireIntegration('bolt')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(503)
  })

  it('returns null for bolt when both vars are set', () => {
    vi.stubEnv('BOLT_API_URL', 'https://bolt.example')
    vi.stubEnv('BOLT_API_KEY', 'key_abc')
    expect(requireIntegration('bolt')).toBeNull()
  })
})

describe('isIntegrationConfigured', () => {
  it('returns true for unknown key', () => {
    expect(isIntegrationConfigured('made_up')).toBe(true)
  })

  it('returns false when env var is absent', () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect(isIntegrationConfigured('resend')).toBe(false)
  })

  it('returns true when env var is present', () => {
    vi.stubEnv('RESEND_API_KEY', 're_123')
    expect(isIntegrationConfigured('resend')).toBe(true)
  })
})

describe('getAllIntegrationStatus', () => {
  it('returns status for all known integrations', () => {
    const status = getAllIntegrationStatus()
    expect(Object.keys(status)).toContain('stripe')
    expect(Object.keys(status)).toContain('resend')
    expect(Object.keys(status)).toContain('bolt')

    // Each entry has the right shape
    for (const [, info] of Object.entries(status)) {
      expect(info).toHaveProperty('name')
      expect(info).toHaveProperty('configured')
      expect(info).toHaveProperty('missing')
      expect(typeof info.configured).toBe('boolean')
      expect(Array.isArray(info.missing)).toBe(true)
    }
  })
})
