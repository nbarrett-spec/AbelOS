export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const builderRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        id, "companyName", "contactName", email, phone, "paymentTerm",
        status, "creditLimit", "accountBalance"
       FROM "Builder" WHERE id = $1`,
      session.builderId
    )

    if (builderRows.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    const builder = builderRows[0]

    // Get counts for projects and orders
    const projectCountRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Project" WHERE "builderId" = $1`,
      session.builderId
    )
    const orderCountRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Order" WHERE "builderId" = $1`,
      session.builderId
    )

    const responseBuilder = {
      ...builder,
      _count: {
        projects: projectCountRows[0]?.count || 0,
        orders: orderCountRows[0]?.count || 0,
      },
    }

    return NextResponse.json({ builder: responseBuilder })
  } catch (error) {
    console.error('Get session error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
