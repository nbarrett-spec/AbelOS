export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/pricing/rules — List pricing rules.
 * POST /api/agent-hub/pricing/rules — Create/update a pricing rule.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "PricingRule" ORDER BY "priority" ASC, "createdAt" DESC
    `)

    return NextResponse.json({ data: rules, total: rules.length })
  } catch (error) {
    console.error('GET /api/agent-hub/pricing/rules error:', error)
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, ruleType, conditions, adjustment, priority, isActive, effectiveDate, expiryDate } = body

    if (!name || !ruleType) {
      return NextResponse.json({ error: 'Missing name and ruleType' }, { status: 400 })
    }

    const id = `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "PricingRule" ("id", "name", "ruleType", "conditions", "adjustment", "priority", "isActive", "effectiveDate", "expiryDate", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, NOW(), NOW())
    `,
      id, name, ruleType,
      JSON.stringify(conditions || {}),
      JSON.stringify(adjustment || {}),
      priority || 50,
      isActive !== false,
      effectiveDate ? new Date(effectiveDate) : null,
      expiryDate ? new Date(expiryDate) : null
    )

    return NextResponse.json({ id, name, ruleType }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/pricing/rules error:', error)
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 })
  }
}
