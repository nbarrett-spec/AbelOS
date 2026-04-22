export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/webp',
]
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp']

// POST /api/ops/floor-plans/upload — Upload a floor plan file
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')

  try {
    // Audit log
    audit(request, 'CREATE', 'FloorPlan', undefined, { method: 'POST' }).catch(() => {})

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null
    const label = (formData.get('label') as string) || 'Floor Plan'
    const notes = formData.get('notes') as string | null

    if (!file || !projectId) {
      return safeJson({ error: 'File and projectId are required' }, { status: 400 })
    }

    // Validate type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return safeJson(
        { error: 'Invalid file type. Accepted: PDF, PNG, JPEG, TIFF, WebP' },
        { status: 400 }
      )
    }

    // Validate extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return safeJson(
        { error: 'Invalid file extension' },
        { status: 400 }
      )
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return safeJson({ error: 'File too large. Maximum 50MB' }, { status: 400 })
    }

    // Verify project exists
    const project: any[] = await prisma.$queryRawUnsafe(
      `SELECT p."id", p."builderId" FROM "Project" p WHERE p."id" = $1`,
      projectId
    )
    if (project.length === 0) {
      return safeJson({ error: 'Project not found' }, { status: 404 })
    }

    // Save file to disk
    const builderId = project[0].builderId
    const uploadDir = path.join(process.cwd(), 'uploads', 'floor-plans', builderId, projectId)
    await mkdir(uploadDir, { recursive: true })

    const timestamp = Date.now()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${timestamp}_${safeFileName}`
    const filePath = path.join(uploadDir, fileName)

    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))

    const fileUrl = `/uploads/floor-plans/${builderId}/${projectId}/${fileName}`

    // Get current version count for this project
    const versionResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX("version"), 0)::int + 1 as "nextVersion"
       FROM "FloorPlan" WHERE "projectId" = $1`,
      projectId
    )
    const version = versionResult[0]?.nextVersion || 1

    // Create DB record
    await prisma.$executeRawUnsafe(
      `INSERT INTO "FloorPlan" ("id", "projectId", "label", "fileName", "fileUrl", "fileSize", "fileType", "version", "notes", "uploadedById")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      projectId,
      label,
      file.name,
      fileUrl,
      file.size,
      file.type,
      version,
      notes || null,
      staffId
    )

    // Fetch back the created record
    const created: any[] = await prisma.$queryRawUnsafe(
      `SELECT fp.*,
              s."firstName" || ' ' || s."lastName" as "uploadedByName"
       FROM "FloorPlan" fp
       LEFT JOIN "Staff" s ON s."id" = fp."uploadedById"
       WHERE fp."fileUrl" = $1
       ORDER BY fp."createdAt" DESC LIMIT 1`,
      fileUrl
    )

    return safeJson({ floorPlan: created[0] || null }, { status: 201 })
  } catch (error: any) {
    console.error('Floor plan upload error:', error)
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}
