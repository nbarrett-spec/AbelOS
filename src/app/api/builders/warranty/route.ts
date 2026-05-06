export const dynamic = 'force-dynamic'
import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { createNotification } from '@/lib/notifications'
import { sendWarrantyClaimConfirmationEmail } from '@/lib/email'
import { auditBuilder } from '@/lib/audit'

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
              "orderId", "jobId", "photoUrls",
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
    Sentry.captureException(error, { tags: { route: '/api/builders/warranty', method: 'GET' } })
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
      policyId, orderId, jobId, type, subject, description,
      productName, productSku, installDate, issueDate,
      contactName, contactEmail, contactPhone,
      siteAddress, siteCity, siteState, siteZip
    } = body

    if (!subject || !description || !type) {
      return NextResponse.json({ error: 'Subject, description, and warranty type are required' }, { status: 400 })
    }

    // ── Defence in depth: verify any FK the builder is asserting ──
    // Both fields are optional — but if supplied, they MUST belong to
    // this builder. Otherwise the form could be used to graffiti claims
    // onto another builder's order/job. Cheap + indexed.
    if (orderId) {
      const owns = (await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "Order" WHERE "id" = $1 AND "builderId" = $2 LIMIT 1`,
        orderId,
        builderId,
      )) as any[]
      if (owns.length === 0) {
        return NextResponse.json(
          { error: 'Order not found for this builder' },
          { status: 400 },
        )
      }
    }
    let resolvedJobAddress: string | null = null
    if (jobId) {
      const ownsJob = (await prisma.$queryRawUnsafe(
        `SELECT j."id", j."jobAddress", j."community", j."lotBlock"
         FROM "Job" j
         JOIN "Order" o ON o."id" = j."orderId"
         WHERE j."id" = $1 AND o."builderId" = $2
         LIMIT 1`,
        jobId,
        builderId,
      )) as any[]
      if (ownsJob.length === 0) {
        return NextResponse.json(
          { error: 'Job not found for this builder' },
          { status: 400 },
        )
      }
      // Auto-populate site address from the job if the form left it blank,
      // so the ops team isn't fishing for the same data twice.
      const j = ownsJob[0]
      resolvedJobAddress = [j.community, j.lotBlock, j.jobAddress]
        .filter(Boolean)
        .join(' · ') || null
    }

    const id = generateId('wcl')
    const claimNumber = generateClaimNumber()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarrantyClaim" (
        "id", "claimNumber", "policyId", "builderId", "orderId", "jobId",
        "type", "status", "priority", "subject", "description",
        "productName", "productSku", "installDate", "issueDate",
        "contactName", "contactEmail", "contactPhone",
        "siteAddress", "siteCity", "siteState", "siteZip",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'SUBMITTED', 'MEDIUM', $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16,
        $17, $18, $19, $20,
        NOW(), NOW()
      )`,
      id, claimNumber, policyId || null, builderId, orderId || null, jobId || null,
      type, subject, description,
      productName || null, productSku || null,
      installDate ? new Date(installDate) : null,
      issueDate ? new Date(issueDate) : null,
      contactName || null, contactEmail || null, contactPhone || null,
      siteAddress || resolvedJobAddress || null,
      siteCity || null, siteState || null, siteZip || null
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

    auditBuilder(
      builderId,
      session.companyName || session.email,
      'BUILDER_FILE_WARRANTY_CLAIM',
      'WarrantyClaim',
      id,
      { claimNumber, type, subjectPreview: subject.slice(0, 80), orderId: orderId || null, jobId: jobId || null }
    ).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Warranty claim submitted successfully',
      claimNumber,
      claimId: id
    }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/builders/warranty error:', error)
    Sentry.captureException(error, { tags: { route: '/api/builders/warranty', method: 'POST' } })
    return NextResponse.json({ error: 'Failed to submit warranty claim' }, { status: 500 })
  }
}
