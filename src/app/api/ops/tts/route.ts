export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import {
  synthesizeSpeech,
  generateOpsAlert,
  generateCollectionCall,
  generateBriefingAudio,
  generateOrderStatusAudio,
  isElevenLabsConfigured,
  listVoices,
  getUsage,
} from '@/lib/elevenlabs'

// ──────────────────────────────────────────────────────────────────────
// GET /api/ops/tts — Check config status, list voices, usage
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const action = request.nextUrl.searchParams.get('action')

  if (!isElevenLabsConfigured()) {
    return NextResponse.json({
      configured: false,
      message: 'Set ELEVENLABS_API_KEY in environment variables',
    })
  }

  if (action === 'voices') {
    const result = await listVoices()
    return NextResponse.json(result)
  }

  if (action === 'usage') {
    const result = await getUsage()
    return NextResponse.json(result)
  }

  return NextResponse.json({ configured: true, actions: ['voices', 'usage'] })
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/ops/tts — Generate audio
// Body: { type, text?, voice?, ...typeSpecificParams }
//
// Types:
//   "raw"        — { text, voice? }
//   "ops-alert"  — { message, driverName? }
//   "collection" — { companyName, invoiceNumber, amount, dueDate, daysOverdue }
//   "briefing"   — { staffName, briefingText }
//   "order-status" — { companyName, orderNumber, statusMessage }
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  if (!isElevenLabsConfigured()) {
    return NextResponse.json(
      { error: 'ElevenLabs not configured — set ELEVENLABS_API_KEY' },
      { status: 503 }
    )
  }

  try {
    const body = await request.json()
    const { type } = body

    audit(request, 'GENERATE_AUDIO', 'TTS', undefined, { type }).catch(() => {})

    let result: { audio: ArrayBuffer; contentType: string; byteLength: number } | { error: string }

    switch (type) {
      case 'raw':
        if (!body.text) return NextResponse.json({ error: 'text required' }, { status: 400 })
        result = await synthesizeSpeech(body.text, { voice: body.voice })
        break

      case 'ops-alert':
        if (!body.message) return NextResponse.json({ error: 'message required' }, { status: 400 })
        result = await generateOpsAlert({ message: body.message, driverName: body.driverName })
        break

      case 'collection':
        if (!body.companyName || !body.invoiceNumber || !body.amount || !body.dueDate || body.daysOverdue == null) {
          return NextResponse.json({ error: 'companyName, invoiceNumber, amount, dueDate, daysOverdue required' }, { status: 400 })
        }
        result = await generateCollectionCall(body)
        break

      case 'briefing':
        if (!body.staffName || !body.briefingText) {
          return NextResponse.json({ error: 'staffName, briefingText required' }, { status: 400 })
        }
        result = await generateBriefingAudio(body)
        break

      case 'order-status':
        if (!body.companyName || !body.orderNumber || !body.statusMessage) {
          return NextResponse.json({ error: 'companyName, orderNumber, statusMessage required' }, { status: 400 })
        }
        result = await generateOrderStatusAudio(body)
        break

      default:
        return NextResponse.json(
          { error: `Invalid type. Use: raw, ops-alert, collection, briefing, order-status` },
          { status: 400 }
        )
    }

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    // Return audio as streaming response
    return new Response(result.audio, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': result.byteLength.toString(),
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="abel-tts-${type}-${Date.now()}.mp3"`,
      },
    })
  } catch (error: any) {
    console.error('[TTS Route] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
