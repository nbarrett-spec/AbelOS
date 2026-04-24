// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/hyphen/ingest
//
// Receives Hyphen portal scrape events from the NUC coordinator. Writes each
// event to HyphenDocument (idempotent via source_id), correlates to a Job/
// Builder, and when the match is low or absent logs an InboxItem for human
// review.
//
// Auth: `Authorization: Bearer ${AEGIS_API_KEY}` — the NUC coordinator must
// send the same shared secret set on the Vercel side.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { correlateToJob } from '@/lib/hyphen/correlate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── Auth helper — shared secret comparison ────────────────────────────
function authorized(req: NextRequest): boolean {
  const expected = process.env.AEGIS_API_KEY || ''
  if (!expected) return false
  const header = req.headers.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  if (!token) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ── Type guards for the STRICT CONTRACT from Agent A ──────────────────
interface IngestPayload {
  source?: string
  source_id?: string
  event_type?: string
  title?: string
  content?: string
  tags?: string[]
  metadata?: {
    po_number?: string | null
    builder_name?: string | null
    subdivision?: string | null
    lot_block?: string | null
    plan_elv_swing?: string | null
    job_address?: string | null
    group_name?: string | null
    phase?: string | null
    doc_category?: string | null
    file?: {
      file_name?: string | null
      file_url?: string | null
      file_local_path?: string | null
      file_sha256?: string | null
      file_size_bytes?: number | null
      content_type?: string | null
    } | null
    schedule?: {
      closing_date?: string | null
      requested_start?: string | null
      requested_end?: string | null
      acknowledged_start?: string | null
      acknowledged_end?: string | null
      actual_start?: string | null
      actual_end?: string | null
      permit_number?: string | null
      is_late?: boolean | null
    } | null
    change_order?: {
      co_number?: string | null
      original_po?: string | null
      reason?: string | null
      net_value_change?: number | null
      builder_status?: string | null
      has_pdf?: boolean | null
    } | null
    extraction_method?: string | null
    scraped_at?: string | null
  }
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: IngestPayload
  try {
    payload = (await req.json()) as IngestPayload
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'invalid JSON' }, { status: 400 })
  }

  if (!payload.source_id || !payload.event_type) {
    return NextResponse.json(
      { error: 'bad_request', message: 'source_id and event_type are required' },
      { status: 400 },
    )
  }

  const m = payload.metadata || {}
  const file = m.file || {}
  const schedule = m.schedule || {}
  const co = m.change_order || {}

  // ── Correlate to Job/Builder ──
  const correlation = await correlateToJob({
    poNumber: m.po_number ?? null,
    builderName: m.builder_name ?? null,
    jobAddress: m.job_address ?? null,
    lotBlock: m.lot_block ?? null,
    subdivision: m.subdivision ?? null,
  })

  const scrapedAt = parseDate(m.scraped_at) || new Date()

  const baseData = {
    sourceId: payload.source_id,
    eventType: payload.event_type,
    jobId: correlation.jobId,
    builderId: correlation.builderId,

    poNumber: m.po_number ?? null,
    builderName: m.builder_name ?? null,
    subdivision: m.subdivision ?? null,
    lotBlock: m.lot_block ?? null,
    planElvSwing: m.plan_elv_swing ?? null,
    jobAddress: m.job_address ?? null,
    groupName: m.group_name ?? null,
    phase: m.phase ?? null,
    docCategory: m.doc_category ?? null,

    fileName: file.file_name ?? null,
    fileUrl: file.file_url ?? null,
    fileSha256: file.file_sha256 ?? null,
    fileSizeBytes: file.file_size_bytes ?? null,
    contentType: file.content_type ?? null,

    closingDate: parseDate(schedule.closing_date),
    requestedStart: parseDate(schedule.requested_start),
    requestedEnd: parseDate(schedule.requested_end),
    acknowledgedStart: parseDate(schedule.acknowledged_start),
    acknowledgedEnd: parseDate(schedule.acknowledged_end),
    actualStart: parseDate(schedule.actual_start),
    actualEnd: parseDate(schedule.actual_end),
    permitNumber: schedule.permit_number ?? null,
    isLate: typeof schedule.is_late === 'boolean' ? schedule.is_late : null,

    coNumber: co.co_number ?? null,
    originalPo: co.original_po ?? null,
    coReason: co.reason ?? null,
    coNetValueChange:
      typeof co.net_value_change === 'number' ? co.net_value_change : null,
    coBuilderStatus: co.builder_status ?? null,

    matchConfidence: correlation.matchConfidence,
    matchMethod: correlation.matchMethod,

    rawPayload: payload as any,
    scrapedAt,
  }

  // ── Upsert (idempotent on sourceId) ──
  const doc = await (prisma as any).hyphenDocument.upsert({
    where: { sourceId: payload.source_id },
    create: baseData,
    update: {
      // preserve createdAt; re-stamp everything else
      eventType: baseData.eventType,
      jobId: baseData.jobId,
      builderId: baseData.builderId,
      poNumber: baseData.poNumber,
      builderName: baseData.builderName,
      subdivision: baseData.subdivision,
      lotBlock: baseData.lotBlock,
      planElvSwing: baseData.planElvSwing,
      jobAddress: baseData.jobAddress,
      groupName: baseData.groupName,
      phase: baseData.phase,
      docCategory: baseData.docCategory,
      fileName: baseData.fileName,
      fileUrl: baseData.fileUrl,
      fileSha256: baseData.fileSha256,
      fileSizeBytes: baseData.fileSizeBytes,
      contentType: baseData.contentType,
      closingDate: baseData.closingDate,
      requestedStart: baseData.requestedStart,
      requestedEnd: baseData.requestedEnd,
      acknowledgedStart: baseData.acknowledgedStart,
      acknowledgedEnd: baseData.acknowledgedEnd,
      actualStart: baseData.actualStart,
      actualEnd: baseData.actualEnd,
      permitNumber: baseData.permitNumber,
      isLate: baseData.isLate,
      coNumber: baseData.coNumber,
      originalPo: baseData.originalPo,
      coReason: baseData.coReason,
      coNetValueChange: baseData.coNetValueChange,
      coBuilderStatus: baseData.coBuilderStatus,
      matchConfidence: baseData.matchConfidence,
      matchMethod: baseData.matchMethod,
      rawPayload: baseData.rawPayload,
      scrapedAt: baseData.scrapedAt,
      updatedAt: new Date(),
    },
  })

  // ── If unmatched/low confidence, drop an InboxItem for review ──
  // Skip if the HIGH-confidence PO correlation worked.
  if (correlation.matchConfidence !== 'HIGH') {
    try {
      // Idempotency: only one InboxItem per sourceId.
      const existing = await prisma.inboxItem.findFirst({
        where: {
          type: 'HYPHEN_DOC_UNMATCHED',
          entityType: 'HyphenDocument',
          entityId: doc.id,
        },
        select: { id: true },
      })
      if (!existing) {
        const title =
          correlation.matchConfidence === 'UNMATCHED'
            ? `Hyphen doc UNMATCHED: ${baseData.fileName || baseData.eventType}`
            : `Hyphen doc ${correlation.matchConfidence} match — review: ${baseData.fileName || baseData.eventType}`

        const description = [
          baseData.builderName ? `Builder: ${baseData.builderName}` : null,
          baseData.poNumber ? `PO: ${baseData.poNumber}` : null,
          baseData.jobAddress ? `Address: ${baseData.jobAddress}` : null,
          baseData.lotBlock ? `Lot: ${baseData.lotBlock}` : null,
          `Category: ${baseData.docCategory || baseData.eventType}`,
          `Method: ${correlation.matchMethod}`,
        ]
          .filter(Boolean)
          .join(' · ')

        await prisma.inboxItem.create({
          data: {
            type: 'HYPHEN_DOC_UNMATCHED',
            source: 'hyphen-ingest',
            title,
            description,
            priority: correlation.matchConfidence === 'UNMATCHED' ? 'HIGH' : 'MEDIUM',
            status: 'PENDING',
            entityType: 'HyphenDocument',
            entityId: doc.id,
            actionData: {
              hyphenDocumentId: doc.id,
              suggestedJobId: correlation.jobId,
              matchConfidence: correlation.matchConfidence,
              matchMethod: correlation.matchMethod,
              builderId: correlation.builderId,
            } as any,
          },
        })
      }
    } catch (err) {
      // Don't fail the ingest on inbox write errors; just log.
      console.warn('[hyphen-ingest] failed to create InboxItem:', err)
    }
  }

  return NextResponse.json({
    status: 'accepted',
    documentId: doc.id,
    jobId: correlation.jobId,
    builderId: correlation.builderId,
    matchConfidence: correlation.matchConfidence,
    matchMethod: correlation.matchMethod,
  })
}
