export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'
import { sendWarrantyClaimConfirmationEmail } from '@/lib/email'

function generateId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function generateClaimNumber(): string {
  const year = new Date().getFullYear()
  const seq = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `WC-${year}-${seq}`
}

// GET /api/builders/warranty — List builder's own warranty claims
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    const builderId = session?.builderId
    if (!builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const claims = await prisma.$queryRawUnsafe(
      `SELECT "id", "claimNumber", "type", "status", "priority", "subject", "description",
              "productName", "resolutionType", "resolutionNotes", "creditAmount",
              "createdAt", "updatedAt", "resolvedAt"
       FROM "WarrantyClaim"
       WHERE "builderId" = $1
       ORDER BY "createdAt" DESC`,
      builderId
    )

    // Get available warranty policies for reference
    const policies = await prisma.$queryRawUnsafe(
      `SELECT "id", "name", "type", "category", "durationMonths", "coverageDetails", "exclusions", "claimProcess"
       FROM "WarrantyPolicy" WHERE "isActive" = true ORDER BY "type", "name"`
    )

    return NextResponse.json({ claims, policies })
  } catch (error: any) {
    console.error('GET /api/builders/warranty error:', error)
    return NextResponse.json({ error: 'Failed to fetch warranty claims' }, { status: 500 })
  }
}

// POST /api/builders/warranty — Submit warranty claim (builder-facing)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const builderId = session?.builderId
    if (!builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      policyId, orderId, type, subject, description,
      productName, productSku, installDate, issueDate,
      contactName, contactEmail, contactPhone,
      siteAddress, siteCity, siteState, siteZip
    } = body

    if (!subject || !description || !type) {
      return NextResponse.json({ error: 'Subject, description, and warranty type are required' }, { status: 400 })
    }

    const id = generateId('wcl')
    const claimNumber = generateClaimNumber()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarrantyClaim" (
        "id", "claimNumber", "policyId", "builderId", "orderId",
        "type", "status", "priority", "subject", "description",
        "productName", "productSku", "installDate", "issueDate",
        "contactName", "contactEmail", "contactPhone",
        "siteAddress", "siteCity", "siteState", "siteZip",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, 'SUBMITTED', 'MEDIUM', $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19,
        NOW(), NOW()
      )`,
      id, claimNumber, policyId || null, builderId, orderId || null,
      type, subject, description,
      productName || null, productSku || null,
      installDate ? new Date(installDate) : null,
      issueDate ? new Date(issueDate) : null,
      contactName || null, contactEmail || null, contactPhone || null,
      siteAddress || null, siteCity || null, siteState || null, siteZip || null
    )

    // Send confirmation email to builder
    if (session?.email) {
      sendWarrantyClaimConfirmationEmail({
        to: session.email,
        builderName: session.companyName || 'Builder',
        claimNumber,
        subject,
        type,
      }).catch(() => {})
    }

    // Notify all ADMIN and MANAGER staff
    const managers = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Staff" WHERE "role"::text IN ('ADMIN', 'MANAGER', 'QC_INSPECTOR') AND "active" = true`
    ) as any[]

    for (const mgr of managers) {
      createNotification({
        staffId: mgr.id,
        type: 'SYSTEM',
        title: 'New Warranty Claim',
        message: `${claimNumber}: ${subject} (${type})`,
        link: `/ops/warranty/claims?id=${id}`
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      message: 'Warranty claim submitted successfully',
      claimNumber,
      claimId: id
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/builders/warranty error:', error)
    return NextResponse.json({ error: 'Failed to submit warranty claim' }, { status: 500 })
  }
}
