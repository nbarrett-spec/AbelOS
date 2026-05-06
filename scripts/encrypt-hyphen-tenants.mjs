// ──────────────────────────────────────────────────────────────────────────
// One-shot migration — encrypt existing HyphenTenant credentials in place.
//
// A-SEC-6: HyphenTenant.username/password/oauthAccessToken/oauthRefreshToken
// were stored in the clear. After deploying src/lib/hyphen/crypto.ts the read
// path transparently passes through plaintext for back-compat. This script
// closes the loop by encrypting every existing row.
//
// Usage:
//   1. Set HYPHEN_ENCRYPTION_KEY (32 bytes hex) in the target environment's
//      env vars BEFORE running this script. The same value must be set in
//      Vercel for app.abellumber.com so the running app can decrypt.
//        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   2. Confirm a recent Neon DB backup exists (point-in-time + branch snapshot).
//   3. Run:
//        node scripts/encrypt-hyphen-tenants.mjs           # dry-run
//        node scripts/encrypt-hyphen-tenants.mjs --apply   # write changes
//   4. Spot-check a tenant: pull row in psql, confirm fields are
//      base64 starting with version byte 0x01.
//
// Idempotent: re-running on already-encrypted rows is a no-op (the helper
// detects v1 envelope and returns the value unchanged).
// ──────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const VERSION_BYTE = 0x01

function getKey() {
  const hex = (process.env.HYPHEN_ENCRYPTION_KEY || '').trim()
  if (!hex) throw new Error('HYPHEN_ENCRYPTION_KEY env var not set')
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('HYPHEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

function isEncrypted(value) {
  if (!value || value.length < 40) return false
  try {
    const buf = Buffer.from(value, 'base64')
    if (buf.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) return false
    return buf.length > IV_LENGTH + TAG_LENGTH + 1 && buf[0] === VERSION_BYTE
  } catch {
    return false
  }
}

function encryptCredential(plaintext, key) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null
  if (isEncrypted(plaintext)) return plaintext
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, tag, ct]).toString('base64')
}

const APPLY = process.argv.includes('--apply')

async function main() {
  const key = getKey()
  const prisma = new PrismaClient()
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderName", "username", "password", "oauthAccessToken", "oauthRefreshToken"
       FROM "HyphenTenant"`,
    )
    console.log(`Found ${rows.length} HyphenTenant rows`)

    let touched = 0
    let alreadyEncrypted = 0
    let skipped = 0
    for (const r of rows) {
      const fields = ['username', 'password', 'oauthAccessToken', 'oauthRefreshToken']
      const original = { username: r.username, password: r.password, oauthAccessToken: r.oauthAccessToken, oauthRefreshToken: r.oauthRefreshToken }
      const updated = {}
      let needsUpdate = false
      let allAlreadyEnc = true
      let anyValue = false
      for (const f of fields) {
        const v = original[f]
        if (v === null || v === undefined || v === '') continue
        anyValue = true
        if (isEncrypted(v)) continue
        allAlreadyEnc = false
        updated[f] = encryptCredential(v, key)
        needsUpdate = true
      }
      if (!anyValue) {
        skipped++
        continue
      }
      if (allAlreadyEnc && !needsUpdate) {
        alreadyEncrypted++
        console.log(`  [${r.builderName || r.id}] already encrypted, skipping`)
        continue
      }
      console.log(`  [${r.builderName || r.id}] will encrypt: ${Object.keys(updated).join(', ')}`)
      if (APPLY) {
        const sets = Object.keys(updated).map((k, i) => `"${k}" = $${i + 1}`).join(', ')
        const params = Object.values(updated)
        await prisma.$executeRawUnsafe(
          `UPDATE "HyphenTenant" SET ${sets}, "updatedAt" = NOW() WHERE "id" = $${params.length + 1}`,
          ...params,
          r.id,
        )
        touched++
      }
    }

    console.log()
    console.log('---')
    console.log(`mode:               ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
    console.log(`rows scanned:       ${rows.length}`)
    console.log(`rows skipped:       ${skipped} (no credential columns set)`)
    console.log(`already encrypted:  ${alreadyEncrypted}`)
    console.log(`rows updated:       ${touched}`)
    if (!APPLY) console.log('Re-run with --apply to write changes.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
