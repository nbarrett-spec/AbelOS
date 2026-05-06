export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import crypto from 'crypto'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────
// DOCUMENT VAULT API
// ──────────────────────────────────────────────────────────────────
// GET  — List / search / filter documents
// POST — Upload new document(s) or perform actions
// ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'QUOTE', 'ORDER', 'INVOICE', 'PURCHASE_ORDER', 'CONTRACT',
  'BLUEPRINT', 'FLOOR_PLAN', 'SPEC_SHEET', 'PHOTO',
  'DELIVERY_PROOF', 'WARRANTY', 'SERVICE_REQUEST',
  'CORRESPONDENCE', 'REPORT', 'GENERAL'
] as const

// Vercel's serverless functions cap request bodies at ~4.5MB. The DB column
// can hold more, but the platform rejects the upload before we ever see it.
// Keeping the application-level cap at 25MB lets us deliver clear errors for
// in-bounds files; anything between 4.5MB and 25MB will surface a 413 from
// the platform and we translate that to a user-friendly message client-side.
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
// Vercel hard cap on serverless function request body. Surfaced to the
// client so the UI can warn before sending.
const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024
const ALLOWED_MIME_PREFIXES = [
  'image/',
  'application/pdf',
  'application/vnd', // Office, OpenDocument, etc.
  'application/msword', // legacy .doc
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream', // some browsers report this for unknown extensions
  'text/',
  'application/json',
  'application/xml',
]

// Extensions we trust even if MIME is empty/wrong — common from older
// browsers, mobile uploads (iOS Safari sends '' for some types), and the
// Windows file picker.
const TRUSTED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'json', 'xml', 'rtf',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'heif',
  'zip',
])

function isAllowedMime(mime: string, fileName: string): boolean {
  if (mime && ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))) {
    return true
  }
  // Fallback: trust well-known extensions even when the browser sent no
  // (or a junk) Content-Type. Mobile uploads + older browsers regularly
  // do this and we don't want to silently reject a legitimate PDF.
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return TRUSTED_EXTENSIONS.has(ext)
}

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DocumentVault" (
      "id" TEXT PRIMARY KEY,
      "fileName" TEXT NOT NULL,
      "fileType" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "fileSize" INT NOT NULL,
      "category" TEXT NOT NULL DEFAULT 'GENERAL',
      "description" TEXT,
      "tags" TEXT[] DEFAULT '{}',
      "storageType" TEXT NOT NULL DEFAULT 'DATABASE' CHECK ("storageType" IN ('DATABASE', 'VERCEL_BLOB', 'EXTERNAL')),
      "blobUrl" TEXT,
      "blobPathname" TEXT,
      "fileData" TEXT,
      "entityType" TEXT,
      "entityId" TEXT,
      "secondaryEntityType" TEXT,
      "secondaryEntityId" TEXT,
      "builderId" TEXT,
      "orderId" TEXT,
      "jobId" TEXT,
      "quoteId" TEXT,
      "invoiceId" TEXT,
      "dealId" TEXT,
      "vendorId" TEXT,
      "purchaseOrderId" TEXT,
      "doorIdentityId" TEXT,
      "uploadedBy" TEXT NOT NULL,
      "uploadedByName" TEXT,
      "isArchived" BOOLEAN DEFAULT false,
      "version" INT DEFAULT 1,
      "parentDocumentId" TEXT,
      "checksum" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
}

