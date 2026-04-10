export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// CHANGE ORDERS — CRUD for change order workflow
// ──────────────────────────────────────────────────────────────────
// GET ?jobId=xxx  — list change orders for a job
// POST             — create a new change order
// PATCH            — update status (submit, approve, reject)
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const jobId = request.nextUrl.searchParams.get('jobId')
  const status = request.nextUrl.searchParams.get('status')

  try {
    let query = `
      SELECT
        co.*,
        s1."firstName" || ' ' || s1."lastName" AS "requestedByName",
        s2."firstName" || ' ' || s2."lastName" AS "approvedByName"
      FROM "ChangeOrder" co
      LEFT JOIN "Staff" s1 ON co."requestedById" = s1."id"
      LEFT JOIN "Staff" s2 ON co."approvedById" = s2."id"
      WHERE 1=1
    `
    const params: any[] = []
    let idx = 1

    if (jobId) {
      query += ` AND co."jobId" = $${idx}`
      params.push(jobId)
      idx++
    }
    if (status) {
      query += ` AND co."status" = $${idx}`
      params.push(status)
      idx++
    }

    query += ` ORDER BY co."createdAt" DESC LIMIT 100`

    const orders: any[] = await prisma.$queryRawUnsafe(query, ...params)
    return safeJson({ changeOrders: orders, count: orders.length })
  } catch (error: any) {
    console.error('[Change Orders GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''

  try {
    const body = await request.json()
    const { jobId, orderId, reason, description, lineItems, costImpact, scheduleImpact } = body

    if (!jobId || !reason) {
      return NextResponse.json({ error: 'jobId and reason are required' }, { status: 400 })
    }

    const id = 'co' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Generate change number
    const seqResult: any[] = await prisma.$queryRawUnsafe(`SELECT nextval('co_seq')::int AS seq`)
    const seq = seqResult[0]?.seq || Date.now()
    const changeNumber = `CO-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "ChangeOrder" (
        id, "changeNumber", "jobId", "orderId", "requestedById", status,
        reason, description, "lineItems", "costImpact", "scheduleImpact",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8::jsonb, $9, $10, NOW(), NOW())
    `,
      id, changeNumber, jobId, orderId || null, staffId,
      reason, description || null,
      JSON.stringify(lineItems || []),
      costImpact || 0, scheduleImpact || null
    )

    return safeJson({ success: true, id, changeNumber })
  } catch (error: any) {
    console.error('[Change Orders POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''

  try {
    const body = await request.json()
    const { id, action, rejectionReason, lineItems, costImpact, description } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    if (action === 'submit') {
      await prisma.$executeRawUnsafe(`
        UPDATE "ChangeOrder"
        SET status = 'SUBMITTED', "submittedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1 AND status = 'DRAFT'
      `, id)
    } else if (action === 'approve') {
      await prisma.$executeRawUnsafe(`
        UPDATE "ChangeOrder"
        SET status = 'APPROVED', "approvedById" = $2, "approvedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1 AND status = 'SUBMITTED'
      `, id, staffId)
    } else if (action === 'reject') {
      await prisma.$executeRawUnsafe(`
        UPDATE "ChangeOrder"
        SET status = 'REJECTED', "approvedById" = $2, "rejectedAt" = NOW(),
            "rejectionReason" = $3, "updatedAt" = NOW()
        WHERE id = $1 AND status = 'SUBMITTED'
      `, id, staffId, rejectionReason || null)
    } else if (action === 'builder_approve') {
      await prisma.$executeRawUnsafe(`
        UPDATE "ChangeOrder"
        SET "builderApproval" = true, "builderApprovedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1
      `, id)
    } else if (action === 'update') {
      // Update draft fields
      const updates: string[] = [`"updatedAt" = NOW()`]
      const params: any[] = [id]
      let pIdx = 2

      if (lineItems !== undefined) {
        updates.push(`"lineItems" = $${pIdx}::jsonb`)
        params.push(JSON.stringify(lineItems))
        pIdx++
      }
      if (costImpact !== undefined) {
        updates.push(`"costImpact" = $${pIdx}`)
        params.push(costImpact)
        pIdx++
      }
      if (description !== undefined) {
        updates.push(`description = $${pIdx}`)
        params.push(description)
        pIdx++
      }

      await prisma.$executeRawUnsafe(
        `UPDATE "ChangeOrder" SET ${updates.join(', ')} WHERE id = $1`,
        ...params
      )
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return safeJson({ success: true, action })
  } catch (error: any) {
    console.error('[Change Orders PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
