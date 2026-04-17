export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import {
import { audit } from '@/lib/audit'
  getBuilderTrendConfig,
  getBuilderTrendClient,
  syncProjects,
  syncSchedules,
  syncMaterialSelections,
} from '@/lib/integrations/buildertrend'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/buildertrend
// Return connection status, synced projects count, upcoming milestones, etc.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const config = await getBuilderTrendConfig()

    // Get integration config from DB
    const configData: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "IntegrationConfig" WHERE "provider" = $1::"IntegrationProvider" LIMIT 1`,
      'BUILDERTREND'
    )

    const integrationConfig = configData.length > 0 ? configData[0] : null

    // Count synced projects
    const projectCounts: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN "jobId" IS NOT NULL THEN 1 END) as mapped
       FROM "BTProjectMapping"`
    )

    const projectCount = projectCounts[0]

    // Get upcoming milestones (within 72 hours)
    const now = new Date()
    const in72Hours = new Date(now.getTime() + 72 * 60 * 60 * 1000)

    const upcomingSchedules: any[] = await prisma.$queryRawUnsafe(
      `SELECT se.* FROM "ScheduleEntry" se
       JOIN "Job" j ON se."jobId" = j."id"
       WHERE se."scheduledDate" BETWEEN $1 AND $2
       AND se."status" != 'COMPLETED'::"ScheduleStatus"
       ORDER BY se."scheduledDate" ASC
       LIMIT 10`,
      now.toISOString(),
      in72Hours.toISOString()
    )

    // Get recent sync logs
    const recentSyncs: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "SyncLog"
       WHERE "provider" = $1::"IntegrationProvider"
       ORDER BY "startedAt" DESC
       LIMIT 5`,
      'BUILDERTREND'
    )

    const response = {
      status: config ? 'CONNECTED' : 'DISCONNECTED',
      config: config
        ? {
            baseUrl: config.baseUrl,
            clientId: config.clientId.substring(0, 4) + '***', // Masked for security
            tokenExpiresAt: config.tokenExpiresAt,
          }
        : null,
      projects: {
        total: Number(projectCount.total),
        mapped: Number(projectCount.mapped),
        unmapped: Number(projectCount.total) - Number(projectCount.mapped),
      },
      upcomingSchedules: upcomingSchedules.map((s: any) => ({
        id: s.id,
        jobId: s.jobId,
        title: s.title,
        scheduledDate: s.scheduledDate,
        scheduledTime: s.scheduledTime,
        entryType: s.entryType,
        status: s.status,
      })),
      recentSyncs: recentSyncs.map((s: any) => ({
        id: s.id,
        syncType: s.syncType,
        status: s.status,
        recordsProcessed: Number(s.recordsProcessed),
        recordsCreated: Number(s.recordsCreated),
        recordsUpdated: Number(s.recordsUpdated),
        recordsFailed: Number(s.recordsFailed),
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: Number(s.durationMs),
      })),
      integrationConfig: integrationConfig ? {
        syncEnabled: integrationConfig.syncEnabled,
        syncInterval: Number(integrationConfig.syncInterval),
      } : null,
    }

    return safeJson(response)
  } catch (error: any) {
    console.error('Error fetching BuilderTrend status:', error)
    return safeJson(
      { error: 'Failed to fetch BuilderTrend status', details: error.message },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/buildertrend
// Actions: 'connect', 'sync-projects', 'sync-schedules', 'sync-materials', 'disconnect'
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { action, baseUrl, clientId, clientSecret } = body

    if (!action) {
      return safeJson({ error: 'action is required' }, { status: 400 })
    }

    // ─── CONNECT: Store credentials and test connection ──────────────────

    if (action === 'connect') {
      if (!baseUrl || !clientId || !clientSecret) {
        return safeJson(
          { error: 'baseUrl, clientId, and clientSecret are required' },
          { status: 400 }
        )
      }

      try {
        // Check if config exists
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT * FROM "IntegrationConfig" WHERE "provider" = $1::"IntegrationProvider" LIMIT 1`,
          'BUILDERTREND'
        )

        if (existing.length > 0) {
          // Update existing
          await prisma.$executeRawUnsafe(
            `UPDATE "IntegrationConfig"
             SET "apiKey" = $1, "apiSecret" = $2, "baseUrl" = $3,
                 "status" = 'CONFIGURING'::"IntegrationStatus", "updatedAt" = CURRENT_TIMESTAMP
             WHERE "provider" = 'BUILDERTREND'::"IntegrationProvider"`,
            clientId,
            clientSecret,
            baseUrl
          )
        } else {
          // Create new
          await prisma.$executeRawUnsafe(
            `INSERT INTO "IntegrationConfig"
             ("provider", "name", "apiKey", "apiSecret", "baseUrl", "syncEnabled", "syncInterval", "status")
             VALUES ('BUILDERTREND'::"IntegrationProvider", 'BuilderTrend', $1, $2, $3, true, 3600, 'CONFIGURING'::"IntegrationStatus")`,
            clientId,
            clientSecret,
            baseUrl
          )
        }

        // Test connection by getting config and attempting a token request
        const testClient = {
          clientId,
          clientSecret,
          baseUrl,
        }

        // Make a simple API call to verify credentials
        try {
          const tokenUrl = `${baseUrl}/oauth/token`
          const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'client_credentials',
              client_id: clientId,
              client_secret: clientSecret,
            }).toString(),
          })

          if (tokenResponse.ok) {
            // Update status to CONNECTED
            await prisma.$executeRawUnsafe(
              `UPDATE "IntegrationConfig"
               SET "status" = 'CONNECTED'::"IntegrationStatus", "updatedAt" = CURRENT_TIMESTAMP
               WHERE "provider" = 'BUILDERTREND'::"IntegrationProvider"`,
            )

            return safeJson({
              success: true,
              message: 'BuilderTrend connected successfully',
              status: 'CONNECTED',
            })
          } else {
            const errorText = await tokenResponse.text()
            return safeJson(
              {
                success: false,
                message: `Connection failed: ${tokenResponse.status} ${errorText}`,
              },
              { status: 400 }
            )
          }
        } catch (testError: any) {
          return safeJson(
            {
              success: false,
              message: `Failed to test connection: ${testError.message}`,
            },
            { status: 400 }
          )
        }
      } catch (error: any) {
        return safeJson(
          { success: false, error: error.message },
          { status: 500 }
        )
      }
    }

    // ─── SYNC-PROJECTS: Pull all active projects from BT ─────────────────

    if (action === 'sync-projects') {
      try {
        const result = await syncProjects()
        return safeJson({
          success: result.status !== 'FAILED',
          result,
        })
      } catch (error: any) {
        return safeJson(
          { success: false, error: error.message },
          { status: 500 }
        )
      }
    }

    // ─── SYNC-SCHEDULES: Pull schedule updates for mapped projects ───────

    if (action === 'sync-schedules') {
      try {
        const result = await syncSchedules()
        return safeJson({
          success: result.status !== 'FAILED',
          result,
        })
      } catch (error: any) {
        return safeJson(
          { success: false, error: error.message },
          { status: 500 }
        )
      }
    }

    // ─── SYNC-MATERIALS: Pull material selections for mapped projects ────

    if (action === 'sync-materials') {
      try {
        const result = await syncMaterialSelections()
        return safeJson({
          success: result.status !== 'FAILED',
          result,
        })
      } catch (error: any) {
        return safeJson(
          { success: false, error: error.message },
          { status: 500 }
        )
      }
    }

    // ─── DISCONNECT: Clear credentials and mappings ──────────────────────

    if (action === 'disconnect') {
      try {
        // Delete integration config
        await prisma.$executeRawUnsafe(
          `DELETE FROM "IntegrationConfig" WHERE "provider" = $1::"IntegrationProvider"`,
          'BUILDERTREND'
        )

        // Optionally clear mappings (commented out to preserve history)
        // await prisma.$executeRawUnsafe(
        //   `DELETE FROM "BTProjectMapping"`
        // )

        return safeJson({
          success: true,
          message: 'BuilderTrend disconnected',
        })
      } catch (error: any) {
        return safeJson(
          { success: false, error: error.message },
          { status: 500 }
        )
      }
    }

    return safeJson(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('Error in BuilderTrend integration POST:', error)
    return safeJson(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
