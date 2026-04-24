export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import type { StaffRole } from '@/lib/permissions'
import { parseRoles } from '@/lib/permissions'
import { logger } from '@/lib/logger'

// Door Identity API — Public + Staff
// GET: Fetch door info (public for homeowner view, enriched for staff)
// POST: Record events
//   - `request_service` is PUBLIC (homeowner-facing — keep open).
//   - All other 7 mutation branches are STAFF-ONLY, gated by cookie auth.
//     The previous implementation read `staffId`/`staffName` from the request
//     body and trusted the values, which let anyone with the URL mark a door
//     INSTALLED, REASSIGNED, etc., and forge the staff name on the audit
//     trail. Audit A#1 — see docs/AUDIT-A-MUTATION-SAFETY.md.

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
    const isStaff = request.cookies.get('abel_staff_session')?.value
      || request.cookies.get('ops_auth')?.value
      ? true
      : false

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

// ──────────────────────────────────────────────────────────────────────────
// Allowed roles per action (gate) — broadest baseline first, narrower per
// branch as needed. ADMIN is implicitly allowed by requireStaffAuth.
// ──────────────────────────────────────────────────────────────────────────
const STAFF_ACTIONS = new Set([
  'qc_pass', 'qc_fail', 'move_to_bay', 'stage', 'deliver', 'install', 'reassign_order',
])

