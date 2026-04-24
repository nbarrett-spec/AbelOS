export const dynamic = 'force-dynamic'

/**
 * GET /api/ops/collections/exposure
 *
 * Cockpit-level AR exposure data for the Collections page (Wave 3, Agent C3).
 *
 * Returns:
 *   • topExposure:  the single builder with the worst exposure, scored by
 *                   sum(balance × daysPastDue). Null if nobody owes.
 *   • aging:        { current, d30, d60, d90 } — each bucket has
 *                   { count, total } computed over every outstanding invoice.
 *   • builders:     every builder with any open balance, with aggregate
 *                   numbers + primary contact, sortable client-side.
 *
 * Lives next to the existing `/today` route (which drives the ladder-based
 * action queue). Kept separate so the cockpit load and the queue load can
 * refresh independently.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

interface InvoiceAgg {
  builderId: string
  builderName: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  invoiceId: string
  balanceDue: number
  dueDate: Date | null
  issuedAt: Date | null
  createdAt: Date
  lastActionAt: Date | null
}

function daysPastDueOf(ref: Date | null, fallback: Date): number {
  const d = ref || fallback
  const ms = Date.now() - d.getTime()
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)))
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // One query joining Invoice ↔ Builder ↔ latest CollectionAction.
    // We group client-side so we can compute the score formula without
    // forcing Postgres through window functions that aren't needed.
    const rows = await prisma.$queryRawUnsafe<InvoiceAgg[]>(`
      SELECT
        i."builderId",
        b."companyName" AS "builderName",
        b."contactName",
        b."email",
        b."phone",
        i."id" AS "invoiceId",
        (i."total" - COALESCE(i."amountPaid", 0))::float AS "balanceDue",
        i."dueDate",
        i."issuedAt",
        i."createdAt",
        last_act."lastActionAt"
      FROM "Invoice" i
      LEFT JOIN "Builder" b ON b."id" = i."builderId"
      LEFT JOIN LATERAL (
        SELECT MAX("sentAt") AS "lastActionAt"
        FROM "CollectionAction" ca
        WHERE ca."invoiceId" = i."id"
      ) last_act ON true
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i."total" - COALESCE(i."amountPaid", 0)) > 0
    `)

    interface BuilderAgg {
      id: string
      name: string
      contactName: string | null
      email: string | null
      phone: string | null
      balance: number
      invoiceCount: number
      maxDaysPastDue: number
      /** Σ balance × dpd — the exposure score. */
      score: number
      lastActionAt: Date | null
    }

    const builderMap = new Map<string, BuilderAgg>()

    // Aging buckets over every invoice.
    let curCount = 0
    let curTotal = 0
    let d30Count = 0
    let d30Total = 0
    let d60Count = 0
    let d60Total = 0
    let d90Count = 0
    let d90Total = 0

    for (const r of rows) {
      const dpd = daysPastDueOf(r.dueDate, r.issuedAt || r.createdAt)
      const balance = Number(r.balanceDue) || 0

      if (dpd < 30) {
        curCount++
        curTotal += balance
      } else if (dpd < 60) {
        d30Count++
        d30Total += balance
      } else if (dpd < 90) {
        d60Count++
        d60Total += balance
      } else {
        d90Count++
        d90Total += balance
      }

      const existing = builderMap.get(r.builderId)
      if (existing) {
        existing.balance += balance
        existing.invoiceCount += 1
        existing.maxDaysPastDue = Math.max(existing.maxDaysPastDue, dpd)
        existing.score += balance * dpd
        if (r.lastActionAt) {
          const t = new Date(r.lastActionAt).getTime()
          if (!existing.lastActionAt || t > existing.lastActionAt.getTime()) {
            existing.lastActionAt = new Date(r.lastActionAt)
          }
        }
      } else {
        builderMap.set(r.builderId, {
          id: r.builderId,
          name: r.builderName || 'Unknown',
          contactName: r.contactName,
          email: r.email,
          phone: r.phone,
          balance,
          invoiceCount: 1,
          maxDaysPastDue: dpd,
          score: balance * dpd,
          lastActionAt: r.lastActionAt ? new Date(r.lastActionAt) : null,
        })
      }
    }

    const builders = [...builderMap.values()]
      .map((b) => ({
        id: b.id,
        name: b.name,
        contactName: b.contactName,
        email: b.email,
        phone: b.phone,
        balance: Math.round(b.balance * 100) / 100,
        invoiceCount: b.invoiceCount,
        maxDaysPastDue: b.maxDaysPastDue,
        score: Math.round(b.score),
        lastActionAt: b.lastActionAt ? b.lastActionAt.toISOString() : null,
        daysSinceLastContact: b.lastActionAt
          ? Math.floor((Date.now() - b.lastActionAt.getTime()) / (1000 * 60 * 60 * 24))
          : null,
      }))
      .sort((a, b) => b.score - a.score)

    const topExposure = builders.length > 0 ? builders[0] : null

    return NextResponse.json({
      asOf: new Date().toISOString(),
      topExposure,
      aging: {
        current: { count: curCount, total: Math.round(curTotal * 100) / 100 },
        d30: { count: d30Count, total: Math.round(d30Total * 100) / 100 },
        d60: { count: d60Count, total: Math.round(d60Total * 100) / 100 },
        d90: { count: d90Count, total: Math.round(d90Total * 100) / 100 },
      },
      builders,
      totalBuilders: builders.length,
      totalOutstanding:
        Math.round(
          (curTotal + d30Total + d60Total + d90Total) * 100,
        ) / 100,
    })
  } catch (error: any) {
    console.error('GET /api/ops/collections/exposure error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch exposure data', detail: error?.message || null },
      { status: 500 },
    )
  }
}
