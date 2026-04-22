export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/buildertrend/projects
// List all mapped BT projects with sync status
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const mappings: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         bpm.id,
         bpm."btProjectId",
         bpm."btProjectName",
         bpm."btBuilderName",
         bpm."btCommunity",
         bpm."btLot",
         bpm."btStatus",
         bpm."builderId",
         bpm."projectId",
         bpm."jobId",
         bpm."lastSyncedAt",
         bpm."createdAt",
         b."companyName" as "builderCompanyName",
         j."jobNumber",
         j."status" as "jobStatus",
         COUNT(DISTINCT se."id")::int as "scheduleCount"
       FROM "BTProjectMapping" bpm
       LEFT JOIN "Builder" b ON bpm."builderId" = b."id"
       LEFT JOIN "Job" j ON bpm."jobId" = j."id"
       LEFT JOIN "ScheduleEntry" se ON j."id" = se."jobId"
       GROUP BY
         bpm.id, bpm."btProjectId", bpm."btProjectName", bpm."btBuilderName",
         bpm."btCommunity", bpm."btLot", bpm."btStatus", bpm."builderId",
         bpm."projectId", bpm."jobId", bpm."lastSyncedAt", bpm."createdAt",
         b."companyName", j."jobNumber", j."status"
       ORDER BY bpm."lastSyncedAt" DESC NULLS LAST`
    )

    const projects = mappings.map((m: any) => ({
      id: m.id,
      btProjectId: m.btProjectId,
      btProjectName: m.btProjectName,
      btBuilderName: m.btBuilderName,
      btCommunity: m.btCommunity,
      btLot: m.btLot,
      btStatus: m.btStatus,
      mapped: {
        builderId: m.builderId,
        builderCompanyName: m.builderCompanyName,
        projectId: m.projectId,
        jobId: m.jobId,
        jobNumber: m.jobNumber,
        jobStatus: m.jobStatus,
      },
      scheduleCount: Number(m.scheduleCount),
      lastSyncedAt: m.lastSyncedAt,
      createdAt: m.createdAt,
    }))

    return safeJson({
      projects,
      total: mappings.length,
      mapped: mappings.filter((m: any) => m.jobId).length,
      unmapped: mappings.filter((m: any) => !m.jobId).length,
    })
  } catch (error: any) {
    console.error('Error listing BT projects:', error)
    return safeJson(
      { error: 'Failed to list projects'},
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/buildertrend/projects
// Manually map a BT project to an Abel builder/project/job
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { btProjectId, builderId, projectId, jobId } = body

    if (!btProjectId) {
      return safeJson(
        { error: 'btProjectId is required' },
        { status: 400 }
      )
    }

    if (!builderId && !projectId && !jobId) {
      return safeJson(
        { error: 'At least one of builderId, projectId, or jobId must be provided' },
        { status: 400 }
      )
    }

    // Verify that the BT project exists in our mappings
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BTProjectMapping" WHERE "btProjectId" = $1 LIMIT 1`,
      btProjectId
    )

    if (existing.length === 0) {
      return safeJson(
        { error: 'BT project not found. Run sync-projects first.' },
        { status: 404 }
      )
    }

    // Verify target resources exist if provided
    if (builderId) {
      const builder: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Builder" WHERE "id" = $1 LIMIT 1`,
        builderId
      )
      if (builder.length === 0) {
        return safeJson(
          { error: 'Builder not found' },
          { status: 404 }
        )
      }
    }

    if (projectId) {
      const project: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Project" WHERE "id" = $1 LIMIT 1`,
        projectId
      )
      if (project.length === 0) {
        return safeJson(
          { error: 'Project not found' },
          { status: 404 }
        )
      }
    }

    if (jobId) {
      const job: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Job" WHERE "id" = $1 LIMIT 1`,
        jobId
      )
      if (job.length === 0) {
        return safeJson(
          { error: 'Job not found' },
          { status: 404 }
        )
      }
    }

    // Update the mapping
    await prisma.$executeRawUnsafe(
      `UPDATE "BTProjectMapping"
       SET "builderId" = COALESCE($2, "builderId"),
           "projectId" = COALESCE($3, "projectId"),
           "jobId" = COALESCE($4, "jobId"),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "btProjectId" = $1`,
      btProjectId,
      builderId || null,
      projectId || null,
      jobId || null
    )

    // Fetch updated mapping
    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BTProjectMapping" WHERE "btProjectId" = $1 LIMIT 1`,
      btProjectId
    )

    return safeJson({
      success: true,
      message: 'Project mapping updated',
      mapping: updated[0],
    })
  } catch (error: any) {
    console.error('Error mapping BT project:', error)
    return safeJson(
      { error: 'Failed to map project'},
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PUT /api/ops/integrations/buildertrend/projects/[id]
// Update mapping for a specific project
// ──────────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Integration', undefined, { method: 'PUT' }).catch(() => {})

    const body = await request.json()
    const { id, builderId, projectId, jobId } = body

    if (!id) {
      return safeJson(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    // Verify mapping exists
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BTProjectMapping" WHERE "id" = $1 LIMIT 1`,
      id
    )

    if (existing.length === 0) {
      return safeJson(
        { error: 'Mapping not found' },
        { status: 404 }
      )
    }

    // Verify target resources exist if provided
    if (builderId) {
      const builder: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Builder" WHERE "id" = $1 LIMIT 1`,
        builderId
      )
      if (builder.length === 0) {
        return safeJson(
          { error: 'Builder not found' },
          { status: 404 }
        )
      }
    }

    if (projectId) {
      const project: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Project" WHERE "id" = $1 LIMIT 1`,
        projectId
      )
      if (project.length === 0) {
        return safeJson(
          { error: 'Project not found' },
          { status: 404 }
        )
      }
    }

    if (jobId) {
      const job: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Job" WHERE "id" = $1 LIMIT 1`,
        jobId
      )
      if (job.length === 0) {
        return safeJson(
          { error: 'Job not found' },
          { status: 404 }
        )
      }
    }

    // Update the mapping
    await prisma.$executeRawUnsafe(
      `UPDATE "BTProjectMapping"
       SET "builderId" = COALESCE($2, "builderId"),
           "projectId" = COALESCE($3, "projectId"),
           "jobId" = COALESCE($4, "jobId"),
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      id,
      builderId || null,
      projectId || null,
      jobId || null
    )

    // Fetch updated mapping with related data
    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         bpm.id,
         bpm."btProjectId",
         bpm."btProjectName",
         bpm."btBuilderName",
         bpm."btCommunity",
         bpm."btLot",
         bpm."btStatus",
         bpm."builderId",
         bpm."projectId",
         bpm."jobId",
         bpm."lastSyncedAt",
         bpm."createdAt",
         b."companyName" as "builderCompanyName",
         j."jobNumber",
         j."status" as "jobStatus"
       FROM "BTProjectMapping" bpm
       LEFT JOIN "Builder" b ON bpm."builderId" = b."id"
       LEFT JOIN "Job" j ON bpm."jobId" = j."id"
       WHERE bpm."id" = $1`,
      id
    )

    if (updated.length === 0) {
      return safeJson(
        { error: 'Failed to retrieve updated mapping' },
        { status: 500 }
      )
    }

    return safeJson({
      success: true,
      message: 'Project mapping updated',
      mapping: updated[0],
    })
  } catch (error: any) {
    console.error('Error updating BT project mapping:', error)
    return safeJson(
      { error: 'Failed to update mapping'},
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/ops/integrations/buildertrend/projects/[id]
// Unmap a BT project (optionally delete the mapping entirely)
// ──────────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'DELETE', 'Integration', undefined, { method: 'DELETE' }).catch(() => {})

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return safeJson(
        { error: 'id query parameter is required' },
        { status: 400 }
      )
    }

    // Clear the mapping (set builder/project/job to NULL) instead of deleting
    await prisma.$executeRawUnsafe(
      `UPDATE "BTProjectMapping"
       SET "builderId" = NULL, "projectId" = NULL, "jobId" = NULL,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      id
    )

    return safeJson({
      success: true,
      message: 'Project mapping cleared',
    })
  } catch (error: any) {
    console.error('Error clearing BT project mapping:', error)
    return safeJson(
      { error: 'Failed to clear mapping'},
      { status: 500 }
    )
  }
}
