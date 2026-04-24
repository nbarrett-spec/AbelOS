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
import PageHeader from '@/components/ui/PageHeader'

export default function InboxPage() {
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [dataQualityCount, setDataQualityCount] = useState<number>(0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inbox"
        description="Pending items assigned to you, or to your role. Resolve, snooze, or escalate."
        actions={
          <>
            {dataQualityCount > 0 && (
              <Badge variant="danger" size="md">
                {dataQualityCount} data quality
              </Badge>
            )}
            <Badge variant="neutral" size="md">
              {pendingCount === null ? '…' : `${pendingCount} pending`}
            </Badge>
          </>
        }
      />

      {/* Queue */}
      <InboxQueue
        variant="full"
        limit={100}
        initialStatus="PENDING"
        onCountsChange={(total, countsByType) => {
          setPendingCount(total)
          setDataQualityCount(countsByType?.DATA_QUALITY ?? 0)
        }}
      />
    </div>
  )
}
