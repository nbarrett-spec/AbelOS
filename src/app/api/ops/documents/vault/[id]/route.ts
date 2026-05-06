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
  // mode: download = force file download | inline = render inline (preview)
  //       info = JSON metadata | activity = activity log
  const mode = request.nextUrl.searchParams.get('mode') || 'download'

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

  // Log download — capture WHO downloaded it. Prior code logged 'system'
  // for every download regardless of which staff member opened the file,
  // which made the activity log useless for compliance audits.
  //
  // Skip logging for `mode=inline` — these calls also drive image
  // thumbnails in the doc list, which would spam the activity table with
  // a row per thumbnail render every page load.
  if (mode !== 'inline') {
    try {
      const staffId = request.headers.get('x-staff-id') || 'system'
      const staffFirst = request.headers.get('x-staff-firstname') || ''
      const staffLast = request.headers.get('x-staff-lastname') || ''
      const staffName =
        [staffFirst, staffLast].filter(Boolean).join(' ').trim() || null
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentVaultActivity" ("id", "documentId", "action", "staffId", "staffName", "createdAt")
         VALUES ($1, $2, 'DOWNLOADED', $3, $4, NOW())`,
        crypto.randomUUID(), id, staffId, staffName
      )
    } catch { /* non-critical */ }
  }

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
    // RFC 5987 / RFC 6266 — supply BOTH a fallback ASCII filename and the
    // UTF-8 encoded form so browsers correctly download files with spaces,
    // parens, accents, etc. (e.g. "Résumé (final v2).docx"). Prior code
    // wrote `filename="My%20File%20(1).pdf"` which downloaded literally
    // with %20 in the name.
    const safeAscii = doc.fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
    const utf8 = encodeURIComponent(doc.fileName)
    // 'inline' for preview iframes/img tags, 'attachment' for downloads.
    // Without this, PDF preview iframes never render — the browser sees
    // attachment and triggers a download instead.
    const disposition = mode === 'inline' ? 'inline' : 'attachment'
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `${disposition}; filename="${safeAscii}"; filename*=UTF-8''${utf8}`,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
        // Frame the same response back into the parent app for the
        // preview iframe. SAMEORIGIN keeps it locked to our domain so
        // we don't undo the global X-Frame-Options: DENY policy for
        // anything but this attachment endpoint.
        'X-Frame-Options': 'SAMEORIGIN',
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

  audit(request, 'DELETE', 'Document', id, { method: 'DELETE' }).catch(() => {})

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
