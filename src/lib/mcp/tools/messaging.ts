/**
 * MCP tools — Messaging domain (builder support threads).
 *
 * Tools:
 *   - send_builder_message  (WRITE) — post a staff message into a builder's
 *     BUILDER_SUPPORT thread, creating the thread if none exists.
 *   - get_builder_messages  (READ)  — fetch the most-recent BUILDER_SUPPORT
 *     thread's messages for a builder, paginated.
 *
 * Sender resolution note:
 *   `Message.senderId` is `Staff` NOT NULL (drift reconciled 2026-04-22 — see
 *   `prisma/schema.prisma` lines 2057–2084). MCP-originated staff messages
 *   have no logged-in user, so we resolve to "any Staff WHERE role='ADMIN'
 *   ORDER BY createdAt LIMIT 1" and stamp that id on both
 *   `Conversation.createdById` (when creating a new thread) and
 *   `Message.senderId`. Same fallback used when a thread is auto-created.
 *   If no ADMIN exists the tool returns a structured error rather than
 *   silently picking another role.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit, withRateLimit } from '@/lib/mcp/wrap'

async function resolveAdminStaffId(): Promise<string | null> {
  const admin = await prisma.staff.findFirst({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return admin?.id ?? null
}

export function registerMessagingTools(server: McpServer) {
  // ──────────────────────────────────────────────────────────────────
  // send_builder_message
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'send_builder_message',
    {
      description:
        'Post a staff message into a builder\'s BUILDER_SUPPORT conversation. Reuses the most-recent open thread for the builder; creates a new thread (with optional subject) if none exists. Returns { messageId, conversationId, threadCreated }.',
      inputSchema: {
        builderId: z.string().describe('Builder ID (cuid format) — required.'),
        message: z.string().min(1).describe('Message body to send. Required.'),
        subject: z
          .string()
          .optional()
          .describe(
            'Subject line, used only when a new thread is created. Defaults to "Builder support".',
          ),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit('send_builder_message', 'WRITE', withRateLimit('send_builder_message', async (args: any) => {
      const { builderId, message, subject } = args as {
        builderId: string
        message: string
        subject?: string
      }

      const adminStaffId = await resolveAdminStaffId()
      if (!adminStaffId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error:
                  'No ADMIN Staff record found — cannot stamp senderId on builder-support message.',
              }),
            },
          ],
          isError: true,
        }
      }

      // Verify builder exists before doing anything mutating.
      const builder = await prisma.builder.findUnique({
        where: { id: builderId },
        select: { id: true },
      })
      if (!builder) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Builder not found', builderId }),
            },
          ],
          isError: true,
        }
      }

      // Find most-recent open BUILDER_SUPPORT thread for this builder.
      let conversation = await prisma.conversation.findFirst({
        where: { type: 'BUILDER_SUPPORT', builderId },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      })

      let threadCreated = false
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: {
            type: 'BUILDER_SUPPORT',
            builderId,
            createdById: adminStaffId,
            subject: subject ?? 'Builder support',
          },
          select: { id: true },
        })
        threadCreated = true
      }

      const now = new Date()
      const preview = message.length > 140 ? `${message.slice(0, 137)}...` : message

      // Insert message + bump conversation last-message metadata in a tx so
      // the preview/timestamp can never disagree with the actual latest row.
      const created = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
          data: {
            conversationId: conversation!.id,
            senderId: adminStaffId,
            senderType: 'STAFF',
            body: message,
          },
          select: { id: true, conversationId: true, createdAt: true },
        })
        await tx.conversation.update({
          where: { id: conversation!.id },
          data: { lastMessageAt: now, lastMessagePreview: preview },
        })
        return msg
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                messageId: created.id,
                conversationId: created.conversationId,
                threadCreated,
              },
              null,
              2,
            ),
          },
        ],
      }
    })),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_builder_messages
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_builder_messages',
    {
      description:
        'Fetch messages from the most-recent BUILDER_SUPPORT conversation for a builder, sorted newest-first, paginated. Returns { messages, conversationId, total }.',
      inputSchema: {
        builderId: z.string().describe('Builder ID (cuid format) — required.'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_builder_messages', 'READ', async (args: any) => {
      const { builderId, page = 1, limit = 50 } = args as {
        builderId: string
        page?: number
        limit?: number
      }

      const conversation = await prisma.conversation.findFirst({
        where: { type: 'BUILDER_SUPPORT', builderId },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
      })

      if (!conversation) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                { messages: [], conversationId: null, total: 0, page, pageSize: limit },
                null,
                2,
              ),
            },
          ],
        }
      }

      const [messages, total] = await Promise.all([
        prisma.message.findMany({
          where: { conversationId: conversation.id },
          select: {
            id: true,
            conversationId: true,
            senderId: true,
            builderSenderId: true,
            senderType: true,
            body: true,
            readBy: true,
            readByBuilder: true,
            createdAt: true,
            sender: { select: { id: true, firstName: true, lastName: true } },
            builderSender: { select: { id: true, companyName: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.message.count({ where: { conversationId: conversation.id } }),
      ])

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                messages,
                conversationId: conversation.id,
                total,
                page,
                pageSize: limit,
              },
              null,
              2,
            ),
          },
        ],
      }
    }),
  )
}
