export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { isElevenLabsConfigured, generateBriefingAudio } from '@/lib/elevenlabs'

/**
 * POST /api/ops/portal/driver/voice-briefing
 *
 * Body: {
 *   stops: Array<{ address?: string; window?: string; builderName?: string }>
 *   staffName?: string
 *   totalMiles?: number
 *   longestDriveMinutes?: number
 *   longestDriveDestination?: string
 * }
 *
 * Returns an MP3 start-of-day briefing. Gracefully falls back to a text
 * script if ElevenLabs isn't configured (503 + script) so the client can
 * still display the prose.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const stops: Array<{ address?: string; window?: string; builderName?: string }> =
      body.stops || []
    const staffName: string = body.staffName || 'driver'
    const totalMiles: number | undefined = body.totalMiles
    const longestDriveMinutes: number | undefined = body.longestDriveMinutes
    const longestDriveDestination: string | undefined = body.longestDriveDestination

    if (!stops.length) {
      return NextResponse.json({ error: 'stops[] required' }, { status: 400 })
    }

    const first = stops[0]
    const firstWindow = first?.window
      ? new Date(first.window).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : null

    const pieces: string[] = []
    pieces.push(`${stops.length} stop${stops.length === 1 ? '' : 's'} today.`)
    if (firstWindow) {
      pieces.push(`First stop is at ${firstWindow}${first.builderName ? ` for ${first.builderName}` : ''}.`)
    } else if (first?.builderName) {
      pieces.push(`First stop is ${first.builderName}.`)
    }
    if (longestDriveMinutes && longestDriveDestination) {
      pieces.push(`Longest drive is to ${longestDriveDestination}, about ${longestDriveMinutes} minutes.`)
    } else if (longestDriveMinutes) {
      pieces.push(`Longest drive is about ${longestDriveMinutes} minutes.`)
    }
    if (totalMiles) {
      pieces.push(`Total miles approximately ${Math.round(totalMiles)}.`)
    }
    pieces.push(`Drive safe.`)

    const briefingText = pieces.join(' ')
    const scriptText = `Good morning ${staffName}. ${briefingText}`

    if (!isElevenLabsConfigured()) {
      return NextResponse.json(
        { ok: false, configured: false, script: scriptText },
        { status: 503 }
      )
    }

    const audio = await generateBriefingAudio({ staffName, briefingText })
    if ('error' in audio) {
      return NextResponse.json({ ok: false, error: audio.error, script: scriptText }, { status: 502 })
    }

    return new Response(audio.audio, {
      status: 200,
      headers: {
        'Content-Type': audio.contentType,
        'Content-Length': audio.byteLength.toString(),
        'Cache-Control': 'private, no-store',
        'X-Briefing-Script': Buffer.from(scriptText).toString('base64'),
      },
    })
  } catch (err: any) {
    console.error('[driver voice-briefing]', err)
    return NextResponse.json({ error: err?.message || 'internal' }, { status: 500 })
  }
}
