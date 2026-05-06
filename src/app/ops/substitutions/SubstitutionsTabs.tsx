'use client'

import { useState } from 'react'
import SubstitutionQueue, {
  type QueueRequest,
  type QueueCounts,
} from './SubstitutionQueue'
import SubstitutionCatalog from './SubstitutionCatalog'

// ──────────────────────────────────────────────────────────────────────────
// SubstitutionsTabs — top-level tab switcher for /ops/substitutions.
//
// "Approval queue" preserves the existing PM-scoped flow (SubstitutionQueue,
// no behavior change). "Catalog browse" surfaces the new search + apply UX
// for low-stock products and their registered substitutes.
// ──────────────────────────────────────────────────────────────────────────

interface ApiResponse {
  scope: 'mine' | 'all'
  status: string
  count: number
  requests: QueueRequest[]
  counts: QueueCounts
  initialized?: boolean
  error?: string
}

interface Props {
  initial: ApiResponse | null
  initialError: string | null
  staffRole: string
  staffId: string
}

type Tab = 'queue' | 'catalog'

export default function SubstitutionsTabs(props: Props) {
  const [tab, setTab] = useState<Tab>('queue')

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Substitution views"
        className="flex items-center gap-1 border-b border-border"
      >
        {(
          [
            { id: 'queue', label: 'Approval queue' },
            { id: 'catalog', label: 'Catalog browse' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2 text-[13px] transition ${
              tab === t.id
                ? 'font-semibold text-fg'
                : 'text-fg-muted hover:text-fg'
            }`}
          >
            {t.label}
            {tab === t.id && (
              <span
                aria-hidden
                className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-fg"
              />
            )}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        hidden={tab !== 'queue'}
        aria-hidden={tab !== 'queue'}
      >
        {tab === 'queue' && <SubstitutionQueue {...props} />}
      </div>
      <div
        role="tabpanel"
        hidden={tab !== 'catalog'}
        aria-hidden={tab !== 'catalog'}
      >
        {tab === 'catalog' && <SubstitutionCatalog />}
      </div>
    </div>
  )
}
