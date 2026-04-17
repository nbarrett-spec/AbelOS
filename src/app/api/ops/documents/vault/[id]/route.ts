export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import crypto from 'crypto'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────
// GET: Download or view a single document
// ──────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = await params
  const mode = request.nextUrl.searchParams.get('mode') || 'download' // download | info | activity

  if (mode === 'info') {
    const docs: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "fileName", "fileType", "mimeType", "fileSize", "category",
              "description", "tags", "storageType", "blobUrl",
              "entityType", "entityId", "secondaryEntityType", "secondaryEntityId",
              "builderId", "orderId", "jobId", "quoteId", "invoiceId",
              "dealId", "vendorId", "purchaseOrderId", "doorIdentityId",
              "uploadedBy", "uploadedByName", "isArchived", "version",
              "parentDocumentId", "checksum", "createdAt", "updatedAt"
       FROM "DocumentVault" WHERE "id" = $1`,
      id
    )
    if (docs.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return safeJson({ document: docs[0] })
  }

  if (mode === 'activity') {
    const activities: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "action", "staffId", "staffName", "details", "createdAt"
       FROM "DocumentVaultActivity" WHERE "documentId" = $1
       ORDER BY "createdAt" DESC LIMIT 50`,
      id
    )
    return safeJson({ activities })
  }

  // Download mode
  const docs: any[] = await prisma.$queryRawUnsafe(
    `SELECT "fileName", "mimeType", "storageType", "blobUrl", "fileData"
     FROM "DocumentVault" WHERE "id" = $1`,
    id
  )
  if (docs.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const doc = docs[0]

  // Log download
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentVaultActivity" ("id", "documentId", "action", "staffId", "createdAt")
       VALUES ($1, $2, 'DOWNLOADED', 'system', NOW())`,
      crypto.randomUUID(), id
    )
  } catch { /* non-critical */ }

  // External URL — redirect
  if (doc.storageType === 'EXTERNAL' && doc.blobUrl) {
    return NextResponse.redirect(doc.blobUrl)
  }

  // Vercel Blob — redirect
  if (doc.storageType === 'VERCEL_BLOB' && doc.blobUrl) {
    return NextResponse.redirect(doc.blobUrl)
  }

  // Database storage — stream base64 data
  if (doc.storageType === 'DATABASE' && doc.fileData) {
    const buffer = Buffer.from(doc.fileData, 'base64')
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  }

  return NextResponse.json({ error: 'File data not available' }, { status: 404 })
}

// ──────────────────────────────────────────────────────────────────
// DELETE: Remove a document permanently
// ──────────────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = await params

  // Check exists
  const docs: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "fileName", "storageType", "blobUrl" FROM "DocumentVault" WHERE "id" = $1`,
    id
  )
  if (docs.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete activity log entries
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DocumentVaultActivity" WHERE "documentId" = $1`,
    id
  )

  // Delete document record
  await prisma.$executeRawUnsafe(
    `DELETE FROM "DocumentVault" WHERE "id" = $1`,
    id
  )

  return safeJson({ success: true, message: `Document ${docs[0].fileName} deleted` })
}
