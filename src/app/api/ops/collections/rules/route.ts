export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "name", "daysOverdue", "actionType", "channel",
             "templateBody", "isActive", "createdAt"
      FROM "CollectionRule"
      ORDER BY "daysOverdue" ASC
    `)

    return NextResponse.json({
      rules,
      total: rules.length,
    })
  } catch (error) {
    console.error('GET /api/ops/collections/rules error:', error)
    return NextResponse.json({ error: 'Failed to fetch collection rules' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, daysOverdue, actionType, channel, templateBody, isActive } = body

    if (!name || daysOverdue === undefined || !actionType || !channel) {
      return NextResponse.json(
        { error: 'Missing required fields: name, daysOverdue, actionType, channel' },
        { status: 400 }
      )
    }

    // Validate actionType
    const validActionTypes = ['REMINDER', 'PAST_DUE', 'FINAL_NOTICE', 'ACCOUNT_HOLD', 'PHONE_CALL', 'PAYMENT_PLAN']
    if (!validActionTypes.includes(actionType)) {
      return NextResponse.json(
        { error: `Invalid actionType. Must be one of: ${validActionTypes.join(', ')}` },
        { status: 400 }
      )
    }

    const ruleId = `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(`
      INSERT INTO "CollectionRule" (
        "id", "name", "daysOverdue", "actionType", "channel", "templateBody", "isActive", "createdAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, NOW()
      )
    `, ruleId, name, daysOverdue, actionType, channel, templateBody || null, isActive !== false)

    await audit(request, 'CREATE', 'CollectionRule', ruleId, {
      name,
      daysOverdue,
      actionType,
      channel,
    })

    // Fetch and return the created rule
    const created: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CollectionRule" WHERE "id" = $1
    `, ruleId)

    return NextResponse.json(created[0], { status: 201 })
  } catch (error) {
    console.error('POST /api/ops/collections/rules error:', error)
    return NextResponse.json({ error: 'Failed to create collection rule' }, { status: 500 })
  }
}
