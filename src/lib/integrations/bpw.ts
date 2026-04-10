// ──────────────────────────────────────────────────────────────────────────
// BPW Pulte / Builder Portal Web — API Integration
// Handles jobs, communities, and schedule/milestone data
// Auth: Bearer token from BPW account
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { SyncResult } from './types'

interface BPWConfig {
  apiKey: string
  baseUrl: string
}

interface BPWJob {
  jobId: string
  jobNumber: string
  address: string
  community: string
  lotBlock: string
  status: string
  deliveryDate?: string
  scheduledDate?: string
}

interface BPWCommunity {
  communityId: string
  communityName: string
  projectName: string
  projectId?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}

interface BPWSchedule {
  jobId: string
  milestoneType: string
  scheduledDate: string
  status: string
  notes?: string
}

async function getConfig(): Promise<BPWConfig | null> {
  const config = await (prisma as any).integrationConfig.findUnique({
    where: { provider: 'BPW_PULTE' },
  })
  if (!config || config.status !== 'CONNECTED' || !config.apiKey || !config.baseUrl) {
    return null
  }
  return { apiKey: config.apiKey, baseUrl: config.baseUrl }
}

async function bpwFetch(path: string, config: BPWConfig, options?: RequestInit) {
  const url = `${config.baseUrl}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`BPW Pulte API ${response.status}: ${text}`)
  }

  return response.json()
}

// ─── Communities Sync ────────────────────────────────────────────────────

export async function syncCommunities(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'communities',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorMessage: 'BPW Pulte not configured',
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0,
    updated = 0,
    failed = 0

  try {
    const data = await bpwFetch('/api/v1/communities', config)
    const communities: BPWCommunity[] = data.communities || data

    for (const bpwCom of communities) {
      try {
        // Try to match by community name or ID
        const existing = await (prisma as any).community.findFirst({
          where: {
            OR: [{ name: bpwCom.communityName }, { externalId: bpwCom.communityId }],
          },
        })

        if (existing) {
          await (prisma as any).community.update({
            where: { id: existing.id },
            data: {
              name: bpwCom.communityName,
              projectName: bpwCom.projectName || existing.projectName,
              externalId: bpwCom.communityId,
              address: bpwCom.address || existing.address,
              city: bpwCom.city || existing.city,
              state: bpwCom.state || existing.state,
              zip: bpwCom.zip || existing.zip,
            },
          })
          updated++
        } else {
          await (prisma as any).community.create({
            data: {
              name: bpwCom.communityName,
              projectName: bpwCom.projectName,
              externalId: bpwCom.communityId,
              address: bpwCom.address,
              city: bpwCom.city,
              state: bpwCom.state,
              zip: bpwCom.zip,
            },
          })
          created++
        }
      } catch (err) {
        failed++
        console.error(`BPW community sync error for ${bpwCom.communityName}:`, err)
      }
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'BPW_PULTE',
        syncType: 'communities',
        direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: created + updated + failed,
        recordsCreated: created,
        recordsUpdated: updated,
        recordsSkipped: 0,
        recordsFailed: failed,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'communities',
      direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + failed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: 0,
      recordsFailed: failed,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'communities',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorMessage: error.message,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Jobs Sync ───────────────────────────────────────────────────────────

export async function syncJobs(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'jobs',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorMessage: 'BPW Pulte not configured',
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0,
    updated = 0,
    skipped = 0,
    failed = 0

  try {
    const data = await bpwFetch('/api/v1/jobs', config)
    const jobs: BPWJob[] = data.jobs || data

    for (const bpwJob of jobs) {
      try {
        // Check if we already have this BPW job by jobId
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "status"::text as status FROM "Job" WHERE "bpwJobId" = $1 LIMIT 1`,
          bpwJob.jobId
        )

        if (existing.length > 0) {
          // Update status/scheduled date if changed
          const newStatus = mapBPWJobStatus(bpwJob.status)
          const newScheduledDate = bpwJob.scheduledDate ? new Date(bpwJob.scheduledDate) : null

          if (existing[0].status !== newStatus || newScheduledDate) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Job" SET "status" = $1::"JobStatus", "scheduledDate" = $2, "updatedAt" = NOW() WHERE "id" = $3`,
              newStatus,
              newScheduledDate,
              existing[0].id
            )
            updated++
          } else {
            skipped++
          }
          continue
        }

        // Create new Job from BPW
        const jobId = `job_bpw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        const jobNumber = `JOB-BPW-${(bpwJob.jobNumber || '').toString().slice(-6).toUpperCase()}`

        await prisma.$executeRawUnsafe(`
          INSERT INTO "Job" (
            "id", "jobNumber", "bpwJobId",
            "builderName", "jobAddress",
            "community", "lotBlock",
            "scopeType", "status", "scheduledDate",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3,
            $4, $5,
            $6, $7,
            'FULL_PACKAGE'::"ScopeType", $8::"JobStatus", $9,
            NOW(), NOW()
          )
        `,
          jobId,
          jobNumber,
          bpwJob.jobId,
          bpwJob.community || 'Unknown',
          bpwJob.address,
          bpwJob.community,
          bpwJob.lotBlock,
          mapBPWJobStatus(bpwJob.status),
          bpwJob.scheduledDate ? new Date(bpwJob.scheduledDate) : null
        )
        created++
      } catch (err: any) {
        failed++
        console.error(`BPW job sync error for ${bpwJob.jobId}:`, err?.message)
      }
    }

    const completedAt = new Date()
    await prisma.$executeRawUnsafe(`
      INSERT INTO "SyncLog" ("id", "provider", "syncType", "direction", "status",
        "recordsProcessed", "recordsCreated", "recordsUpdated", "recordsSkipped", "recordsFailed",
        "startedAt", "completedAt", "durationMs")
      VALUES ($1, 'BPW_PULTE', 'jobs', 'PULL', $2,
        $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      `sync_${Date.now().toString(36)}`,
      failed > 0 ? 'PARTIAL' : 'SUCCESS',
      created + updated + skipped + failed,
      created,
      updated,
      skipped,
      failed,
      startedAt,
      completedAt,
      completedAt.getTime() - startedAt.getTime()
    )

    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'jobs',
      direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + updated + skipped + failed,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'jobs',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorMessage: error.message,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Schedule Sync ───────────────────────────────────────────────────────

