'use client'

/**
 * Ops-side Delivery detail page.
 *
 * Intentionally minimal — the page exists to surface the two things we
 * now track per-Delivery that no other ops surface shows:
 *
 *   1. Whether the builder got the auto-confirmation email (time + address)
 *   2. A Resend button, with optional CC input, for the "didn't land in
 *      the right inbox" follow-up
 *
 * The broader delivery detail (manifest items, timeline, map) is the
 * dispatch/driver pages' job; this page is scoped to the confirmation
 * workflow so it doesn't collide with the sibling agents working on
 * dispatch and the builder portal.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface DeliveryDetail {
  id: string
  deliveryNumber: string
  address: string | null
  completedAt: string | null
  status: string
  signedBy: string | null
  jobNumber: string | null
  orderNumber: string | null
  builderName: string | null
  builderEmail: string | null
  confirmationSentAt: string | null
  confirmationSentTo: string | null
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function OpsDeliveryDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [data, setData] = useState<DeliveryDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ccInput, setCcInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ops/deliveries/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e: any) {
      setError(e?.message || 'Failed to load delivery')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function resend(force: boolean) {
    if (!data) return
    setSending(true)
    setSendResult(null)
    try {
      const ccEmails = ccInput
        .split(/[,\s;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.includes('@'))

      const res = await fetch(`/api/ops/deliveries/${id}/send-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccEmails, force }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.sent) {
        setSendResult(
          `Sent to ${(json.recipientEmails || []).join(', ')}.`,
        )
        setCcInput('')
        await load()
      } else if (json.reason === 'already_sent') {
        setSendResult(
          `Already sent at ${fmtDateTime(json.alreadySentAt)} to ${(json.recipientEmails || []).join(', ') || 'unknown'}. Tap Resend to send again.`,
        )
      } else {
        setSendResult(
          `Send failed: ${json.reason || json.error || 'unknown error'}`,
        )
      }
    } catch (e: any) {
      setSendResult(`Send failed: ${e?.message || 'network error'}`)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 32 }}>Loading delivery…</div>
  }
  if (error || !data) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: '#b91c1c' }}>{error || 'Delivery not found'}</p>
        <Link href="/ops/portal/delivery" style={{ color: '#0f2a3e' }}>
          Back to delivery dashboard
        </Link>
      </div>
    )
  }

  const isComplete = data.status === 'COMPLETE' || data.status === 'PARTIAL_DELIVERY'
  const hasSent = !!data.confirmationSentAt
  const canSend = isComplete && !!data.builderEmail

  return (
    <div style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
        <Link href="/ops/portal/delivery" style={{ color: '#6b7280', textDecoration: 'none' }}>
          Delivery
        </Link>{' '}
        / {data.deliveryNumber}
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f2a3e', marginBottom: 4 }}>
        Delivery {data.deliveryNumber}
      </h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
        {data.status}
        {data.completedAt ? ` · completed ${fmtDateTime(data.completedAt)}` : ''}
      </p>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <table style={{ width: '100%', fontSize: 14 }}>
          <tbody>
            <tr>
              <td style={{ padding: '6px 0', color: '#6b7280' }}>Job</td>
              <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>
                {data.jobNumber || '—'}
              </td>
            </tr>
            {data.orderNumber && (
              <tr>
                <td style={{ padding: '6px 0', color: '#6b7280' }}>Order</td>
                <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>
                  {data.orderNumber}
                </td>
              </tr>
            )}
            <tr>
              <td style={{ padding: '6px 0', color: '#6b7280' }}>Builder</td>
              <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>
                {data.builderName || '—'}
                {data.builderEmail && (
                  <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 13 }}>
                    {' '}
                    ({data.builderEmail})
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0', color: '#6b7280' }}>Address</td>
              <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>
                {data.address || '—'}
              </td>
            </tr>
            {data.signedBy && (
              <tr>
                <td style={{ padding: '6px 0', color: '#6b7280' }}>Signed by</td>
                <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 600 }}>
                  {data.signedBy}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          background: hasSent ? '#f0fdf4' : '#f8f9fa',
          border: `1px solid ${hasSent ? '#bbf7d0' : '#e5e7eb'}`,
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f2a3e', margin: '0 0 8px' }}>
          Builder confirmation email
        </h2>
        {hasSent ? (
          <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }}>
            Sent {fmtDateTime(data.confirmationSentAt)} to{' '}
            <strong>{data.confirmationSentTo || 'builder'}</strong>.
          </p>
        ) : isComplete ? (
          <p style={{ color: '#374151', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }}>
            Not sent yet. Delivery is complete — queue the confirmation below.
          </p>
        ) : (
          <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }}>
            Delivery not complete yet. The confirmation email auto-sends when the driver marks COMPLETE.
          </p>
        )}

        {canSend && (
          <>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                color: '#6b7280',
                marginBottom: 4,
                marginTop: 12,
              }}
            >
              CC additional recipients (optional — comma separated)
            </label>
            <input
              type="text"
              value={ccInput}
              onChange={(e) => setCcInput(e.target.value)}
              placeholder="super@builder.com, pm@builder.com"
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 8,
                fontSize: 14,
                marginBottom: 12,
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              {!hasSent && (
                <button
                  onClick={() => resend(false)}
                  disabled={sending}
                  style={{
                    padding: '10px 16px',
                    background: '#0f2a3e',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: sending ? 'not-allowed' : 'pointer',
                    opacity: sending ? 0.6 : 1,
                  }}
                >
                  {sending ? 'Sending…' : 'Send confirmation'}
                </button>
              )}
              {hasSent && (
                <button
                  onClick={() => resend(true)}
                  disabled={sending}
                  style={{
                    padding: '10px 16px',
                    background: '#C6A24E',
                    color: 'white',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: sending ? 'not-allowed' : 'pointer',
                    opacity: sending ? 0.6 : 1,
                  }}
                >
                  {sending ? 'Sending…' : 'Resend confirmation'}
                </button>
              )}
            </div>

            {sendResult && (
              <p style={{ marginTop: 12, fontSize: 13, color: '#374151' }}>
                {sendResult}
              </p>
            )}
          </>
        )}

        {isComplete && !data.builderEmail && (
          <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>
            No builder email on file for this order — add one on the Builder record to enable
            auto-confirmation.
          </p>
        )}
      </div>
    </div>
  )
}
