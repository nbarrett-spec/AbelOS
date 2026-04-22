export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/cron/brain-sync
// Pulls entity data from the NUC Brain API and syncs into Aegis tables:
//   • Communities  → from Brain community entities
//   • BuilderOrganization → from Brain builder/customer entities
//   • Jobs         → address enrichment from Brain entity data
//   • Scores       → entity health scores (A-F) from Brain scoring engine
//
// The Brain API lives at brain.abellumber.com/brain/* behind CF Access.
// This cron calls it directly (not via proxy) using CF service token.
// ──────────────────────────────────────────────────────────────────────────

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function brainFetch(path: string, timeout = 25000): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainSync/1.0',
  }

  const cfClientId = process.env.CF_ACCESS_CLIENT_ID
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfClientId && cfClientSecret) {
    headers['CF-Access-Client-Id'] = cfClientId
    headers['CF-Access-Client-Secret'] = cfClientSecret
  }

  const response = await fetch(`${BRAIN_BASE_URL}/brain/${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(timeout),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Brain API ${response.status}: ${text.substring(0, 200)}`)
  }

  return response.json()
}

// ──────────────────────────────────────────────────────────────────────────
// Entity sync logic
// ──────────────────────────────────────────────────────────────────────────

interface SyncStats {
  communitiesCreated: number
  communitiesUpdated: number
  orgsCreated: number
  orgsUpdated: number
  jobsEnriched: number
  scoresUpdated: number
  errors: string[]
}

