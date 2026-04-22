export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'

// Door Identity API — Public + Staff
// GET: Fetch door info (public for homeowner view, enriched for staff)
// POST: Record events (staff only — QC, staging, delivery, install, bay moves)

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // Find door by serialNumber, nfcTagId, or id
    const doors: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d.*,
        p.name as "productName", p.sku as "productSku", p.category as "productCategory",
        p."doorSize", p.handing, p."coreType", p."panelStyle", p."jambSize",
        p.material, p."fireRating", p."hardwareFinish", p."imageUrl",
        b."bayNumber", b.zone as "bayZone", b.aisle as "bayAisle",
        wp.name as "warrantyName", wp.description as "warrantyDescription",
        wp."durationMonths" as "warrantyMonths", wp."coverageType",
        wp."careInstructions"
      FROM "DoorIdentity" d
      LEFT JOIN "Product" p ON d."productId" = p.id
      LEFT JOIN "WarehouseBay" b ON d."bayId" = b.id
      LEFT JOIN "WarrantyPolicy" wp ON d."warrantyPolicyId" = wp.id
      WHERE d."serialNumber" = $1 OR d."nfcTagId" = $1 OR d.id = $1
      LIMIT 1
    `, id)

    if (doors.length === 0) {
      return safeJson({ error: 'Door not found' }, { status: 404 })
    }

    const door = doors[0]

    // Get event history
    const events: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "eventType", "previousStatus", "newStatus",
        "performedByName", notes, metadata, "createdAt"
      FROM "DoorEvent"
      WHERE "doorId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 50
    `, door.id)

    // Check if requester is staff (has auth cookie)
    const isStaff = request.cookies.get('ops_auth')?.value ? true : false

    // Get BOM snapshot components
    let bomComponents: any[] = []
    if (door.bomSnapshot) {
      bomComponents = typeof door.bomSnapshot === 'string'
        ? JSON.parse(door.bomSnapshot)
        : door.bomSnapshot
    } else if (door.productId) {
      bomComponents = await prisma.$queryRawUnsafe(`
        SELECT be.quantity, cp.name, cp.sku, cp.category as "componentType"
        FROM "BomEntry" be
        JOIN "Product" cp ON be."componentId" = cp.id
        WHERE be."parentId" = $1
        ORDER BY cp.category
      `, door.productId)
    }

    // Service history
    const serviceRequests: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "issueType", description, status, "isWarrantyClaim",
        "warrantyApproved", "createdAt", "resolvedAt"
      FROM "ServiceRequest"
      WHERE "doorId" = $1
      ORDER BY "createdAt" DESC
    `, door.id)

    // Build response based on staff vs public
    const response: any = {
      id: door.id,
      serialNumber: door.serialNumber,
      status: door.status,
      product: {
        name: door.productName,
        sku: door.productSku,
        category: door.productCategory,
        doorSize: door.doorSize,
        handing: door.handing,
        coreType: door.coreType,
        panelStyle: door.panelStyle,
        jambSize: door.jambSize,
        material: door.material,
        fireRating: door.fireRating,
        hardwareFinish: door.hardwareFinish,
        imageUrl: door.imageUrl,
      },
      components: bomComponents,
      warranty: {
        policyName: door.warrantyName,
        description: door.warrantyDescription,
        durationMonths: door.warrantyMonths,
        coverageType: door.coverageType,
        careInstructions: door.careInstructions,
        startDate: door.warrantyStartDate,
        endDate: door.warrantyEndDate,
        isActive: door.warrantyEndDate ? new Date(door.warrantyEndDate) > new Date() : null,
      },
      dates: {
        manufactured: door.manufacturedAt,
        qcPassed: door.qcPassedAt,
        staged: door.stagedAt,
        delivered: door.deliveredAt,
        installed: door.installedAt,
      },
      installation: door.installAddress ? {
        address: door.installAddress,
        city: door.installCity,
        state: door.installState,
        zip: door.installZip,
        notes: door.installNotes,
      } : null,
      homeowner: door.homeownerName ? {
        name: door.homeownerName,
        email: door.homeownerEmail,
        phone: door.homeownerPhone,
      } : null,
      serviceRequests,
      events: isStaff ? events : events.filter(e =>
        ['INSTALLED', 'SERVICE_REQUESTED', 'SERVICE_COMPLETED', 'WARRANTY_CLAIM'].includes(e.eventType)
      ),
      isStaff,
    }

    // Staff gets extra operational data
    if (isStaff) {
      response.operational = {
        nfcTagId: door.nfcTagId,
        orderId: door.orderId,
        orderItemId: door.orderItemId,
        jobId: door.jobId,
        builderId: door.builderId,
        builderName: door.builderName,
        bay: door.bayId ? {
          id: door.bayId,
          number: door.bayNumber,
          zone: door.bayZone,
          aisle: door.bayAisle,
        } : null,
        manufacturedBy: door.manufacturedBy,
        qcPassedBy: door.qcPassedBy,
        qcNotes: door.qcNotes,
        deliveredBy: door.deliveredBy,
        deliveryNotes: door.deliveryNotes,
        installedBy: door.installedBy,
      }
    }

    return safeJson(response)
  } catch (error: any) {
    console.error('Door GET error:', error)
    return safeJson({ error: 'Failed to load door details' }, { status: 500 })
  }
}

// POST: Record lifecycle events
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    const body = await request.json()
    const { action, staffId, staffName, ...data } = body

    // Find door
    const doors: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, status, "bayId", "productId", "jobId"
      FROM "DoorIdentity"
      WHERE "serialNumber" = $1 OR "nfcTagId" = $1 OR id = $1
      LIMIT 1
    `, id)

    if (doors.length === 0) {
      return safeJson({ error: 'Door not found' }, { status: 404 })
    }

    const door = doors[0]
    const eventId = `de_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const now = new Date()

    switch (action) {
      case 'qc_pass': {
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'QC_PASSED', "qcPassedAt" = $1, "qcPassedBy" = $2, "qcNotes" = $3, "updatedAt" = $1
          WHERE id = $4
        `, now, staffName || staffId, data.notes || null, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'QC_PASSED', $3, 'QC_PASSED', $4, $5, $6, $7)
        `, eventId, door.id, door.status, staffId, staffName, data.notes || null, now)

        return safeJson({ success: true, newStatus: 'QC_PASSED' })
      }

      case 'qc_fail': {
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'QC_FAILED', "qcNotes" = $1, "updatedAt" = $2
          WHERE id = $3
        `, data.notes || 'Failed QC', now, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'QC_FAILED', $3, 'QC_FAILED', $4, $5, $6, $7)
        `, eventId, door.id, door.status, staffId, staffName, data.notes || null, now)

        return safeJson({ success: true, newStatus: 'QC_FAILED' })
      }

      case 'move_to_bay': {
        const { bayId } = data
        if (!bayId) return safeJson({ error: 'bayId required' }, { status: 400 })

        // Verify bay exists
        const bays: any[] = await prisma.$queryRawUnsafe(`
          SELECT id, "bayNumber" FROM "WarehouseBay" WHERE id = $1 OR "nfcTagId" = $1 OR "bayNumber" = $1 LIMIT 1
        `, bayId)

        if (bays.length === 0) return safeJson({ error: 'Bay not found' }, { status: 404 })
        const bay = bays[0]

        const moveId = `bm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

        // Record bay movement
        await prisma.$executeRawUnsafe(`
          INSERT INTO "BayMovement" (id, "doorId", "fromBayId", "toBayId", "movedBy", "movedByName", reason, "createdAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, moveId, door.id, door.bayId || null, bay.id, staffId, staffName, data.reason || null, now)

        // Update door location and status
        const newStatus = door.status === 'PRODUCTION' || door.status === 'QC_PASSED' ? 'STORED' : door.status
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET "bayId" = $1, status = $2, "updatedAt" = $3
          WHERE id = $4
        `, bay.id, newStatus, now, door.id)

        // Update bay counts
        if (door.bayId) {
          await prisma.$executeRawUnsafe(`
            UPDATE "WarehouseBay" SET "currentCount" = GREATEST("currentCount" - 1, 0) WHERE id = $1
          `, door.bayId)
        }
        await prisma.$executeRawUnsafe(`
          UPDATE "WarehouseBay" SET "currentCount" = "currentCount" + 1 WHERE id = $1
        `, bay.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", "bayId", notes, "createdAt")
          VALUES ($1, $2, 'BAY_MOVE', $3, $4, $5, $6, $7, $8, $9)
        `, eventId, door.id, door.status, newStatus, staffId, staffName, bay.id, `Moved to ${bay.bayNumber}`, now)

        return safeJson({ success: true, newStatus, bay: bay.bayNumber })
      }

      case 'stage': {
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'STAGED', "stagedAt" = $1, "stagedBy" = $2, "updatedAt" = $1
          WHERE id = $3
        `, now, staffName || staffId, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'STAGED', $3, 'STAGED', $4, $5, $6, $7)
        `, eventId, door.id, door.status, staffId, staffName, data.notes || null, now)

        return safeJson({ success: true, newStatus: 'STAGED' })
      }

      case 'deliver': {
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'DELIVERED', "deliveredAt" = $1, "deliveredBy" = $2, "deliveryNotes" = $3, "updatedAt" = $1
          WHERE id = $4
        `, now, staffName || staffId, data.notes || null, door.id)

        // Remove from bay
        if (door.bayId) {
          await prisma.$executeRawUnsafe(`
            UPDATE "WarehouseBay" SET "currentCount" = GREATEST("currentCount" - 1, 0) WHERE id = $1
          `, door.bayId)
          await prisma.$executeRawUnsafe(`
            UPDATE "DoorIdentity" SET "bayId" = NULL WHERE id = $1
          `, door.id)
        }

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'DELIVERED', $3, 'DELIVERED', $4, $5, $6, $7)
        `, eventId, door.id, door.status, staffId, staffName, data.notes || null, now)

        return safeJson({ success: true, newStatus: 'DELIVERED' })
      }

      case 'install': {
        const warrantyStart = now
        // Look up warranty policy for this product category
        let warrantyEnd = new Date(now)
        warrantyEnd.setMonth(warrantyEnd.getMonth() + 12) // default 12 months
        let policyId = 'wp_standard'

        if (door.productId) {
          const policies: any[] = await prisma.$queryRawUnsafe(`
            SELECT wp.id, wp."durationMonths"
            FROM "WarrantyPolicy" wp
            JOIN "Product" p ON wp."appliesToCategory" = p.category
            WHERE p.id = $1
            LIMIT 1
          `, door.productId)

          if (policies.length > 0) {
            policyId = policies[0].id
            warrantyEnd = new Date(now)
            warrantyEnd.setMonth(warrantyEnd.getMonth() + policies[0].durationMonths)
          }
        }

        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'INSTALLED', "installedAt" = $1, "installedBy" = $2,
            "installAddress" = $3, "installCity" = $4, "installState" = $5, "installZip" = $6,
            "installNotes" = $7, "homeownerName" = $8, "homeownerEmail" = $9, "homeownerPhone" = $10,
            "warrantyPolicyId" = $11, "warrantyStartDate" = $12, "warrantyEndDate" = $13,
            "updatedAt" = $1
          WHERE id = $14
        `, now, staffName || staffId,
          data.address || null, data.city || null, data.state || 'TX', data.zip || null,
          data.notes || null, data.homeownerName || null, data.homeownerEmail || null, data.homeownerPhone || null,
          policyId, warrantyStart, warrantyEnd, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'INSTALLED', $3, 'INSTALLED', $4, $5, $6, $7)
        `, eventId, door.id, door.status, staffId, staffName, `Installed at ${data.address || 'address pending'}`, now)

        return safeJson({ success: true, newStatus: 'INSTALLED', warrantyEnd })
      }

      case 'reassign_order': {
        const { newOrderId, reason } = data
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity" SET "orderId" = $1, "updatedAt" = $2 WHERE id = $3
        `, newOrderId, now, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'REASSIGNED', $3, $3, $4, $5, $6, $7)
        `, eventId, door.id, door.status, staffId, staffName, reason || `Reassigned to order ${newOrderId}`, now)

        return safeJson({ success: true, newOrderId })
      }

      case 'request_service': {
        // This can be called by homeowners (no staff auth needed)
        const srId = `sr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

        await prisma.$executeRawUnsafe(`
          INSERT INTO "ServiceRequest" (id, "doorId", "requestedByName", "requestedByEmail", "requestedByPhone", "issueType", description, "isWarrantyClaim", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        `, srId, door.id,
          data.name || null, data.email || null, data.phone || null,
          data.issueType || 'GENERAL', data.description || '',
          data.isWarrantyClaim || false, now)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", notes, "createdAt")
          VALUES ($1, $2, 'SERVICE_REQUESTED', $3, $3, $4, $5)
        `, eventId, door.id, door.status, `Service request: ${data.issueType || 'GENERAL'}`, now)

        return safeJson({ success: true, serviceRequestId: srId })
      }

      default:
        return safeJson({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error: any) {
    console.error('Door POST error:', error)
    return safeJson({ error: 'Failed to process door action' }, { status: 500 })
  }
}
