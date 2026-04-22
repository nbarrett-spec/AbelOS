export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const DEFAULT_PREFERENCES = {
  theme: 'system',
  accentColor: '#C6A24E',
  sidebarCollapsed: false,
  compactMode: false,
  dashboardLayout: {},
  hiddenSections: [],
  pinnedSections: [],
  fontSize: 'medium',
}

const VALID_THEMES = ['light', 'dark', 'system']
const VALID_FONT_SIZES = ['small', 'medium', 'large']
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ preferences: DEFAULT_PREFERENCES })
    }

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "theme", "accentColor", "sidebarCollapsed", "compactMode",
              "dashboardLayout", "hiddenSections", "pinnedSections", "fontSize"
       FROM "StaffPreferences" WHERE "staffId" = $1`,
      staffId
    )

    return NextResponse.json({
      preferences: rows.length > 0 ? rows[0] : DEFAULT_PREFERENCES,
    })
  } catch (error: any) {
    console.error('GET /api/ops/preferences error:', error)
    return NextResponse.json({ preferences: DEFAULT_PREFERENCES })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Preferences', undefined, { method: 'PATCH' }).catch(() => {})

    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'No staff ID' }, { status: 400 })
    }

    const body = await request.json()

    // Validate
    if (body.theme !== undefined && !VALID_THEMES.includes(body.theme)) {
      return NextResponse.json({ error: 'Invalid theme' }, { status: 400 })
    }
    if (body.fontSize !== undefined && !VALID_FONT_SIZES.includes(body.fontSize)) {
      return NextResponse.json({ error: 'Invalid fontSize' }, { status: 400 })
    }
    if (body.accentColor !== undefined && !HEX_PATTERN.test(body.accentColor)) {
      return NextResponse.json({ error: 'Invalid accentColor' }, { status: 400 })
    }

    // Build SET clause dynamically
    const allowedFields = [
      'theme', 'accentColor', 'sidebarCollapsed', 'compactMode',
      'dashboardLayout', 'hiddenSections', 'pinnedSections', 'fontSize',
    ]
    const jsonbFields = ['dashboardLayout', 'hiddenSections', 'pinnedSections']

    const setClauses: string[] = []
    const params: any[] = [staffId] // $1 = staffId
    let idx = 2

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        const isJsonb = jsonbFields.includes(field)
        setClauses.push(`"${field}" = $${idx}${isJsonb ? '::jsonb' : ''}`)
        params.push(isJsonb ? JSON.stringify(body[field]) : body[field])
        idx++
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Try UPDATE first
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "StaffPreferences" SET ${setClauses.join(', ')}, "updatedAt" = NOW() WHERE "staffId" = $1`,
      ...params
    )

    // INSERT if no existing record
    if (updated === 0) {
      const insertCols = ['"id"', '"staffId"']
      const insertVals = ['gen_random_uuid()::text', '$1']
      const insertParams: any[] = [staffId]
      let insertIdx = 2

      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          const isJsonb = jsonbFields.includes(field)
          insertCols.push(`"${field}"`)
          insertVals.push(`$${insertIdx}${isJsonb ? '::jsonb' : ''}`)
          insertParams.push(isJsonb ? JSON.stringify(body[field]) : body[field])
          insertIdx++
        }
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "StaffPreferences" (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`,
        ...insertParams
      )
    }

    // Return updated preferences
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "theme", "accentColor", "sidebarCollapsed", "compactMode",
              "dashboardLayout", "hiddenSections", "pinnedSections", "fontSize"
       FROM "StaffPreferences" WHERE "staffId" = $1`,
      staffId
    )

    return NextResponse.json({
      preferences: rows.length > 0 ? rows[0] : DEFAULT_PREFERENCES,
    })
  } catch (error: any) {
    console.error('PATCH /api/ops/preferences error:', error)
    return NextResponse.json(
      { error: 'Failed to update preferences'},
      { status: 500 }
    )
  }
}
