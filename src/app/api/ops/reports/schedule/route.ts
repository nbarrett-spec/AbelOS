export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'

// POST /api/ops/reports/schedule
//
// Body: {
//   templateId: string                     // 'ar-aging', 'revenue-by-builder', ...
//   cadence: 'daily' | 'weekly' | 'monthly'
//   recipients: string[]                   // email addresses
//   params?: { from?, to?, builderId?, ... }
//   name?: string                          // optional label
//   enabled?: boolean                      // default true
// }
//
// Behaviour: validates and persists the schedule. A dedicated
// ScheduledReport model does not yet exist in Prisma, so for now we log the
// schedule to the audit/logger stream and return a synthetic id. Once the
// model ships, this handler should switch to `prisma.scheduledReport.create`.
//
// GET /api/ops/reports/schedule
//   Returns the known template IDs + cadence options so the UI can render
//   picker state without hard-coding values.
export async function GET(request: NextRequest) {
  const authErr = checkStaffAuth(request)
  if (authErr) return authErr

  return NextResponse.json({
    templates: [
      { id: 'ar-aging', label: 'AR Aging' },
      { id: 'revenue-by-builder', label: 'Revenue by Builder' },
      { id: 'po-by-vendor', label: 'PO by Vendor' },
      { id: 'deliveries-by-driver', label: 'Deliveries by Driver' },
      { id: 'profit-by-family', label: 'Profitability by Product Family' },
    ],
    cadences: ['daily', 'weekly', 'monthly'],
  })
}

const VALID_TEMPLATES = new Set([
  'ar-aging',
  'revenue-by-builder',
  'po-by-vendor',
  'deliveries-by-driver',
  'profit-by-family',
])
const VALID_CADENCES = new Set(['daily', 'weekly', 'monthly'])
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  const authErr = checkStaffAuth(request)
  if (authErr) return authErr

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const templateId = String(body.templateId || '').toLowerCase()
  const cadence = String(body.cadence || '').toLowerCase()
  const recipients: string[] = Array.isArray(body.recipients) ? body.recipients : []
  const params = body.params || {}
  const name = body.name ? String(body.name).slice(0, 200) : undefined
  const enabled = body.enabled !== false

  if (!VALID_TEMPLATES.has(templateId)) {
    return NextResponse.json(
      { error: `Invalid templateId. Must be one of: ${Array.from(VALID_TEMPLATES).join(', ')}` },
      { status: 400 },
    )
  }
  if (!VALID_CADENCES.has(cadence)) {
    return NextResponse.json(
      { error: `Invalid cadence. Must be one of: ${Array.from(VALID_CADENCES).join(', ')}` },
      { status: 400 },
    )
  }
  if (!recipients.length) {
    return NextResponse.json({ error: 'At least one recipient required' }, { status: 400 })
  }
  const badRecipients = recipients.filter((r) => typeof r !== 'string' || !EMAIL_RX.test(r))
  if (badRecipients.length) {
    return NextResponse.json(
      { error: 'Invalid recipient email(s)', detail: badRecipients },
      { status: 400 },
    )
  }

  const staffId = request.headers.get('x-staff-id') || undefined
  const id = `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const scheduled = {
    id,
    templateId,
    cadence,
    recipients,
    params,
    name: name ?? `${templateId} (${cadence})`,
    enabled,
    createdAt: new Date().toISOString(),
    createdBy: staffId,
  }

  // Persist via logger for now — audit trail + easy swap to DB later.
  logger.info('report_schedule_created', {
    ...scheduled,
    note: 'ScheduledReport model not yet in schema; stored as log entry',
  })

  return NextResponse.json({ ok: true, schedule: scheduled })
}
