'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import SignaturePad, { SignaturePadHandle } from '@/components/SignaturePad'
import { Badge } from '@/components/ui'
import { enqueueCompletion } from '../ServiceWorker'

// ──────────────────────────────────────────────────────────────────────────
// Driver — Single-stop completion screen
//
// Driver taps "Complete delivery" on a stop card and lands here. Captures:
//   • Recipient name (who accepted on site)
//   • Signature (canvas, touch + mouse)
//   • Photos from the phone camera (input capture=environment)
//   • Damaged items (free text) + damage report toggle
//   • Partial-complete toggle
//   • Driver notes
//
// Offline-aware: if the POST fails (network out), the payload is queued in
// localStorage and retried when the device is back online.
// ──────────────────────────────────────────────────────────────────────────

interface StopDetail {
  id: string
  deliveryNumber: string
  address: string | null
  status: string
  builderName: string | null
  builderPhone: string | null
  orderNumber: string | null
  orderTotal: number | null
  jobNumber: string
  window: string | null
  notes: string
  signedBy: string | null
}

function mapsUrl(address: string | null): string {
  if (!address) return '#'
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

// Exception categorization — drives downstream triage. Stays in sync with the
// API route's accepted enum; if you add a value here, add it there too.
const EXCEPTION_CATEGORIES = [
  { value: 'NONE', label: 'No issues' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'CUSTOMER_COMPLAINT', label: 'Customer complaint' },
  { value: 'VEHICLE_ISSUE', label: 'Vehicle issue' },
  { value: 'ADDRESS_ISSUE', label: 'Address issue' },
  { value: 'REFUSED', label: 'Refused' },
  { value: 'OTHER', label: 'Other' },
] as const

type ExceptionCategory = typeof EXCEPTION_CATEGORIES[number]['value']

export default function DriverStopDetailPage() {
  const router = useRouter()
  const params = useParams<{ deliveryId: string }>()
  const deliveryId = params.deliveryId

  const [stop, setStop] = useState<StopDetail | null>(null)
  const [loading, setLoading] = useState(true)

  // Form state
  const [recipientName, setRecipientName] = useState('')
  const [notes, setNotes] = useState('')
  const [damageText, setDamageText] = useState('')
  const [hasDamage, setHasDamage] = useState(false)
  const [exceptionCategory, setExceptionCategory] = useState<ExceptionCategory>('NONE')
  const [partialComplete, setPartialComplete] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [sigHasStrokes, setSigHasStrokes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queuedOffline, setQueuedOffline] = useState(false)

  const sigRef = useRef<SignaturePadHandle>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Load stop from today list (cheap — SW cached). We don't have a single-
  // delivery GET endpoint yet, so filter from the list.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/delivery/today')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      for (const bucket of data.drivers || []) {
        const found = (bucket.deliveries || []).find((d: any) => d.id === deliveryId)
        if (found) {
          setStop(found as StopDetail)
          return
        }
      }
      setError('Delivery not found on today\'s route.')
    } catch (e: any) {
      setError(e?.message || 'Failed to load delivery')
    } finally {
      setLoading(false)
    }
  }, [deliveryId])

  useEffect(() => {
    load()
  }, [load])

  // ── Photo capture ──────────────────────────────────────────────────────
  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return
    const encoded: string[] = []
    for (const file of Array.from(files)) {
      // Downscale jumbo camera shots so we don't blow out localStorage /
      // payload size. Canvas-based resize keeps dependencies zero.
      try {
        const resized = await resizeImage(file, 1280, 0.7)
        encoded.push(resized)
      } catch {
        // If resize fails, fall back to raw dataURL
        encoded.push(await fileToDataUrl(file))
      }
    }
    setPhotos((p) => [...p, ...encoded])
  }

  function removePhoto(i: number) {
    setPhotos((p) => p.filter((_, idx) => idx !== i))
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  async function submit() {
    setError(null)
    if (!recipientName.trim()) {
      setError('Recipient name is required.')
      return
    }
    const signatureDataUrl = sigRef.current?.toDataURL() ?? null
    if (!signatureDataUrl && !partialComplete) {
      setError('Signature required (or mark as partial delivery).')
      return
    }

    // If the driver toggled damage on but didn't pick a more specific
    // category, default the exception type to DAMAGE so the API/audit log
     // sees a non-NONE value. Driver's explicit pick always wins.
    const resolvedCategory: ExceptionCategory =
      exceptionCategory !== 'NONE' ? exceptionCategory : hasDamage ? 'DAMAGE' : 'NONE'

    const payload = {
      recipientName: recipientName.trim(),
      signatureDataUrl,
      photos,
      damagedItems: hasDamage && damageText.trim() ? [damageText.trim()] : [],
      damageNotes: hasDamage ? damageText.trim() || null : null,
      partialComplete,
      notes: notes.trim() || null,
      exceptionCategory: resolvedCategory,
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/ops/delivery/${deliveryId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push('/ops/portal/driver?completed=1')
    } catch (e: any) {
      // Offline or server error — queue for retry
      enqueueCompletion({
        id: deliveryId,
        payload,
        queuedAt: new Date().toISOString(),
        attempts: 0,
      })
      setQueuedOffline(true)
      setTimeout(() => router.push('/ops/portal/driver'), 1200)
    } finally {
      setSubmitting(false)
    }
  }

  const totalSize = useMemo(() => {
    return photos.reduce((acc, p) => acc + p.length, 0)
  }, [photos])

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', fontSize: 14 }}>Loading stop…</div>
  }

  if (!stop) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 16 }}>Delivery not found.</div>
        {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
        <Link href="/ops/portal/driver" style={backLinkStyle}>← Back to route</Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 120 }}>
      {/* Sticky header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--canvas, #0e1113)',
          borderBottom: '1px solid var(--border, #2a2722)',
          padding: '12px 16px',
        }}
      >
        <Link
          href="/ops/portal/driver"
          style={{
            fontSize: 13,
            color: 'var(--fg-muted, #a39a8a)',
            textDecoration: 'none',
          }}
        >
          ← Route
        </Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 6 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {stop.builderName || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)', marginTop: 2 }}>
              {stop.deliveryNumber} · {stop.orderNumber || 'no PO'}
            </div>
          </div>
          <Badge variant="info" size="sm">
            {stop.status.replace('_', ' ')}
          </Badge>
        </div>
      </header>

      {/* Stop summary */}
      <section style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {stop.address && (
          <a
            href={mapsUrl(stop.address)}
            target="_blank"
            rel="noreferrer"
            style={linkCardStyle}
          >
            <div style={labelStyle}>Address · tap for maps</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{stop.address}</div>
          </a>
        )}
        {stop.builderPhone && (
          <a href={`tel:${stop.builderPhone.replace(/[^\d+]/g, '')}`} style={linkCardStyle}>
            <div style={labelStyle}>Contact</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{stop.builderPhone}</div>
          </a>
        )}
        {stop.notes && (
          <div style={{ ...linkCardStyle, fontStyle: 'italic', color: 'var(--fg-muted, #a39a8a)' }}>
            {stop.notes}
          </div>
        )}
      </section>

      <div style={{ height: 1, background: 'var(--border, #2a2722)', margin: '0 16px' }} />

      {/* Capture form */}
      <section style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Recipient */}
        <div>
          <div style={labelStyle}>Received by</div>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="Who signed for the delivery"
            style={inputStyle}
            autoComplete="off"
          />
        </div>

        {/* Signature */}
        <div>
          <div style={labelStyle}>Signature</div>
          <div
            style={{
              marginTop: 6,
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 12,
              background: 'var(--surface, #161a1d)',
            }}
          >
            <SignaturePad ref={sigRef} height={220} onChange={setSigHasStrokes} />
          </div>
          <div style={hintStyle}>
            {sigHasStrokes ? 'Captured — tap Clear to redo.' : 'Hand the phone to the recipient and have them sign above.'}
          </div>
        </div>

        {/* Photos */}
        <div>
          <div style={labelStyle}>Photos</div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(e) => addPhotos(e.target.files)}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            style={{
              ...bigActionBtnStyle,
              background: 'var(--surface-muted, #1f2326)',
              color: 'var(--fg, #e7e1d6)',
              marginTop: 6,
            }}
          >
            + Add photo ({photos.length})
          </button>
          {photos.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 8,
                marginTop: 10,
              }}
            >
              {photos.map((src, i) => (
                <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--surface, #161a1d)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      background: 'rgba(14, 17, 19, 0.85)',
                      color: '#fca5a5',
                      border: '1px solid var(--border, #2a2722)',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 700,
                    }}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {totalSize > 4_000_000 && (
            <div style={{ ...hintStyle, color: '#f5c168' }}>
              Heads up — total photo size is getting large ({Math.round(totalSize / 1024)} KB).
            </div>
          )}
        </div>

        {/* Exception category */}
        <div>
          <div style={labelStyle}>Exception category</div>
          <select
            value={exceptionCategory}
            onChange={(e) => setExceptionCategory(e.target.value as ExceptionCategory)}
            style={{ ...inputStyle, appearance: 'auto' }}
          >
            {EXCEPTION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <div style={hintStyle}>
            Categorize what went wrong (if anything) so the office can route it.
          </div>
        </div>

        {/* Damage */}
        <div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              background: 'var(--surface-muted, #1f2326)',
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={hasDamage}
              onChange={(e) => setHasDamage(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Report damage</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)' }}>
                Flag broken, missing, or refused items.
              </div>
            </div>
          </label>
          {hasDamage && (
            <textarea
              value={damageText}
              onChange={(e) => setDamageText(e.target.value)}
              placeholder="Describe what's damaged or missing…"
              style={{ ...inputStyle, minHeight: 80, marginTop: 8 }}
            />
          )}
        </div>

        {/* Partial */}
        <div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              background: 'var(--surface-muted, #1f2326)',
              border: '1px solid var(--border, #2a2722)',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={partialComplete}
              onChange={(e) => setPartialComplete(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Partial delivery</div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted, #a39a8a)' }}>
                Only some items dropped — job won't be marked fully delivered.
              </div>
            </div>
          </label>
        </div>

        {/* Notes */}
        <div>
          <div style={labelStyle}>Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Drop location, gate code, anything the next driver or office needs to know…"
            style={{ ...inputStyle, minHeight: 80 }}
          />
        </div>

        {error && (
          <div
            style={{
              padding: 12,
              background: '#3b1d1d',
              color: '#fca5a5',
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        {queuedOffline && (
          <div
            style={{
              padding: 12,
              background: '#2b2414',
              color: '#f5c168',
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            You're offline — delivery queued. Will sync when you're back on signal.
          </div>
        )}
      </section>

      {/* Sticky submit bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--canvas, #0e1113)',
          borderTop: '1px solid var(--border, #2a2722)',
          padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)',
          display: 'flex',
          gap: 10,
          zIndex: 20,
        }}
      >
        <Link href="/ops/portal/driver" style={{ ...backLinkStyle, flexShrink: 0 }}>
          Cancel
        </Link>
        <button
          onClick={submit}
          disabled={submitting}
          style={{
            ...bigActionBtnStyle,
            flex: 1,
            background: submitting ? 'var(--surface-muted, #1f2326)' : 'var(--accent-fg, #c6a24e)',
            color: submitting ? 'var(--fg-muted, #a39a8a)' : '#0e1113',
            opacity: submitting ? 0.8 : 1,
          }}
        >
          {submitting ? 'Submitting…' : partialComplete ? 'Submit partial' : 'Complete delivery'}
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Resize an image to fit within maxWidth while preserving aspect ratio.
 * JPEG output at the given quality. Fallback to original if anything fails.
 */
async function resizeImage(file: File, maxWidth: number, quality: number): Promise<string> {
  const src = await fileToDataUrl(file)
  const img = await loadImage(src)
  const ratio = img.width > maxWidth ? maxWidth / img.width : 1
  const w = Math.round(img.width * ratio)
  const h = Math.round(img.height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Styles
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--fg-muted, #a39a8a)',
  fontWeight: 600,
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-subtle, #7a7369)',
  marginTop: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px 14px',
  fontSize: 16, // 16px avoids iOS auto-zoom on focus
  background: 'var(--surface, #161a1d)',
  color: 'var(--fg, #e7e1d6)',
  border: '1px solid var(--border, #2a2722)',
  borderRadius: 10,
  marginTop: 6,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const linkCardStyle: React.CSSProperties = {
  display: 'block',
  padding: '12px 14px',
  background: 'var(--surface, #161a1d)',
  border: '1px solid var(--border, #2a2722)',
  borderRadius: 10,
  color: 'var(--fg, #e7e1d6)',
  textDecoration: 'none',
  fontSize: 13,
}

const bigActionBtnStyle: React.CSSProperties = {
  minHeight: 56,
  padding: '14px 16px',
  borderRadius: 10,
  fontSize: 16,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
  textAlign: 'center',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const backLinkStyle: React.CSSProperties = {
  minHeight: 56,
  padding: '14px 20px',
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid var(--border, #2a2722)',
  background: 'var(--surface-muted, #1f2326)',
  color: 'var(--fg, #e7e1d6)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
