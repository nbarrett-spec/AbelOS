// Live diagnostic for audit() — calls the helper with a mock NextRequest and
// surfaces the REAL error that .catch(() => {}) in callers has been swallowing.
// Usage: node scripts/test-audit.mjs
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function directInsertLikeHelper() {
  const id = 'aud' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  console.log('\n--- Direct insert replicating helper SQL (unpatched) ---')
  try {
    await prisma.$queryRawUnsafe(
      `INSERT INTO "AuditLog" ("id", "staffId", "staffName", "action", "entity", "entityId", "details", "ipAddress", "userAgent", "severity", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, NOW())`,
      id,
      'unknown',
      'Test User',
      'TEST_AUDIT_UNPATCHED',
      'Diagnostic',
      'diag-1',
      '{}',
      null,
      null,
      'INFO'
    )
    console.log('OK — inserted', id)
  } catch (e) {
    console.log('EXPECTED FAILURE:', e.message)
    console.log('(Confirms staffName column is missing — root cause)')
  }
}

async function patchedInsert() {
  const id = 'aud' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  console.log('\n--- Patched insert (no staffName column, staffId null-safe) ---')
  try {
    await prisma.$queryRawUnsafe(
      `INSERT INTO "AuditLog" ("id", "staffId", "action", "entity", "entityId", "details", "ipAddress", "userAgent", "severity", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())`,
      id,
      null, // staffId nullable — FK-safe
      'TEST_AUDIT_PATCHED',
      'Diagnostic',
      'diag-2',
      '{"source":"test-audit.mjs"}',
      null,
      null,
      'INFO'
    )
    console.log('OK — inserted', id)
  } catch (e) {
    console.log('FAILURE:', e.message)
  }
}

async function invokeRealHelper() {
  console.log('\n--- Invoking compiled audit() helper via loader ---')
  // Build a minimal NextRequest-like object (Headers-backed).
  const headers = new Headers({
    'x-staff-id': 'unknown',
    'x-staff-firstname': 'Test',
    'x-staff-lastname': 'User',
    'user-agent': 'test-audit.mjs',
  })
  const mockReq = { headers }

  try {
    // Import via tsx-compatible path. When run without tsx this will fail — we
    // fall back to the direct inserts above to surface the same SQL.
    const { audit } = await import('../src/lib/audit.ts').catch(async () => {
      return await import('../src/lib/audit.js').catch(() => ({ audit: null }))
    })
    if (!audit) {
      console.log('SKIP — audit() requires tsx/ts-node. Direct inserts above prove root cause.')
      return
    }
    const id = await audit(mockReq, 'TEST_AUDIT_HELPER', 'Diagnostic', 'diag-3', { via: 'helper' })
    console.log('audit() returned id =', JSON.stringify(id))
  } catch (e) {
    console.log('HELPER FAILURE:', e.message)
  }
}

async function verify() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, "staffId", action, entity, "entityId", "createdAt" FROM "AuditLog" WHERE action LIKE 'TEST_AUDIT%' ORDER BY "createdAt" DESC LIMIT 10`
  )
  console.log('\n--- Rows landed ---')
  console.table(rows)
}

;(async () => {
  await directInsertLikeHelper()
  await patchedInsert()
  await invokeRealHelper()
  await verify()
  await prisma.$disconnect()
})().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
