export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────────────
// SmartPO Queue — Agent C6 (Wave-3)
//
// GET /api/ops/smartpo/recommendations
//
// Returns PENDING SmartPORecommendation rows, grouped by vendor, ready for
// Nate's Monday push (384 recs across 8+ vendors, total ~$148K). The
// /ops/purchasing/smart-po page speaks a different (older) shape — this
// endpoint speaks a vendor-grouped shape the /ops/smartpo page expects.
//
// Query params:
//   vendorId    — filter to one vendor
//   priority    — HIGH | MEDIUM | LOW  (maps onto SmartPORecommendation.urgency:
//                 HIGH → CRITICAL+HIGH, MEDIUM → NORMAL, LOW → LOW)
//   minAmount   — hide recs below $X
//   hideOnHold  — 'true' to exclude vendors on credit-hold
//   page        — 1-based page (50 recs/page)
//
// Response:
//   {
//     ok: true,
//     totalRecs, totalVendors, totalAmount,
//     groups: [{ vendor: {...}, recs: [...], totals: {...} }],
//     page, pageSize, hasMore
//   }
// ──────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

type Priority = 'HIGH' | 'MEDIUM' | 'LOW'

/** Map UI priority → SmartPORecommendation.urgency values */
function urgenciesForPriority(p: Priority | null): string[] | null {
  if (!p) return null
  if (p === 'HIGH') return ['CRITICAL', 'HIGH']
  if (p === 'MEDIUM') return ['NORMAL', 'MEDIUM'] // tolerate both spellings
  if (p === 'LOW') return ['LOW']
  return null
}

