// ──────────────────────────────────────────────────────────────────────────
// Hyphen credential encryption
//
// HyphenTenant rows hold per-builder credentials (username, password,
// oauthAccessToken, oauthRefreshToken) for the SupplyPro / BuildPro portals.
// Pre-A-SEC-6 these were stored in the clear — anyone with read access to
// `prod-main` Neon could grab Brookfield's, Toll's, Shaddock's portal logins.
//
// This module wraps AES-256-GCM around those fields. The key comes from
// HYPHEN_ENCRYPTION_KEY (32 bytes = 64 hex chars). Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Wire format (base64): version(1) | iv(12) | tag(16) | ciphertext(N)
//   v1 = 0x01. Bumping the version lets us migrate algorithms later
//   without ambiguity.
//
// Plaintext detection: anything that does NOT start with the v1 prefix
// (after base64 decode) is treated as plaintext. This keeps the read
// path back-compat during the rolling migration — encryptCredential()
// is idempotent against already-encrypted values.
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM standard
const TAG_LENGTH = 16
const VERSION_BYTE = 0x01

let cachedKey: Buffer | null = null

function getKey(): Buffer | null {
  if (cachedKey) return cachedKey
  const hex = process.env.HYPHEN_ENCRYPTION_KEY?.trim()
  if (!hex) return null
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'HYPHEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). ' +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    )
  }
  cachedKey = Buffer.from(hex, 'hex')
  return cachedKey
}

export function isEncryptionConfigured(): boolean {
  try {
    return getKey() !== null
  } catch {
    return false
  }
}

/**
 * Returns true if the given string is in the v1 ciphertext envelope. Used by
 * the read path to decide whether to decrypt or pass through (back-compat
 * with rows that haven't been migrated yet).
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false
  // Quick reject — base64 decode is cheap but worth skipping for obvious
  // plaintext (HYPHEN tokens contain colons, slashes, etc).
  if (value.length < 40) return false
  try {
    const buf = Buffer.from(value, 'base64')
    // Round-trip check: real base64 round-trips; arbitrary plaintext
    // typically does not (e.g. "myPassword!" decodes but re-encodes
    // differently because of padding/charset). This catches most cases.
    if (buf.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
      return false
    }
    return buf.length > IV_LENGTH + TAG_LENGTH + 1 && buf[0] === VERSION_BYTE
  } catch {
    return false
  }
}

/**
 * Encrypt a credential. Idempotent — if the value is already a v1 envelope,
 * returns it unchanged. Throws if HYPHEN_ENCRYPTION_KEY is not set.
 *
 * Pass null/undefined through untouched (column may be nullable).
 */
export function encryptCredential(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null
  if (isEncrypted(plaintext)) return plaintext
  const key = getKey()
  if (!key) {
    throw new Error(
      'HYPHEN_ENCRYPTION_KEY not set — refusing to write Hyphen credentials in plaintext. ' +
        'Set the env var (32 bytes hex) and retry.',
    )
  }
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope = Buffer.concat([Buffer.from([VERSION_BYTE]), iv, tag, ct])
  return envelope.toString('base64')
}

/**
 * Decrypt a credential. If the input is plaintext (no v1 envelope), it is
 * returned unchanged — back-compat with rows that haven't been migrated.
 * Throws on a malformed envelope or auth-tag mismatch (do not silently
 * accept tampered data).
 */
export function decryptCredential(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (!isEncrypted(value)) return value // plaintext passthrough
  const key = getKey()
  if (!key) {
    throw new Error(
      'HYPHEN_ENCRYPTION_KEY not set — cannot decrypt stored Hyphen credentials.',
    )
  }
  const buf = Buffer.from(value, 'base64')
  if (buf[0] !== VERSION_BYTE) {
    throw new Error(`Unsupported HYPHEN credential envelope version: ${buf[0]}`)
  }
  const iv = buf.subarray(1, 1 + IV_LENGTH)
  const tag = buf.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH)
  const ct = buf.subarray(1 + IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}