const ROLES_BY_ACTION: Record<string, StaffRole[]> = {
  qc_pass:        ['QC_INSPECTOR', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'MANAGER', 'ADMIN'],
  qc_fail:        ['QC_INSPECTOR', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'MANAGER', 'ADMIN'],
  move_to_bay:    ['WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'MANAGER', 'ADMIN'],
  stage:          ['WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'MANAGER', 'ADMIN'],
  deliver:        ['DRIVER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'MANAGER', 'ADMIN'],
  install:        ['INSTALLER', 'WAREHOUSE_LEAD', 'MANAGER', 'ADMIN'],
  reassign_order: ['MANAGER', 'PROJECT_MANAGER', 'ADMIN'],
}

// ──────────────────────────────────────────────────────────────────────────
// Input validation — zod schemas per action. Body shape is validated AFTER
// auth so we don't leak action-vocabulary to anonymous callers.
// ──────────────────────────────────────────────────────────────────────────
const optStr = (max = 1000) => z.string().max(max).optional().nullable()

const ActionSchemas = {
  qc_pass:     z.object({ action: z.literal('qc_pass'),     notes: optStr(2000) }),
  qc_fail:     z.object({ action: z.literal('qc_fail'),     notes: optStr(2000) }),
  move_to_bay: z.object({ action: z.literal('move_to_bay'), bayId: z.string().min(1).max(200), reason: optStr(500) }),
  stage:       z.object({ action: z.literal('stage'),       notes: optStr(2000) }),
  deliver:     z.object({ action: z.literal('deliver'),     notes: optStr(2000) }),
  install: z.object({
    action: z.literal('install'),
    address: optStr(500),
    city: optStr(120),
    state: optStr(2),
    zip: optStr(20),
    notes: optStr(2000),
    homeownerName: optStr(200),
    homeownerEmail: optStr(320),
    homeownerPhone: optStr(40),
  }),
  reassign_order: z.object({
    action: z.literal('reassign_order'),
    newOrderId: z.string().min(1).max(200),
    reason: optStr(500),
  }),
  request_service: z.object({
    action: z.literal('request_service'),
    name: optStr(200),
    email: optStr(320),
    phone: optStr(40),
    issueType: optStr(80),
    description: z.string().min(1).max(4000),
    isWarrantyClaim: z.boolean().optional(),
  }),
} as const

type Action = keyof typeof ActionSchemas

// POST: Record lifecycle events
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params

    // ── 1. Parse body (no trust on staffId/staffName) ──
    let raw: any
    try {
      raw = await request.json()
    } catch {
      return safeJson({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!raw || typeof raw !== 'object') {
      return safeJson({ error: 'Body must be a JSON object' }, { status: 400 })
    }

    const action = typeof raw.action === 'string' ? raw.action : ''
    if (!action) {
      return safeJson({ error: 'action is required' }, { status: 400 })
    }
    if (!(action in ActionSchemas)) {
      return safeJson({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // ── 2. Auth gate — `request_service` is public (homeowner). All other
    //       branches require a valid staff session AND an allowed role. ──
    let staffId = 'public'
    let staffName: string | undefined
    let staffRole: string | undefined

    if (STAFF_ACTIONS.has(action)) {
      const allowedRoles = ROLES_BY_ACTION[action] || []
      const auth = await requireStaffAuth(request, { allowedRoles })
      if (auth.error) return auth.error
      const session = auth.session
      // Belt-and-suspenders: if cookie-fallback path was used, requireStaffAuth's
      // path-based canAccessAPI() check is skipped, but allowedRoles is enforced.
      // Re-verify the session role intersects the allowed set so this branch can
      // never run without an allowed role even if the auth helper changes.
      const roles = parseRoles(session.roles || session.role)
      const hasAdmin = roles.includes('ADMIN')
      const hasAllowed = roles.some(r => allowedRoles.includes(r as StaffRole))
      if (!hasAdmin && !hasAllowed) {
        return safeJson({ error: 'Insufficient permissions for this action' }, { status: 403 })
      }
      staffId = session.staffId
      staffName = `${session.firstName || ''} ${session.lastName || ''}`.trim()
        || request.headers.get('x-staff-firstname')
        || session.email
        || 'Staff'
      staffRole = session.role
    }

    // ── 3. Strict body validation per-action (post-auth) ──
    const schema = ActionSchemas[action as Action]
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return safeJson(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const data = parsed.data as any

    // ── 4. Find door ──
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

    // Helper: insert a DoorEvent row using the AUTHENTICATED staff identity.
    // For the public homeowner path we leave performedBy/performedByName NULL
    // (matches the original `request_service` behavior).
    const performedBy = STAFF_ACTIONS.has(action) ? staffId : null
    const performedByName = STAFF_ACTIONS.has(action) ? (staffName || null) : null

    switch (action as Action) {
      case 'qc_pass': {
        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity"
          SET status = 'QC_PASSED', "qcPassedAt" = $1, "qcPassedBy" = $2, "qcNotes" = $3, "updatedAt" = $1
          WHERE id = $4
        `, now, staffName || staffId, data.notes || null, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'QC_PASSED', $3, 'QC_PASSED', $4, $5, $6, $7)
        `, eventId, door.id, door.status, performedBy, performedByName, data.notes || null, now)

        await audit(request, 'DOOR_QC_PASS', 'DoorIdentity', door.id, {
          previousStatus: door.status,
          newStatus: 'QC_PASSED',
          notes: data.notes || null,
          eventId,
          staffRole,
        }, 'INFO').catch(() => {})

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
        `, eventId, door.id, door.status, performedBy, performedByName, data.notes || null, now)

        await audit(request, 'DOOR_QC_FAIL', 'DoorIdentity', door.id, {
          previousStatus: door.status,
          newStatus: 'QC_FAILED',
          notes: data.notes || null,
          eventId,
          staffRole,
        }, 'WARN').catch(() => {})

        return safeJson({ success: true, newStatus: 'QC_FAILED' })
      }

      case 'move_to_bay': {
        const { bayId } = data

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
        `, moveId, door.id, door.bayId || null, bay.id, performedBy, performedByName, data.reason || null, now)

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
        `, eventId, door.id, door.status, newStatus, performedBy, performedByName, bay.id, `Moved to ${bay.bayNumber}`, now)

        await audit(request, 'DOOR_BAY_MOVE', 'DoorIdentity', door.id, {
          previousStatus: door.status,
          newStatus,
          fromBayId: door.bayId || null,
          toBayId: bay.id,
          bayNumber: bay.bayNumber,
          reason: data.reason || null,
          moveId,
          eventId,
          staffRole,
        }, 'INFO').catch(() => {})

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
        `, eventId, door.id, door.status, performedBy, performedByName, data.notes || null, now)

        await audit(request, 'DOOR_STAGE', 'DoorIdentity', door.id, {
          previousStatus: door.status,
          newStatus: 'STAGED',
          notes: data.notes || null,
          eventId,
          staffRole,
        }, 'INFO').catch(() => {})

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
        `, eventId, door.id, door.status, performedBy, performedByName, data.notes || null, now)

        await audit(request, 'DOOR_DELIVER', 'DoorIdentity', door.id, {
          previousStatus: door.status,
          newStatus: 'DELIVERED',
          notes: data.notes || null,
          fromBayId: door.bayId || null,
          eventId,
          staffRole,
        }, 'INFO').catch(() => {})

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
        `, eventId, door.id, door.status, performedBy, performedByName, `Installed at ${data.address || 'address pending'}`, now)

        await audit(request, 'DOOR_INSTALL', 'DoorIdentity', door.id, {
          previousStatus: door.status,
          newStatus: 'INSTALLED',
          warrantyPolicyId: policyId,
          warrantyStart,
          warrantyEnd,
          installAddress: data.address || null,
          installCity: data.city || null,
          installState: data.state || 'TX',
          installZip: data.zip || null,
          homeownerName: data.homeownerName || null,
          eventId,
          staffRole,
        }, 'WARN').catch(() => {})

        return safeJson({ success: true, newStatus: 'INSTALLED', warrantyEnd })
      }

      case 'reassign_order': {
        const { newOrderId, reason } = data
        const previousOrderId = (door as any).orderId || null

        await prisma.$executeRawUnsafe(`
          UPDATE "DoorIdentity" SET "orderId" = $1, "updatedAt" = $2 WHERE id = $3
        `, newOrderId, now, door.id)

        await prisma.$executeRawUnsafe(`
          INSERT INTO "DoorEvent" (id, "doorId", "eventType", "previousStatus", "newStatus", "performedBy", "performedByName", notes, "createdAt")
          VALUES ($1, $2, 'REASSIGNED', $3, $3, $4, $5, $6, $7)
        `, eventId, door.id, door.status, performedBy, performedByName, reason || `Reassigned to order ${newOrderId}`, now)

        await audit(request, 'DOOR_REASSIGN_ORDER', 'DoorIdentity', door.id, {
          status: door.status,
          previousOrderId,
          newOrderId,
          reason: reason || null,
          eventId,
          staffRole,
        }, 'WARN').catch(() => {})

        return safeJson({ success: true, newOrderId })
      }

      case 'request_service': {
        // PUBLIC branch — homeowners scanning the NFC tag. No staff auth.
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
    }

    // Unreachable — schema check above guarantees a known action.
    return safeJson({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error: any) {
    // Log the full error server-side for forensics; return a sanitized
    // payload to the caller so we don't leak Postgres / stack details.
    try {
      logger.error('door_post_failed', error, {
        doorId: params?.id,
      })
    } catch {}
    // eslint-disable-next-line no-console
    console.error('Door POST error:', error)
    return safeJson({ error: 'Failed to process door action' }, { status: 500 })
  }
}
