'use client'

/**
 * Builder Portal — Save Order as Template modal (A-BIZ-14).
 *
 * POSTs to /api/portal/order-templates with { sourceOrderId, name, description }.
 * On success, closes and (optionally) routes to the new templates list.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X } from 'lucide-react'

interface SaveTemplateModalProps {
  open: boolean
  onClose: () => void
  sourceOrderId: string
  defaultName: string
}

export function SaveTemplateModal({
  open,
  onClose,
  sourceOrderId,
  defaultName,
}: SaveTemplateModalProps) {
  const router = useRouter()
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/order-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceOrderId,
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to save template')
      }
      const data = await res.json()
      setSavedId(data.templateId)
    } catch (err: any) {
      setError(err?.message || 'Failed to save template')
      setSubmitting(false)
    }
  }

  function handleClose() {
    if (submitting) return
    onClose()
    setName(defaultName)
    setDescription('')
    setError(null)
    setSavedId(null)
    setSubmitting(false)
  }

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(20, 14, 10, 0.55)', backdropFilter: 'blur(2px)' }}
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-[14px] overflow-hidden"
          style={{
            background: 'var(--portal-bg-card, #FFFFFF)',
            border: '1px solid var(--portal-border, #E8DFD0)',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.25)',
          }}
        >
          <div
            className="flex items-start justify-between gap-4 px-6 py-4"
            style={{ borderBottom: '1px solid var(--portal-border-light, #F0E8DA)' }}
          >
            <div>
              <div
                className="text-[11px] uppercase mb-1"
                style={{
                  color: 'var(--portal-text-subtle)',
                  fontFamily: 'var(--font-portal-mono)',
                  letterSpacing: '0.12em',
                }}
              >
                Save as Template
              </div>
              <h2
                id="save-template-title"
                className="text-lg"
                style={{
                  color: 'var(--portal-text-strong)',
                  fontFamily: 'var(--font-portal-display)',
                  fontWeight: 500,
                }}
              >
                {savedId ? 'Template saved' : 'Save these line items'}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-[var(--portal-bg-elevated)]"
              aria-label="Close"
            >
              <X className="w-4 h-4" style={{ color: 'var(--portal-text-muted)' }} />
            </button>
          </div>

          {savedId ? (
            <div className="px-6 py-5 space-y-4">
              <p
                className="text-sm"
                style={{ color: 'var(--portal-text)' }}
              >
                Template "<strong>{name}</strong>" is now saved. Use it any time
                from your templates list to start a new order.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 h-9 rounded-full text-sm"
                  style={{
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong)',
                  }}
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleClose()
                    router.push('/portal/orders/templates')
                  }}
                  className="px-4 h-9 rounded-full text-sm font-medium"
                  style={{
                    background: 'var(--grad)',
                    color: 'white',
                  }}
                >
                  View templates
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label
                    className="block text-[11px] uppercase mb-1.5"
                    style={{
                      color: 'var(--portal-text-subtle)',
                      fontFamily: 'var(--font-portal-mono)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={200}
                    className="w-full h-9 px-3 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong)',
                    }}
                    placeholder="Standard slab door package"
                  />
                </div>
                <div>
                  <label
                    className="block text-[11px] uppercase mb-1.5"
                    style={{
                      color: 'var(--portal-text-subtle)',
                      fontFamily: 'var(--font-portal-mono)',
                      letterSpacing: '0.1em',
                    }}
                  >
                    Description (optional)
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--c1)]/30 resize-none"
                    style={{
                      background: 'var(--portal-bg-card, #FFFFFF)',
                      border: '1px solid var(--portal-border, #E8DFD0)',
                      color: 'var(--portal-text-strong)',
                    }}
                    placeholder="Use for 3-bed plan starts"
                  />
                </div>

                {error && (
                  <div
                    className="px-3 py-2 rounded-md text-sm"
                    style={{
                      background: 'rgba(110,42,36,0.08)',
                      border: '1px solid rgba(110,42,36,0.2)',
                      color: '#7E2417',
                    }}
                  >
                    {error}
                  </div>
                )}
              </div>

              <div
                className="px-6 py-3 flex items-center justify-end gap-2"
                style={{
                  borderTop: '1px solid var(--portal-border-light, #F0E8DA)',
                  background: 'var(--portal-bg-elevated, #FAF6EE)',
                }}
              >
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  className="px-4 h-9 rounded-full text-sm"
                  style={{
                    border: '1px solid var(--portal-border, #E8DFD0)',
                    color: 'var(--portal-text-strong)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="inline-flex items-center gap-1.5 px-5 h-9 rounded-full text-sm font-medium disabled:opacity-60"
                  style={{
                    background: 'var(--grad)',
                    color: 'white',
                  }}
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {submitting ? 'Saving…' : 'Save template'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </>
  )
}
