export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { MAX_FILE_SIZE, ALLOWED_BLUEPRINT_TYPES } from '@/lib/constants'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file || !projectId) {
      return NextResponse.json(
        { error: 'File and projectId are required' },
        { status: 400 }
      )
    }

    // Validate file type (MIME + extension)
    if (!ALLOWED_BLUEPRINT_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Accepted: PDF, PNG, JPEG, TIFF' },
        { status: 400 }
      )
    }

    // Also validate file extension to prevent MIME spoofing
    const allowedExtensions = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff']
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!allowedExtensions.includes(ext)) {
      return NextResponse.json(
        { error: 'Invalid file extension. Accepted: .pdf, .png, .jpg, .jpeg, .tif, .tiff' },
        { status: 400 }
      )
    }

    // Validate file size — 25MB cap (A-SEC-9, see lib/constants.ts).
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 25MB' },
        { status: 413 }
      )
    }

    // Verify project belongs to this builder
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId" FROM "Project" WHERE "id" = $1 AND "builderId" = $2 LIMIT 1`,
      projectId,
      session.builderId
    )
    if (!projects[0]) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Save file
    const uploadDir = path.join(
      process.cwd(),
      'uploads',
      session.builderId,
      projectId
    )
    await mkdir(uploadDir, { recursive: true })

    const timestamp = Date.now()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${timestamp}_${safeFileName}`
    const filePath = path.join(uploadDir, fileName)

    const bytes = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(bytes))

    // Create blueprint record
    const blueprintId = `bp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const fileUrl = `/uploads/${session.builderId}/${projectId}/${fileName}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Blueprint" ("id", "projectId", "fileName", "fileUrl", "fileSize", "fileType", "processingStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW(), NOW())`,
      blueprintId,
      projectId,
      file.name,
      fileUrl,
      file.size,
      file.type
    )

    // Update project status
    await prisma.$executeRawUnsafe(
      `UPDATE "Project" SET "status" = 'BLUEPRINT_UPLOADED', "updatedAt" = NOW() WHERE "id" = $1`,
      projectId
    )

    return NextResponse.json({
      blueprint: {
        id: blueprintId,
        projectId,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        fileType: file.type,
        processingStatus: 'PENDING',
      }
    }, { status: 201 })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}
