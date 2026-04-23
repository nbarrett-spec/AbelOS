// Post-fix verification: invoke the patched audit() helper and confirm
// rows land in AuditLog. Run with tsx so TS imports resolve cleanly.
//   npx tsx scripts/verify-audit-patched.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { audit, logAudit } from '../src/lib/audit'

const prisma = new PrismaClient()

async function main() {
  const mockReq: any = {
    headers: new Headers({
      'x-staff-id': 'unknown',
      'x-staff-firstname': 'Test',
      'x-staff-lastname': 'User',
      'user-agent': 'verify-audit-patched',
    }),
  }

  console.log('--- audit() with unknown staff (cron/webhook simulation) ---')
  const id1 = await audit(mockReq, 'TEST_AUDIT_POSTFIX', 'Diagnostic', 'diag-postfix-1', { via: 'audit()' })
  console.log('id1 =', JSON.stringify(id1))

  console.log('--- logAudit() with staffName param (should route name into details) ---')
  const id2 = await logAudit({
    staffId: 'unknown',
    staffName: 'Test User 2',
    action: 'TEST_AUDIT_POSTFIX',
    entity: 'Diagnostic',
    entityId: 'diag-postfix-2',
    details: { a: 1 },
  })
  console.log('id2 =', JSON.stringify(id2))

  console.log('--- logAudit() with real Staff id ---')
  const id3 = await logAudit({
    staffId: 'cmn0bsdf800005yk9sizrwc22',
    action: 'TEST_AUDIT_POSTFIX',
    entity: 'Diagnostic',
    entityId: 'diag-postfix-3',
  })
  console.log('id3 =', JSON.stringify(id3))

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "staffId", action, entity, "entityId", details, "createdAt"
       FROM "AuditLog"
      WHERE action = 'TEST_AUDIT_POSTFIX'
      ORDER BY "createdAt" DESC LIMIT 5`
  )
  console.log('\n--- Rows landed ---')
  console.table(
    rows.map((r) => ({
      id: r.id,
      staffId: r.staffId,
      entityId: r.entityId,
      stashedName: r.details?.staffName ?? null,
      createdAt: r.createdAt,
    }))
  )

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
