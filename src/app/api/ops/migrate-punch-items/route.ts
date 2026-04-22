export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_PUNCH_ITEMS', 'Database', undefined, { migration: 'RUN_MIGRATE_PUNCH_ITEMS' }, 'CRITICAL').catch(() => {})

  const results: Record<string, string> = {}

  try {
    // ── PunchItem table ──
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PunchItem" (
        id TEXT PRIMARY KEY,
        "punchNumber" TEXT NOT NULL,
        "installationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        location TEXT,
        description TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'MINOR',
        status TEXT NOT NULL DEFAULT 'OPEN',
        "assignedToId" TEXT,
        "reportedById" TEXT,
        "photoUrls" TEXT[] DEFAULT '{}',
        "fixPhotoUrls" TEXT[] DEFAULT '{}',
        "dueDate" TIMESTAMP WITH TIME ZONE,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "resolvedById" TEXT,
        "resolutionNotes" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    results.punchItemTable = 'OK'

    // Indexes
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_pi_install" ON "PunchItem"("installationId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_pi_job" ON "PunchItem"("jobId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_pi_status" ON "PunchItem"("status")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_pi_severity" ON "PunchItem"("severity")`)
    results.punchItemIndexes = 'OK'

    return NextResponse.json({ success: true, results })
  } catch (error: any) {
    console.error('[Migrate PunchItems]', error)
    return NextResponse.json({ error: 'Internal server error', results }, { status: 500 })
  }
}
