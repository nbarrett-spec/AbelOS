export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import crypto from 'crypto'

// ──────────────────────────────────────────────────────────────────
// QC PHOTO QUEUE — B-FEAT-5 (2026-05-05)
// ──────────────────────────────────────────────────────────────────
// GET   — list QcPhoto rows + the requirement catalog for a scope
//         (?jobId / ?deliveryId / ?stage). Returns enough info to render
//         the per-photoType checklist (uploaded vs missing).
// POST  — create one QcPhoto row pointing at an already-uploaded
//         DocumentVault id. The vault upload itself happens via the
//         existing /api/ops/documents/vault POST flow.
// ──────────────────────────────────────────────────────────────────

const VALID_STAGES = ['POST_MFG', 'DELIVERY'] as const
type Stage = (typeof VALID_STAGES)[number]

const VALID_PHOTO_TYPES = [
  'DOOR_FULL',
  'DOOR_BORE',
  'TRIM_FULL',
  'TRIM_FRONT',
  'DOORS_FULL',
  'DOORS_SIDE',
  'HARDWARE',
] as const

// Self-healing bootstrap — mirrors the DocumentVault pattern. Lets the route
// stand up on a DB where the SQL migration hasn't been applied yet.
let tablesEnsured = false
async function ensureTables() {
  if (tablesEnsured) return
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QcPhotoRequirement" (
      "id"          TEXT PRIMARY KEY,
      "stage"       TEXT NOT NULL,
      "photoType"   TEXT NOT NULL,
      "required"    BOOLEAN NOT NULL DEFAULT true,
      "description" TEXT,
      "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "QcPhotoRequirement_stage_photoType_key"
      ON "QcPhotoRequirement" ("stage", "photoType")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "QcPhoto" (
      "id"              TEXT PRIMARY KEY,
      "jobId"           TEXT,
      "doorIdentityId"  TEXT,
      "deliveryId"      TEXT,
      "stage"           TEXT NOT NULL,
      "photoType"       TEXT NOT NULL,
      "documentVaultId" TEXT,
      "uploadedBy"      TEXT,
      "uploadedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QcPhoto_jobId_idx"          ON "QcPhoto" ("jobId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QcPhoto_deliveryId_idx"     ON "QcPhoto" ("deliveryId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QcPhoto_doorIdentityId_idx" ON "QcPhoto" ("doorIdentityId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "QcPhoto_stage_photoType_idx" ON "QcPhoto" ("stage", "photoType")`)

  // Seed the 7 required rows. ON CONFLICT keeps the call idempotent.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "QcPhotoRequirement" ("id", "stage", "photoType", "required", "description")
    VALUES
      ('qpr_postmfg_door_full',   'POST_MFG', 'DOOR_FULL',    true, 'Full-door photo after manufacturing — verifies finish, slab, and frame.'),
      ('qpr_postmfg_door_bore',   'POST_MFG', 'DOOR_BORE',    true, 'Close-up of bore prep — verifies bore depth, edge, and lock prep.'),
      ('qpr_delivery_trim_full',  'DELIVERY', 'TRIM_FULL',    true, 'Full-load photo of trim packaging on the truck.'),
      ('qpr_delivery_trim_front', 'DELIVERY', 'TRIM_FRONT',   true, 'Front view of trim bundles — verifies labels and counts.'),
      ('qpr_delivery_doors_full', 'DELIVERY', 'DOORS_FULL',   true, 'Full-load photo of all doors staged on the truck.'),
      ('qpr_delivery_doors_side', 'DELIVERY', 'DOORS_SIDE',   true, 'Side photo of door stack — verifies dunnage and protection.'),
      ('qpr_delivery_hardware',   'DELIVERY', 'HARDWARE',     true, 'Hardware boxes / bins on the truck — verifies kit completeness.')
    ON CONFLICT ("stage", "photoType") DO NOTHING
  `)

  tablesEnsured = true
}

interface RequirementRow {
  id: string
  stage: string
  photoType: string
  required: boolean
  description: string | null
}

interface PhotoRow {
  id: string
  jobId: string | null
  doorIdentityId: string | null
  deliveryId: string | null
  stage: string
  photoType: string
  documentVaultId: string | null
  uploadedBy: string | null
  uploadedAt: Date
}

// ──────────────────────────────────────────────────────────────────
// GET
// ──────────────────────────────────────────────────────────────────
// Query params (all optional, but at least one of jobId/deliveryId/
// doorIdentityId is required):
//   ?stage=POST_MFG|DELIVERY    (optional filter)
//   ?jobId=<id>
//   ?deliveryId=<id>
//   ?doorIdentityId=<id>
//
// Response shape:
//   {
//     requirements: RequirementRow[],   // catalog for the requested stage(s)
//     photos: PhotoRow[],               // actual uploads in scope
//     stageStatus: {                    // convenience rollup per stage
//       POST_MFG?: { complete: boolean, missing: string[], uploaded: string[] }
//       DELIVERY?: { complete: boolean, missing: string[], uploaded: string[] }
//     }
//   }
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTables()

    const { searchParams } = new URL(request.url)
    const stage = searchParams.get('stage')
    const jobId = searchParams.get('jobId')
    const deliveryId = searchParams.get('deliveryId')
    const doorIdentityId = searchParams.get('doorIdentityId')

    if (!jobId && !deliveryId && !doorIdentityId) {
      return NextResponse.json(
        { error: 'Provide at least one of jobId, deliveryId, doorIdentityId' },
        { status: 400 },
      )
    }

    if (stage && !VALID_STAGES.includes(stage as Stage)) {
      return NextResponse.json(
        { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 },
      )
    }

    // Fetch requirement catalog (optionally filtered by stage)
    const requirements = stage
      ? await prisma.$queryRawUnsafe<RequirementRow[]>(
          `SELECT "id", "stage", "photoType", "required", "description"
           FROM "QcPhotoRequirement"
           WHERE "stage" = $1
           ORDER BY "stage", "photoType"`,
          stage,
        )
      : await prisma.$queryRawUnsafe<RequirementRow[]>(
          `SELECT "id", "stage", "photoType", "required", "description"
           FROM "QcPhotoRequirement"
           ORDER BY "stage", "photoType"`,
        )

    // Build a parameterised WHERE for QcPhoto. We OR across the three scope
    // columns so callers can pass any subset; AND with stage if provided.
    const filters: string[] = []
    const params: unknown[] = []
    let p = 1
    const orParts: string[] = []
    if (jobId) {
      orParts.push(`"jobId" = $${p++}`)
      params.push(jobId)
    }
    if (deliveryId) {
      orParts.push(`"deliveryId" = $${p++}`)
      params.push(deliveryId)
    }
    if (doorIdentityId) {
      orParts.push(`"doorIdentityId" = $${p++}`)
      params.push(doorIdentityId)
    }
    filters.push(`(${orParts.join(' OR ')})`)
    if (stage) {
      filters.push(`"stage" = $${p++}`)
      params.push(stage)
    }

    const photos = await prisma.$queryRawUnsafe<PhotoRow[]>(
      `SELECT "id", "jobId", "doorIdentityId", "deliveryId", "stage",
              "photoType", "documentVaultId", "uploadedBy", "uploadedAt"
       FROM "QcPhoto"
       WHERE ${filters.join(' AND ')}
       ORDER BY "uploadedAt" DESC`,
      ...params,
    )

    // Build per-stage rollup (uploaded vs missing photoTypes)
    const stageStatus: Record<string, { complete: boolean; missing: string[]; uploaded: string[] }> = {}
    const stagesToReport = stage ? [stage as Stage] : VALID_STAGES
    for (const s of stagesToReport) {
      const required = requirements.filter((r) => r.stage === s && r.required).map((r) => r.photoType)
      const uploaded = Array.from(
        new Set(photos.filter((ph) => ph.stage === s).map((ph) => ph.photoType)),
      )
      const missing = required.filter((t) => !uploaded.includes(t))
      stageStatus[s] = {
        complete: required.length > 0 && missing.length === 0,
        missing,
        uploaded,
      }
    }

    return NextResponse.json({ requirements, photos, stageStatus })
  } catch (e: any) {
    console.error('[/api/ops/qc/photos GET]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────
// POST
// ──────────────────────────────────────────────────────────────────
// Body:
//   {
//     stage: 'POST_MFG' | 'DELIVERY',
//     photoType: 'DOOR_FULL' | ... ,
//     documentVaultId: string,            // required — link to the file
//     jobId?: string,
//     deliveryId?: string,
//     doorIdentityId?: string
//   }
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTables()

    const body = await request.json().catch(() => ({}))
    const { stage, photoType, documentVaultId, jobId, deliveryId, doorIdentityId } = body as {
      stage?: string
      photoType?: string
      documentVaultId?: string
      jobId?: string
      deliveryId?: string
      doorIdentityId?: string
    }

    if (!stage || !VALID_STAGES.includes(stage as Stage)) {
      return NextResponse.json(
        { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!photoType || !VALID_PHOTO_TYPES.includes(photoType as (typeof VALID_PHOTO_TYPES)[number])) {
      return NextResponse.json(
        { error: `Invalid photoType. Must be one of: ${VALID_PHOTO_TYPES.join(', ')}` },
        { status: 400 },
      )
    }
    if (!documentVaultId) {
      return NextResponse.json({ error: 'documentVaultId is required' }, { status: 400 })
    }
    if (!jobId && !deliveryId && !doorIdentityId) {
      return NextResponse.json(
        { error: 'Provide at least one of jobId, deliveryId, doorIdentityId' },
        { status: 400 },
      )
    }

    const staffId = request.headers.get('x-staff-id') || null
    const id = `qcph_${crypto.randomBytes(10).toString('hex')}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "QcPhoto"
        ("id", "jobId", "doorIdentityId", "deliveryId", "stage", "photoType",
         "documentVaultId", "uploadedBy", "uploadedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
      id,
      jobId || null,
      doorIdentityId || null,
      deliveryId || null,
      stage,
      photoType,
      documentVaultId,
      staffId,
    )

    await audit(request, 'CREATE', 'QcPhoto', id, {
      stage,
      photoType,
      documentVaultId,
      jobId: jobId || null,
      deliveryId: deliveryId || null,
      doorIdentityId: doorIdentityId || null,
    }).catch(() => {
      /* audit failures shouldn't break the upload link */
    })

    return NextResponse.json({
      id,
      stage,
      photoType,
      documentVaultId,
      jobId: jobId || null,
      deliveryId: deliveryId || null,
      doorIdentityId: doorIdentityId || null,
      uploadedBy: staffId,
    })
  } catch (e: any) {
    console.error('[/api/ops/qc/photos POST]', e)
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 })
  }
}