async function syncCommunityEntities(entities: any[], stats: SyncStats) {
  const communityEntities = entities.filter(
    (e: any) => e.type === 'community' || e.type === 'subdivision' || e.type === 'project'
  )

  for (const entity of communityEntities) {
    try {
      const name = entity.name || entity.label || entity.title
      if (!name) continue

      // Try to find the builder this community belongs to
      let builderId: string | null = null
      if (entity.builderId || entity.builder_id) {
        builderId = entity.builderId || entity.builder_id
      } else if (entity.builderName || entity.builder) {
        const builderMatch: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Builder" WHERE "companyName" ILIKE $1 LIMIT 1`,
          `%${entity.builderName || entity.builder}%`
        )
        if (builderMatch.length > 0) builderId = builderMatch[0].id
      }

      if (!builderId) {
        // Default to first active builder if we can't resolve
        const defaultBuilder: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Builder" WHERE "status"::text = 'ACTIVE' ORDER BY "companyName" ASC LIMIT 1`
        )
        if (defaultBuilder.length > 0) builderId = defaultBuilder[0].id
        else continue // Can't create community without a builder
      }

      // Check if community already exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "Community"
         WHERE ("name" ILIKE $1 AND "builderId" = $2)
            OR ("code" = $3 AND $3 IS NOT NULL)
            OR ("boltId" = $4 AND $4 IS NOT NULL)
         LIMIT 1`,
        name,
        builderId,
        entity.code || entity.externalCode || null,
        entity.id || null
      )

      if (existing.length > 0) {
        // Update with enriched data from brain
        await prisma.$executeRawUnsafe(
          `UPDATE "Community" SET
            "address" = COALESCE($1, "address"),
            "city" = COALESCE($2, "city"),
            "state" = COALESCE($3, "state"),
            "zip" = COALESCE($4, "zip"),
            "county" = COALESCE($5, "county"),
            "totalLots" = CASE WHEN $6 > 0 THEN $6 ELSE "totalLots" END,
            "activeLots" = CASE WHEN $7 > 0 THEN $7 ELSE "activeLots" END,
            "phase" = COALESCE($8, "phase"),
            "division" = COALESCE($9, "division"),
            "notes" = CASE WHEN $10 IS NOT NULL THEN COALESCE("notes", '') || E'\n[Brain] ' || $10 ELSE "notes" END,
            "updatedAt" = NOW()
          WHERE "id" = $11`,
          entity.address || entity.street || null,
          entity.city || null,
          entity.state || entity.stateCode || null,
          entity.zip || entity.postalCode || null,
          entity.county || null,
          Number(entity.totalLots || entity.lots || 0) || 0,
          Number(entity.activeLots || 0) || 0,
          entity.phase || null,
          entity.division || entity.market || null,
          entity.summary || entity.description || null,
          existing[0].id
        )
        stats.communitiesUpdated++
      } else {
        // Create new community from brain data
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Community" (
            "id", "builderId", "name", "code", "address", "city", "state", "zip", "county",
            "totalLots", "activeLots", "phase", "status", "division", "notes",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13::"CommunityStatus", $14, $15,
            NOW(), NOW()
          )`,
          generateId('com'),
          builderId,
          name,
          entity.code || entity.externalCode || name.substring(0, 10).toUpperCase().replace(/\s/g, ''),
          entity.address || entity.street || null,
          entity.city || null,
          entity.state || entity.stateCode || null,
          entity.zip || entity.postalCode || null,
          entity.county || null,
          Number(entity.totalLots || entity.lots || 0) || 0,
          Number(entity.activeLots || 0) || 0,
          entity.phase || null,
          entity.status === 'closed' ? 'CLOSED' : entity.status === 'winding_down' ? 'WINDING_DOWN' : 'ACTIVE',
          entity.division || entity.market || null,
          entity.summary ? `[Brain] ${entity.summary}` : null
        )
        stats.communitiesCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Community "${entity.name}": ${err.message}`)
    }
  }
}

async function syncBuilderOrgEntities(entities: any[], stats: SyncStats) {
  const orgEntities = entities.filter(
    (e: any) => e.type === 'builder' || e.type === 'customer' || e.type === 'organization'
  )

  for (const entity of orgEntities) {
    try {
      const name = entity.name || entity.label || entity.title
      if (!name) continue

      // Check if org already exists
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id" FROM "BuilderOrganization"
         WHERE "name" ILIKE $1 OR "code" = $2
         LIMIT 1`,
        name,
        entity.code || entity.externalCode || name.substring(0, 10).toUpperCase().replace(/\s/g, '')
      )

      if (existing.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "BuilderOrganization" SET
            "contactName" = COALESCE($1, "contactName"),
            "email" = COALESCE($2, "email"),
            "phone" = COALESCE($3, "phone"),
            "address" = COALESCE($4, "address"),
            "city" = COALESCE($5, "city"),
            "state" = COALESCE($6, "state"),
            "zip" = COALESCE($7, "zip"),
            "creditLimit" = CASE WHEN $8 > 0 THEN $8 ELSE "creditLimit" END,
            "updatedAt" = NOW()
          WHERE "id" = $9`,
          entity.contactName || entity.contact || null,
          entity.email || null,
          entity.phone || null,
          entity.address || null,
          entity.city || null,
          entity.state || null,
          entity.zip || null,
          Number(entity.creditLimit || 0) || 0,
          existing[0].id
        )
        stats.orgsUpdated++
      } else {
        const code = (entity.code || name.substring(0, 10).toUpperCase().replace(/\s/g, '')).substring(0, 20)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BuilderOrganization" (
            "name", "code", "type", "contactName", "email", "phone",
            "address", "city", "state", "zip",
            "creditLimit", "notes", "active"
          ) VALUES ($1, $2, $3::"OrgType", $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
          ON CONFLICT DO NOTHING`,
          name,
          code,
          entity.orgType === 'custom' ? 'CUSTOM' : 'NATIONAL',
          entity.contactName || entity.contact || null,
          entity.email || null,
          entity.phone || null,
          entity.address || null,
          entity.city || null,
          entity.state || null,
          entity.zip || null,
          Number(entity.creditLimit || 0) || null,
          entity.summary ? `[Brain] ${entity.summary}` : null
        )
        stats.orgsCreated++
      }
    } catch (err: any) {
      stats.errors.push(`Org "${entity.name}": ${err.message}`)
    }
  }
}

