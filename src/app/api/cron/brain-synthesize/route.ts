export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { startCronRun, finishCronRun } from '@/lib/cron'

// GET /api/cron/brain-synthesize — daily knowledge synthesis nudge.
// POSTs to brain.abellumber.com/brain/knowledge/synthesize behind CF Access.
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

  try {
    const res = await fetch(`${BRAIN_BASE_URL}/brain/knowledge/synthesize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(110_000),
      redirect: 'manual',
    })

    const raw = await res.text()
    let data: any = raw
    try { data = JSON.parse(raw) } catch {}

    const ok = res.ok
    await finishCronRun(runId, ok ? 'SUCCESS' : 'FAILURE', Date.now() - started, {
      result: { status: res.status, body: data },
      error: ok ? undefined : `Brain synthesize returned ${res.status}`,
    })

    return NextResponse.json(
      { success: ok, status: res.status, body: data },
      { status: ok ? 200 : 502 }
    )
  } catch (error: any) {
    console.error('brain-synthesize cron error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error?.message || String(error),
    })
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
