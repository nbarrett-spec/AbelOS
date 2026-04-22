import { audit } from '@/lib/audit'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const results: string[] = []

  try {
    audit(request, 'RUN_MIGRATE_AI_AGENT', 'Database', undefined, { migration: 'RUN_MIGRATE_AI_AGENT' }, 'CRITICAL').catch(() => {})
    // 1. AgentConversation — tracks each chat session
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AgentConversation" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "builderId" TEXT NOT NULL REFERENCES "Builder"(id),
          channel TEXT NOT NULL DEFAULT 'PORTAL',
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          subject TEXT,
          "lastMessageAt" TIMESTAMPTZ DEFAULT NOW(),
          "escalatedTo" TEXT REFERENCES "Staff"(id),
          "escalatedAt" TIMESTAMPTZ,
          "resolvedAt" TIMESTAMPTZ,
          metadata JSONB DEFAULT '{}',
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      results.push('✅ Created AgentConversation table')
    } catch (e: any) { results.push(`⚠️ AgentConversation: ${e.message}`) }

    // 2. AgentMessage — individual messages in a conversation
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AgentMessage" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "conversationId" TEXT NOT NULL REFERENCES "AgentConversation"(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'user',
          content TEXT NOT NULL,
          intent TEXT,
          "dataRefs" JSONB DEFAULT '[]',
          "createdAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      results.push('✅ Created AgentMessage table')
    } catch (e: any) { results.push(`⚠️ AgentMessage: ${e.message}`) }

    // 3. ScheduleChangeRequest — builder-initiated reschedule requests
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ScheduleChangeRequest" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "requestNumber" TEXT UNIQUE NOT NULL,
          "builderId" TEXT NOT NULL REFERENCES "Builder"(id),
          "conversationId" TEXT REFERENCES "AgentConversation"(id),
          "jobId" TEXT REFERENCES "Job"(id),
          "deliveryId" TEXT REFERENCES "Delivery"(id),
          "scheduleEntryId" TEXT REFERENCES "ScheduleEntry"(id),
          "requestType" TEXT NOT NULL DEFAULT 'RESCHEDULE',
          "currentDate" DATE,
          "requestedDate" DATE,
          "requestedTime" TEXT,
          reason TEXT,
          "autoApproved" BOOLEAN DEFAULT false,
          status TEXT NOT NULL DEFAULT 'PENDING',
          "reviewedById" TEXT REFERENCES "Staff"(id),
          "reviewedAt" TIMESTAMPTZ,
          "reviewNotes" TEXT,
          "createdAt" TIMESTAMPTZ DEFAULT NOW(),
          "updatedAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      results.push('✅ Created ScheduleChangeRequest table')
    } catch (e: any) { results.push(`⚠️ ScheduleChangeRequest: ${e.message}`) }

    // 4. AgentSmsLog — SMS message tracking
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AgentSmsLog" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "conversationId" TEXT REFERENCES "AgentConversation"(id),
          "builderId" TEXT REFERENCES "Builder"(id),
          "phoneNumber" TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'INBOUND',
          body TEXT NOT NULL,
          "externalId" TEXT,
          status TEXT DEFAULT 'SENT',
          "createdAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      results.push('✅ Created AgentSmsLog table')
    } catch (e: any) { results.push(`⚠️ AgentSmsLog: ${e.message}`) }

    // 5. AgentEmailLog — Email inquiry tracking
    try {
      await prisma.$queryRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AgentEmailLog" (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
          "conversationId" TEXT REFERENCES "AgentConversation"(id),
          "builderId" TEXT REFERENCES "Builder"(id),
          "fromEmail" TEXT NOT NULL,
          "toEmail" TEXT NOT NULL,
          subject TEXT,
          body TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'INBOUND',
          "externalId" TEXT,
          status TEXT DEFAULT 'RECEIVED',
          "createdAt" TIMESTAMPTZ DEFAULT NOW()
        )
      `)
      results.push('✅ Created AgentEmailLog table')
    } catch (e: any) { results.push(`⚠️ AgentEmailLog: ${e.message}`) }

    // 6. Indexes
    try {
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_agent_conv_builder ON "AgentConversation"("builderId")`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_agent_conv_status ON "AgentConversation"(status)`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_agent_conv_channel ON "AgentConversation"(channel)`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_agent_msg_conv ON "AgentMessage"("conversationId")`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_agent_msg_role ON "AgentMessage"(role)`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_schedule_change_builder ON "ScheduleChangeRequest"("builderId")`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_schedule_change_status ON "ScheduleChangeRequest"(status)`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_sms_log_conv ON "AgentSmsLog"("conversationId")`)
      await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_email_log_conv ON "AgentEmailLog"("conversationId")`)
      results.push('✅ Created 9 indexes')
    } catch (e: any) { results.push(`⚠️ Indexes: ${e.message}`) }

    return NextResponse.json({ success: true, results })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error', results }, { status: 500 })
  }
}
