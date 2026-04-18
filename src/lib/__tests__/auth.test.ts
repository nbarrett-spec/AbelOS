/**
 * Smoke tests for auth utilities (hashPassword, verifyPassword, createToken, verifyToken).
 *
 * These are pure unit tests — no DB or HTTP needed.
 */
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, createToken, verifyToken } from '../auth'

describe('auth – password hashing', () => {
  it('hashes a password and verifies it', async () => {
    const plain = 'SuperSecret123!'
    const hash = await hashPassword(plain)

    expect(hash).not.toBe(plain)
    expect(hash).toMatch(/^\$2[aby]?\$/) // bcrypt prefix
    expect(await verifyPassword(plain, hash)).toBe(true)
  })

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct-horse')
    expect(await verifyPassword('wrong-horse', hash)).toBe(false)
  })

  it('produces different hashes for same input (salt)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })
})

describe('auth – JWT tokens', () => {
  const payload = {
    builderId: 'bld_test123',
    email: 'test@builder.com',
    companyName: 'Test Homes LLC',
  }

  it('creates and verifies a token', async () => {
    const token = await createToken(payload)
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3) // JWT has 3 parts

    const decoded = await verifyToken(token)
    expect(decoded).not.toBeNull()
    expect(decoded!.builderId).toBe(payload.builderId)
    expect(decoded!.email).toBe(payload.email)
    expect(decoded!.companyName).toBe(payload.companyName)
  })

  it('rejects a tampered token', async () => {
    const token = await createToken(payload)
    // Flip one character in the signature
    const tampered = token.slice(0, -2) + 'XX'
    const decoded = await verifyToken(tampered)
    expect(decoded).toBeNull()
  })

  it('rejects garbage input', async () => {
    expect(await verifyToken('')).toBeNull()
    expect(await verifyToken('not.a.jwt')).toBeNull()
    expect(await verifyToken('abc123')).toBeNull()
  })
})