export async function syncSchedules(): Promise<SyncResult> {
  const startedAt = new Date()
  const config = await getConfig()
  if (!config) {
    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'schedules',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorMessage: 'BPW Pulte not configured',
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let updated = 0,
    skipped = 0,
    failed = 0

  try {
    const data = await bpwFetch('/api/v1/schedules', config)
    const schedules: BPWSchedule[] = data.schedules || data

    for (const bpwSched of schedules) {
      try {
        // Find the Job by BPW job ID
        const job: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Job" WHERE "bpwJobId" = $1 LIMIT 1`,
          bpwSched.jobId
        )

        if (job.length > 0) {
          const scheduledDate = new Date(bpwSched.scheduledDate)

          // Update job's scheduled date
          await prisma.$executeRawUnsafe(
            `UPDATE "Job" SET "scheduledDate" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
            scheduledDate,
            job[0].id
          )
          updated++
        } else {
          skipped++
        }
      } catch (err: any) {
        failed++
        console.error(`BPW schedule sync error for job ${bpwSched.jobId}:`, err?.message)
      }
    }

    const completedAt = new Date()
    await prisma.$executeRawUnsafe(`
      INSERT INTO "SyncLog" ("id", "provider", "syncType", "direction", "status",
        "recordsProcessed", "recordsCreated", "recordsUpdated", "recordsSkipped", "recordsFailed",
        "startedAt", "completedAt", "durationMs")
      VALUES ($1, 'BPW_PULTE', 'schedules', 'PULL', $2,
        $3, $4, $5, $6, $7, $8, $9, $10)
    `,
      `sync_${Date.now().toString(36)}`,
      failed > 0 ? 'PARTIAL' : 'SUCCESS',
      updated + skipped + failed,
      0,
      updated,
      skipped,
      failed,
      startedAt,
      completedAt,
      completedAt.getTime() - startedAt.getTime()
    )

    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'schedules',
      direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: updated + skipped + failed,
      recordsCreated: 0,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'BPW_PULTE' as any,
      syncType: 'schedules',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
      errorMessage: error.message,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Connection Test ─────────────────────────────────────────────────────

export async function testConnection(
  apiKey: string,
  baseUrl: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/communities?limit=1`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return { success: false, message: `API returned ${response.status}: ${response.statusText}` }
    }

    return { success: true, message: 'Connected to BPW Pulte successfully' }
  } catch (error: any) {
    return { success: false, message: error.message }
  }
}

// ─── Status Mapping ──────────────────────────────────────────────────────

function mapBPWJobStatus(bpwStatus: string): string {
  const map: Record<string, string> = {
    'New': 'CREATED',
    'Scheduled': 'READINESS_CHECK',
    'MaterialsReady': 'MATERIALS_LOCKED',
    'InProduction': 'IN_PRODUCTION',
    'Staged': 'STAGED',
    'Loaded': 'LOADED',
    'InTransit': 'IN_TRANSIT',
    'Delivered': 'DELIVERED',
    'Installing': 'INSTALLING',
    'Complete': 'COMPLETE',
    'Cancelled': 'CANCELLED',
  }
  return map[bpwStatus] || 'CREATED'
}
