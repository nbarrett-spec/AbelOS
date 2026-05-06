/**
 * scripts/_tmp-mock-route-p1-inbox.ts
 *
 * One-shot: writes 5 HIGH-priority InboxItem rows for the top P1 mock routes
 * surfaced by AEGIS-MOCK-ROUTE-AUDIT.md. Source tag: MOCK_ROUTE_P1.
 *
 * Deterministic IDs so re-runs upsert (no dupes).
 *
 * Usage:
 *   npx tsx scripts/_tmp-mock-route-p1-inbox.ts              # DRY-RUN (default)
 *   npx tsx scripts/_tmp-mock-route-p1-inbox.ts --commit     # write to DB
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'MOCK_ROUTE_P1'

interface Item {
  key: string
  title: string
  description: string
  route: string
}

const ITEMS: Item[] = [
  {
    key: 'outreach-engine-fake-send',
    title: 'Outreach engine marks emails SENT without sending',
    description:
      'src/app/api/ops/sales/outreach-engine/route.ts process_queue flips AUTO-mode enrollment steps to SENT without invoking any email provider. 8 UI call-sites on /ops/sales/outreach show green "sent" checkmarks for messages that never left the building. Wire to Resend using the existing sendQuoteReadyEmail pattern.',
    route: 'src/app/api/ops/sales/outreach-engine/route.ts',
  },
  {
    key: 'vendor-scoring-hardcoded-costs',
    title: 'Vendor scorecards include hardcoded cost/comm grades',
    description:
      'src/app/api/ops/procurement-intelligence/vendor-scoring/route.ts POST sets costScore=75 and communicationScore=80 as literal constants that feed the composite overallScore (35% of the grade). Vendor selection for PO routing is partly fictional. Replace with real cost-trend from VendorPerformanceLog and comms signal from CommunicationLog.',
    route: 'src/app/api/ops/procurement-intelligence/vendor-scoring/route.ts',
  },
  {
    key: 'financial-snapshot-cash-zero',
    title: 'Financial snapshots treat cashOnHand as $0',
    description:
      'src/app/api/cron/financial-snapshot/route.ts sets cashOnHand = 0 with a TODO to integrate with actual cash account. DSO, currentRatio, and netCashPosition are understated in every snapshot. These numbers feed the Hancock Whitney pitch and the ops finance dashboards. Pull from QB cash account once QB Sync Queue decision lands.',
    route: 'src/app/api/cron/financial-snapshot/route.ts',
  },
  {
    key: 'delivery-cost-attribution-placeholder',
    title: 'Delivery cost-attribution report is time-based only',
    description:
      'src/app/api/ops/delivery/optimize/route.ts getCostAttribution() has a "placeholder - will be enhanced with actual fuel/labor data" comment. Currently returns avgHoursPerDelivery by builder — no dollar cost. Builder-profitability views are therefore misleading. Add fuel and labor cost rollup from fleet data.',
    route: 'src/app/api/ops/delivery/optimize/route.ts',
  },
  {
    key: 'admin-data-quality-no-role-check',
    title: 'Admin data-quality run endpoint lacks role check',
    description:
      'src/app/api/ops/admin/data-quality/run/route.ts has a "TODO: add session/role check to verify the caller is an admin" — it only validates CRON_SECRET server-side. Any authenticated user hitting the admin page can trigger cron runs. Add parseRoles + hasPermission gate.',
    route: 'src/app/api/ops/admin/data-quality/run/route.ts',
  },
]

function deterministicId(key: string): string {
  return (
    'inb_mrp1_' +
    crypto.createHash('sha256').update(`${SOURCE_TAG}:${key}`).digest('hex').slice(0, 16)
  )
}

async function main() {
  const prisma = new PrismaClient()
  try {
    console.log(
      `[mock-route-p1-inbox] ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'} — writing ${ITEMS.length} HIGH InboxItems (source=${SOURCE_TAG})`
    )
    let created = 0
    let updated = 0
    for (const item of ITEMS) {
      const id = deterministicId(item.key)
      if (DRY_RUN) {
        console.log(`  would upsert ${id} — ${item.title}`)
        continue
      }
      const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "InboxItem" WHERE id = $1 LIMIT 1`,
        id
      )
      if (existing.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem"
           SET title = $2, description = $3, priority = 'HIGH',
               "entityType" = 'APIRoute', "entityId" = $4,
               "actionData" = $5::jsonb, "updatedAt" = NOW()
           WHERE id = $1`,
          id,
          item.title,
          item.description,
          item.route,
          JSON.stringify({ source: SOURCE_TAG, key: item.key, route: item.route })
        )
        updated++
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InboxItem"
             (id, type, source, title, description, priority,
              "entityType", "entityId", "actionData", status,
              "createdAt", "updatedAt")
           VALUES ($1, 'TECH_DEBT', $2, $3, $4, 'HIGH',
                   'APIRoute', $5, $6::jsonb, 'PENDING',
                   NOW(), NOW())`,
          id,
          SOURCE_TAG,
          item.title,
          item.description,
          item.route,
          JSON.stringify({ source: SOURCE_TAG, key: item.key, route: item.route })
        )
        created++
      }
    }
    console.log(`[mock-route-p1-inbox] done — created=${created} updated=${updated}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
