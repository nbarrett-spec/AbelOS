'use client'

/**
 * Unified Operator Inbox — triage queue
 *
 * Three-column layout:
 *   - Left:   type filter sidebar with counts
 *   - Middle: list of pending items (priority-sorted)
 *   - Right:  detail pane for selected item (+ resolve/snooze/escalate/take-action)
 *
 * Keyboard: J/K to navigate · R resolve · S snooze · E escalate · Enter take action
 *
 * All actions routed through per-item endpoints under /api/ops/inbox/[id]/*
 * Backed by the role-scoped GET /api/ops/inbox/scoped.
 */

import { useState } from 'react'
import InboxQueue from '@/components/ui/InboxQueue'
import Badge from '@/components/ui/Badge'

export default function InboxPage() {
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      {/* Page header */}
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-fg tracking-tight">Inbox</h1>
          <p className="text-xs text-fg-subtle mt-1">
            Pending items assigned to you, or to your role. Resolve, snooze, or escalate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="neutral" size="md">
            {pendingCount === null ? '…' : `${pendingCount} pending`}
          </Badge>
        </div>
      </header>

      {/* Queue */}
      <InboxQueue
        variant="full"
        limit={100}
        initialStatus="PENDING"
        onCountsChange={(total) => setPendingCount(total)}
      />
    </div>
  )
}