// ──────────────────────────────────────────────────────────────────
// GET: List, search, filter documents
// ──────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  await ensureTable()

  const url = request.nextUrl
  const search = url.searchParams.get('search') || ''
  const category = url.searchParams.get('category') || ''
  const entityType = url.searchParams.get('entityType') || ''
  const entityId = url.searchParams.get('entityId') || ''
  const builderId = url.searchParams.get('builderId') || ''
  const orderId = url.searchParams.get('orderId') || ''
  const jobId = url.searchParams.get('jobId') || ''
  const quoteId = url.searchParams.get('quoteId') || ''
  const invoiceId = url.searchParams.get('invoiceId') || ''
  const dealId = url.searchParams.get('dealId') || ''
  const vendorId = url.searchParams.get('vendorId') || ''
  const purchaseOrderId = url.searchParams.get('purchaseOrderId') || ''
  const journalEntryId = url.searchParams.get('journalEntryId') || ''
  const showArchived = url.searchParams.get('archived') === 'true'
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
  const offset = (page - 1) * limit
  const report = url.searchParams.get('report')

  // Summary report
  if (report === 'summary') {
    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalDocuments",
        COUNT(CASE WHEN "isArchived" = false THEN 1 END)::int AS "activeDocuments",
        COUNT(CASE WHEN "isArchived" = true THEN 1 END)::int AS "archivedDocuments",
        COALESCE(SUM("fileSize"), 0)::float AS "totalSizeBytes",
        COUNT(DISTINCT "builderId")::int AS "buildersWithDocs",
        COUNT(DISTINCT "orderId")::int AS "ordersWithDocs",
        COUNT(DISTINCT "jobId")::int AS "jobsWithDocs",
        COUNT(DISTINCT "uploadedBy")::int AS "uniqueUploaders"
      FROM "DocumentVault"
    `)

    const byCat: any[] = await prisma.$queryRawUnsafe(`
      SELECT "category", COUNT(*)::int AS "count",
             COALESCE(SUM("fileSize"), 0)::float AS "totalSize"
      FROM "DocumentVault" WHERE "isArchived" = false
      GROUP BY "category" ORDER BY "count" DESC
    `)

    const recentActivity: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "fileName", "category", "fileType", "fileSize",
             "uploadedByName", "createdAt", "entityType", "entityId"
      FROM "DocumentVault" WHERE "isArchived" = false
      ORDER BY "createdAt" DESC LIMIT 10
    `)

    return safeJson({
      summary: summary[0],
      byCategory: byCat,
      recentUploads: recentActivity,
    })
  }

  // Build dynamic WHERE clause
  const conditions: string[] = []
  const params: any[] = []
  let paramIdx = 1

  if (!showArchived) {
    conditions.push(`"isArchived" = false`)
  }
  if (search) {
    conditions.push(`("fileName" ILIKE $${paramIdx} OR "description" ILIKE $${paramIdx} OR $${paramIdx + 1}::text = ANY("tags"))`)
    params.push(`%${search}%`, search.toLowerCase())
    paramIdx += 2
  }
  if (category) {
    conditions.push(`"category" = $${paramIdx}`)
    params.push(category)
    paramIdx++
  }
  if (entityType && entityId) {
    conditions.push(`("entityType" = $${paramIdx} AND "entityId" = $${paramIdx + 1})`)
    params.push(entityType, entityId)
    paramIdx += 2
  }
  if (builderId) { conditions.push(`"builderId" = $${paramIdx}`); params.push(builderId); paramIdx++ }
  if (orderId) { conditions.push(`"orderId" = $${paramIdx}`); params.push(orderId); paramIdx++ }
  if (jobId) { conditions.push(`"jobId" = $${paramIdx}`); params.push(jobId); paramIdx++ }
  if (quoteId) { conditions.push(`"quoteId" = $${paramIdx}`); params.push(quoteId); paramIdx++ }
  if (invoiceId) { conditions.push(`"invoiceId" = $${paramIdx}`); params.push(invoiceId); paramIdx++ }
  if (dealId) { conditions.push(`"dealId" = $${paramIdx}`); params.push(dealId); paramIdx++ }
  if (vendorId) { conditions.push(`"vendorId" = $${paramIdx}`); params.push(vendorId); paramIdx++ }
  if (purchaseOrderId) { conditions.push(`"purchaseOrderId" = $${paramIdx}`); params.push(purchaseOrderId); paramIdx++ }
  if (journalEntryId) { conditions.push(`"journalEntryId" = $${paramIdx}`); params.push(journalEntryId); paramIdx++ }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // Count
  const countResult: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "total" FROM "DocumentVault" ${whereClause}`,
    ...params
  )
  const total = countResult[0]?.total || 0

  // Fetch documents (exclude fileData for list views)
  const docs: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "fileName", "fileType", "mimeType", "fileSize", "category",
            "description", "tags", "storageType", "blobUrl",
            "entityType", "entityId", "secondaryEntityType", "secondaryEntityId",
            "builderId", "orderId", "jobId", "quoteId", "invoiceId",
            "dealId", "vendorId", "purchaseOrderId", "doorIdentityId",
            "journalEntryId",
            "uploadedBy", "uploadedByName", "isArchived", "version",
            "parentDocumentId", "createdAt", "updatedAt"
     FROM "DocumentVault" ${whereClause}
     ORDER BY "createdAt" DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    ...params, limit, offset
  )

  return safeJson({
    documents: docs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}

// ──────────────────────────────────────────────────────────────────
// POST: Upload documents or perform actions
// ──────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  await ensureTable()

  const contentType = request.headers.get('content-type') || ''

  // Multipart upload
  if (contentType.includes('multipart/form-data')) {
    return handleFileUpload(request)
  }

  // JSON actions
  const body = await request.json()
  const { action } = body

  switch (action) {
    case 'archive': return handleArchive(body)
    case 'restore': return handleRestore(body)
    case 'update': return handleUpdate(body)
    case 'link': return handleLink(body)
    case 'unlink': return handleUnlink(body)
    case 'bulk_archive': return handleBulkArchive(body)
    case 'register_external': return handleRegisterExternal(body)
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

// ──────────────────────────────────────────────────────────────────
// PATCH: Quick metadata edits (category, description, tags)
// ──────────────────────────────────────────────────────────────────
// The shared <DocumentAttachments> component issues a PATCH to update
// category from the row dropdown. Without this handler, the call returns
// 405 and the dropdown silently snaps back — which is exactly what was
// reported as "category click-to-edit not working."
export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  await ensureTable()

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sessionStaffId = request.headers.get('x-staff-id') || 'system'
  const sessionFirst = request.headers.get('x-staff-firstname') || ''
  const sessionLast = request.headers.get('x-staff-lastname') || ''
  const staffName =
    [sessionFirst, sessionLast].filter(Boolean).join(' ').trim() || null

  // Reuse the existing handleUpdate path so audit + history are consistent.
  return handleUpdate({
    ...body,
    staffId: sessionStaffId,
    staffName,
  })
}

// ──────────────────────────────────────────────────────────────────
// FILE UPLOAD HANDLER
// ──────────────────────────────────────────────────────────────────
async function handleFileUpload(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Documents', undefined, { method: 'POST' }).catch(() => {})

    // Derive uploader identity from the trusted middleware-injected
    // headers — never from the form payload (FIX-6 lesson: never trust
    // client-supplied identity). Falls back to 'system' only if the auth
    // gate somehow let an anonymous request through.
    const sessionStaffId = request.headers.get('x-staff-id') || 'system'
    const sessionFirst = request.headers.get('x-staff-firstname') || ''
    const sessionLast = request.headers.get('x-staff-lastname') || ''
    const sessionEmail = request.headers.get('x-staff-email') || ''
    const derivedName =
      [sessionFirst, sessionLast].filter(Boolean).join(' ').trim() ||
      sessionEmail ||
      null

    const formData = await request.formData()
    const files = formData.getAll('files') as File[]
    const file = formData.get('file') as File | null

    const allFiles = file ? [file, ...files] : files
    if (allFiles.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    // Metadata from form
    const category = (formData.get('category') as string) || 'GENERAL'
    const description = formData.get('description') as string | null
    const tags = (formData.get('tags') as string || '').split(',').filter(Boolean).map((t: string) => t.trim())
    const entityType = formData.get('entityType') as string | null
    const entityId = formData.get('entityId') as string | null
    const builderId = formData.get('builderId') as string | null
    const orderId = formData.get('orderId') as string | null
    const jobId = formData.get('jobId') as string | null
    const quoteId = formData.get('quoteId') as string | null
    const invoiceId = formData.get('invoiceId') as string | null
    const dealId = formData.get('dealId') as string | null
    const vendorId = formData.get('vendorId') as string | null
    const purchaseOrderId = formData.get('purchaseOrderId') as string | null
    const doorIdentityId = formData.get('doorIdentityId') as string | null
    const journalEntryId = formData.get('journalEntryId') as string | null
    // Identity comes from the session, not the client. Form values are
    // ignored to prevent spoofing.
    const uploadedBy = sessionStaffId
    const uploadedByName = derivedName

    const uploaded: any[] = []
    const errors: string[] = []

    for (const f of allFiles) {
      if (!(f instanceof File) || !f.name) {
        errors.push('Invalid file object')
        continue
      }
      if (f.size > MAX_FILE_SIZE) {
        errors.push(`${f.name}: exceeds 25MB limit (${(f.size / 1024 / 1024).toFixed(1)}MB)`)
        continue
      }
      if (!isAllowedMime(f.type, f.name)) {
        errors.push(`${f.name}: file type not allowed (${f.type || 'unknown'})`)
        continue
      }

      const id = crypto.randomUUID()
      const buffer = Buffer.from(await f.arrayBuffer())
      const checksum = crypto.createHash('md5').update(buffer).digest('hex')
      const fileExt = f.name.split('.').pop()?.toLowerCase() || ''
      const base64Data = buffer.toString('base64')

      // Store in PostgreSQL (default). Vercel Blob upgrade is a config change.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentVault" (
          "id", "fileName", "fileType", "mimeType", "fileSize", "category",
          "description", "tags", "storageType", "fileData",
          "entityType", "entityId",
          "builderId", "orderId", "jobId", "quoteId", "invoiceId",
          "dealId", "vendorId", "purchaseOrderId", "doorIdentityId",
          "journalEntryId",
          "uploadedBy", "uploadedByName", "checksum", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8::text[], $9, $10,
          $11, $12,
          $13, $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22,
          $23, $24, $25, NOW(), NOW()
        )`,
        id, f.name, fileExt, f.type, f.size, category,
        description, tags, 'DATABASE', base64Data,
        entityType, entityId,
        builderId, orderId, jobId, quoteId, invoiceId,
        dealId, vendorId, purchaseOrderId, doorIdentityId,
        journalEntryId,
        uploadedBy, uploadedByName, checksum
      )

      uploaded.push({ id, fileName: f.name, fileSize: f.size, fileType: fileExt, category })
    }

    return safeJson({
      uploaded,
      errors,
      message: `${uploaded.length} file(s) uploaded${errors.length > 0 ? `, ${errors.length} error(s)` : ''}`,
    })
  } catch (err: any) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────
