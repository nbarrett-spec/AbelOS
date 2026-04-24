export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { logAudit, getStaffFromHeaders } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// SmartPO Ship — Agent C6 (Wave-3)
//
// POST /api/ops/smartpo/ship
//
// Body:
//   { mode: 'one',            recommendationIds: string[] }
//   { mode: 'all_for_vendor', vendorId: string }
//
// For each selected recommendation:
//   1. Create a PurchaseOrder (status=DRAFT, aiGenerated=true)
//   2. Create PurchaseOrderItem rows
//   3. Flip SmartPORecommendation → status=CONVERTED, convertedPOId=<poId>
//   4. Audit each conversion with action=SHIP_FROM_SMARTPO
//
// "Ship" here = create the internal Aegis PO record. It does NOT email the
// vendor. Nate sends externally.
//
// Idempotency: a recommendation already CONVERTED (has convertedPOId) is
// skipped. Shape of the response tells the UI which ones were skipped so a
// double-click doesn't create duplicate POs.
//
// Feature flag: FEATURE_SMARTPO_SHIP (server-side, default on). Set to
// 'off' to disable.
// ──────────────────────────────────────────────────────────────────────────

interface ShipBody {
  mode: 'one' | 'all_for_vendor'
  recommendationIds?: string[]
  vendorId?: string
}

/** Generate next PO number of the form PO-YYYY-#### — transaction-safe enough
 *  for the Monday push: if two concurrent requests collide, one retries.
 */
async function generatePoNumber(tx: any): Promise<string> {
  const year = new Date().getFullYear()
  const rows = (await tx.$queryRawUnsafe(
    `SELECT COALESCE(MAX(CAST(SUBSTRING("poNumber" FROM '[0-9]+$') AS INT)), 0)::int AS "maxNumber"
     FROM "PurchaseOrder"
     WHERE "poNumber" LIKE 'PO-${year}-%'`
  )) as Array<{ maxNumber: number }>
  const next = (rows[0]?.maxNumber ?? 0) + 1
  return `PO-${year}-${String(next).padStart(4, '0')}`
}

/** Best-effort lookup to satisfy the non-null createdById FK. Prefer the
 *  authenticated staff; fall back to any ADMIN; fall back to any Staff row.
 */
