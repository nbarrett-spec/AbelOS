/**
 * ElevenLabs Text-to-Speech Integration for Abel Lumber / Aegis
 *
 * All integrations read ELEVENLABS_API_KEY from env.
 * Set it once in Vercel + once on NUC coordinator, everything works.
 *
 * Usage:
 *   import { synthesizeSpeech, generateBriefingAudio, generateCollectionCall } from '@/lib/elevenlabs'
 *   const audio = await synthesizeSpeech('Your delivery is ready', { voice: 'professional-male' })
 */

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1'

// Pre-selected voices — tune these after testing in the ElevenLabs dashboard
// IDs are from ElevenLabs' voice library; swap with cloned voices later if desired
const VOICES = {
  'professional-male': '29vD33N1CtxCmqQRPOHJ',   // Drew — clear, professional
  'professional-female': 'EXAVITQu4vr4xnSDxMaL', // Sarah — warm, professional
  'notifications': 'onwK4e9ZLuTAKqWW03F9',        // Daniel — neutral, clear
  'briefing': '29vD33N1CtxCmqQRPOHJ',             // Drew — good for long-form
} as const

type VoicePreset = keyof typeof VOICES

interface SpeechOptions {
  voice?: VoicePreset | string  // Preset name or raw ElevenLabs voice ID
  model?: string                // Default: eleven_turbo_v2_5 (fastest, cheapest)
  stability?: number            // 0-1, default 0.5
  similarityBoost?: number      // 0-1, default 0.75
  style?: number                // 0-1, default 0 (lower = more stable)
  outputFormat?: string         // mp3_44100_128 (default), pcm_16000, etc.
}

interface ElevenLabsError {
  detail?: { message?: string; status?: string }
  message?: string
}

function getApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY || null
}

export function isElevenLabsConfigured(): boolean {
  return !!getApiKey()
}

function resolveVoiceId(voice?: VoicePreset | string): string {
  if (!voice) return VOICES['professional-male']
  if (voice in VOICES) return VOICES[voice as VoicePreset]
  return voice // Assume raw voice ID
}

/**
 * Core TTS — returns raw audio Buffer (MP3 by default)
 */
export async function synthesizeSpeech(
  text: string,
  options: SpeechOptions = {}
): Promise<{ audio: ArrayBuffer; contentType: string; byteLength: number } | { error: string }> {
  const apiKey = getApiKey()
  if (!apiKey) return { error: 'ElevenLabs not configured — set ELEVENLABS_API_KEY' }

  if (!text || text.trim().length === 0) return { error: 'Empty text' }

  // Truncate to ElevenLabs limit (5000 chars for turbo)
  const cleanText = text.slice(0, 4900)

  const voiceId = resolveVoiceId(options.voice)
  const model = options.model || 'eleven_turbo_v2_5'
  const outputFormat = options.outputFormat || 'mp3_44100_128'

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: model,
          voice_settings: {
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarityBoost ?? 0.75,
            style: options.style ?? 0,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!response.ok) {
      const errBody: ElevenLabsError = await response.json().catch(() => ({}))
      const msg = errBody.detail?.message || errBody.message || `ElevenLabs API error ${response.status}`
      console.error('[ElevenLabs]', msg)
      return { error: msg }
    }

    const arrayBuffer = await response.arrayBuffer()
    const contentType = outputFormat.startsWith('mp3') ? 'audio/mpeg' : 'audio/wav'

    return { audio: arrayBuffer, contentType, byteLength: arrayBuffer.byteLength }
  } catch (err: any) {
    console.error('[ElevenLabs] Request failed:', err.message)
    return { error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════════
// HIGH-LEVEL GENERATORS — domain-specific audio for Abel Lumber
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate delivery/production alert audio
 * Short, clear, designed for warehouse speakers or driver devices
 */
export async function generateOpsAlert(params: {
  driverName?: string
  message: string
}) {
  const text = params.driverName
    ? `${params.driverName}. ${params.message}`
    : params.message
  return synthesizeSpeech(text, { voice: 'notifications', stability: 0.7 })
}

/**
 * Generate collections voice message for overdue invoice
 * Professional, firm but polite tone
 */
export async function generateCollectionCall(params: {
  companyName: string
  invoiceNumber: string
  amount: number
  dueDate: string
  daysOverdue: number
}) {
  const { companyName, invoiceNumber, amount, dueDate, daysOverdue } = params
  const amountStr = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  let tone = ''
  if (daysOverdue > 60) {
    tone = `This is an urgent message regarding a significantly past-due balance. `
  } else if (daysOverdue > 30) {
    tone = `This is a follow-up regarding an outstanding balance. `
  }

  const text = `${tone}Hello, this is Abel Lumber calling for ${companyName} regarding invoice ${invoiceNumber}. `
    + `The balance of ${amountStr} was due on ${dueDate} and is currently ${daysOverdue} days past due. `
    + `Please contact our accounting team at your earliest convenience to arrange payment. `
    + `You can reach us at 940-440-3583 or pay online at app.abellumber.com. Thank you.`

  return synthesizeSpeech(text, { voice: 'professional-female', stability: 0.65 })
}

/**
 * Generate daily briefing audio from text summary
 * Longer-form, conversational pacing
 */
export async function generateBriefingAudio(params: {
  staffName: string
  briefingText: string
}) {
  const text = `Good morning ${params.staffName}. Here's your briefing for today. ${params.briefingText}`
  return synthesizeSpeech(text, { voice: 'briefing', stability: 0.5, style: 0.15 })
}

/**
 * Generate builder-facing order status update audio
 * Warm, customer-service tone
 */
export async function generateOrderStatusAudio(params: {
  companyName: string
  orderNumber: string
  statusMessage: string
}) {
  const text = `Hi ${params.companyName}, this is an update on your Abel Lumber order ${params.orderNumber}. `
    + params.statusMessage
  return synthesizeSpeech(text, { voice: 'professional-female', stability: 0.55 })
}

/**
 * List available voices from ElevenLabs account (for admin config)
 */
export async function listVoices(): Promise<{ voices: any[] } | { error: string }> {
  const apiKey = getApiKey()
  if (!apiKey) return { error: 'ElevenLabs not configured' }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: { 'xi-api-key': apiKey },
    })
    if (!response.ok) return { error: `Failed to list voices: ${response.status}` }
    const data = await response.json()
    return { voices: data.voices || [] }
  } catch (err: any) {
    return { error: err.message }
  }
}

/**
 * Get account usage/subscription info
 */
export async function getUsage(): Promise<any> {
  const apiKey = getApiKey()
  if (!apiKey) return { error: 'ElevenLabs not configured' }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/user/subscription`, {
      headers: { 'xi-api-key': apiKey },
    })
    if (!response.ok) return { error: `Failed to get usage: ${response.status}` }
    return response.json()
  } catch (err: any) {
    return { error: err.message }
  }
}
