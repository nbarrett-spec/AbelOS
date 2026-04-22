export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_CHANGE_ORDERS', 'Database', undefined, { migration: 'RUN_MIGRATE_CHANGE_ORDERS' }, 'CRITICAL').catch(() => {})

  const results: Record<string, string> = {}

  try {
    // ── ChangeOrder table ──
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ChangeOrder" (
        id TEXT PRIMARY KEY,
        "changeNumber" TEXT NOT NULL UNIQUE,
        "jobId" TEXT NOT NULL,
        "orderId" TEXT,
        "requestedById" TEXT,
        "approvedById" TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        reason TEXT NOT NULL,
        description TEXT,
        "lineItems" JSONB DEFAULT '[]',
        "originalTotal" FLOAT DEFAULT 0,
        "revisedTotal" FLOAT DEFAULT 0,
        "costImpact" FLOAT DEFAULT 0,
        "scheduleImpact" TEXT,
        "builderApproval" BOOLEAN DEFAULT FALSE,
        "builderApprovedAt" TIMESTAMP WITH TIME ZONE,
        "internalNotes" TEXT,
        "submittedAt" TIMESTAMP WITH TIME ZONE,
        "approvedAt" TIMESTAMP WITH TIME ZONE,
        "rejectedAt" TIMESTAMP WITH TIME ZONE,
        "rejectionReason" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    results.changeOrderTable = 'OK'

    // Indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_co_job" ON "ChangeOrder"("jobId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_co_order" ON "ChangeOrder"("orderId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_co_status" ON "ChangeOrder"("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_co_number" ON "ChangeOrder"("changeNumber")`)
    results.changeOrderIndexes = 'OK'

    // Sequence for change order numbers
    await prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS co_seq START 1`)
    results.coSequence = 'OK'

    return NextResponse.json({ success: true, results })
  } catch (error: any) {
    console.error('[Migrate ChangeOrders]', error)
    return NextResponse.json({ error: 'Internal server error', results }, { status: 500 })
  }
}