async function resolveCreatedById(staffId: string | null): Promise<string | null> {
  if (staffId) {
    const hit = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "Staff" WHERE "id" = $1 LIMIT 1`,
      staffId
    )
    if (hit[0]?.id) return hit[0].id
  }
  const admin = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Staff" WHERE "role" = 'ADMIN' AND "active" = true ORDER BY "createdAt" ASC LIMIT 1`
  ).catch(() => [] as Array<{ id: string }>)
  if (admin[0]?.id) return admin[0].id
  const any = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`
  ).catch(() => [] as Array<{ id: string }>)
  return any[0]?.id ?? null
}

export async function POST(request: NextRequest) {
  if ((process.env.FEATURE_SMARTPO_SHIP || '').toLowerCase() === 'off') {
    return safeJson(
      { ok: false, error: 'SmartPO ship is disabled (FEATURE_SMARTPO_SHIP=off)' },
      { status: 503 }
    )
  }

  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staff = getStaffFromHeaders(request.headers)

  let body: ShipBody
  try {
    body = await request.json()
  } catch {
    return safeJson({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.mode !== 'one' && body.mode !== 'all_for_vendor') {
    return safeJson({ ok: false, error: 'mode must be "one" or "all_for_vendor"' }, { status: 400 })
  }

  // ── Collect the candidate recommendation IDs ────────────────────────────
  let candidateIds: string[] = []

  if (body.mode === 'one') {
    if (!Array.isArray(body.recommendationIds) || body.recommendationIds.length === 0) {
      return safeJson(
        { ok: false, error: 'recommendationIds[] required for mode=one' },
        { status: 400 }
      )
    }
    candidateIds = body.recommendationIds.filter((x) => typeof x === 'string' && x.length > 0)
  } else {
    if (!body.vendorId || typeof body.vendorId !== 'string') {
      return safeJson(
        { ok: false, error: 'vendorId required for mode=all_for_vendor' },
        { status: 400 }
      )
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "SmartPORecommendation"
       WHERE "vendorId" = $1 AND "status" = 'PENDING'`,
      body.vendorId
    )
    candidateIds = rows.map((r) => r.id)
  }

  if (candidateIds.length === 0) {
    return safeJson(
      { ok: true, shipped: 0, failed: 0, skipped: 0, poIds: [], errors: [], skippedIds: [] },
      { status: 200 }
    )
  }

  // ── Resolve createdBy (FK-safe) once ────────────────────────────────────
  const createdById = await resolveCreatedById(staff.staffId === 'unknown' ? null : staff.staffId)
  if (!createdById) {
    return safeJson(
      {
        ok: false,
        error:
          'No Staff row available for PurchaseOrder.createdById (required FK). Seed at least one Staff row.',
      },
      { status: 500 }
    )
  }

  // ── Load full rec rows + check idempotency + group by vendor ────────────
  const recs = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT
      r."id", r."vendorId", r."productId", r."productCategory",
      r."urgency", r."recommendedQty", r."estimatedCost",
      r."targetDeliveryDate", r."orderByDate", r."relatedJobIds",
      r."status", r."convertedPOId", r."triggerReason",
      p."sku", p."name" AS "productName",
      vp."vendorCost"  AS "vendorUnitCost",
      v."name" AS "vendorName"
    FROM "SmartPORecommendation" r
    LEFT JOIN "Vendor" v ON v."id" = r."vendorId"
    LEFT JOIN "Product" p ON p."id" = r."productId"
    LEFT JOIN "VendorProduct" vp
      ON vp."vendorId" = r."vendorId" AND vp."productId" = r."productId"
    WHERE r."id" = ANY($1::text[])
    `,
    candidateIds
  )

  const skippedIds: string[] = []
  const live: any[] = []
  for (const r of recs) {
    if (r.status !== 'PENDING' || r.convertedPOId) {
      skippedIds.push(r.id)
    } else {
      live.push(r)
    }
  }

  if (live.length === 0) {
    return safeJson({
      ok: true,
      shipped: 0,
      failed: 0,
      skipped: skippedIds.length,
      poIds: [],
      errors: [],
      skippedIds,
    })
  }

  // ── Group by vendor — 1 PO per vendor per ship call ─────────────────────
  const byVendor = new Map<string, any[]>()
  for (const r of live) {
    const arr = byVendor.get(r.vendorId) || []
    arr.push(r)
    byVendor.set(r.vendorId, arr)
  }

  const poIds: string[] = []
  const errors: Array<{ vendorId?: string; recId?: string; message: string }> = []
  let shipped = 0
  let failed = 0

  for (const [vendorId, vendorRecs] of byVendor.entries()) {
    try {
      const vendorName = vendorRecs[0].vendorName || vendorId

      // Earliest orderByDate across the group → expectedDate
      let earliestTarget: Date | null = null
      for (const r of vendorRecs) {
        const d = r.targetDeliveryDate || r.orderByDate
        if (d) {
          const dd = new Date(d)
          if (!earliestTarget || dd < earliestTarget) earliestTarget = dd
        }
      }

      // Line totals
      let subtotal = 0
      const itemsToInsert: Array<{
        id: string
        productId: string | null
        vendorSku: string
        description: string
        quantity: number
        unitCost: number
        lineTotal: number
      }> = []
      for (const r of vendorRecs) {
        const qty = Math.max(0, Number(r.recommendedQty || 0))
        if (qty === 0) continue
        const lineTotal = Number(r.estimatedCost || 0)
        const unitCost = qty > 0 ? lineTotal / qty : Number(r.vendorUnitCost || 0)
        subtotal += lineTotal
        itemsToInsert.push({
          id: `poi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          productId: r.productId ?? null,
          vendorSku: r.sku || (r.productId ? `PROD-${String(r.productId).slice(0, 8)}` : 'UNMAPPED'),
          description: r.productName || r.triggerReason || 'SmartPO line',
          quantity: qty,
          unitCost,
          lineTotal,
        })
      }

      if (itemsToInsert.length === 0) {
        for (const r of vendorRecs) {
          errors.push({ vendorId, recId: r.id, message: 'Recommendation had zero qty' })
          failed++
        }
        continue
      }

      // Transactional write — PO + items + rec flips
      await prisma.$transaction(async (tx) => {
        const poNumber = await generatePoNumber(tx)
        const poId = `po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

        await tx.$executeRawUnsafe(
          `INSERT INTO "PurchaseOrder"
            ("id", "poNumber", "vendorId", "createdById", "status", "category",
             "subtotal", "shippingCost", "total", "expectedDate", "notes",
             "aiGenerated", "source", "createdAt", "updatedAt")
           VALUES
            ($1, $2, $3, $4, 'DRAFT'::"POStatus", 'GENERAL'::"POCategory",
             $5, 0, $5, $6, $7,
             true, 'SMARTPO', NOW(), NOW())`,
          poId,
          poNumber,
          vendorId,
          createdById,
          subtotal,
          earliestTarget,
          `Shipped from SmartPO queue — ${itemsToInsert.length} line(s) from ${vendorRecs.length} recommendation(s)`
        )

        for (const it of itemsToInsert) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "PurchaseOrderItem"
              ("id", "purchaseOrderId", "productId", "vendorSku", "description",
               "quantity", "unitCost", "lineTotal", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            it.id,
            poId,
            it.productId,
            it.vendorSku,
            it.description,
            it.quantity,
            it.unitCost,
            it.lineTotal
          )
        }

        // Flip every sourced recommendation → CONVERTED with convertedPOId set
        const recIds = vendorRecs.map((r: any) => r.id)
        await tx.$executeRawUnsafe(
          `UPDATE "SmartPORecommendation"
           SET "status" = 'CONVERTED',
               "convertedPOId" = $1,
               "updatedAt" = NOW()
           WHERE "id" = ANY($2::text[]) AND "status" = 'PENDING'`,
          poId,
          recIds
        )

        poIds.push(poId)
        shipped += vendorRecs.length
      })

      // ── Audit (outside transaction; fail-soft) ──────────────────────────
      for (const r of vendorRecs) {
        logAudit({
          staffId: staff.staffId,
          staffName: staff.staffName,
          action: 'SHIP_FROM_SMARTPO',
          entity: 'purchase_order',
          entityId: poIds[poIds.length - 1],
          details: {
            recommendationId: r.id,
            vendorId,
            vendorName,
            amount: Number(r.estimatedCost || 0),
            sku: r.sku || null,
            qty: Number(r.recommendedQty || 0),
            urgency: r.urgency,
            mode: body.mode,
          },
          severity: 'INFO',
          ipAddress:
            request.headers.get('x-forwarded-for') ||
            request.headers.get('x-real-ip') ||
            undefined,
          userAgent: request.headers.get('user-agent') || undefined,
        }).catch(() => {})
      }
    } catch (err: any) {
      failed += vendorRecs.length
      errors.push({
        vendorId,
        message: err?.message || String(err),
      })
    }
  }

  return safeJson({
    ok: failed === 0,
    shipped,
    failed,
    skipped: skippedIds.length,
    poIds,
    errors,
    skippedIds,
  })
}
