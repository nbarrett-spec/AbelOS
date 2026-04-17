export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Default settings returned if table is empty or doesn't exist
const DEFAULT_SETTINGS = {
  companyName: 'Abel Lumber',
  companyEmail: 'info@abellumber.com',
  companyPhone: '(940) 555-ABEL',
  companyAddress: 'Gainesville, TX',
  defaultPaymentTerms: 'NET_30',
  quoteValidityDays: '30',
  warrantyAutoApprove: 'false',
  emailNotifications: 'true',
  smsNotifications: 'false',
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/settings — Retrieve all system settings
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Staff auth check: extract staffId from request headers
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json(
        { error: 'Missing x-staff-id header' },
        { status: 401 }
      )
    }

    // Try to query settings from SystemSetting table
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(
        'SELECT "key", "value" FROM "SystemSetting"'
      )

      // Convert array of rows to key-value object
      const settings = rows.reduce(
        (acc, row) => {
          acc[row.key] = row.value
          return acc
        },
        {} as Record<string, string>
      )

      // If settings are empty, return defaults
      const mergedSettings = {
        ...DEFAULT_SETTINGS,
        ...settings,
      }

      return NextResponse.json({
        settings: mergedSettings,
      })
    } catch (dbError: any) {
      // If table doesn't exist, return sensible defaults
      if (dbError.message?.includes('does not exist')) {
        return NextResponse.json({
          settings: DEFAULT_SETTINGS,
        })
      }
      throw dbError
    }
  } catch (error: any) {
    console.error('Settings GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/settings — Update system settings (ADMIN only)
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Settings', undefined, { method: 'POST' }).catch(() => {})

    // Staff auth check: must be ADMIN role
    const staffId = request.headers.get('x-staff-id')
    const staffRole = request.headers.get('x-staff-role')

    if (!staffId) {
      return NextResponse.json(
        { error: 'Missing x-staff-id header' },
        { status: 401 }
      )
    }

    if (staffRole !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only ADMIN users can update settings' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { settings } = body

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body. Expected { settings: { key: value, ... } }' },
        { status: 400 }
      )
    }

    // Ensure SystemSetting table exists
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SystemSetting" (
          "key" TEXT PRIMARY KEY,
          "value" TEXT NOT NULL,
          "updatedAt" TIMESTAMP DEFAULT NOW()
        )
      `)
    } catch (tableError: any) {
      console.error('Failed to create SystemSetting table:', tableError)
      // Continue anyway, it might already exist
    }

    // UPSERT each key/value pair
    for (const [key, value] of Object.entries(settings)) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
           VALUES ($1, $2, NOW())
           ON CONFLICT ("key") DO UPDATE SET
           "value" = $2, "updatedAt" = NOW()`,
          key,
          String(value)
        )
      } catch (upsertError: any) {
        console.error(`Failed to upsert setting ${key}:`, upsertError)
        throw upsertError
      }
    }

    return NextResponse.json(
      { success: true },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Settings POST error:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}
