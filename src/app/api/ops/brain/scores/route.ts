/**
 * Brain → Aegis: Entity Scores Receiver
 *
 * POST: Receives entity scores from the NUC Brain FeedAgent every 10 min.
 *       Stores latest scores in AgentConfig (brain_scores key) and optionally
 *       creates InboxItem alerts for entities that dropped below C.
 *
 * Auth: Bearer token matching NUC_BRAIN_API_KEY env var
 *       (set this to the same value as AEGIS_API_KEY on the NUC)
 *
 * GET:  Returns current brain scores (for Aegis dashboard consumption)
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Auth: service-to-service bearer token (NUC → Aegis)
// ---------------------------------------------------------------------------
function validateBrainAuth(request: NextRequest): boolean {
  const key = process.env.NUC_BRAIN_API_KEY
  if (!key) return false
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${key}`
}

// ---------------------------------------------------------------------------
// GET: Return latest brain scores for dashboard
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    // Scores are stored in AgentConfig as a JSON blob
    const config = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "configValue", "updatedAt"
       FROM "AgentConfig"
       WHERE "agentRole" = 'brain' AND "configKey" = 'entity_scores'
       LIMIT 1`
    )

    if (!config.length) {
      return NextResponse.json({ scores: [], lastUpdated: null })
    }

    const scores = typeof config[0].configValue === 'string'
      ? JSON.parse(config[0].configValue)
      : config[0].configValue

    return NextResponse.json({
      scores,
      lastUpdated: config[0].updatedAt,
    })
  } catch (error: any) {
    logger.error('brain_scores_get_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch brain scores' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST: Receive scores from NUC Brain FeedAgent
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  if (!validateBrainAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { brain_id, timestamp, entity_scores } = body

    if (!entity_scores || !Array.isArray(entity_scores)) {
      return NextResponse.json(
        { error: 'Missing or invalid entity_scores array' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // 1. Upsert scores into AgentConfig (latest snapshot)
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "AgentConfig"
       WHERE "agentRole" = 'brain' AND "configKey" = 'entity_scores'
       LIMIT 1`
    )

    const scoresJson = JSON.stringify(entity_scores)

    if (existing.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AgentConfig"
         SET "configValue" = $1::jsonb, "updatedAt" = $2, "updatedBy" = 'brain-feed'
         WHERE id = $3`,
        scoresJson, now, existing[0].id
      )
    } else {
      const id = `acfg_brain_scores_${Date.now()}`
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentConfig" (id, "agentRole", "configKey", "configValue", description, "updatedBy", "createdAt", "updatedAt")
         VALUES ($1, 'brain', 'entity_scores', $2::jsonb, 'Latest entity scores from NUC Brain', 'brain-feed', $3, $3)`,
        id, scoresJson, now
      )
    }

    // 2. Also store score history (one row per push, for trend tracking)
    const historyId = `acfg_brain_sh_${Date.now()}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AgentConfig" (id, "agentRole", "configKey", "configValue", description, "updatedBy", "createdAt", "updatedAt")
       VALUES ($1, 'brain', $2, $3::jsonb, 'Score snapshot', 'brain-feed', $4, $4)`,
      historyId,
      `score_history_${new Date().toISOString().slice(0, 10)}`,
      scoresJson,
      now
    )

    // 3. Create InboxItem alerts for entities scoring D or F
    let alertsCreated = 0
    for (const score of entity_scores) {
      if (score.score === 'D' || score.score === 'F' || score.score === 'D+' || score.score === 'D-' || score.score === 'F') {
        // Check for existing pending alert for this entity
        const dup = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM "InboxItem"
           WHERE type = 'BRAIN_SCORE_ALERT' AND "entityId" = $1 AND status = 'PENDING'
           LIMIT 1`,
          score.entity_id
        )

        if (dup.length === 0) {
          const alertId = `inb_brain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InboxItem" (id, type, source, title, description, priority, "entityType", "entityId", "actionData", status, "createdAt", "updatedAt")
             VALUES ($1, 'BRAIN_SCORE_ALERT', 'nuc-brain', $2, $3, $4, $5, $6, $7, 'PENDING', $8, $8)`,
            alertId,
            `${score.name}: Score dropped to ${score.score}`,
            `Entity "${score.name}" (${score.type}) scored ${score.score} with ${Math.round((score.confidence || 0) * 100)}% confidence. Health: ${score.health}. Review in Brain command center.`,
            score.score === 'F' ? 'CRITICAL' : 'HIGH',
            score.type || 'BrainEntity',
            score.entity_id,
            JSON.stringify(score),
            now
          )
          alertsCreated++
        }
      }
    }

    logger.info('brain_scores_received', {
      brainId: brain_id,
      scoreCount: entity_scores.length,
      alertsCreated,
    })

    return NextResponse.json({
      received: entity_scores.length,
      alertsCreated,
      timestamp: now,
    })
  } catch (error: any) {
    logger.error('brain_scores_post_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to process brain scores' },
      { status: 500 }
    )
  }
}
