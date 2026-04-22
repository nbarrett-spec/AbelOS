export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory/[id]/transactions
//   Movement timeline derived from PurchaseOrderItem (RECEIPT) and
//   MaterialPick (ISSUE).
//   Query params: page, limit, type (all|receipt|issue)
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const productId = params.id
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  try {
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25', 10) || 25))
    const type = (searchParams.get('type') || 'all').toLowerCase()
    const offset = (page - 1) * limit

    // Build a UNION of receipts (POI) and issues (MP)
    const wantReceipts = type === 'all' || type === 'receipt'
    const wantIssues = type === 'all' || type === 'issue'

    const unionParts: string[] = []
    if (wantReceipts) {
      unionParts.push(`
        SELECT
          'RECEIPT'::text AS "type",
          poi."id" AS "id",
          poi."receivedQty" AS "quantity",
          poi."unitCost" AS "unitCost",
          (poi."receivedQty" * poi."unitCost") AS "value",
          po."receivedAt" AS "ts",
          po."poNumber" AS "reference",
          v."name" AS "counterparty",
          po."status" AS "subStatus",
          poi."damagedQty" AS "damagedQty",
          NULL::text AS "jobNumber",
          NULL::text AS "builderName"
        FROM "PurchaseOrderItem" poi
        JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
        LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
        WHERE poi."productId" = $1
          AND poi."receivedQty" > 0
      `)
    }
    if (wantIssues) {
      unionParts.push(`
        SELECT
          'ISSUE'::text AS "type",
          mp."id" AS "id",
          mp."pickedQty" AS "quantity",
          NULL::numeric AS "unitCost",
          NULL::numeric AS "value",
          mp."pickedAt" AS "ts",
          j."jobNumber" AS "reference",
          COALESCE(b."companyName", j."builderName") AS "counterparty",
          mp."status"::text AS "subStatus",
          NULL::integer AS "damagedQty",
          j."jobNumber" AS "jobNumber",
          COALESCE(b."companyName", j."builderName") AS "builderName"
        FROM "MaterialPick" mp
        LEFT JOIN "Job" j ON j."id" = mp."jobId"
        LEFT JOIN "Order" o ON o."id" = j."orderId"
        LEFT JOIN "Builder" b ON b."id" = o."builderId"
        WHERE mp."productId" = $1
          AND mp."pickedQty" > 0
          AND mp."pickedAt" IS NOT NULL
      `)
    }

    if (unionParts.length === 0) {
      return safeJson({ transactions: [], total: 0, page, totalPages: 1 })
    }

    const unionSql = unionParts.join(' UNION ALL ')

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM (${unionSql}) AS t
      ORDER BY t."ts" DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `, productId, limit, offset)

    const countRow: any[] = await prisma.$queryRawUnsafe(`
      SELECT CAST(COUNT(*) AS INTEGER) AS cnt FROM (${unionSql}) AS t
    `, productId)
    const total = Number(countRow[0]?.cnt || 0)

    return safeJson({
      transactions: rows.map(r => ({
        type: r.type,
        id: r.id,
        quantity: Number(r.quantity || 0),
        unitCost: r.unitCost == null ? null : Number(r.unitCost),
        value: r.value == null ? null : Number(r.value),
        ts: r.ts,
        reference: r.reference,
        counterparty: r.counterparty,
        subStatus: r.subStatus,
        damagedQty: r.damagedQty == null ? null : Number(r.damagedQty),
        jobNumber: r.jobNumber,
        builderName: r.builderName,
      })),
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (error: any) {
    console.error('Inventory transactions error:', error)
    return NextResponse.json({ error: 'Internal server error', detail: String(error?.message || error) }, { status: 500 })
  }
}
