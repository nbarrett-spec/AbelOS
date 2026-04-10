export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// Warehouse Bay Management API

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const zone = searchParams.get('zone')
    const bayId = searchParams.get('bayId')

    // Single bay with contents
    if (bayId) {
      const bay: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "WarehouseBay" WHERE id = $1 OR "bayNumber" = $1 OR "nfcTagId" = $1 LIMIT 1
      `, bayId)

      if (bay.length === 0) return safeJson({ error: 'Bay not found' }, { status: 404 })

      const doors: any[] = await prisma.$queryRawUnsafe(`
        SELECT d.id, d."serialNumber", d.status, j."orderId",
          p.name as "productName", p.sku, p.category
        FROM "DoorIdentity" d
        LEFT JOIN "Job" j ON d."jobId" = j.id
        LEFT JOIN "Product" p ON d."productId" = p.id
        WHERE d."bayId" = $1
        ORDER BY d."createdAt" DESC
      `, bay[0].id)

      return safeJson({ bay: bay[0], doors })
    }

    // All bays with summary
    const whereClause = zone ? `WHERE b.zone = '${zone}'` : ''
    const bays: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        b.*,
        COUNT(d.id)::int as "doorCount",
        COUNT(CASE WHEN d.status = 'QC_PASSED' THEN 1 END)::int as "readyCount",
        COUNT(CASE WHEN d.status = 'STAGED' THEN 1 END)::int as "stagedCount"
      FROM "WarehouseBay" b
      LEFT JOIN "DoorIdentity" d ON d."bayId" = b.id
      ${whereClause}
      GROUP BY b.id
      ORDER BY b.zone, b."bayNumber"
    `)

    const zones: any[] = await prisma.$queryRawUnsafe(`
      SELECT zone, COUNT(*)::int as "bayCount",
        SUM("currentCount")::int as "totalDoors",
        SUM(capacity)::int as "totalCapacity"
      FROM "WarehouseBay"
      WHERE active = true
      GROUP BY zone ORDER BY zone
    `)

    return safeJson({ bays, zones })
  } catch (error: any) {
    console.error('Bays GET error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}

// POST: Create or bulk-create bays
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'bulk_create') {
      // Create a range of bays: { zone, prefix, startNum, endNum, capacity }
      const { zone, prefix, startNum, endNum, capacity, aisle } = body
      if (!zone || !prefix || !startNum || !endNum) {
        return safeJson({ error: 'zone, prefix, startNum, endNum required' }, { status: 400 })
      }

      let created = 0
      for (let i = startNum; i <= endNum; i++) {
        const bayNumber = `${prefix}${String(i).padStart(3, '0')}`
        const id = `bay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}_${i}`
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "WarehouseBay" (id, "bayNumber", zone, aisle, capacity, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT ("bayNumber") DO NOTHING
          `, id, bayNumber, zone, aisle || null, capacity || 20)
          created++
        } catch (e: any) { console.warn('[Warehouse Bays] Failed to create bay in bulk:', e?.message) }
      }
      return safeJson({ success: true, created })
    }

    // Single bay creation
    const { bayNumber, zone, aisle, position, capacity, nfcTagId, description } = body
    if (!bayNumber) return safeJson({ error: 'bayNumber required' }, { status: 400 })

    const id = `bay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(`
      INSERT INTO "WarehouseBay" (id, "bayNumber", zone, aisle, "position", "nfcTagId", capacity, description, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    `, id, bayNumber, zone || 'MAIN', aisle || null, position || null, nfcTagId || null, capacity || 20, description || null)

    return safeJson({ success: true, bayId: id, bayNumber })
  } catch (error: any) {
    console.error('Bays POST error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}
