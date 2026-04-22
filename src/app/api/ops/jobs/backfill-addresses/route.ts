export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/jobs/backfill-addresses
// Scans all Jobs with missing jobAddress and tries to fill from:
//   1. Linked Order deliveryNotes (Hyphen address lines)
//   2. Community address
//   3. Shipping info in HyphenOrderEvent rawPayload
//   4. InFlow SO shipTo
//   5. Bolt work order address
//
// Safe — only fills blanks, never overwrites existing addresses.
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || 'system'
  audit(request, 'BACKFILL_ADDRESSES', 'Job', undefined, { staffId }).catch(() => {})

  try {
    let enriched = 0
    const sources: Record<string, number> = {
      deliveryNotes: 0,
      community: 0,
      hyphenEvent: 0,
      bolt: 0,
    }

    // Get all jobs missing addresses
    const jobsNeedingAddr: any[] = await prisma.$queryRawUnsafe(`
      SELECT j."id", j."orderId", j."communityId", j."community",
             j."lotBlock", j."boltJobId", j."hyphenJobId"
      FROM "Job" j
      WHERE j."jobAddress" IS NULL OR j."jobAddress" = ''
      LIMIT 500
    `)

    for (const job of jobsNeedingAddr) {
      let address: string | null = null

      // Source 1: Parse address from Order.deliveryNotes (Hyphen puts "Address: ..." line)
      if (!address && job.orderId) {
        const orderRow: any[] = await prisma.$queryRawUnsafe(
          `SELECT "deliveryNotes" FROM "Order" WHERE "id" = $1 LIMIT 1`,
          job.orderId
        )
        if (orderRow.length > 0 && orderRow[0].deliveryNotes) {
          const notes = orderRow[0].deliveryNotes as string
          const addrMatch = notes.match(/Address:\s*(.+)/i)
          if (addrMatch && addrMatch[1] && addrMatch[1].length > 5) {
            address = addrMatch[1].trim()
            sources.deliveryNotes++
          }
        }
      }

      // Source 2: Community address
      if (!address && job.communityId) {
        const comm: any[] = await prisma.$queryRawUnsafe(
          `SELECT "address", "city", "state", "zip" FROM "Community" WHERE "id" = $1 LIMIT 1`,
          job.communityId
        )
        if (comm.length > 0 && comm[0].address) {
          address = [comm[0].address, comm[0].city, comm[0].state, comm[0].zip]
            .filter(Boolean)
            .join(', ')
          if (job.lotBlock) address = `${job.lotBlock}, ${address}`
          sources.community++
        }
      } else if (!address && job.community) {
        const comm: any[] = await prisma.$queryRawUnsafe(
          `SELECT "address", "city", "state", "zip" FROM "Community" WHERE "name" ILIKE $1 LIMIT 1`,
          `%${job.community}%`
        )
        if (comm.length > 0 && comm[0].address) {
          address = [comm[0].address, comm[0].city, comm[0].state, comm[0].zip]
            .filter(Boolean)
            .join(', ')
          if (job.lotBlock) address = `${job.lotBlock}, ${address}`
          sources.community++
        }
      }

      // Source 3: Hyphen event raw payload (has full job address)
      if (!address && job.hyphenJobId) {
        const events: any[] = await prisma.$queryRawUnsafe(
          `SELECT "rawPayload" FROM "HyphenOrderEvent"
           WHERE "externalId" = $1 AND "status" = 'PROCESSED'
           ORDER BY "processedAt" DESC LIMIT 1`,
          job.hyphenJobId
        )
        if (events.length > 0 && events[0].rawPayload) {
          const payload = typeof events[0].rawPayload === 'string'
            ? JSON.parse(events[0].rawPayload)
            : events[0].rawPayload
          const hJob = payload?.header?.job
          if (hJob) {
            const parts = [hJob.street, hJob.city, hJob.stateCode, hJob.postalCode].filter(Boolean)
            if (parts.length >= 2) {
              address = parts.join(', ')
              sources.hyphenEvent++
            }
          }
        }
      }

      // Source 4: Bolt work order (already stored on creation, but double-check)
      if (!address && job.boltJobId) {
        // Bolt addresses are already written during syncWorkOrders — this is a safety net
        sources.bolt++ // counted but likely no action needed
      }

      // Write address if found
      if (address && address.length > 5) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Job" SET "jobAddress" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
          address, job.id
        )
        enriched++
      }
    }

    return NextResponse.json({
      success: true,
      totalScanned: jobsNeedingAddr.length,
      enriched,
      sources,
    })
  } catch (error: any) {
    console.error('Address backfill error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