async function enrichJobAddresses(entities: any[], stats: SyncStats) {
  // Find entities with job/address data and match to existing jobs
  const jobEntities = entities.filter(
    (e: any) => e.type === 'job' || e.type === 'work_order' || e.type === 'lot' ||
                (e.address && (e.lot || e.lotBlock || e.community))
  )

  for (const entity of jobEntities) {
    try {
      const address = entity.address || entity.jobAddress || entity.street ||
        [entity.streetNumber, entity.streetName].filter(Boolean).join(' ') || null
      if (!address) continue

      // Build address with city/state/zip
      const fullAddress = [
        address,
        entity.city,
        entity.state || entity.stateCode,
        entity.zip || entity.postalCode,
      ].filter(Boolean).join(', ')

      // Try to match to existing job
      let matched = false

      // Match by brain entity ID
      if (entity.id) {
        const result = await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET
            "jobAddress" = COALESCE(NULLIF($1, ''), "jobAddress"),
            "updatedAt" = NOW()
          WHERE ("boltJobId" = $2 OR "hyphenJobId" = $2)
            AND ("jobAddress" IS NULL OR "jobAddress" = '')
          `,
          fullAddress,
          entity.id
        )
        if ((result as any) > 0) { stats.jobsEnriched++; matched = true }
      }

      // Match by community + lot/block
      if (!matched && (entity.community || entity.subdivision) && (entity.lot || entity.lotBlock)) {
        const communityName = entity.community || entity.subdivision
        const lotBlock = entity.lotBlock || entity.lot
        const result = await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET
            "jobAddress" = COALESCE(NULLIF($1, ''), "jobAddress"),
            "updatedAt" = NOW()
          WHERE "community" ILIKE $2
            AND "lotBlock" = $3
            AND ("jobAddress" IS NULL OR "jobAddress" = '')
          `,
          fullAddress,
          `%${communityName}%`,
          lotBlock
        )
        if ((result as any) > 0) { stats.jobsEnriched++; matched = true }
      }
    } catch (err: any) {
      stats.errors.push(`Job enrich "${entity.id}": ${err.message}`)
    }
  }
}

