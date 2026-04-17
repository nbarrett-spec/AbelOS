export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/manufacturing/bom-cleanup
 * Deduplicate BOM entries: keep the newest entry per parentId+componentId pair,
 * delete all older duplicates. Then create the unique index.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { step: string; status: string; detail?: string; error?: string }[] = []

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    // Step 1: Count total entries before
    const beforeCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count FROM "BomEntry"
    `)
    results.push({ step: 'Count before', status: 'OK', detail: `${beforeCount[0]?.count} total BOM entries` })

    // Step 2: Count duplicate groups
    const dupeGroups: any[] = await prisma.$queryRawUnsafe(`
      SELECT "parentId", "componentId", COUNT(*)::int as cnt
      FROM "BomEntry"
      GROUP BY "parentId", "componentId"
      HAVING COUNT(*) > 1
    `)
    results.push({ step: 'Find duplicates', status: 'OK', detail: `${dupeGroups.length} duplicate groups found` })

    // Step 3: Delete duplicates - keep the one with the latest createdAt per parentId+componentId
    const deleteResult = await prisma.$executeRawUnsafe(`
      DELETE FROM "BomEntry"
      WHERE id NOT IN (
        SELECT DISTINCT ON ("parentId", "componentId") id
        FROM "BomEntry"
        ORDER BY "parentId", "componentId", "createdAt" DESC
      )
    `)
    results.push({ step: 'Delete duplicates', status: 'OK', detail: `Deleted ${deleteResult} duplicate rows` })

    // Step 4: Count after
    const afterCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count FROM "BomEntry"
    `)
    results.push({ step: 'Count after', status: 'OK', detail: `${afterCount[0]?.count} BOM entries remaining` })

    // Step 5: Count unique parents
    const parentCount: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT "parentId")::int as count FROM "BomEntry"
    `)
    results.push({ step: 'Unique parents', status: 'OK', detail: `${parentCount[0]?.count} unique parent products with BOMs` })

    // Step 6: Now create the unique index
    try {
      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "BomEntry_parentId_componentId_key"
        ON "BomEntry" ("parentId", "componentId")
      `)
      results.push({ step: 'Create unique index', status: 'OK' })
    } catch (e: any) {
      results.push({ step: 'Create unique index', status: 'ERROR', error: e.message?.slice(0, 200) })
    }

    // Step 7: Show a sample BOM to verify
    const sample: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        pp.name as "parentName", pp.sku as "parentSku",
        cp.name as "componentName", cp.sku as "componentSku",
        be.quantity, be."componentType"
      FROM "BomEntry" be
      JOIN "Product" pp ON be."parentId" = pp.id
      JOIN "Product" cp ON be."componentId" = cp.id
      ORDER BY pp.name ASC
      LIMIT 8
    `)
    results.push({ step: 'Sample verification', status: 'OK', detail: JSON.stringify(sample) })

    return NextResponse.json({ success: true, results })
  } catch (error: any) {
    results.push({ step: 'Fatal error', status: 'ERROR', error: error.message })
    return NextResponse.json({ success: false, results }, { status: 500 })
  }
}
