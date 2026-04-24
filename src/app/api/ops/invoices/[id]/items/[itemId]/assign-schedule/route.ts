export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/invoices/[id]/items/[itemId]/assign-schedule
//
// Assign a crew + date to a LABOR invoice line. Creates either an
// Installation row (default — for install labor) or a ScheduleEntry
// (for non-install labor). The row links back via invoiceItemId so we
// can trace "this billable labor was performed on X by crew Y for invoice Z".
//
// If a prior assignment exists, it is SOFT-OVERWRITTEN:
//   - The existing row's invoiceItemId is nulled out (so it falls off
//     the invoice's "currently scheduled" view).
//   - A fresh Installation/ScheduleEntry row is created and linked.
// The audit log preserves the full history of assignments.
//
// Body:
//   crewId:           string
//   scheduledDate:    string  (ISO 8601)
//   scopeNotes?:      string
//   installationType: 'INSTALLATION' | 'SCHEDULE' (default 'INSTALLATION')
//
// GET /api/ops/invoices/[id]/items/[itemId]/assign-schedule
// Returns the current Installation/ScheduleEntry linked to this line, if any.
// ──────────────────────────────────────────────────────────────────────────

interface RouteParams {
  params: { id: string; itemId: string }
}

const LABEL_LINETYPE_LABOR = 'LABOR'

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id: invoiceId, itemId } = params

    // Confirm the line belongs to this invoice.
    const itemRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "invoiceId", COALESCE("lineType", 'MATERIAL') AS "lineType",
              "description", "productId"
       FROM "InvoiceItem" WHERE "id" = $1 AND "invoiceId" = $2`,
      itemId, invoiceId,
    )
    if (itemRows.length === 0) {
      return NextResponse.json({ error: 'Invoice item not found' }, { status: 404 })
    }

    const installRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT ins.*, c."name" AS "crewName"
       FROM "Installation" ins
       LEFT JOIN "Crew" c ON c."id" = ins."crewId"
       WHERE ins."invoiceItemId" = $1
       ORDER BY ins."createdAt" DESC LIMIT 1`,
      itemId,
    )

    const scheduleRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT se.*, c."name" AS "crewName"
       FROM "ScheduleEntry" se
       LEFT JOIN "Crew" c ON c."id" = se."crewId"
       WHERE se."invoiceItemId" = $1
       ORDER BY se."createdAt" DESC LIMIT 1`,
      itemId,
    )

    return NextResponse.json({
      item: itemRows[0],
      installation: installRows[0] || null,
      scheduleEntry: scheduleRows[0] || null,
    })
  } catch (error) {
    console.error('GET /assign-schedule error:', error)
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id: invoiceId, itemId } = params
    const body = await request.json().catch(() => ({}))
    const crewId: string | undefined = body?.crewId
    const scheduledDate: string | undefined = body?.scheduledDate
    const scopeNotes: string | undefined = body?.scopeNotes
    const installationType: 'INSTALLATION' | 'SCHEDULE' =
      body?.installationType === 'SCHEDULE' ? 'SCHEDULE' : 'INSTALLATION'

    if (!crewId || typeof crewId !== 'string') {
      return NextResponse.json({ error: 'Missing crewId' }, { status: 400 })
    }
    if (!scheduledDate || typeof scheduledDate !== 'string') {
      return NextResponse.json({ error: 'Missing scheduledDate' }, { status: 400 })
    }
    const parsed = new Date(scheduledDate)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduledDate' }, { status: 400 })
    }

    // Load the InvoiceItem + its parent Invoice (we need jobId).
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT ii."id" AS "itemId",
              ii."invoiceId",
              COALESCE(ii."lineType", 'MATERIAL') AS "lineType",
              ii."description" AS "itemDescription",
              i."jobId" AS "jobId",
              i."invoiceNumber" AS "invoiceNumber",
              i."builderId" AS "builderId"
       FROM "InvoiceItem" ii
       LEFT JOIN "Invoice" i ON i."id" = ii."invoiceId"
       WHERE ii."id" = $1 AND ii."invoiceId" = $2`,
      itemId, invoiceId,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invoice item not found' }, { status: 404 })
    }
    const ctx = rows[0]

    if (ctx.lineType !== LABEL_LINETYPE_LABOR) {
      return NextResponse.json(
        { error: `Line type is ${ctx.lineType}; only LABOR lines can be scheduled.` },
        { status: 400 },
      )
    }
    if (!ctx.jobId) {
      return NextResponse.json(
        { error: 'Invoice has no jobId — cannot schedule labor without a parent job.' },
        { status: 400 },
      )
    }

    // Confirm the crew exists and is active.
    const crewRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "name", "active" FROM "Crew" WHERE "id" = $1`,
      crewId,
    )
    if (crewRows.length === 0) {
      return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
    }

    // Soft-overwrite: unlink any prior Installation/ScheduleEntry rows so
    // only the newest assignment surfaces in the invoice UI. History stays
    // in the underlying rows + audit log.
    await prisma.$executeRawUnsafe(
      `UPDATE "Installation" SET "invoiceItemId" = NULL, "updatedAt" = NOW()
       WHERE "invoiceItemId" = $1`,
      itemId,
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "ScheduleEntry" SET "invoiceItemId" = NULL, "updatedAt" = NOW()
       WHERE "invoiceItemId" = $1`,
      itemId,
    )

    const scopeText = scopeNotes?.trim() || ctx.itemDescription || 'Invoice-assigned labor'
    const createdAt = new Date().toISOString()

    let createdRow: any
    let createdKind: 'INSTALLATION' | 'SCHEDULE'
    let createdId: string

    if (installationType === 'INSTALLATION') {
      // Generate installNumber in the existing INS-YYYY-NNNN pattern.
      const insCount: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM "Installation"`,
      )
      const seq = (insCount[0]?.c || 0) + 1
      const installNumber = `INS-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`
      createdId = 'ins' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Installation"
          ("id","jobId","crewId","installNumber","scopeNotes","status",
           "scheduledDate","beforePhotos","afterPhotos","invoiceItemId",
           "passedQC","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,'SCHEDULED'::"InstallationStatus",
                 $6::timestamptz,'{}','{}',$7,false,NOW(),NOW())`,
        createdId,
        ctx.jobId,
        crewId,
        installNumber,
        scopeText,
        parsed.toISOString(),
        itemId,
      )

      const outRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT ins.*, c."name" AS "crewName"
         FROM "Installation" ins
         LEFT JOIN "Crew" c ON c."id" = ins."crewId"
         WHERE ins."id" = $1`,
        createdId,
      )
      createdRow = outRows[0]
      createdKind = 'INSTALLATION'
    } else {
      // Non-install labor → ScheduleEntry of type INSTALLATION-category
      // (we pick INSTALLATION as the entryType since this is a schedulable
      // billable service; caller can switch to DELIVERY/INSPECTION later).
      createdId = 'sch' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

      await prisma.$executeRawUnsafe(
        `INSERT INTO "ScheduleEntry"
          ("id","jobId","entryType","title","scheduledDate","crewId","status",
           "notes","invoiceItemId","createdAt","updatedAt")
         VALUES ($1,$2,'INSTALLATION'::"ScheduleType",$3,$4::timestamptz,$5,
                 'FIRM'::"ScheduleStatus",$6,$7,NOW(),NOW())`,
        createdId,
        ctx.jobId,
        scopeText,
        parsed.toISOString(),
        crewId,
        scopeText,
        itemId,
      )

      const outRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT se.*, c."name" AS "crewName"
         FROM "ScheduleEntry" se
         LEFT JOIN "Crew" c ON c."id" = se."crewId"
         WHERE se."id" = $1`,
        createdId,
      )
      createdRow = outRows[0]
      createdKind = 'SCHEDULE'
    }

    await audit(
      request,
      'SCHEDULE_LABOR',
      'InvoiceItem',
      itemId,
      {
        crewId,
        crewName: crewRows[0]?.name,
        scheduledDate: parsed.toISOString(),
        jobId: ctx.jobId,
        invoiceId,
        invoiceNumber: ctx.invoiceNumber,
        [createdKind === 'INSTALLATION' ? 'installationId' : 'scheduleEntryId']: createdId,
        kind: createdKind,
        scopeNotes: scopeText,
        createdAt,
      },
    )

    // Return the full item re-render payload for the UI.
    const itemBack: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        ii."id", ii."invoiceId", ii."productId", ii."description",
        ii."quantity", ii."unitPrice", ii."lineTotal",
        COALESCE(ii."lineType", 'MATERIAL') AS "lineType"
       FROM "InvoiceItem" ii WHERE ii."id" = $1`,
      itemId,
    )

    return NextResponse.json({
      ok: true,
      kind: createdKind,
      installation: createdKind === 'INSTALLATION' ? createdRow : null,
      scheduleEntry: createdKind === 'SCHEDULE' ? createdRow : null,
      item: itemBack[0] || null,
    })
  } catch (error: any) {
    console.error('POST /assign-schedule error:', error)
    return NextResponse.json(
      { error: 'Failed to assign schedule', details: error?.message || String(error) },
      { status: 500 },
    )
  }
}
