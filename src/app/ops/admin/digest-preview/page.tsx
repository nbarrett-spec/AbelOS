'use client'

/**
 * Admin: Daily Digest Preview
 *
 * Pick a staff member → render exactly what their 6 AM digest email would
 * look like right now. Admin can also "Send test" to fire a real email
 * (bypasses same-day duplicate block; still respects opt-out + empty).
 */

import { useEffect, useMemo, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'

interface StaffOption {
  id: string
  name: string
  email: string
  role: string
  roles: string | null
}

interface SectionSummary {
  key: string
  title: string
  count: number
  summary: string
  href: string
}

interface PreviewPayload {
  subject: string
  htmlBody: string
  textBody: string
  sections: SectionSummary[]
  totalItems: number
  digestDate: string
  staffEmail: string
  staffFirstName: string
}

export default function DigestPreviewPage() {
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<string>('')

  useEffect(() => {
    fetch('/api/ops/admin/digest-preview?action=staff')
      .then((r) => r.json())
      .then((data) => setStaff(data.staff || []))
      .catch(() => setErr('Failed to load staff list'))
  }, [])

  const selectedStaff = useMemo(
    () => staff.find((s) => s.id === selectedId),
    [staff, selectedId],
  )

  async function loadPreview(staffId: string) {
    setLoading(true)
    setErr(null)
    setPreview(null)
    try {
      const res = await fetch(
        `/api/ops/admin/digest-preview?staffId=${encodeURIComponent(staffId)}`,
      )
      const data = await res.json()
      if (!res.ok) {
        setErr(data.error || 'Failed to load preview')
      } else {
        setPreview(data)
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load preview')
    } finally {
      setLoading(false)
    }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  async function handleSendTest() {
    if (!selectedId) return
    setSending(true)
    try {
      const res = await fetch('/api/ops/admin/digest-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: selectedId }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Send failed')
      } else if (data.status === 'SENT') {
        showToast(`Sent to ${selectedStaff?.email}`)
      } else {
        showToast(`Not sent — ${data.status.replace(/_/g, ' ').toLowerCase()}`)
      }
    } catch {
      showToast('Send request failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-surface-elev text-fg-on-accent px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <PageHeader
        title="Daily Digest Preview"
        description={'Pick a staff member to see exactly what their 6 AM digest would look like right now. "Send test" fires a real email (opt-out still applies).'}
        crumbs={[
          { label: 'Ops', href: '/ops' },
          { label: 'Admin', href: '/ops/admin' },
          { label: 'Digest Preview' },
        ]}
      />

      <div className="bg-surface border border-border rounded-lg p-4 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs uppercase tracking-wide text-fg-muted mb-1">
            Staff
          </label>
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value)
              if (e.target.value) loadPreview(e.target.value)
            }}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-fg"
          >
            <option value="">— select —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.email} · {s.role}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-fg-muted mb-1">
            Date
          </label>
          <div className="px-3 py-2 border border-border rounded-lg text-sm bg-surface-muted text-fg-muted min-w-[120px]">
            {preview?.digestDate || 'today'}
          </div>
        </div>
        <button
          disabled={!selectedId || loading}
          onClick={() => selectedId && loadPreview(selectedId)}
          className="bg-surface-elev text-fg-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button
          disabled={!selectedId || sending}
          onClick={handleSendTest}
          className="bg-signal text-fg-on-accent px-4 py-2 rounded-lg text-sm font-medium hover:bg-signal-hover disabled:opacity-50"
          title="Fires a real email (bypasses duplicate-block)"
        >
          {sending ? 'Sending…' : 'Send test'}
        </button>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">
          {err}
        </div>
      )}

      {preview && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-surface border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-fg mb-3">
                Summary
              </h2>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between">
                  <dt className="text-fg-muted">To</dt>
                  <dd className="font-mono text-xs">{preview.staffEmail}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Subject</dt>
                  <dd className="text-right text-xs max-w-[70%] truncate" title={preview.subject}>
                    {preview.subject}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Total items</dt>
                  <dd className="font-semibold">{preview.totalItems}</dd>
                </div>
              </dl>
            </div>

            <div className="bg-surface border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-fg mb-3">
                Sections ({preview.sections.length})
              </h2>
              {preview.sections.length === 0 ? (
                <p className="text-xs text-fg-muted">
                  Empty digest — this staff would be skipped by the cron.
                </p>
              ) : (
                <ul className="space-y-2">
                  {preview.sections.map((s) => (
                    <li
                      key={s.key}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-fg-muted">{s.title}</span>
                      <span className="text-xs bg-signal-subtle text-signal px-2 py-0.5 rounded-full font-medium">
                        {s.count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-surface border border-border rounded-lg overflow-hidden">
            <div className="border-b border-border px-4 py-2 text-xs text-fg-muted flex items-center justify-between">
              <span>Rendered HTML</span>
              <span className="font-mono">{preview.subject}</span>
            </div>
            <iframe
              title="Digest preview"
              srcDoc={preview.htmlBody}
              className="w-full border-0"
              style={{ minHeight: '720px', background: '#f5f5f5' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
