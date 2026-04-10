export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// GET /api/ops/margin-defaults — list all category margin defaults
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const defaults: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CategoryMarginDefault"
      WHERE "active" = true
      ORDER BY "sortOrder"
    `)

    return NextResponse.json({
      defaults: defaults.map((d: any) => ({
        id: d.id,
        category: d.category,
        categoryType: d.categoryType,
        defaultTargetMargin: Number(d.defaultTargetMargin),
        defaultMinMargin: Number(d.defaultMinMargin),
        sortOrder: d.sortOrder,
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
