export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { getRedis } from '@/lib/redis'
import { hasPermission, parseRoles } from '@/lib/permissions'
import {
  EXTRACTION_SYSTEM_PROMPT,
  parseExtractionResponse,
  rowToTakeoffItem,
  EXTRACTION_RATE_LIMIT_PER_HOUR,
  ESTIMATED_EXTRACTION_COST_USD,
  type TakeoffExtractionResult,
} from '@/lib/takeoff-tool'
import crypto from 'crypto'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-5'

/**
 * POST /api/ops/takeoffs/[id]/extract
 *
 * Runs Claude Vision on the takeoff's blueprint PDF and stores the structured
 * result in Takeoff.aiExtractionResult + creates TakeoffItem rows.
 *
 * Graceful fallbacks:
 *   - ANTHROPIC_API_KEY missing → { error: 'AI not configured', manualFallback: true }
 *   - rate limit exceeded       → 429 with remaining seconds
 *   - same SHA already extracted → returns cached result (no extra API call)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const roles = parseRoles(
    request.headers.get('x-staff-roles') || request.headers.get('x-staff-role'),
  )
  if (!hasPermission(roles, 'takeoff:ai_extract')) {
    return NextResponse.json(
      { error: 'Forbidden — missing takeoff:ai_extract' },
      { status: 403 },
    )
  }

  const staffId = request.headers.get('x-staff-id') || 'anon'

  // ── Fetch takeoff + blueprint ───────────────────────────────────────
  const rows = await prisma.$queryRawUnsafe<
    {
      takeoffId: string
      blueprintId: string
      fileBase64: string | null
      fileSha256: string | null
      fileType: string
      aiExtractionResult: unknown
    }[]
  >(
    `SELECT t."id" AS "takeoffId", b."id" AS "blueprintId",
            b."fileBase64" AS "fileBase64", b."fileSha256" AS "fileSha256",
            b."fileType" AS "fileType", t."aiExtractionResult"
     FROM "Takeoff" t
     JOIN "Blueprint" b ON b."id" = t."blueprintId"
     WHERE t."id" = $1
     LIMIT 1`,
    params.id,
  )

  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: 'Takeoff not found' }, { status: 404 })
  }

  const row = rows[0]
  if (!row.fileBase64) {
    return NextResponse.json(
      {
        error: 'Blueprint has no inline file — re-upload via the takeoff tool',
        manualFallback: true,
      },
      { status: 400 },
    )
  }

  // ── Fallback: no AI key configured ──────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI not configured', manualFallback: true },
      { status: 503 },
    )
  }

  // ── Cache hit: same SHA already extracted (on this or any takeoff) ──
  if (row.fileSha256) {
    const cached = await prisma.$queryRawUnsafe<
      { aiExtractionResult: unknown; aiExtractionModel: string | null }[]
    >(
      `SELECT "aiExtractionResult", "aiExtractionModel"
       FROM "Takeoff"
       WHERE "blueprintId" IN (SELECT "id" FROM "Blueprint" WHERE "fileSha256" = $1)
         AND "aiExtractionResult" IS NOT NULL
       LIMIT 1`,
      row.fileSha256,
    )
    if (cached.length > 0 && cached[0].aiExtractionResult) {
      const extraction = cached[0].aiExtractionResult as TakeoffExtractionResult
      await persistExtractionToTakeoff(params.id, extraction, cached[0].aiExtractionModel || MODEL, 0)
      await audit(request, 'UPDATE', 'Takeoff', params.id, {
        action: 'ai_extract_cached',
        sha256: row.fileSha256.slice(0, 16),
      })
      return NextResponse.json({
        cached: true,
        extraction,
        itemsCreated: extraction.items?.length || 0,
      })
    }
  }

  // ── Rate limit: 20/hr per staff ─────────────────────────────────────
  const redis = getRedis()
  if (redis) {
    const key = `takeoff-extract:${staffId}:${Math.floor(Date.now() / 3600_000)}`
    try {
      const next = await redis.incr(key)
      if (next === 1) await redis.expire(key, 3600)
      if (next > EXTRACTION_RATE_LIMIT_PER_HOUR) {
        const resetIn = 3600 - (Math.floor(Date.now() / 1000) % 3600)
        return NextResponse.json(
          {
            error: `Rate limit: ${EXTRACTION_RATE_LIMIT_PER_HOUR} extractions/hour`,
            resetInSeconds: resetIn,
          },
          { status: 429 },
        )
      }
    } catch {
      // Redis unavailable → allow the request through (fail-open during scaffold)
    }
  }

  // ── Call Claude Vision ──────────────────────────────────────────────
  const mediaType = row.fileType === 'pdf' ? 'application/pdf' : mimeForImage(row.fileType)
  const isPdf = mediaType === 'application/pdf'

  const imageBlock = isPdf
    ? {
        type: 'document',
        source: { type: 'base64', media_type: mediaType, data: row.fileBase64 },
      }
    : {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: row.fileBase64 },
      }

  const started = Date.now()
  let apiResp: Response
  try {
    apiResp = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [imageBlock, { type: 'text', text: EXTRACTION_SYSTEM_PROMPT }],
          },
        ],
      }),
    })
  } catch (e: any) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Takeoff" SET "aiExtractionError" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      `network: ${e?.message || e}`,
      params.id,
    )
    return NextResponse.json(
      { error: 'AI request failed', detail: e?.message || String(e) },
      { status: 502 },
    )
  }

  const durationMs = Date.now() - started

  if (!apiResp.ok) {
    const body = await apiResp.text()
    await prisma.$executeRawUnsafe(
      `UPDATE "Takeoff" SET "aiExtractionError" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      `api_${apiResp.status}: ${body.slice(0, 300)}`,
      params.id,
    )
    return NextResponse.json(
      { error: `Claude API ${apiResp.status}`, detail: body.slice(0, 500) },
      { status: 502 },
    )
  }

  const apiJson = (await apiResp.json()) as {
    content?: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
    model?: string
  }
  const text =
    apiJson.content?.find((c) => c.type === 'text')?.text ||
    apiJson.content?.map((c) => c.text).filter(Boolean).join('\n') ||
    ''

  const parsed = parseExtractionResponse(text)
  if ('error' in parsed) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Takeoff" SET "aiExtractionError" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      `${parsed.error}: ${parsed.reason}`,
      params.id,
    )
    return NextResponse.json(
      { error: parsed.error, reason: parsed.reason, manualFallback: true },
      { status: 422 },
    )
  }

  // ── Cost estimate → record to AIInvocation ──────────────────────────
  const usage = apiJson.usage || {}
  const inputTok = usage.input_tokens || 0
  const outputTok = usage.output_tokens || 0
  const costEstimate =
    (inputTok / 1_000_000) * 3.0 + (outputTok / 1_000_000) * 15.0
  const invocationId = 'aii' + crypto.randomBytes(4).toString('hex')
  await ensureAIInvocationTable()
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AIInvocation"
         ("id","endpoint","inputHash","model","promptTokens","completionTokens",
          "cacheReadTokens","cacheWriteTokens","costEstimate","durationMs","staffId","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,0,0,$7,$8,$9,NOW())`,
      invocationId,
      '/api/ops/takeoffs/[id]/extract',
      (row.fileSha256 || params.id).slice(0, 24),
      apiJson.model || MODEL,
      inputTok,
      outputTok,
      costEstimate,
      durationMs,
      staffId,
    )
  } catch (e: any) {
    console.warn('[takeoff-extract] AIInvocation log failed', e?.message)
  }

  await persistExtractionToTakeoff(
    params.id,
    parsed,
    apiJson.model || MODEL,
    costEstimate,
  )
  await audit(request, 'UPDATE', 'Takeoff', params.id, {
    action: 'ai_extract',
    items: parsed.items.length,
    cost: costEstimate.toFixed(4),
  })

  return NextResponse.json({
    cached: false,
    extraction: parsed,
    itemsCreated: parsed.items.length,
    costEstimate,
    durationMs,
    estimatedCostAdvice: ESTIMATED_EXTRACTION_COST_USD,
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────

function mimeForImage(t: string): string {
  if (t === 'png') return 'image/png'
  if (t === 'webp') return 'image/webp'
  return 'image/jpeg'
}

/**
 * Store extraction JSON on the takeoff AND rebuild TakeoffItem rows from it.
 * Existing items are cleared so re-running extract gives a clean slate.
 */
