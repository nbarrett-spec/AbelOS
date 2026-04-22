export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDevAdmin } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/cleanup — Remove demo/test data for production launch (DEV ONLY, ADMIN required)

const REAL_EMPLOYEE_EMAILS = [
  'josh@abellumber.com',
  'c.vinson@abellumber.com',
  'n.barrett@abellumber.com',
  'scott@abellumber.com',
  'sean@abellumber.com',
  'karen@abellumber.com',
  'd.haag@abellumber.com',
  'jessica@abellumber.com',
  'robin@abellumber.com',
  'dalton@abellumber.com',
  'jordan@abellumber.com',
  'chris@abellumber.com',
  'dakota@abellumber.com',
  'bob@abellumber.com',
  'jarreola@mgfinancialpartners.com',
  'jgladue@mgfinancialpartners.com',
]

async function safeExec(label: string, fn: () => Promise<any>) {
  try {
    const result = await fn()
    return { label, status: 'ok', result }
  } catch (e: any) {
    return { label, status: 'skipped', error: e.message?.substring(0, 300) }
  }
}

export async function POST(request: NextRequest) {
  const guard = requireDevAdmin(request)
  if (guard) return guard

  try {
    const log: any[] = []
    audit(request, 'RUN_CLEANUP', 'Database', undefined, { note: 'demo/test data purge' }, 'CRITICAL').catch(() => {})

    // ── 1. Identify fake staff ──
    const allStaff: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "firstName", "lastName" FROM "Staff"`
    )
    const fakeStaff = allStaff.filter(s => !REAL_EMPLOYEE_EMAILS.includes(s.email))
    const fakeIds = fakeStaff.map(s => s.id)
    const adminId = allStaff.find(s => s.email === 'n.barrett@abellumber.com')?.id || ''

    log.push({ fakeStaffFound: fakeStaff.map(s => `${s.firstName} ${s.lastName} (${s.email})`) })

    if (fakeIds.length > 0) {
      // Clear FK refs on every table that might reference fake staff
      const deleteTables = [
        [`UPDATE "Job" SET "assignedPMId" = NULL WHERE "assignedPMId" = ANY($1::text[])`, 'jobs-unassign'],
        [`DELETE FROM "Notification" WHERE "staffId" = ANY($1::text[])`, 'notifications-del'],
        [`DELETE FROM "Message" WHERE "senderId" = ANY($1::text[])`, 'messages-del'],
        [`DELETE FROM "ConversationParticipant" WHERE "staffId" = ANY($1::text[])`, 'conv-participants-del'],
        [`DELETE FROM "Conversation" WHERE "createdById" = ANY($1::text[])`, 'conversations-del'],
        [`DELETE FROM "Activity" WHERE "staffId" = ANY($1::text[])`, 'activities-del'],
        [`DELETE FROM "Task" WHERE "assigneeId" = ANY($1::text[])`, 'tasks-assignee-del'],
        [`DELETE FROM "Task" WHERE "creatorId" = ANY($1::text[])`, 'tasks-creator-del'],
        // Invoice - reassign to admin
        [`UPDATE "Invoice" SET "createdById" = $2 WHERE "createdById" = ANY($1::text[])`, 'invoice-reassign'],
        // PO - reassign to admin
        [`UPDATE "PurchaseOrder" SET "createdById" = $2 WHERE "createdById" = ANY($1::text[])`, 'po-reassign'],
        [`UPDATE "PurchaseOrder" SET "approvedById" = NULL WHERE "approvedById" = ANY($1::text[])`, 'po-approver-null'],
      ]

      for (const [sql, label] of deleteTables) {
        if (sql.includes('$2')) {
          log.push(await safeExec(label, () => prisma.$executeRawUnsafe(sql, fakeIds, adminId)))
        } else {
          log.push(await safeExec(label, () => prisma.$executeRawUnsafe(sql, fakeIds)))
        }
      }

      // Delete fake staff
      log.push(await safeExec('fake-staff-del', async () => {
        const r: any[] = await prisma.$queryRawUnsafe(
          `DELETE FROM "Staff" WHERE "id" = ANY($1::text[]) RETURNING "id"`,
          fakeIds
        )
        return r.length
      }))
    }

    // ── 2. Remove demo/test builders ──
    const deleteBuilder = async (identifier: string, email?: string, companyPattern?: string) => {
      let b: any = null
      if (email) {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "companyName", "email" FROM "Builder" WHERE "email" = $1 LIMIT 1`,
          email
        )
        b = rows[0]
      } else if (companyPattern) {
        const rows: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "companyName", "email" FROM "Builder" WHERE "companyName" ILIKE $1 LIMIT 1`,
          `%${companyPattern}%`
        )
        b = rows[0]
      }
      if (!b) return 'not found'
      const bid = b.id

      await prisma.$executeRawUnsafe(`DELETE FROM "HomeownerSelection" WHERE "homeownerAccessId" IN (SELECT id FROM "HomeownerAccess" WHERE "builderId" = $1)`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "HomeownerAccess" WHERE "builderId" = $1`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "HomeownerAccess" WHERE "projectId" IN (SELECT id FROM "Project" WHERE "builderId" = $1)`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "BuilderPricing" WHERE "builderId" = $1`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "Order" WHERE "builderId" = $1`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "Quote" WHERE "projectId" IN (SELECT id FROM "Project" WHERE "builderId" = $1)`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "Takeoff" WHERE "projectId" IN (SELECT id FROM "Project" WHERE "builderId" = $1)`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "Blueprint" WHERE "projectId" IN (SELECT id FROM "Project" WHERE "builderId" = $1)`, bid)
      await prisma.$executeRawUnsafe(`UPDATE "Job" SET "projectId" = NULL WHERE "projectId" IN (SELECT id FROM "Project" WHERE "builderId" = $1)`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "Project" WHERE "builderId" = $1`, bid)
      await prisma.$executeRawUnsafe(`DELETE FROM "Builder" WHERE id = $1`, bid)
      return `deleted: ${b.companyName || b.email}`
    }

    log.push(await safeExec('demo-builder',
      () => deleteBuilder('demo', 'demo@abelbuilder.com')
    ))

    log.push(await safeExec('test-builder-co',
      () => deleteBuilder('test', undefined, 'Test Builder')
    ))

    // ── 4. Demo homeowner ──
    log.push(await safeExec('demo-homeowner', async () => {
      await prisma.$executeRawUnsafe(`
        DELETE FROM "HomeownerSelection" WHERE "homeownerAccessId" IN
        (SELECT id FROM "HomeownerAccess" WHERE "accessToken" = 'demo-homeowner-2026')
      `)
      return await prisma.$executeRawUnsafe(`DELETE FROM "HomeownerAccess" WHERE "accessToken" = 'demo-homeowner-2026'`)
    }))

    // ── 5. Test jobs ──
    const jobCleanupSqls = [
      [`DELETE FROM "MaterialPick" WHERE "jobId" IN (SELECT id FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%')`, 'test-picks'],
      [`DELETE FROM "ScheduleEntry" WHERE "jobId" IN (SELECT id FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%')`, 'test-schedules'],
      [`DELETE FROM "Delivery" WHERE "jobId" IN (SELECT id FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%')`, 'test-deliveries'],
      [`DELETE FROM "Installation" WHERE "jobId" IN (SELECT id FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%')`, 'test-installs'],
      [`DELETE FROM "Activity" WHERE "jobId" IN (SELECT id FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%')`, 'test-job-activities'],
      [`DELETE FROM "Task" WHERE "jobId" IN (SELECT id FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%')`, 'test-job-tasks'],
      [`DELETE FROM "Job" WHERE "jobNumber" LIKE 'JOB-2026-00%'`, 'test-jobs'],
    ]
    for (const [sql, label] of jobCleanupSqls) {
      log.push(await safeExec(label, () => prisma.$executeRawUnsafe(sql)))
    }

    // ── 6. Test crews ──
    log.push(await safeExec('test-crew-members', () =>
      prisma.$executeRawUnsafe(`DELETE FROM "CrewMember" WHERE "crewId" LIKE 'crew_%'`)
    ))
    log.push(await safeExec('test-crews', () =>
      prisma.$executeRawUnsafe(`DELETE FROM "Crew" WHERE id LIKE 'crew_%'`)
    ))

    // ── 7. Final counts ──
    const staffCountResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "count" FROM "Staff"`
    )
    const builderCountResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "count" FROM "Builder"`
    )

    return NextResponse.json({
      success: true,
      remainingStaff: staffCountResult[0]?.count || 0,
      remainingBuilders: builderCountResult[0]?.count || 0,
      log
    })
  } catch (error: any) {
    console.error('Cleanup error:', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
