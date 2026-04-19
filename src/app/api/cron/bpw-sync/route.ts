/**
 * Cron: BPW Pulte Sync
 *
 * Syncs jobs, communities, and schedules from BPW Pulte
 * - Syncs communities → Community table
 * - Syncs jobs → Job table, matching on address/lot/community
 * - Syncs schedules → updates Job scheduledDate field
 *
 * Each sync type logs to SyncLog
 * Requires CRON_SECRET for auth
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { syncCommunities, syncJobs, syncSchedules } from '@/lib/integrations/bpw'
import { startCronRun, finishCronRun } from '@/lib/cron'

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if BPW Pulte is configured before burning a CronRun entry
  // BPW uses IntegrationConfig with provider 'BPW_PULTE'
  const { prisma } = await import('@/lib/prisma')
  const bpwConfig: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "IntegrationConfig" WHERE name ILIKE '%bpw%' OR name ILIKE '%pulte%' AND status::text = 'CONNECTED' LIMIT 1`
  )
  if (bpwConfig.length === 0) {
    return NextResponse.json({
      success: true,
      skipped: true,
      message: 'BPW Pulte not configured — skipping sync. Add IntegrationConfig for BPW Pulte to enable.',
    })
  }

  const runId = await startCronRun('bpw-sync', 'schedule')
  const results: any[] = []
  const startedAt = Date.now()

  // 1. Sync communities first (needed for job matching)
  try {
    const comResult = await syncCommunities()
    results.push({ type: 'communities', ...comResult })
  } catch (e: any) {
    results.push({ type: 'communities', status: 'FAILED', error: e?.message })
  }

  // 2. Sync jobs
  try {
    const jobResult = await syncJobs()
    results.push({ type: 'jobs', ...jobResult })
  } catch (e: any) {
    results.push({ type: 'jobs', status: 'FAILED', error: e?.message })
  }

  // 3. Sync schedules
  try {
    const schedResult = await syncSchedules()
    results.push({ type: 'schedules', ...schedResult })
  } catch (e: any) {
    results.push({ type: 'schedules', status: 'FAILED', error: e?.message })
  }

  const totalDuration = Date.now() - startedAt
  const hasErrors = results.some(r => r.status === 'FAILED')

  const payload = {
    success: !hasErrors,
    durationMs: totalDuration,
    results,
  }
  await finishCronRun(runId, hasErrors ? 'FAILURE' : 'SUCCESS', totalDuration, {
    result: payload,
    error: hasErrors ? results.filter(r => r.status === 'FAILED').map(r => `${r.type}: ${r.error}`).join('; ') : undefined,
  })
  return NextResponse.json(payload)
}
