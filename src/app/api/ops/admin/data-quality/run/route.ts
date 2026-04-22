/**
 * POST /api/ops/admin/data-quality/run
 *
 * Server-side proxy that triggers the data-quality cron.
 * Called by the admin Data Quality page's "Run Now" button.
 * Keeps CRON_SECRET server-side — never exposed to the browser.
 */

import { NextRequest, NextResponse } from 'next/server'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  // TODO: add session/role check to verify the caller is an admin
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  try {
    const res = await fetch(`${baseUrl}/api/cron/data-quality`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cronSecret}` },
    })

    const data = await res.json().catch(() => ({}))
    await audit(request, 'TRIGGER', 'DataQualityCheck', 'system', { status: res.status })
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to trigger data-quality cron' }, { status: 500 })
  }
}
