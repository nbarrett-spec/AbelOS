'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ──────────────────────────────────────────────────────────────────────────
// QuickBooks Online — Connect page (phase 2 stub)
// ──────────────────────────────────────────────────────────────────────────
// Decision (2026-04-22): We went with QBO over QB Desktop Web Connector.
// Rationale lives in memory/projects/quickbooks-decision.md. This page
// intentionally renders a disabled "Connect QuickBooks" button so the
// expectation is clear — the scaffold is in place, the OAuth handshake
// comes in phase 2.
// ──────────────────────────────────────────────────────────────────────────

interface QboStatus {
  provider: string
  connected: boolean
  configured: boolean
  realmId: string | null
  apiBase: string
  credentialsPresent: boolean
  missing: string[]
  phase: 'phase2-stub' | 'active'
  notes: string
  lastSyncAt?: string | null
  lastSyncStatus?: string | null
}

export default function QuickBooksIntegrationPage() {
  const [status, setStatus] = useState<QboStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/integrations/quickbooks/status')
      if (!res.ok) {
        throw new Error(`Failed to load status (${res.status})`)
      }
      const data = await res.json()
      setStatus(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load QuickBooks status')
    } finally {
      setLoading(false)
    }
  }

  const isPhase2 = status?.phase === 'phase2-stub'
  const phase2Tooltip = 'Coming in phase 2'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">QuickBooks Online</h1>
            <p className="text-blue-200 mt-2">
              OAuth2 sync for invoices, payments, and month-end journals.
            </p>
          </div>
          <Link
            href="/ops/integrations"
            className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm"
          >
            Integrations
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8 space-y-6">
        {/* Decision banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h3 className="font-semibold text-amber-900 mb-1">
            Decision: QuickBooks Online, not Desktop
          </h3>
          <p className="text-sm text-amber-800">
            We retired the QuickBooks Web Connector (QBWC) path on 2026-04-22
            in favor of QuickBooks Online via OAuth2. No data migration — QB
            sync was never live in Aegis. The scaffold below goes live in
            phase 2.
          </p>
        </div>

        {/* Status card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-[#1e3a5f] text-lg">Connection Status</h2>
            <button
              onClick={loadStatus}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Refresh
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
              Loading status...
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          )}

          {!loading && !error && status && (
            <div className="space-y-3">
              <StatusRow
                label="Phase"
                value={status.phase === 'phase2-stub' ? 'Phase 2 — stub (not live)' : 'Active'}
                tone={status.phase === 'phase2-stub' ? 'warn' : 'ok'}
              />
              <StatusRow
                label="Credentials"
                value={status.credentialsPresent ? 'All env vars set' : `Missing: ${status.missing.join(', ')}`}
                tone={status.credentialsPresent ? 'ok' : 'warn'}
              />
              <StatusRow
                label="Connected"
                value={status.connected ? 'Yes' : 'No'}
                tone={status.connected ? 'ok' : 'muted'}
              />
              <StatusRow label="Realm ID" value={status.realmId || '—'} />
              <StatusRow label="API Base" value={status.apiBase} />
              <StatusRow
                label="Last Sync"
                value={status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Never'}
              />
              <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
                {status.notes}
              </p>
            </div>
          )}
        </div>

        {/* Connect CTA */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-bold text-[#1e3a5f] text-lg mb-2">Connect QuickBooks</h2>
          <p className="text-sm text-gray-600 mb-4">
            When phase 2 ships, this button kicks off the OAuth2 authorization
            flow with Intuit. You'll be redirected to QuickBooks to choose a
            company, approve scopes, and land back here with the realm ID
            populated.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isPhase2}
              title={isPhase2 ? phase2Tooltip : undefined}
              aria-disabled={isPhase2}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isPhase2
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-[#0f2a3e] hover:bg-[#163d5c] text-white'
              }`}
            >
              Connect QuickBooks
            </button>
            {isPhase2 && (
              <span className="text-xs text-gray-500">{phase2Tooltip}</span>
            )}
          </div>
        </div>

        {/* What phase 2 turns on */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-bold text-[#1e3a5f] text-lg mb-3">Phase 2 Sync Coverage</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>
                <strong>Invoices</strong> — push new/updated Aegis invoices to QBO.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>
                <strong>Payments</strong> — mirror builder payments into QBO customer AR.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-gray-400">•</span>
              <span>
                <strong>Month-end journals</strong> — post closing journal entries for
                the period into QBO.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'muted'
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
      ? 'text-amber-700'
      : tone === 'muted'
      ? 'text-gray-500'
      : 'text-gray-800'
  return (
    <div className="flex items-start justify-between gap-6 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={`font-medium text-right break-all ${toneClass}`}>{value}</span>
    </div>
  )
}