async function syncScores(stats: SyncStats) {
  try {
    const scoresData = await brainFetch('scores')
    const scores = Array.isArray(scoresData) ? scoresData : (scoresData.scores || scoresData.entities || [])

    if (scores.length === 0) return

    // Store latest scores in AgentConfig
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "AgentConfig" WHERE "key" = 'brain_entity_scores' LIMIT 1`
    )

    const scorePayload = JSON.stringify({
      scores,
      syncedAt: new Date().toISOString(),
      count: scores.length,
    })

    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AgentConfig" SET "value" = $1, "updatedAt" = NOW() WHERE "key" = 'brain_entity_scores'`,
        scorePayload
      )
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" ("id", "key", "value", "createdAt", "updatedAt")
         VALUES ($1, 'brain_entity_scores', $2, NOW(), NOW())`,
        generateId('ac'),
        scorePayload
      )
    }

    // Create alerts for D/F scored entities
    for (const score of scores) {
      if (score.grade === 'D' || score.grade === 'F') {
        const alertTitle = `${score.grade} Grade: ${score.name || score.entityId}`
        const alertBody = `Entity "${score.name || score.entityId}" scored ${score.grade} (${score.score || 'N/A'}/100). ${score.reason || score.summary || ''}`

        // Check for existing recent alert on same entity
        const recentAlert: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "InboxItem"
           WHERE "type" = 'ALERT' AND "entityId" = $1
             AND "createdAt" > NOW() - INTERVAL '24 hours'
           LIMIT 1`,
          score.entityId || score.id || score.name
        )

        if (recentAlert.length === 0) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InboxItem" (
              "id", "type", "title", "body", "priority", "status",
              "entityType", "entityId", "source",
              "createdAt", "updatedAt"
            ) VALUES ($1, 'ALERT', $2, $3, $4, 'UNREAD', $5, $6, 'brain-sync', NOW(), NOW())`,
            generateId('inb'),
            alertTitle,
            alertBody,
            score.grade === 'F' ? 'HIGH' : 'MEDIUM',
            score.type || 'entity',
            score.entityId || score.id || score.name
          )
        }
      }
      stats.scoresUpdated++
    }
  } catch (err: any) {
    // Scores endpoint may not exist — don't fail the whole sync
    stats.errors.push(`Scores sync: ${err.message}`)
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('brain-sync', 'schedule')
  const started = Date.now()

  const stats: SyncStats = {
    communitiesCreated: 0,
    communitiesUpdated: 0,
    orgsCreated: 0,
    orgsUpdated: 0,
    jobsEnriched: 0,
    scoresUpdated: 0,
    errors: [],
  }

  try {
    // 1. Check brain health first
    let brainHealthy = false
    try {
      const health = await brainFetch('health', 10000)
      brainHealthy = health?.status === 'ok' || health?.status === 'healthy' || !!health
    } catch {
      // Brain might be offline — that's OK, we'll skip gracefully
    }

    if (!brainHealthy) {
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, {
        result: { skipped: true, reason: 'Brain engine unreachable or unhealthy' },
      })
      return NextResponse.json({
        success: true,
        skipped: true,
        message: 'Brain engine unreachable — skipping sync',
      })
    }

    // 2. Pull all entities from brain
    let allEntities: any[] = []
    try {
      const entitiesData = await brainFetch('entities?limit=500')
      allEntities = Array.isArray(entitiesData)
        ? entitiesData
        : (entitiesData.entities || entitiesData.data || [])
    } catch (err: any) {
      stats.errors.push(`Entity fetch: ${err.message}`)
    }

    // 3. Sync each entity type
    if (allEntities.length > 0) {
      await syncCommunityEntities(allEntities, stats)
      await syncBuilderOrgEntities(allEntities, stats)
      await enrichJobAddresses(allEntities, stats)
    }

    // 4. Pull and sync scores
    await syncScores(stats)

    // 5. Record last sync timestamp
    const syncTimestamp = new Date().toISOString()
    const existingTs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "AgentConfig" WHERE "key" = 'brain_sync_last' LIMIT 1`
    )
    if (existingTs.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AgentConfig" SET "value" = $1, "updatedAt" = NOW() WHERE "key" = 'brain_sync_last'`,
        JSON.stringify({ lastSync: syncTimestamp, stats })
      )
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" ("id", "key", "value", "createdAt", "updatedAt")
         VALUES ($1, 'brain_sync_last', $2, NOW(), NOW())`,
        generateId('ac'),
        JSON.stringify({ lastSync: syncTimestamp, stats })
      )
    }

    const allSuccess = stats.errors.length === 0
    const payload = {
      success: allSuccess,
      timestamp: syncTimestamp,
      entitiesFetched: allEntities.length,
      stats: {
        communitiesCreated: stats.communitiesCreated,
        communitiesUpdated: stats.communitiesUpdated,
        orgsCreated: stats.orgsCreated,
        orgsUpdated: stats.orgsUpdated,
        jobsEnriched: stats.jobsEnriched,
        scoresUpdated: stats.scoresUpdated,
      },
      errors: stats.errors.length > 0 ? stats.errors.slice(0, 20) : undefined,
    }

    await finishCronRun(runId, allSuccess ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: payload,
      error: allSuccess ? undefined : `${stats.errors.length} errors during sync`,
    })

    return NextResponse.json(payload, { status: allSuccess ? 200 : 207 })
  } catch (error: any) {
    console.error('Brain sync cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error.message, stats },
      { status: 500 }
    )
  }
}

// Also support POST for manual trigger
export async function POST(request: NextRequest) {
  return GET(request)
}
