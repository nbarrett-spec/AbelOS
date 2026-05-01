/**
 * Builder Portal — Messages.
 *
 * Phase 4 of BUILDER-PORTAL-SPEC.md (§4.8).
 *
 * Server component shell — the actual chat UI is fully client-side because
 * it needs polling, message-input state, and instant scroll-to-bottom.
 * Server pre-fetches the conversation list on first paint so the panel
 * isn't empty.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { MessagesClient, type ConversationRow } from './_MessagesClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Chat with your Abel team.',
}

interface ConversationsResponse {
  conversations: ConversationRow[]
  total: number
}

async function fetchConversations(): Promise<ConversationRow[]> {
  try {
    const cookieStore = await cookies()
    const headerStore = await headers()
    const proto =
      headerStore.get('x-forwarded-proto') ||
      (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const host =
      headerStore.get('x-forwarded-host') ||
      headerStore.get('host') ||
      `localhost:${process.env.PORT || 3000}`
    const url = `${proto}://${host}/api/builder/chat?take=40`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as ConversationsResponse
    return data.conversations ?? []
  } catch {
    return []
  }
}

export default async function PortalMessagesPage() {
  const session = await getSession()
  if (!session) return null

  const conversations = await fetchConversations()

  return (
    <Suspense fallback={null}>
      <MessagesClient initialConversations={conversations} />
    </Suspense>
  )
}
