export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/inspections/templates — List all inspection templates
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const templates: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "InspectionTemplate" WHERE "active" = true ORDER BY "category", "name"`
    )
    return NextResponse.json({ templates })
  } catch (error: any) {
    console.error('[InspectionTemplates GET]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// POST /api/ops/inspections/templates — Create custom template
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Inspections', undefined, { method: 'POST' }).catch(() => {})

    const { name, code, description, category, items } = await request.json()
    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 })
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "InspectionTemplate" ("id", "name", "code", "description", "category", "items")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      name, code, description || null, category || 'GENERAL', JSON.stringify(items || [])
    )

    return NextResponse.json({ template: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[InspectionTemplates POST]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