async function persistExtractionToTakeoff(
  takeoffId: string,
  extraction: TakeoffExtractionResult,
  model: string,
  costEstimate: number,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "Takeoff"
       SET "aiExtractionResult" = $1::jsonb,
           "aiExtractionAt"     = NOW(),
           "aiExtractionModel"  = $2,
           "aiExtractionCost"   = $3,
           "aiExtractionError"  = NULL,
           "confidence"         = $4,
           "status"             = 'NEEDS_REVIEW',
           "rawResult"          = $1::jsonb,
           "updatedAt"          = NOW()
     WHERE "id" = $5`,
    JSON.stringify(extraction),
    model,
    costEstimate,
    extraction.confidence ?? null,
    takeoffId,
  )

  // Clear any pre-existing items (re-extraction path)
  await prisma.$executeRawUnsafe(
    `DELETE FROM "TakeoffItem" WHERE "takeoffId" = $1`,
    takeoffId,
  )

  for (const raw of extraction.items) {
    const mapped = rowToTakeoffItem(raw)
    const id = 'tki_' + crypto.randomBytes(6).toString('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TakeoffItem"
         ("id","takeoffId","category","description","location","quantity",
          "itemType","widthInches","heightInches","linearFeet","hardware","notes",
          "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      id,
      takeoffId,
      mapped.category,
      mapped.description,
      mapped.location,
      mapped.quantity,
      mapped.itemType,
      mapped.widthInches,
      mapped.heightInches,
      mapped.linearFeet,
      mapped.hardware,
      mapped.notes,
    )
  }
}

let _aiInvocationReady = false
async function ensureAIInvocationTable() {
  if (_aiInvocationReady) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AIInvocation" (
        "id" TEXT PRIMARY KEY,
        "endpoint" TEXT NOT NULL,
        "inputHash" TEXT NOT NULL,
        "model" TEXT,
        "promptTokens" INTEGER NOT NULL DEFAULT 0,
        "completionTokens" INTEGER NOT NULL DEFAULT 0,
        "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
        "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
        "costEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "durationMs" INTEGER NOT NULL DEFAULT 0,
        "staffId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    _aiInvocationReady = true
  } catch {
    _aiInvocationReady = true
  }
}
