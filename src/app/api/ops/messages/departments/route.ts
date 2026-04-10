export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

const DEPARTMENTS = [
  'EXECUTIVE',
  'SALES',
  'ESTIMATING',
  'OPERATIONS',
  'MANUFACTURING',
  'WAREHOUSE',
  'DELIVERY',
  'INSTALLATION',
  'ACCOUNTING',
  'PURCHASING',
]

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get all existing department channels with raw SQL
    const existingChannels = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        c.id,
        c.name,
        c."departmentScope",
        c."createdAt",
        (SELECT COUNT(*)::int FROM "Message" WHERE "conversationId" = c.id) as messages,
        (SELECT COUNT(*)::int FROM "ConversationParticipant" WHERE "conversationId" = c.id) as participants
      FROM "Conversation" c
      WHERE c.type = 'DEPARTMENT'
      ORDER BY c."createdAt" ASC
      `
    )

    // Fetch participants for each channel
    const channelsWithParticipants = await Promise.all(
      existingChannels.map(async (channel: any) => {
        const participants = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT "staffId"
          FROM "ConversationParticipant"
          WHERE "conversationId" = $1
          `,
          channel.id
        )

        return {
          id: channel.id,
          name: channel.name,
          departmentScope: channel.departmentScope,
          createdAt: channel.createdAt,
          participants: participants.map((p: any) => ({ staffId: p.staffId })),
          _count: {
            messages: channel.messages,
            participants: channel.participants,
          },
        }
      })
    )

    // Identify missing departments
    const existingDepartments = new Set(
      channelsWithParticipants.map((c: any) => c.departmentScope)
    )
    const missingDepartments = DEPARTMENTS.filter(
      (dept) => !existingDepartments.has(dept)
    )

    // Auto-create missing department channels
    let createdChannelsResult: any[] = []

    if (missingDepartments.length > 0) {
      // Get admin user for creating channels
      const adminResult = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT id FROM "Staff"
        WHERE role = 'ADMIN'
        LIMIT 1
        `
      )

      if (adminResult.length > 0) {
        const admin = adminResult[0]

        for (const dept of missingDepartments) {
          // Get all staff members in this department
          const deptStaff = await prisma.$queryRawUnsafe<any[]>(
            `
            SELECT id FROM "Staff"
            WHERE department = $1 AND active = true
            `,
            dept
          )

          // Create channel with all department staff as participants
          const participantIds = Array.from(
            new Set([
              admin.id,
              ...deptStaff.map((s: any) => s.id),
            ])
          )

          const conversationId = `conv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
          const now = new Date()

          // Create conversation
          await prisma.$executeRawUnsafe(
            `
            INSERT INTO "Conversation" (id, type, name, "departmentScope", "createdById", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            conversationId,
            'DEPARTMENT',
            `${dept} Channel`,
            dept,
            admin.id,
            now,
            now
          )

          // Create participant entries
          for (const participantId of participantIds) {
            await prisma.$executeRawUnsafe(
              `
              INSERT INTO "ConversationParticipant" ("conversationId", "staffId", "createdAt")
              VALUES ($1, $2, $3)
              `,
              conversationId,
              participantId,
              now
            )
          }

          // Fetch created channel data
          const createdConv = await prisma.$queryRawUnsafe<any[]>(
            `
            SELECT id, name, "departmentScope", "createdAt"
            FROM "Conversation"
            WHERE id = $1
            `,
            conversationId
          )

          const participants = await prisma.$queryRawUnsafe<any[]>(
            `
            SELECT "staffId"
            FROM "ConversationParticipant"
            WHERE "conversationId" = $1
            `,
            conversationId
          )

          const messageCount = await prisma.$queryRawUnsafe<any[]>(
            `
            SELECT COUNT(*)::int as count FROM "Message" WHERE "conversationId" = $1
            `,
            conversationId
          )

          createdChannelsResult.push({
            id: createdConv[0].id,
            name: createdConv[0].name,
            departmentScope: createdConv[0].departmentScope,
            createdAt: createdConv[0].createdAt,
            participants: participants.map((p: any) => ({ staffId: p.staffId })),
            _count: {
              messages: messageCount[0]?.count || 0,
              participants: participantIds.length,
            },
          })
        }
      }
    }

    // Combine existing and newly created channels
    const allChannels = [...channelsWithParticipants, ...createdChannelsResult]

    return NextResponse.json({
      channels: allChannels,
      created: createdChannelsResult.length,
      message:
        createdChannelsResult.length > 0
          ? `Retrieved ${channelsWithParticipants.length} existing department channels and created ${createdChannelsResult.length} new ones`
          : `Retrieved ${channelsWithParticipants.length} department channels`,
    })
  } catch (error) {
    console.error('Failed to fetch/create department channels:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
