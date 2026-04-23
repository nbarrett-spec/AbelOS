export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { hasPermission, parseRoles } from '@/lib/permissions'
import { sha256Base64 } from '@/lib/takeoff-tool'
import crypto from 'crypto'

// 25 MB cap — larger PDFs should be split before upload during scaffold phase.
const MAX_PDF_BYTES = 25 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
])

/**
 * POST /api/ops/takeoffs/upload
 *
 * multipart/form-data:
 *   - file        (required) PDF / image
 *   - projectId   (optional) attach to an existing project
 *   - builderId   (optional) attach to a specific builder (new project created)
 *   - projectName (optional) human label for the new project when no projectId given
 *
 * Creates a Blueprint row storing raw bytes in fileBase64, a draft Takeoff row
 * in PROCESSING state, and (if needed) a "Takeoff Tool" placeholder
 * project/builder so the scaffold runs without a real builder picker.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const roles = parseRoles(
    request.headers.get('x-staff-roles') || request.headers.get('x-staff-role'),
  )
  if (!hasPermission(roles, 'takeoff:create')) {
    return NextResponse.json({ error: 'Forbidden — missing takeoff:create' }, { status: 403 })
  }

  await ensureSchema()

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file missing from form' }, { status: 400 })
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type ${file.type}` },
      { status: 400 },
    )
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB limit` },
      { status: 413 },
    )
  }

  const arrayBuf = await file.arrayBuffer()
  const buf = Buffer.from(arrayBuf)
  const base64 = buf.toString('base64')
  const sha = sha256Base64(base64)
  const fileTypeShort = fileTypeFromMime(file.type)

  const projectIdParam = stringField(form, 'projectId')
  const builderIdParam = stringField(form, 'builderId')
  const projectName = stringField(form, 'projectName') || file.name.replace(/\.[^.]+$/, '')

  // Resolve a project to attach the blueprint to.
  let projectId: string
  try {
    projectId = await resolveProjectId({
      explicitProjectId: projectIdParam,
      explicitBuilderId: builderIdParam,
      projectName,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Failed to resolve project' },
      { status: 400 },
    )
  }

  // Insert Blueprint. We store bytes inline (scaffold) — prod would use blob
  // storage and a signed URL in Blueprint.fileUrl.
  const blueprintId = 'bp_' + crypto.randomBytes(8).toString('hex')
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Blueprint"
       ("id","projectId","fileName","fileUrl","fileSize","fileType","fileBase64","fileSha256","processingStatus","createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',NOW())`,
    blueprintId,
    projectId,
    file.name,
    // fileUrl kept non-null to satisfy legacy consumers; inline data-URL prefix
    `inline://blueprint/${blueprintId}`,
    file.size,
    fileTypeShort,
    base64,
    sha,
  )

  // Insert draft Takeoff.
  const takeoffId = 'tk_' + crypto.randomBytes(8).toString('hex')
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Takeoff" ("id","projectId","blueprintId","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,'PROCESSING',NOW(),NOW())`,
    takeoffId,
    projectId,
    blueprintId,
  )

  await audit(request, 'CREATE', 'Takeoff', takeoffId, {
    via: 'takeoff-tool/upload',
    blueprintId,
    projectId,
    sha256: sha.slice(0, 16),
    bytes: file.size,
  })

  return NextResponse.json({
    takeoffId,
    blueprintId,
    projectId,
    sha256: sha,
    fileType: fileTypeShort,
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────

function stringField(form: FormData, name: string): string | undefined {
  const v = form.get(name)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

function fileTypeFromMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/jpeg') return 'jpg'
  return 'bin'
}

async function ensureSchema(): Promise<void> {
  const migrations = [
    `ALTER TABLE "Blueprint" ADD COLUMN IF NOT EXISTS "fileBase64" TEXT`,
    `ALTER TABLE "Blueprint" ADD COLUMN IF NOT EXISTS "fileSha256" TEXT`,
    `CREATE INDEX IF NOT EXISTS "idx_blueprint_filesha256" ON "Blueprint" ("fileSha256")`,
    `ALTER TABLE "Takeoff" ADD COLUMN IF NOT EXISTS "aiExtractionResult" JSONB`,
    `ALTER TABLE "Takeoff" ADD COLUMN IF NOT EXISTS "aiExtractionAt" TIMESTAMPTZ`,
    `ALTER TABLE "Takeoff" ADD COLUMN IF NOT EXISTS "aiExtractionModel" TEXT`,
    `ALTER TABLE "Takeoff" ADD COLUMN IF NOT EXISTS "aiExtractionCost" DOUBLE PRECISION`,
    `ALTER TABLE "Takeoff" ADD COLUMN IF NOT EXISTS "aiExtractionError" TEXT`,
    `ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "itemType" TEXT`,
    `ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "widthInches" DOUBLE PRECISION`,
    `ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "heightInches" DOUBLE PRECISION`,
    `ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "linearFeet" DOUBLE PRECISION`,
    `ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "hardware" TEXT`,
    `ALTER TABLE "TakeoffItem" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
    `CREATE INDEX IF NOT EXISTS "idx_takeoffitem_itemtype" ON "TakeoffItem" ("itemType")`,
  ]
  for (const sql of migrations) {
    try { await prisma.$executeRawUnsafe(sql) }
    catch (e: any) { console.warn('[takeoff-tool ensureSchema]', sql.slice(0, 60), e?.message) }
  }
}

/**
 * Resolve which Project a new blueprint belongs to. Order of precedence:
 *   1. explicit projectId (must exist)
 *   2. explicit builderId → create a new project for that builder
 *   3. fall back to a shared "Takeoff Tool" system builder + fresh project
 */
async function resolveProjectId(opts: {
  explicitProjectId?: string
  explicitBuilderId?: string
  projectName: string
}): Promise<string> {
  if (opts.explicitProjectId) {
    const row = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Project" WHERE "id" = $1`,
      opts.explicitProjectId,
    )
    if (!row || row.length === 0) throw new Error('projectId not found')
    return row[0].id
  }

  let builderId = opts.explicitBuilderId
  if (builderId) {
    const row = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Builder" WHERE "id" = $1`,
      builderId,
    )
    if (!row || row.length === 0) throw new Error('builderId not found')
  } else {
    builderId = await getOrCreateSystemBuilderId()
  }

  const projectId = 'prj_' + crypto.randomBytes(8).toString('hex')
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Project" ("id","builderId","name","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,'DRAFT',NOW(),NOW())`,
    projectId,
    builderId,
    opts.projectName.slice(0, 120),
  )
  return projectId
}

const SYSTEM_BUILDER_EMAIL = 'system-takeoff-tool@abellumber.local'

async function getOrCreateSystemBuilderId(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "Builder" WHERE "email" = $1 LIMIT 1`,
    SYSTEM_BUILDER_EMAIL,
  )
  if (rows.length > 0) return rows[0].id

  const id = 'bld_system_takeoff'
  // passwordHash is required but this account never logs in
  const pwHash = crypto.randomBytes(32).toString('hex')
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Builder"
       ("id","companyName","contactName","email","passwordHash","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,'PENDING',NOW(),NOW())
     ON CONFLICT ("email") DO NOTHING`,
    id,
    'Abel Takeoff Tool (System)',
    'Abel Ops',
    SYSTEM_BUILDER_EMAIL,
    pwHash,
  )
  const check = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "Builder" WHERE "email" = $1 LIMIT 1`,
    SYSTEM_BUILDER_EMAIL,
  )
  return check[0].id
}
