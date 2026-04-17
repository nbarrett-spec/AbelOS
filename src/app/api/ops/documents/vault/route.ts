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

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/vnd', 'text/', 'application/json', 'application/xml']

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix))
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
// FILE UPLOAD HANDLER
// ──────────────────────────────────────────────────────────────────
async function handleFileUpload(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Documents', undefined, { method: 'POST' }).catch(() => {})

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
    const uploadedBy = formData.get('uploadedBy') as string || 'system'
    const uploadedByName = formData.get('uploadedByName') as string | null

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
      if (!isAllowedMime(f.type)) {
        errors.push(`${f.name}: file type not allowed (${f.type})`)
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
          "uploadedBy", "uploadedByName", "checksum", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8::text[], $9, $10,
          $11, $12,
          $13, $14, $15, $16, $17,
          $18, $19, $20, $21,
          $22, $23, $24, NOW(), NOW()
        )`,
        id, f.name, fileExt, f.type, f.size, category,
        description, tags, 'DATABASE', base64Data,
        entityType, entityId,
        builderId, orderId, jobId, quoteId, invoiceId,
        dealId, vendorId, purchaseOrderId, doorIdentityId,
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

  const sets: string[] = ['"updatedAt" = NOW()']
  const params: any[] = []
  let idx = 1

  if (category) { sets.push(`"category" = $${idx}`); params.push(category); idx++ }
  if (description !== undefined) { sets.push(`"description" = $${idx}`); params.push(description); idx++ }
  if (tags) { sets.push(`"tags" = $${idx}::text[]`); params.push(tags); idx++ }

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
