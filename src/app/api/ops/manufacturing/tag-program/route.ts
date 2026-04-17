export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// NFC Tag Programming — Production Line Endpoint
// Creates DoorIdentity records from order items, generates serial numbers,
// and optionally bulk-registers NFC tag URLs.
// ──────────────────────────────────────────────────────────────────────────

function generateSerial(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ABL-${ts}-${rand}`
}

function generateId(): string {
  return `door_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// GET: List doors for a job/order, or search by serial/nfc
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')
    const orderId = searchParams.get('orderId')
    const search = searchParams.get('search')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '100')

    let whereClause = 'WHERE 1=1'
    const params: any[] = []
    let paramIdx = 1

    if (jobId) {
      whereClause += ` AND d."jobId" = $${paramIdx++}`
      params.push(jobId)
    }
    if (orderId) {
      // Delivery doesn't have orderId; filter through Job.orderId
      whereClause += ` AND j."orderId" = $${paramIdx++}`
      params.push(orderId)
    }
    if (status) {
      whereClause += ` AND d.status::text = $${paramIdx++}`
      params.push(status)
    }
    if (search) {
      whereClause += ` AND (d."serialNumber" ILIKE $${paramIdx} OR d."nfcTagId" ILIKE $${paramIdx} OR d."homeownerName" ILIKE $${paramIdx})`
      params.push(`%${search}%`)
      paramIdx++
    }

    const doors: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d.id, d."serialNumber", d."nfcTagId", d."nfcUrl",
        d.status::text as status, j."orderId", d."jobId",
        d."bayId", d."manufacturedAt", d."qcPassedAt",
        d."stagedAt", d."deliveredAt", d."installedAt",
        d."homeownerName", d."installAddress",
        p.name as "productName", p.sku, p.category,
        b."bayNumber"
      FROM "DoorIdentity" d
      LEFT JOIN "Job" j ON d."jobId" = j.id
      LEFT JOIN "Product" p ON d."productId" = p.id
      LEFT JOIN "WarehouseBay" b ON d."bayId" = b.id
      ${whereClause}
      ORDER BY d."createdAt" DESC
      LIMIT $${paramIdx}
    `, ...params, limit)

    // Summary counts
    const counts: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN status::text = 'PRODUCTION' THEN 1 END)::int as "inProduction",
        COUNT(CASE WHEN status::text = 'QC_PASSED' THEN 1 END)::int as "qcPassed",
        COUNT(CASE WHEN status::text = 'STORED' THEN 1 END)::int as stored,
        COUNT(CASE WHEN status::text = 'STAGED' THEN 1 END)::int as staged,
        COUNT(CASE WHEN status::text = 'DELIVERED' THEN 1 END)::int as delivered,
        COUNT(CASE WHEN status::text = 'INSTALLED' THEN 1 END)::int as installed
      FROM "DoorIdentity"
      ${jobId ? 'WHERE "jobId" = $1' : orderId ? 'WHERE "orderId" = $1' : ''}
    `, ...(jobId ? [jobId] : orderId ? [orderId] : []))

    return safeJson({ doors, summary: counts[0] || {} })
  } catch (error: any) {
    console.error('Tag program GET error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}

// POST: Create door identities from order/job items, or register NFC tags
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { action } = body

    // ─── Action: create_from_order ───
    // Creates DoorIdentity records for all items in an order
    if (action === 'create_from_order') {
      const { orderId, jobId, manufacturedBy } = body
      if (!orderId) return safeJson({ error: 'orderId required' }, { status: 400 })

      // Get order items with product info
      const items: any[] = await prisma.$queryRawUnsafe(`
        SELECT oi.id as "orderItemId", oi."productId", oi.quantity,
          p.name as "productName", p.sku, p.category
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productId" = p.id
        WHERE oi."orderId" = $1
      `, orderId)

      if (items.length === 0) {
        return safeJson({ error: 'No order items found' }, { status: 404 })
      }

      let created = 0
      const serials: string[] = []

      for (const item of items) {
        const qty = item.quantity || 1
        for (let i = 0; i < qty; i++) {
          const id = generateId()
          const serial = generateSerial()
          const nfcUrl = `/door/${serial}`

          await prisma.$executeRawUnsafe(`
            INSERT INTO "DoorIdentity" (
              id, "serialNumber", "nfcUrl", status, "productId",
              "orderId", "orderItemId", "jobId",
              "manufacturedAt", "manufacturedBy",
              "createdAt", "updatedAt"
            ) VALUES (
              $1, $2, $3, 'PRODUCTION', $4,
              $5, $6, $7,
              NOW(), $8,
              NOW(), NOW()
            )
          `, id, serial, nfcUrl, item.productId,
            orderId, item.orderItemId, jobId || null,
            manufacturedBy || null)

          // Create initial event
          const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(`
            INSERT INTO "DoorEvent" (id, "doorId", "eventType", "newStatus", "performedBy", notes, "createdAt")
            VALUES ($1, $2, 'CREATED', 'PRODUCTION', $3, $4, NOW())
          `, eventId, id, manufacturedBy || null,
            `Door registered from order ${orderId}, product ${item.productName} (${item.sku})`)

          serials.push(serial)
          created++
        }
      }

      return safeJson({
        success: true,
        created,
        serials,
        message: `Created ${created} door identities from ${items.length} order items`
      })
    }

    // ─── Action: create_single ───
    // Register a single door (manual tag programming)
    if (action === 'create_single') {
      const { productId, orderId, jobId, nfcTagId, manufacturedBy } = body
      if (!productId) return safeJson({ error: 'productId required' }, { status: 400 })

      const id = generateId()
      const serial = generateSerial()
      const nfcUrl = `/door/${serial}`

      await prisma.$executeRawUnsafe(`
        INSERT INTO "DoorIdentity" (
          id, "serialNumber", "nfcTagId", "nfcUrl", status,
          "productId", "orderId", "jobId",
          "manufacturedAt", "manufacturedBy",
          "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, 'PRODUCTION', $5, $6, $7,
          NOW(), $8, NOW(), NOW()
        )
      `, id, serial, nfcTagId || null, nfcUrl,
        productId, orderId || null, jobId || null,
        manufacturedBy || null)

      const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(`
        INSERT INTO "DoorEvent" (id, "doorId", "eventType", "newStatus", "performedBy", notes, "createdAt")
        VALUES ($1, $2, 'CREATED', 'PRODUCTION', $3, 'Manual tag registration', NOW())
      `, eventId, id, manufacturedBy || null)

      return safeJson({ success: true, doorId: id, serialNumber: serial, nfcUrl })
    }

    // ─── Action: link_nfc ───
    // Associate an NFC tag ID with an existing door
    if (action === 'link_nfc') {
      const { doorId, serialNumber, nfcTagId } = body
      if (!nfcTagId) return safeJson({ error: 'nfcTagId required' }, { status: 400 })
      if (!doorId && !serialNumber) return safeJson({ error: 'doorId or serialNumber required' }, { status: 400 })

      const lookup = doorId
        ? `id = $1`
        : `"serialNumber" = $1`
      const lookupVal = doorId || serialNumber

      await prisma.$executeRawUnsafe(`
        UPDATE "DoorIdentity"
        SET "nfcTagId" = $2, "updatedAt" = NOW()
        WHERE ${lookup}
      `, lookupVal, nfcTagId)

      return safeJson({ success: true, message: `NFC tag ${nfcTagId} linked` })
    }

    // ─── Action: bulk_link_nfc ───
    // Associate NFC tags with multiple doors at once
    if (action === 'bulk_link_nfc') {
      const { mappings } = body  // [{ serialNumber, nfcTagId }]
      if (!mappings?.length) return safeJson({ error: 'mappings array required' }, { status: 400 })

      let linked = 0
      for (const m of mappings) {
        try {
          await prisma.$executeRawUnsafe(`
            UPDATE "DoorIdentity"
            SET "nfcTagId" = $1, "updatedAt" = NOW()
            WHERE "serialNumber" = $2
          `, m.nfcTagId, m.serialNumber)
          linked++
        } catch (e: any) { console.warn('[Tag Program] Failed to link NFC tag:', e?.message) }
      }

      return safeJson({ success: true, linked, total: mappings.length })
    }

    // ─── Action: complete_job ───
    // Auto-transition all doors on a job to INSTALLED when job is marked complete
    if (action === 'complete_job') {
      const { jobId, installedBy, installAddress, installCity, installState, installZip,
              homeownerName, homeownerEmail, homeownerPhone } = body
      if (!jobId) return safeJson({ error: 'jobId required' }, { status: 400 })

      // Get all non-installed doors for this job
      const doors: any[] = await prisma.$queryRawUnsafe(`
        SELECT d.id, d."serialNumber", d.status::text as status, d."productId",
          p.category
        FROM "DoorIdentity" d
        LEFT JOIN "Product" p ON d."productId" = p.id
        WHERE d."jobId" = $1 AND d.status::text != 'INSTALLED'
      `, jobId)

      let transitioned = 0
      for (const door of doors) {
        // Find best warranty policy for this category
        const policies: any[] = await prisma.$queryRawUnsafe(`
          SELECT id, "durationMonths" FROM "WarrantyPolicy"
          WHERE "appliesToCategory" = $1
          UNION ALL
          SELECT id, "durationMonths" FROM "WarrantyPolicy"
          WHERE "isDefault" = true
          LIMIT 1
        `, door.category || '')

        const policy = policies[0]
        const warrantyMonths = policy?.durationMonths || 12

        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'INSTALLED',
              "installedAt" = NOW(),
              "installedBy" = $2,
              "installAddress" = $3,
              "installCity" = $4,
              "installState" = COALESCE($5, 'TX'),
              "installZip" = $6,
              "homeownerName" = $7,
              "homeownerEmail" = $8,
              "homeownerPhone" = $9,
              "warrantyPolicyId" = $10,
              "warrantyStartDate" = NOW(),
              "warrantyEndDate" = NOW() + ($11 || ' months')::interval,
              "updatedAt" = NOW()
          WHERE id = $1
        `, door.id, installedBy || null,
          installAddress || null, installCity || null,
          installState || 'TX', installZip || null,
          homeownerName || null, homeownerEmail || null,
          homeownerPhone || null, policy?.id || 'wp_standard',
          String(warrantyMonths))

        // Create event
        const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus",
            "performedBy", notes, "createdAt")
          VALUES ($1, $2, 'JOB_COMPLETE', $3, 'INSTALLED', $4,
            $5, NOW())
        `, eventId, door.id, door.status, installedBy || null,
          `Auto-transitioned via job completion (Job: ${jobId})`)

        transitioned++
      }

      return safeJson({
        success: true,
        transitioned,
        total: doors.length,
        message: `${transitioned} doors transitioned to INSTALLED with warranty activated`
      })
    }

    return safeJson({ error: 'Unknown action. Use: create_from_order, create_single, link_nfc, bulk_link_nfc, complete_job' }, { status: 400 })
  } catch (error: any) {
    console.error('Tag program POST error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}
