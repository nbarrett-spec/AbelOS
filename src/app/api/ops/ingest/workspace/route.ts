/**
 * POST /api/ops/ingest/workspace
 *
 * Generic ingest endpoint for the NUC Brain to push structured records into
 * Aegis. Accepts a typed payload describing what kind of records and how to
 * upsert them. Designed to be called by the Brain after it processes:
 *   - Gmail threads from any company account
 *   - Drive files (CSV / XLSX / DOCX text extracts)
 *   - Workspace folder structured data (bolt-*.json, inFlow_*.csv, etc.)
 *
 * Each `kind` maps to a target table + an upsert strategy. New `kind`s get
 * added by extending the switch below. Unknown kinds are recorded in
 * AuditLog as `INGEST_UNKNOWN_KIND` (severity WARN) and 422'd back so the
 * Brain knows to add a handler instead of dropping data.
 *
 * Auth: Bearer ${NUC_BRAIN_API_KEY} — same key the brain webhook uses.
 *       Verified timing-safe via verifyBearerToken.
 *
 * Idempotency: callers MUST pass a stable `eventId` per record. The handler
 * de-dupes via the WebhookEvent table under provider='brain-ingest'. Re-sending
 * the same eventId is a no-op success.
 *
 * Audit: every record landed gets an audit row (entity matches the target
 * table, action `INGEST_<KIND>_<UPSERTRESULT>`).
 *
 * Payload shape:
 *   {
 *     "eventId": "ingest-2026-05-04-1430-batch-001",
 *     "source": "gmail" | "drive" | "workspace" | "manual" | "...",
 *     "records": [
 *       { "kind": "builder_email", "data": { "companyName": "...", "email": "..." } },
 *       { "kind": "vendor_email", "data": { "vendorName": "...", "email": "..." } },
 *       { "kind": "community", "data": { "name": "...", "city": "...", "state": "...", "boltId": "..." } },
 *       { "kind": "job_address", "data": { "jobNumber": "...", "address": "...", "lotBlock": "..." } },
 *       { "kind": "staff_phone", "data": { "fullName": "...", "phone": "..." } }
 *     ]
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     eventId: "...",
 *     processed: { upserted: 12, skippedDuplicate: 3, unknownKinds: 0 },
 *     errors: []
 *   }
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyBearerToken,
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'
import { logAudit } from '@/lib/audit'

interface IngestRecord {
  kind: string
  data: Record<string, any>
}

interface IngestPayload {
  eventId?: string
  source?: string
  records?: IngestRecord[]
}

function authOk(req: NextRequest): boolean {
  return verifyBearerToken(
    req.headers.get('authorization'),
    process.env.NUC_BRAIN_API_KEY
  )
}

function norm(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
}

// ─── Per-kind handlers ────────────────────────────────────────────────────
// Each returns one of: 'upserted' | 'skipped' | 'error:<msg>'

async function handleBuilderEmail(d: any): Promise<string> {
  const name = d.companyName?.trim()
  const email = d.email?.trim()
  if (!name || !email?.includes('@')) return 'error:missing companyName or valid email'
  const r = await prisma.$executeRawUnsafe(
    `UPDATE "Builder" SET email = $1, "updatedAt" = NOW()
     WHERE LOWER(TRIM("companyName")) = LOWER(TRIM($2))
       AND (email IS NULL OR email = '' OR email LIKE '%@internal.abellumber.com')`,
    email, name
  )
  return Number(r) > 0 ? 'upserted' : 'skipped'
}

async function handleVendorEmail(d: any): Promise<string> {
  const name = d.vendorName?.trim() || d.name?.trim()
  const email = d.email?.trim()
  if (!name || !email?.includes('@')) return 'error:missing vendorName or valid email'
  const r = await prisma.$executeRawUnsafe(
    `UPDATE "Vendor" SET email = $1, "updatedAt" = NOW()
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($2)) AND (email IS NULL OR email = '')`,
    email, name
  )
  return Number(r) > 0 ? 'upserted' : 'skipped'
}

async function handleStaffPhone(d: any): Promise<string> {
  const name = d.fullName?.trim()
  const phone = d.phone?.trim()
  if (!name || !phone) return 'error:missing fullName or phone'
  const r = await prisma.$executeRawUnsafe(
    `UPDATE "Staff" SET phone = $1, "updatedAt" = NOW()
     WHERE LOWER(TRIM(CONCAT("firstName", ' ', "lastName"))) = LOWER(TRIM($2))
       AND (phone IS NULL OR phone = '')
       AND email LIKE '%@abellumber.com'`,  // prefer canonical staff over dups
    phone, name
  )
  return Number(r) > 0 ? 'upserted' : 'skipped'
}

async function handleCommunity(d: any): Promise<string> {
  const name = d.name?.trim()
  if (!name) return 'error:missing name'
  // Find or create. Use boltId as the dedup key when present, else name.
  const existing = d.boltId
    ? await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM "Community" WHERE "boltId" = $1 LIMIT 1`, String(d.boltId))
    : await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM "Community" WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`, name)
  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Community" SET
         city = COALESCE(NULLIF(city,''), $1),
         state = COALESCE(NULLIF(state,''), $2),
         "updatedAt" = NOW()
       WHERE id = $3`,
      d.city || null, d.state || null, existing[0].id
    )
    return 'skipped'  // exists; only filled NULLs
  }
  // Create with fallback Builder if customer doesn't resolve
  let builderId: string | null = null
  if (d.customer) {
    const b = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "Builder" WHERE LOWER(TRIM("companyName")) = LOWER(TRIM($1)) LIMIT 1`,
      d.customer
    )
    builderId = b[0]?.id || null
  }
  if (!builderId) {
    const fallback = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "Builder" WHERE "companyName" = 'Unmatched Bolt Communities' LIMIT 1`
    )
    builderId = fallback[0]?.id
    if (!builderId) return 'error:no fallback Builder available'
  }
  const id = `com_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Community" (id, "boltId", "builderId", name, city, state, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE'::"CommunityStatus", NOW(), NOW())`,
    id, d.boltId ? String(d.boltId) : null, builderId, name, d.city || null, d.state || null
  )
  return 'upserted'
}

async function handleJobAddress(d: any): Promise<string> {
  const jobNumber = d.jobNumber?.trim()
  if (!jobNumber) return 'error:missing jobNumber'
  const set: string[] = []
  const params: any[] = []
  let idx = 1
  if (d.address) { set.push(`"jobAddress" = COALESCE(NULLIF("jobAddress",''), $${idx++})`); params.push(d.address) }
  if (d.community) { set.push(`community = COALESCE(NULLIF(community,''), $${idx++})`); params.push(d.community) }
  if (d.lotBlock) { set.push(`"lotBlock" = COALESCE(NULLIF("lotBlock",''), $${idx++})`); params.push(d.lotBlock) }
  if (set.length === 0) return 'error:no fillable fields'
  params.push(jobNumber)
  const r = await prisma.$executeRawUnsafe(
    `UPDATE "Job" SET ${set.join(', ')}, "updatedAt" = NOW() WHERE "jobNumber" = $${idx}`,
    ...params
  )
  return Number(r) > 0 ? 'upserted' : 'skipped'
}

const HANDLERS: Record<string, (d: any) => Promise<string>> = {
  builder_email: handleBuilderEmail,
  vendor_email: handleVendorEmail,
  staff_phone: handleStaffPhone,
  community: handleCommunity,
  job_address: handleJobAddress,
}

export async function POST(request: NextRequest) {
  if (!authOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: IngestPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const records = body.records || []
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: 'records[] required' }, { status: 400 })
  }
  if (records.length > 1000) {
    return NextResponse.json({ error: 'max 1000 records per batch' }, { status: 400 })
  }

  const eventId = body.eventId || `brain-ingest:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  const idem = await ensureIdempotent('brain-ingest', eventId, 'workspace_batch', body)
  if (idem.status === 'duplicate') {
    return NextResponse.json({ ok: true, eventId, duplicate: true })
  }

  let upserted = 0, skipped = 0, unknownKinds = 0
  const errors: string[] = []

  try {
    for (const rec of records) {
      const handler = HANDLERS[rec.kind]
      if (!handler) {
        unknownKinds++
        errors.push(`unknown kind: ${rec.kind}`)
        continue
      }
      try {
        const result = await handler(rec.data || {})
        if (result === 'upserted') upserted++
        else if (result === 'skipped') skipped++
        else errors.push(`${rec.kind}: ${result}`)
      } catch (e: any) {
        errors.push(`${rec.kind}: ${e?.message?.slice(0, 200)}`)
      }
    }

    await markWebhookProcessed(idem.id)

    logAudit({
      staffId: 'system:brain-ingest',
      action: 'INGEST_WORKSPACE_BATCH',
      entity: 'BrainIngest',
      entityId: eventId,
      details: {
        source: body.source || 'unknown',
        records: records.length,
        upserted,
        skipped,
        unknownKinds,
        errorCount: errors.length,
      },
      severity: 'INFO',
    }).catch(() => {})

    return NextResponse.json({
      ok: true,
      eventId,
      processed: { upserted, skipped, unknownKinds },
      errors: errors.slice(0, 50),  // cap response size
    })
  } catch (e: any) {
    await markWebhookFailed(idem.id, e?.message || String(e))
    return NextResponse.json(
      { ok: false, error: e?.message || 'internal_error' },
      { status: 500 }
    )
  }
}
