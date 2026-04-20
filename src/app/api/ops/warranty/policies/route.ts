export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit, audit } from '@/lib/audit'
import { checkStaffAuth } from '@/lib/api-auth'

function generateId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// GET /api/ops/warranty/policies — List warranty policies
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const type = searchParams.get('type')
    const activeOnly = searchParams.get('active') !== 'false'

    let whereClause = ''
    const params: any[] = []
    const conditions: string[] = []

    if (activeOnly) {
      conditions.push(`"isActive" = true`)
    }
    if (type && type !== 'ALL') {
      params.push(type)
      conditions.push(`"type" = $${params.length}`)
    }

    if (conditions.length > 0) {
      whereClause = 'WHERE ' + conditions.join(' AND ')
    }

    const policies = await prisma.$queryRawUnsafe(
      `SELECT * FROM "WarrantyPolicy" ${whereClause} ORDER BY "type", "name"`,
      ...params
    )

    return NextResponse.json({ policies })
  } catch (error: any) {
    console.error('GET /api/ops/warranty/policies error:', error)
    return NextResponse.json({ error: 'Failed to fetch warranty policies' }, { status: 500 })
  }
}

// POST /api/ops/warranty/policies — Create or seed warranty policies
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    audit(request, 'CREATE', 'WarrantyPolicy', undefined, { method: 'POST' }).catch(() => {})

    // If action is 'seed', create default Abel Lumber warranty policies
    if (body.action === 'seed') {
      const defaultPolicies = [
        {
          name: 'Interior Door Warranty',
          type: 'PRODUCT',
          category: 'Doors - Interior',
          description: 'Covers manufacturing defects in interior doors including warping, delamination, and finish defects.',
          durationMonths: 12,
          coverageDetails: 'Full replacement or repair of defective interior doors. Covers warping beyond 1/4 inch, delamination, veneer separation, and factory finish defects.',
          exclusions: 'Normal wear and tear, damage from improper installation, moisture damage from exposure to elements, modifications made after purchase, cosmetic imperfections visible only under certain lighting.',
          claimProcess: '1. Submit claim with photos. 2. Abel team reviews within 3 business days. 3. If approved, inspection may be scheduled. 4. Resolution via replacement, repair, or credit.',
        },
        {
          name: 'Exterior Door Warranty',
          type: 'PRODUCT',
          category: 'Doors - Exterior',
          description: 'Covers manufacturing defects in exterior doors including structural integrity, weatherstripping, and hardware.',
          durationMonths: 24,
          coverageDetails: 'Full replacement or repair of defective exterior doors. Covers structural failures, weatherstrip defects, glass seal failures, and factory-installed hardware defects.',
          exclusions: 'Damage from extreme weather events, improper installation, failure to maintain per care instructions, modifications, glass breakage from impact.',
          claimProcess: '1. Submit claim with photos. 2. Abel team reviews within 3 business days. 3. On-site inspection scheduled. 4. Resolution via replacement, repair, or credit.',
        },
        {
          name: 'Trim & Millwork Warranty',
          type: 'PRODUCT',
          category: 'Trim & Millwork',
          description: 'Covers manufacturing defects in trim, molding, and custom millwork products.',
          durationMonths: 12,
          coverageDetails: 'Replacement of defective trim and millwork. Covers splits, cracks, warping, and profile inconsistencies that were present at time of delivery.',
          exclusions: 'Field damage, nail splits from installation, natural wood movement, color variation, damage from improper acclimation.',
          claimProcess: '1. Submit claim with photos and order number. 2. Review within 5 business days. 3. Replacement material shipped or credit issued.',
        },
        {
          name: 'Framing Lumber Warranty',
          type: 'MATERIAL',
          category: 'Framing Lumber',
          description: 'Covers grade compliance and structural integrity of framing lumber at time of delivery.',
          durationMonths: 6,
          coverageDetails: 'Replacement of lumber that does not meet specified grade standards at time of delivery. Covers dimensional accuracy, grade compliance, and obvious structural defects.',
          exclusions: 'Damage after delivery acceptance, natural checking/splitting, moisture-related changes after delivery, improper storage on site.',
          claimProcess: '1. Report within 48 hours of delivery. 2. Provide photos and delivery ticket number. 3. Abel rep inspects on site. 4. Replacement delivered.',
        },
        {
          name: 'Installation Workmanship Warranty',
          type: 'INSTALLATION',
          category: 'Installation Services',
          description: 'Covers workmanship defects for all Abel Lumber installation services including doors, trim, and hardware.',
          durationMonths: 24,
          coverageDetails: 'Full repair or re-installation for workmanship issues. Covers improper fitting, alignment issues, inadequate fastening, and finish work defects performed by Abel crews.',
          exclusions: 'Issues caused by settling, structural movement, homeowner modifications, damage from other trades, work not performed by Abel crews.',
          claimProcess: '1. Submit claim describing the issue. 2. Abel schedules inspection within 5 business days. 3. Inspector documents findings. 4. Repair crew dispatched if claim approved.',
        },
        {
          name: 'Hardware Warranty',
          type: 'PRODUCT',
          category: 'Hardware',
          description: 'Covers manufacturer defects in door hardware, hinges, locks, and closers.',
          durationMonths: 36,
          coverageDetails: 'Replacement of defective hardware components. Covers mechanical failures, finish defects, and functional issues under normal use.',
          exclusions: 'Wear items (springs, seals), cosmetic wear, damage from misuse, non-standard installations, commercial high-traffic applications unless rated for such use.',
          claimProcess: '1. Submit claim with photos and order details. 2. Review within 3 business days. 3. Replacement hardware shipped or on-site swap scheduled.',
        },
      ]

      const created: string[] = []
      for (const policy of defaultPolicies) {
        const id = generateId('wpol')
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "WarrantyPolicy" ("id", "name", "type", "category", "description", "durationMonths", "coverageDetails", "exclusions", "claimProcess", "isActive", "createdById", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, NOW(), NOW())`,
            id, policy.name, policy.type, policy.category, policy.description,
            policy.durationMonths, policy.coverageDetails, policy.exclusions,
            policy.claimProcess, staffId
          )
          created.push(policy.name)
        } catch (e: any) {
          // Skip duplicates silently
        }
      }

      await logAudit({
        staffId,
        action: 'SEED_WARRANTY_POLICIES',
        entity: 'WarrantyPolicy',
        entityId: 'batch',
        details: { count: created.length, names: created },
      }).catch(() => {})

      return NextResponse.json({ success: true, message: `${created.length} warranty policies seeded`, created })
    }

    // Regular create
    const { name, type, category, description, durationMonths, coverageDetails, exclusions, claimProcess, appliesToProducts } = body

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 })
    }

    const id = generateId('wpol')

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarrantyPolicy" ("id", "name", "type", "category", "description", "durationMonths", "coverageDetails", "exclusions", "claimProcess", "appliesToProducts", "isActive", "createdById", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, NOW(), NOW())`,
      id, name, type, category || null, description || null,
      durationMonths || 12, coverageDetails || null, exclusions || null,
      claimProcess || null, JSON.stringify(appliesToProducts || []), staffId
    )

    await logAudit({
      staffId,
      action: 'CREATE',
      entity: 'WarrantyPolicy',
      entityId: id,
      details: { name, type },
    }).catch(() => {})

    return NextResponse.json({ success: true, policyId: id }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/warranty/policies error:', error)
    return NextResponse.json({ error: 'Failed to create warranty policy' }, { status: 500 })
  }
}

// PATCH /api/ops/warranty/policies — Update a policy
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { policyId, ...updates } = body

    audit(request, 'UPDATE', 'WarrantyPolicy', undefined, { method: 'PATCH' }).catch(() => {})

    if (!policyId) {
      return NextResponse.json({ error: 'policyId is required' }, { status: 400 })
    }

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const params: any[] = []
    let idx = 1

    const allowedFields = ['name', 'type', 'category', 'description', 'durationMonths', 'coverageDetails', 'exclusions', 'claimProcess', 'isActive']

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        setClauses.push(`"${field}" = $${idx}`)
        params.push(updates[field])
        idx++
      }
    }

    params.push(policyId)

    await prisma.$executeRawUnsafe(
      `UPDATE "WarrantyPolicy" SET ${setClauses.join(', ')} WHERE "id" = $${idx}`,
      ...params
    )

    await logAudit({
      staffId,
      action: 'UPDATE',
      entity: 'WarrantyPolicy',
      entityId: policyId,
      details: updates,
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('PATCH /api/ops/warranty/policies error:', error)
    return NextResponse.json({ error: 'Failed to update warranty policy' }, { status: 500 })
  }
}