// ARCHIVE / RESTORE / UPDATE / LINK
// ──────────────────────────────────────────────────────────────────
async function handleArchive(body: any) {
  const { documentId, staffId, staffName } = body
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  await prisma.$executeRawUnsafe(
    `UPDATE "DocumentVault" SET "isArchived" = true, "updatedAt" = NOW() WHERE "id" = $1`,
    documentId
  )
  await logActivity(documentId, 'ARCHIVED', staffId, staffName)
  return safeJson({ success: true, message: 'Document archived' })
}

async function handleRestore(body: any) {
  const { documentId, staffId, staffName } = body
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  await prisma.$executeRawUnsafe(
    `UPDATE "DocumentVault" SET "isArchived" = false, "updatedAt" = NOW() WHERE "id" = $1`,
    documentId
  )
  await logActivity(documentId, 'RESTORED', staffId, staffName)
  return safeJson({ success: true, message: 'Document restored' })
}

async function handleUpdate(body: any) {
  const { documentId, staffId, staffName, category, description, tags } = body
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  // Validate category against the canonical list. Garbage in → 400 instead
  // of a silent corruption that would later break the categoryColor switch.
  if (category && !CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${CATEGORIES.join(', ')}` },
      { status: 400 },
    )
  }

  const sets: string[] = ['"updatedAt" = NOW()']
  const params: any[] = []
  let idx = 1

  if (category) { sets.push(`"category" = $${idx}`); params.push(category); idx++ }
  if (description !== undefined) { sets.push(`"description" = $${idx}`); params.push(description); idx++ }
  if (tags) { sets.push(`"tags" = $${idx}::text[]`); params.push(tags); idx++ }

  // Nothing to update — short-circuit so we don't burn an audit row.
  if (sets.length === 1) {
    return safeJson({ success: true, noop: true })
  }

  params.push(documentId)
  await prisma.$executeRawUnsafe(
    `UPDATE "DocumentVault" SET ${sets.join(', ')} WHERE "id" = $${idx}`,
    ...params
  )
  await logActivity(documentId, 'UPDATED', staffId, staffName, `Updated: ${sets.filter(s => !s.includes('updatedAt')).map(s => s.split('"')[1]).join(', ')}`)
  return safeJson({ success: true })
}

async function handleLink(body: any) {
  const { documentId, staffId, staffName, ...links } = body
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  const sets: string[] = ['"updatedAt" = NOW()']
  const params: any[] = []
  let idx = 1
  const linkFields = ['builderId', 'orderId', 'jobId', 'quoteId', 'invoiceId', 'dealId', 'vendorId', 'purchaseOrderId', 'doorIdentityId', 'entityType', 'entityId']

  for (const field of linkFields) {
    if (links[field] !== undefined) {
      sets.push(`"${field}" = $${idx}`)
      params.push(links[field])
      idx++
    }
  }

  params.push(documentId)
  await prisma.$executeRawUnsafe(
    `UPDATE "DocumentVault" SET ${sets.join(', ')} WHERE "id" = $${idx}`,
    ...params
  )
  await logActivity(documentId, 'LINKED', staffId, staffName, `Linked to: ${Object.keys(links).filter(k => linkFields.includes(k)).join(', ')}`)
  return safeJson({ success: true })
}

async function handleUnlink(body: any) {
  const { documentId, staffId, staffName, fields } = body
  if (!documentId || !fields?.length) return NextResponse.json({ error: 'documentId and fields required' }, { status: 400 })

  const sets = fields.map((f: string) => `"${f}" = NULL`).concat(['"updatedAt" = NOW()'])
  await prisma.$executeRawUnsafe(
    `UPDATE "DocumentVault" SET ${sets.join(', ')} WHERE "id" = $1`,
    documentId
  )
  await logActivity(documentId, 'UNLINKED', staffId, staffName, `Unlinked: ${fields.join(', ')}`)
  return safeJson({ success: true })
}

async function handleBulkArchive(body: any) {
  const { documentIds, staffId, staffName } = body
  if (!documentIds?.length) return NextResponse.json({ error: 'documentIds required' }, { status: 400 })

  for (const docId of documentIds) {
    await prisma.$executeRawUnsafe(
      `UPDATE "DocumentVault" SET "isArchived" = true, "updatedAt" = NOW() WHERE "id" = $1`,
      docId
    )
    await logActivity(docId, 'ARCHIVED', staffId, staffName, 'Bulk archive')
  }
  return safeJson({ success: true, archived: documentIds.length })
}

async function handleRegisterExternal(body: any) {
  const { fileName, fileType, mimeType, fileSize, externalUrl, category, description, tags, entityType, entityId, builderId, orderId, jobId, quoteId, invoiceId, dealId, vendorId, purchaseOrderId, doorIdentityId, uploadedBy, uploadedByName } = body

  if (!fileName || !externalUrl) return NextResponse.json({ error: 'fileName and externalUrl required' }, { status: 400 })

  const id = crypto.randomUUID()
  await prisma.$executeRawUnsafe(
    `INSERT INTO "DocumentVault" (
      "id", "fileName", "fileType", "mimeType", "fileSize", "category",
      "description", "tags", "storageType", "blobUrl",
      "entityType", "entityId",
      "builderId", "orderId", "jobId", "quoteId", "invoiceId",
      "dealId", "vendorId", "purchaseOrderId", "doorIdentityId",
      "uploadedBy", "uploadedByName", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8::text[], 'EXTERNAL', $9,
      $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18, $19, $20,
      $21, $22, NOW(), NOW()
    )`,
    id, fileName, fileType || '', mimeType || 'application/octet-stream', fileSize || 0, category || 'GENERAL',
    description || null, tags || [], externalUrl,
    entityType || null, entityId || null,
    builderId || null, orderId || null, jobId || null, quoteId || null, invoiceId || null,
    dealId || null, vendorId || null, purchaseOrderId || null, doorIdentityId || null,
    uploadedBy || 'system', uploadedByName || null
  )

  return safeJson({ id, message: 'External document registered' })
}

// ──────────────────────────────────────────────────────────────────
// ACTIVITY LOG HELPER
// ──────────────────────────────────────────────────────────────────
async function logActivity(documentId: string, action: string, staffId?: string, staffName?: string, details?: string) {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentVaultActivity" ("id", "documentId", "action", "staffId", "staffName", "details", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      crypto.randomUUID(), documentId, action, staffId || 'system', staffName || null, details || null
    )
  } catch { /* non-critical */ }
}
