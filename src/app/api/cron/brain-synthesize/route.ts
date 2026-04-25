export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun, finishCronRun } from '@/lib/cron'

// GET /api/cron/brain-synthesize — daily knowledge synthesis nudge.
// Fires the Brain's three pipeline stages (ingest → polish → narrate)
// against brain.abellumber.com behind CF Access.
// Coordinator (8400) is hung — call Brain directly. Schedule: 0 6 * * *.
// Auth: Bearer ${CRON_SECRET}.

const BRAIN_BASE_URL = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'

function validateCronAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: NextRequest) {
  if (!validateCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('brain-synthesize', 'schedule')
  const started = Date.now()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-BrainSynthesizeCron/1.0',
  }
  const cfId = process.env.CF_ACCESS_CLIENT_ID
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId
    headers['CF-Access-Client-Secret'] = cfSecret
  }
  const brainApiKey = process.env.BRAIN_API_KEY
  if (brainApiKey) {
    headers['X-API-Key'] = brainApiKey
    headers['Authorization'] = `Bearer ${brainApiKey}` // CF strips X-API-Key
  }

  const stages = ['ingest', 'polish', 'narrate'] as const
  const results: Array<{ stage: string; status: number; ok: boolean }> = []
  try {
    for (const stage of stages) {
      try {
        const res = await fetch(`${BRAIN_BASE_URL}/brain/trigger/${stage}`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(35_000),
          redirect: 'manual',
        })
        results.push({ stage, status: res.status, ok: res.ok })
      } catch (err: any) {
        results.push({ stage, status: 504, ok: false })
      }
    }
    const ok = results.every((r) => r.ok)
    await finishCronRun(runId, ok ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: { stages: results },
      error: ok ? undefined : `One or more Brain trigger stages failed`,
    })
    return NextResponse.json({ success: ok, stages: results }, { status: ok ? 200 : 502 })
  } catch (error: any) {
    console.error('brain-synthesize cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error), stages: results },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
