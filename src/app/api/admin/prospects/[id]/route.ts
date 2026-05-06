// /api/admin/prospects/[id]
//
// GET   — full detail for a single Prospect:
//         - prospect row (incl. enrichment metadata)
//         - pitchContext (1:1) — sales positioning data
//         - pitchRuns (n) — recent pitch generations
//         - auditHistory — last 20 AuditLog rows for this Prospect
//
// PATCH — sales staff edits sales-positioning + manual contact overrides:
//         body shape:
//           {
//             pitchContext?: {
//               targetPlans?: any[]  // JSON
//               currentVendor?: string | null
//               estBuildVolume?: number | null
//               dealStage?: string | null
//               positioningNotes?: string | null
//             },
//             contactOverride?: {
//               email?: string | null
//               phone?: string | null
//               founderName?: string | null
//             }
//           }
//
//         - Upserts PitchContext via raw SQL (model not in generated client)
//         - Patches Prospect's overridable fields (email, phone, founderName)
//         - Clears bouncedAt when email changes (allows re-research)
//         - Audits each section that changed
//
// Auth: SALES_REP+ (ADMIN allowed automatically).

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { getAuditLogs } from '@/lib/audit'

interface ProspectRow {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  source: string | null
  licenseNumber: string | null
  estimatedAnnualVolume: string | number | null
  status: string
  assignedTo: string | null
  notes: string | null
  domain: string | null
  founderName: string | null
  emailPattern: string | null
  enrichmentRunAt: Date | null
  enrichmentConfidence: string | null
  enrichmentSourceUrls: string[] | null
  bouncedAt: Date | null
  icpTier: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

interface PitchContextRow {
  id: string
  prospectId: string
  targetPlans: any
  currentVendor: string | null
  estBuildVolume: number | null
  dealStage: string | null
  positioningNotes: string | null
  lastTouchedAt: Date | null
  lastTouchedBy: string | null
  createdAt: Date
  updatedAt: Date
}

interface PitchRunRow {
  id: string
  style: string
  layout: string
  elements: string[]
  status: string
  previewUrl: string | null
  emailDraft: string | null
  errorMessage: string | null
  costEstimate: string | number | null
  generatedBy: string | null
  approvedBy: string | null
  approvedAt: Date | null
  sentAt: Date | null
  createdAt: Date
}

const VALID_DEAL_STAGES = [
  'COLD',
  'INTRO_SENT',
  'IN_DISCUSSION',
  'PROPOSAL',
  'WON',
  'LOST',
] as const

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error

  try {
    const { id } = params

    const prospectRows = await prisma.$queryRawUnsafe<ProspectRow[]>(
      `SELECT id, "companyName", "contactName", email, phone, address, city, state,
              source, "licenseNumber", "estimatedAnnualVolume", status, "assignedTo", notes,
              domain, "founderName", "emailPattern", "enrichmentRunAt", "enrichmentConfidence",
              "enrichmentSourceUrls", "bouncedAt", "icpTier", "createdAt", "updatedAt"
         FROM "Prospect"
        WHERE id = $1
        LIMIT 1`,
      id
    )

    const prospect = prospectRows[0]
    if (!prospect) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
    }

    const [pitchContextRows, pitchRunRows, auditResult] = await Promise.all([
      prisma
        .$queryRawUnsafe<PitchContextRow[]>(
          `SELECT id, "prospectId", "targetPlans", "currentVendor", "estBuildVolume",
                  "dealStage", "positioningNotes", "lastTouchedAt", "lastTouchedBy",
                  "createdAt", "updatedAt"
             FROM "PitchContext"
            WHERE "prospectId" = $1
            LIMIT 1`,
          id
        )
        .catch(() => [] as PitchContextRow[]),
      prisma
        .$queryRawUnsafe<PitchRunRow[]>(
          `SELECT id, style, layout, elements, status, "previewUrl", "emailDraft",
                  "errorMessage", "costEstimate", "generatedBy", "approvedBy",
                  "approvedAt", "sentAt", "createdAt"
             FROM "PitchRun"
            WHERE "prospectId" = $1
            ORDER BY "createdAt" DESC
            LIMIT 25`,
          id
        )
        .catch(() => [] as PitchRunRow[]),
      getAuditLogs({ entity: 'Prospect', entityId: id, limit: 20 }).catch(() => ({
        logs: [],
        total: 0,
      })),
    ])

