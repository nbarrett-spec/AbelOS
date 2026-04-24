export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import {
  ensureSubstitutionRequestTable,
  runAllocationSwap,
} from '@/lib/substitution-requests'
import { sendSubstitutionRequestEmail } from '@/lib/email/substitution-request'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/products/[productId]/substitutes/apply
//
// Body: {
//   jobId: string,                     // required
//   substituteProductId: string,       // required — must be an active sub for productId
//   quantity: number,                  // required, > 0
//   allocationId?: string,             // optional — an existing allocation row
//   reason?: string,                   // optional — context for the approver (CONDITIONAL only)
// }
//
// Behavior:
//   - IDENTICAL or COMPATIBLE substitution → allocate immediately
//       * If allocationId is provided AND status is RESERVED/BACKORDERED:
//           · Mark the existing allocation RELEASED with a note
//           · Create a NEW allocation against the substitute product
//       * If no allocationId is provided (pre-allocation phase):
//           · Simply create a new allocation against the substitute
//   - CONDITIONAL substitution → create a SubstitutionRequest in PENDING status
//       * No allocation movement until approved
//       * PM (assigned on the Job) + Clint are notified by email
//       * UI should display "Request submitted, awaiting approval"
//
// This keeps the ledger clean — the original demand record is preserved in
// RELEASED state so audit can reconstruct the swap after the fact.
// ──────────────────────────────────────────────────────────────────────────

interface Body {
  jobId?: string
  substituteProductId?: string
  quantity?: number
  allocationId?: string
  reason?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { productId } = params
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { jobId, substituteProductId, quantity, allocationId, reason } = body
  if (!jobId || !substituteProductId || !quantity || quantity <= 0) {
    return NextResponse.json(
      { error: 'jobId, substituteProductId and quantity (>0) are required' },
      { status: 400 }
    )
  }

  try {
    // Verify the substitute is actually a valid substitute for productId.
    // Pull compatibility + conditions so we can branch on CONDITIONAL.
    const match: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "substitutionType", "conditions", "compatibility", "priceDelta"
         FROM "ProductSubstitution"
        WHERE "primaryProductId" = $1
          AND "substituteProductId" = $2
          AND active = true
        LIMIT 1`,
      productId,
      substituteProductId
    )
    if (match.length === 0) {
      return NextResponse.json(
        { error: 'Substitute is not registered for this primary product' },
        { status: 400 }
      )
    }
    const sub = match[0]
    const compatibility = String(sub.compatibility ?? '').toUpperCase()
    const isConditional = compatibility === 'CONDITIONAL'

    const staffId = request.headers.get('x-staff-id') ?? 'system'

    // ── CONDITIONAL branch: create a PENDING request, don't allocate ──────
    if (isConditional) {
      await ensureSubstitutionRequestTable()

      // Grab job + product + staff context for the notification email.
      const jobRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT j.id,
                j."jobNumber",
                j."assignedPMId",
                b.name AS "builderName"
           FROM "Job" j
           LEFT JOIN "Builder" b ON b.id = j."builderId"
          WHERE j.id = $1
          LIMIT 1`,
        jobId
      )
      if (jobRow.length === 0) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      const productRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, sku, name FROM "Product" WHERE id = ANY($1::text[])`,
        [productId, substituteProductId]
      )
      const origProduct = productRows.find((r) => r.id === productId)
      const subProduct = productRows.find(
        (r) => r.id === substituteProductId
      )

      // Insert the request.
      const inserted: any[] = await prisma.$queryRawUnsafe(
        `INSERT INTO "SubstitutionRequest"
           ("jobId", "originalAllocationId", "originalProductId",
            "substituteProductId", "quantity", "requestedById", "reason", "status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
         RETURNING id, status, "createdAt"`,
        jobId,
        allocationId ?? null,
        productId,
        substituteProductId,
        quantity,
        staffId,
        reason ?? null
      )
      const request_ = inserted[0]

      // Fire off notification emails (PM + Clint). Non-blocking — if it
      // fails we still return the pending request so the UI can show it.
      try {
        // Look up PM email + name
        let pmEmail: string | null = null
        let pmFirstName = 'there'
        if (jobRow[0].assignedPMId) {
          const pm: any[] = await prisma.$queryRawUnsafe(
            `SELECT email, "firstName" FROM "Staff" WHERE id = $1 LIMIT 1`,
            jobRow[0].assignedPMId
          )
          if (pm.length > 0 && pm[0].email) {
            pmEmail = pm[0].email as string
            pmFirstName = (pm[0].firstName as string) || 'there'
          }
        }

        // Also look up Clint by role=COO or a known email fallback. Don't
        // require a specific staff id — match by role title.
        const clintRow: any[] = await prisma.$queryRawUnsafe(
          `SELECT email, "firstName" FROM "Staff"
            WHERE active = true
              AND (email ILIKE 'c.vinson@%'
                OR email ILIKE 'clint@%'
                OR LOWER("firstName") = 'clint')
            LIMIT 1`
        )
        const clintEmail = clintRow.length > 0 ? clintRow[0].email : null

        // Requestor's display name (for the email body)
        const requesterRow: any[] = await prisma.$queryRawUnsafe(
          `SELECT "firstName", "lastName" FROM "Staff" WHERE id = $1 LIMIT 1`,
          staffId
        )
        const requestedByName =
          requesterRow.length > 0
            ? `${requesterRow[0].firstName ?? ''} ${
                requesterRow[0].lastName ?? ''
              }`.trim() || 'A teammate'
            : 'A teammate'

        const recipients = [pmEmail, clintEmail].filter(
          (e): e is string => !!e
        )

        for (const to of recipients) {
          const firstName =
            to === pmEmail ? pmFirstName : to === clintEmail ? 'Clint' : 'there'
          await sendSubstitutionRequestEmail({
            to,
            recipientFirstName: firstName,
            requestId: request_.id,
            jobId,
            jobNumber: jobRow[0].jobNumber ?? jobId,
            builderName: jobRow[0].builderName ?? null,
            originalSku: origProduct?.sku ?? null,
            originalName: origProduct?.name ?? null,
            substituteSku: subProduct?.sku ?? null,
            substituteName: subProduct?.name ?? null,
            quantity,
            conditions: sub.conditions ?? null,
            priceDelta:
              sub.priceDelta == null ? null : Number(sub.priceDelta),
            requestedByName,
            reason: reason ?? null,
          })
        }
      } catch (emailErr) {
        console.warn(
          '[substitutes/apply] notification email failed (non-fatal):',
          emailErr
        )
      }

      return NextResponse.json({
        ok: true,
        pending: true,
        requestId: request_.id,
        status: 'PENDING',
        message:
          'CONDITIONAL substitution submitted for approval. No inventory moved.',
      })
    }

    // ── IDENTICAL / COMPATIBLE branch: run the swap immediately ───────────
    const noteSuffix = `${sub.substitutionType}${
      sub.conditions ? ` — ${sub.conditions}` : ''
    }`

    const result = await prisma.$transaction(async (tx) => {
      return runAllocationSwap(tx, {
        originalProductId: productId,
        substituteProductId,
        jobId,
        quantity,
        allocationId: allocationId ?? null,
        staffId,
        noteSuffix,
      })
    })

    return NextResponse.json({
      ok: true,
      pending: false,
      ...result,
    })
  } catch (err: any) {
    console.error('[substitutes/apply POST]', err)
    return NextResponse.json(
      { error: 'Failed to apply substitute', details: err?.message },
      { status: 500 }
    )
  }
}
