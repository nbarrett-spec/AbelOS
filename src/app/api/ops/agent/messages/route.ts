export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// GET: Fetch conversation messages (staff-authenticated, no builder cookie needed)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const convId = searchParams.get('conversationId')

    if (!convId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
    }

    const messages: any[] = await prisma.$queryRawUnsafe(`
      SELECT m.id, m.role, m.content, m.intent, m."dataRefs", m."createdAt"
      FROM "AgentMessage" m
      WHERE m."conversationId" = $1
      ORDER BY m."createdAt" ASC
    `, convId)

    return NextResponse.json({ messages })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