    return NextResponse.json({
      prospect: {
        ...prospect,
        estimatedAnnualVolume:
          prospect.estimatedAnnualVolume == null
            ? null
            : Number(prospect.estimatedAnnualVolume),
      },
      pitchContext: pitchContextRows[0] || null,
      pitchRuns: pitchRunRows.map((r) => ({
        ...r,
        costEstimate: r.costEstimate == null ? null : Number(r.costEstimate),
      })),
      auditHistory: auditResult.logs || [],
    })
  } catch (error: any) {
    console.error('[Admin Prospect GET]', error?.message || error)
    return NextResponse.json(
      { error: 'Failed to load prospect' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error

  try {
    const { id } = params
    const body = await request.json().catch(() => ({}))
    const pitchContext = body.pitchContext || null
    const contactOverride = body.contactOverride || null

    // Validate target prospect exists.
    const existingRows = await prisma.$queryRawUnsafe<
      Array<{ id: string; email: string | null; phone: string | null; founderName: string | null }>
    >(
      `SELECT id, email, phone, "founderName" FROM "Prospect" WHERE id = $1 LIMIT 1`,
      id
    )
    const existing = existingRows[0]
    if (!existing) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
    }

    const auditChanges: Record<string, { from: any; to: any }> = {}
    const staffId = auth.session.staffId

    // ── Manual contact overrides on Prospect ──
    if (contactOverride && typeof contactOverride === 'object') {
      const updates: string[] = []
      const values: any[] = [id]
      let p = 2
      let emailChanged = false

      if ('email' in contactOverride) {
        const next = contactOverride.email ?? null
        if ((existing.email || null) !== next) {
          updates.push(`email = $${p}`)
          values.push(next)
          p++
          emailChanged = true
          auditChanges.email = { from: existing.email, to: next }
        }
      }
      if ('phone' in contactOverride) {
        const next = contactOverride.phone ?? null
        if ((existing.phone || null) !== next) {
          updates.push(`phone = $${p}`)
          values.push(next)
          p++
          auditChanges.phone = { from: existing.phone, to: next }
        }
      }
      if ('founderName' in contactOverride) {
        const next = contactOverride.founderName ?? null
        if ((existing.founderName || null) !== next) {
          updates.push(`"founderName" = $${p}`)
          values.push(next)
          p++
          auditChanges.founderName = {
            from: existing.founderName,
            to: next,
          }
        }
      }

      // If email changes, clear bouncedAt — gives the next cron a clean slate
      // to re-research before flagging another bounce.
      if (emailChanged) {
        updates.push(`"bouncedAt" = NULL`)
      }

      if (updates.length > 0) {
        updates.push(`"updatedAt" = NOW()`)
        await prisma.$executeRawUnsafe(
          `UPDATE "Prospect" SET ${updates.join(', ')} WHERE id = $1`,
          ...values
        )
      }
    }

    // ── Upsert PitchContext ──
    if (pitchContext && typeof pitchContext === 'object') {
      // Validate dealStage if provided
      if (
        pitchContext.dealStage &&
        !VALID_DEAL_STAGES.includes(pitchContext.dealStage)
      ) {
        return NextResponse.json(
          {
            error: `Invalid dealStage. Must be one of: ${VALID_DEAL_STAGES.join(', ')}`,
          },
          { status: 400 }
        )
      }

      const targetPlansJson = pitchContext.targetPlans
        ? JSON.stringify(pitchContext.targetPlans)
        : null

      // Upsert by prospectId (which is @unique).
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PitchContext"
           (id, "prospectId", "targetPlans", "currentVendor", "estBuildVolume",
            "dealStage", "positioningNotes", "lastTouchedAt", "lastTouchedBy",
            "createdAt", "updatedAt")
         VALUES (
           $1, $2, $3::jsonb, $4, $5, $6, $7, NOW(), $8, NOW(), NOW()
         )
         ON CONFLICT ("prospectId") DO UPDATE SET
           "targetPlans"     = COALESCE(EXCLUDED."targetPlans", "PitchContext"."targetPlans"),
           "currentVendor"   = COALESCE(EXCLUDED."currentVendor", "PitchContext"."currentVendor"),
           "estBuildVolume"  = COALESCE(EXCLUDED."estBuildVolume", "PitchContext"."estBuildVolume"),
           "dealStage"       = COALESCE(EXCLUDED."dealStage", "PitchContext"."dealStage"),
           "positioningNotes"= COALESCE(EXCLUDED."positioningNotes", "PitchContext"."positioningNotes"),
           "lastTouchedAt"   = NOW(),
           "lastTouchedBy"   = EXCLUDED."lastTouchedBy",
           "updatedAt"       = NOW()`,
        // Use Prospect id as PitchContext id when upserting fresh — cuid()
        // would also work but reuse keeps it deterministic + indexable.
        `pc_${id}`,
        id,
        targetPlansJson,
        pitchContext.currentVendor ?? null,
        pitchContext.estBuildVolume ?? null,
        pitchContext.dealStage ?? null,
        pitchContext.positioningNotes ?? null,
        staffId
      )

      auditChanges.pitchContext = {
        from: 'previous',
        to: {
          targetPlans: pitchContext.targetPlans ?? undefined,
          currentVendor: pitchContext.currentVendor ?? undefined,
          estBuildVolume: pitchContext.estBuildVolume ?? undefined,
          dealStage: pitchContext.dealStage ?? undefined,
          positioningNotes: pitchContext.positioningNotes ? '[updated]' : undefined,
        },
      }
    }

    if (Object.keys(auditChanges).length > 0) {
      await audit(
        request,
        'ADMIN_EDIT_PROSPECT',
        'Prospect',
        id,
        {
          prospectId: id,
          changedFields: Object.keys(auditChanges),
          changes: auditChanges,
        }
      ).catch(() => {})
    }

    return NextResponse.json({ ok: true, changedFields: Object.keys(auditChanges) })
  } catch (error: any) {
    console.error('[Admin Prospect PATCH]', error?.message || error)
    return NextResponse.json(
      { error: 'Failed to update prospect' },
      { status: 500 }
    )
  }
}