/** Collapse urgency → HIGH|MEDIUM|LOW for UI color-coding */
function priorityOf(urgency: string): Priority {
  const u = (urgency || '').toUpperCase()
  if (u === 'CRITICAL' || u === 'HIGH') return 'HIGH'
  if (u === 'LOW') return 'LOW'
  return 'MEDIUM'
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const vendorFilter = searchParams.get('vendorId') || null
  const priorityRaw = (searchParams.get('priority') || '').toUpperCase() as Priority | ''
  const priority: Priority | null =
    priorityRaw === 'HIGH' || priorityRaw === 'MEDIUM' || priorityRaw === 'LOW' ? priorityRaw : null
  const minAmountRaw = parseFloat(searchParams.get('minAmount') || '0')
  const minAmount = Number.isFinite(minAmountRaw) && minAmountRaw > 0 ? minAmountRaw : 0
  const hideOnHold = searchParams.get('hideOnHold') === 'true'
  const pageRaw = parseInt(searchParams.get('page') || '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

  try {
    const params: any[] = []
    const where: string[] = [`r."status" = 'PENDING'`]

    if (vendorFilter) {
      params.push(vendorFilter)
      where.push(`r."vendorId" = $${params.length}`)
    }

    const urgs = urgenciesForPriority(priority)
    if (urgs) {
      const placeholders: string[] = []
      for (const u of urgs) {
        params.push(u)
        placeholders.push(`$${params.length}`)
      }
      where.push(`r."urgency" IN (${placeholders.join(',')})`)
    }

    if (minAmount > 0) {
      params.push(minAmount)
      where.push(`COALESCE(r."estimatedCost", 0) >= $${params.length}`)
    }

    if (hideOnHold) {
      where.push(`(v."creditHold" IS NULL OR v."creditHold" = false)`)
    }

    const whereSql = where.join(' AND ')

    // ── Totals (full unpaginated set) — header + pagination math ──────────
    const totalsRow = await prisma.$queryRawUnsafe<
      Array<{ totalRecs: number; totalVendors: number; totalAmount: number }>
    >(
      `
      SELECT
        COUNT(*)::int AS "totalRecs",
        COUNT(DISTINCT r."vendorId")::int AS "totalVendors",
        COALESCE(SUM(r."estimatedCost"), 0)::float AS "totalAmount"
      FROM "SmartPORecommendation" r
      LEFT JOIN "Vendor" v ON v."id" = r."vendorId"
      WHERE ${whereSql}
      `,
      ...params
    )
    const totalRecs = totalsRow[0]?.totalRecs ?? 0
    const totalVendors = totalsRow[0]?.totalVendors ?? 0
    const totalAmount = Number(totalsRow[0]?.totalAmount ?? 0)

    // ── Paginated rows — 50/page, sorted by vendor then urgency then due ──
    // Sort vendors by their CRITICAL/HIGH count first so the biggest-pain
    // vendors float up — Masonite, Boise, etc.
    const offset = (page - 1) * PAGE_SIZE

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      WITH scoped AS (
        SELECT
          r."id",
          r."vendorId",
          r."productId",
          r."productCategory",
          r."recommendationType",
          r."urgency",
          r."triggerReason",
          r."recommendedQty",
          r."estimatedCost",
          r."targetDeliveryDate",
          r."orderByDate",
          r."relatedJobIds",
          r."aiReasoning",
          r."createdAt",
          v."id"           AS "v_id",
          v."name"         AS "vendorName",
          v."code"         AS "vendorCode",
          v."avgLeadDays"  AS "vendorLeadDays",
          v."creditHold"   AS "vendorCreditHold",
          v."paymentTerms" AS "vendorPaymentTerms",
          p."sku"          AS "sku",
          p."name"         AS "productName",
          vp."leadTimeDays" AS "productLeadDays",
          vp."vendorCost"  AS "vendorUnitCost"
        FROM "SmartPORecommendation" r
        LEFT JOIN "Vendor" v ON v."id" = r."vendorId"
        LEFT JOIN "Product" p ON p."id" = r."productId"
        LEFT JOIN "VendorProduct" vp
          ON vp."vendorId" = r."vendorId" AND vp."productId" = r."productId"
        WHERE ${whereSql}
      ),
      vendor_rank AS (
        SELECT
          "vendorId",
          SUM(CASE WHEN "urgency" IN ('CRITICAL','HIGH') THEN 1 ELSE 0 END)::int AS "hotCount",
          SUM(COALESCE("estimatedCost", 0))::float AS "vendorTotal"
        FROM scoped
        GROUP BY "vendorId"
      )
      SELECT s.*, vr."hotCount", vr."vendorTotal"
      FROM scoped s
      JOIN vendor_rank vr USING ("vendorId")
      ORDER BY
        vr."hotCount" DESC,
        vr."vendorTotal" DESC,
        s."vendorName" ASC,
        CASE s."urgency"
          WHEN 'CRITICAL' THEN 0
          WHEN 'HIGH'     THEN 1
          WHEN 'NORMAL'   THEN 2
          WHEN 'MEDIUM'   THEN 2
          WHEN 'LOW'      THEN 3
          ELSE 4
        END,
        s."orderByDate" ASC NULLS LAST,
        COALESCE(s."estimatedCost", 0) DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `,
      ...params
    )

    // Pull source jobs in one round-trip — relatedJobIds is a Json array of
    // string ids. Gather the union, fetch, and splice back in.
    const allJobIds = new Set<string>()
    for (const row of rows) {
      const arr = Array.isArray(row.relatedJobIds) ? row.relatedJobIds : []
      for (const j of arr) {
        if (typeof j === 'string' && j) allJobIds.add(j)
      }
    }

    const jobsById = new Map<string, any>()
    if (allJobIds.size > 0) {
      const ids = Array.from(allJobIds)
      const jobRows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT "id", "jobNumber", "builderName", "community", "scheduledDate"
        FROM "Job"
        WHERE "id" = ANY($1::text[])
        `,
        ids
      )
      for (const j of jobRows) jobsById.set(j.id, j)
    }

    // Shape into vendor groups
    type VendorGroup = {
      vendor: {
        id: string
        name: string | null
        code: string | null
        avgLeadDays: number | null
        creditHold: boolean
        paymentTerms: string | null
      }
      recs: any[]
      totals: {
        count: number
        amount: number
        priorityCounts: { HIGH: number; MEDIUM: number; LOW: number }
      }
    }
    const groupMap = new Map<string, VendorGroup>()

    for (const row of rows) {
      const vendorId: string = row.vendorId
      let group = groupMap.get(vendorId)
      if (!group) {
        group = {
          vendor: {
            id: vendorId,
            name: row.vendorName ?? null,
            code: row.vendorCode ?? null,
            avgLeadDays: row.vendorLeadDays ?? null,
            creditHold: !!row.vendorCreditHold,
            paymentTerms: row.vendorPaymentTerms ?? null,
          },
          recs: [],
          totals: { count: 0, amount: 0, priorityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 } },
        }
        groupMap.set(vendorId, group)
      }

      const jobIdArr: string[] = Array.isArray(row.relatedJobIds) ? row.relatedJobIds : []
      const sourceJobs = jobIdArr
        .map((id) => jobsById.get(id))
        .filter(Boolean)
        .map((j: any) => ({
          id: j.id,
          jobNumber: j.jobNumber,
          builderName: j.builderName,
          community: j.community,
          scheduledDate: j.scheduledDate,
        }))

      const qty = Number(row.recommendedQty || 0)
      const lineTotal = Number(row.estimatedCost || 0)
      const unitCost = qty > 0 ? lineTotal / qty : Number(row.vendorUnitCost || 0)
      const leadTime = row.productLeadDays ?? row.vendorLeadDays ?? null
      const prio = priorityOf(row.urgency)

      group.recs.push({
        id: row.id,
        sku: row.sku,
        productId: row.productId,
        productName: row.productName,
        productCategory: row.productCategory,
        urgency: row.urgency,
        priority: prio,
        recommendedQty: qty,
        unitCost,
        lineTotal,
        leadTimeDays: leadTime,
        orderByDate: row.orderByDate,
        targetDeliveryDate: row.targetDeliveryDate,
        triggerReason: row.triggerReason,
        aiReasoning: row.aiReasoning,
        sourceJobs,
        createdAt: row.createdAt,
      })
      group.totals.count += 1
      group.totals.amount += lineTotal
      group.totals.priorityCounts[prio] += 1
    }

    const groups = Array.from(groupMap.values())

    return safeJson({
      ok: true,
      totalRecs,
      totalVendors,
      totalAmount,
      groups,
      page,
      pageSize: PAGE_SIZE,
      hasMore: page * PAGE_SIZE < totalRecs,
      filters: {
        vendorId: vendorFilter,
        priority,
        minAmount,
        hideOnHold,
      },
    })
  } catch (error: any) {
    return safeJson(
      {
        ok: false,
        error: 'Failed to load SmartPO queue',
        details: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}
