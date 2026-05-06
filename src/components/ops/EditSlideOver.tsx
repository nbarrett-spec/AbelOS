'use client'

// ── EditSlideOver ─────────────────────────────────────────────────────────
// Generic slide-over panel for inline editing of a record (builder, community,
// etc.). Renders a form from a list of field defs, submits to a PATCH endpoint,
// closes on success and fires onSuccess with the response body.
//
// Used by:
//   - /admin/builders/[id]
//   - /ops/communities/[id]
//
// Why a custom panel instead of reusing Sheet:
// Sheet (src/components/ui/Sheet.tsx) is read-only — Details/Timeline/Files/
// Audit/Raw tabs. Editing wants a single column form with Save/Cancel in a
// sticky footer and no tabs. Wrapping Sheet would require forking its tab
// machinery; cleaner to ship a small dedicated form panel that matches the
// same visual language (right-side, glass surface, ESC-to-close, scroll lock).
// ─────────────────────────────────────────────────────────────────────────

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui'

export type FieldType =
  | 'text'
  | 'tel'
  | 'email'
  | 'url'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'

export interface FieldOption {
  value: string
  label: string
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  placeholder?: string
  /** Help text shown beneath the input. */
  hint?: string
  /** Options for `select`. */
  options?: FieldOption[]
  /** For `number` — coerce blank to null on submit (default true). */
  nullableNumber?: boolean
  /** For `text`/`textarea` — coerce blank to null (default false). */
  nullableString?: boolean
  /** Override grid span (default 1; use 2 for full-width fields). */
  colSpan?: 1 | 2
  /** Hide field entirely — useful for conditional rendering by caller. */
  hidden?: boolean
}

export interface EditSlideOverProps<T extends Record<string, any> = any> {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: ReactNode
  fields: FieldDef[]
  initialValues: T
  endpoint: string
  method?: 'PATCH' | 'PUT' | 'POST'
  /**
   * Called with the parsed JSON body after a successful response.
   * The response body shape is up to the caller's API; we don't unwrap.
   */
  onSuccess?: (body: any) => void
  /** Submit button label (default "Save changes"). */
  saveLabel?: string
}

function coerceValue(field: FieldDef, raw: any): any {
  if (field.type === 'number') {
    if (raw === '' || raw === null || raw === undefined) {
      return field.nullableNumber === false ? 0 : null
    }
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  if (field.type === 'checkbox') {
    return Boolean(raw)
  }
  if (raw === '' || raw === null || raw === undefined) {
    return field.nullableString ? null : ''
  }
  return raw
}

export function EditSlideOver<T extends Record<string, any>>({
  open,
  onClose,
  title,
  subtitle,
  fields,
  initialValues,
  endpoint,
  method = 'PATCH',
  onSuccess,
  saveLabel = 'Save changes',
}: EditSlideOverProps<T>) {
  const visibleFields = useMemo(() => fields.filter((f) => !f.hidden), [fields])

  const [values, setValues] = useState<Record<string, any>>(() => ({
    ...initialValues,
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [topError, setTopError] = useState<string | null>(null)
  const [visible, setVisible] = useState(open)
  const [entering, setEntering] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Re-seed values when initialValues changes between opens. Run only on
  // open transition so an in-progress edit isn't blown away by a parent
  // re-render that re-passes the same prop reference.
  useEffect(() => {
    if (open) {
      setValues({ ...initialValues })
      setErrors({})
      setTopError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Enter/exit animation hook (matches Sheet timing).
  useEffect(() => {
    if (open) {
      setVisible(true)
      requestAnimationFrame(() => setEntering(true))
    } else if (visible) {
      setEntering(false)
      const t = setTimeout(() => setVisible(false), 240)
      return () => clearTimeout(t)
    }
    return
  }, [open, visible])

  // ESC closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!visible) return null

  function setField(key: string, raw: any) {
    setValues((prev) => ({ ...prev, [key]: raw }))
    if (errors[key]) {
      setErrors((prev) => {
        const { [key]: _omit, ...rest } = prev
        return rest
      })
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    for (const f of visibleFields) {
      if (!f.required) continue
      const v = values[f.key]
      const empty =
        v === undefined ||
        v === null ||
        (typeof v === 'string' && v.trim() === '')
      if (empty) next[f.key] = `${f.label} is required`
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setTopError(null)
    if (!validate()) return

    // Build payload with coerced values for visible fields only. Hidden /
    // non-listed keys never go up — guards against a caller leaking secrets.
    const payload: Record<string, any> = {}
    for (const f of visibleFields) {
      payload[f.key] = coerceValue(f, values[f.key])
    }

    setSubmitting(true)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let msg = `Request failed (${res.status})`
        try {
          const j = await res.json()
          if (j?.error) msg = j.error
        } catch {
          /* ignore */
        }
        setTopError(msg)
        return
      }
      const body = await res.json().catch(() => ({}))
      onSuccess?.(body)
    } catch (err: any) {
      setTopError(err?.message ?? 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="aegis-eso-backdrop absolute inset-0"
        onClick={submitting ? undefined : onClose}
        data-entering={entering || undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={cn(
          'aegis-eso-panel relative h-full flex flex-col ml-auto max-w-full',
        )}
        style={{ width: 'min(560px, 100vw)' }}
        data-entering={entering || undefined}
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-fg leading-tight truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-[12px] text-fg-muted truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 -m-1 rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
            {topError && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-[var(--data-negative)] bg-[var(--data-negative-bg)] text-[var(--data-negative-fg)] px-3 py-2 text-[12.5px]"
              >
                {topError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
              {visibleFields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => setField(f.key, v)}
                  error={errors[f.key]}
                  disabled={submitting}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-muted/40">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={submitting}>
              {saveLabel}
            </Button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .aegis-eso-backdrop {
          background: rgba(8, 13, 26, 0.65);
          backdrop-filter: blur(20px) saturate(1.3);
          -webkit-backdrop-filter: blur(20px) saturate(1.3);
          opacity: 0;
          transition: opacity 240ms var(--ease);
        }
        .aegis-eso-backdrop[data-entering='true'] {
          opacity: 1;
        }
        .aegis-eso-panel {
          background: var(--glass, var(--surface-elevated));
          backdrop-filter: var(--glass-blur, blur(24px) saturate(1.4));
          -webkit-backdrop-filter: var(--glass-blur, blur(24px) saturate(1.4));
          border-left: 1px solid var(--glass-border, var(--border));
          box-shadow: var(--glass-shadow, var(--elev-4));
          transform: translateX(100%);
          transition:
            transform 480ms var(--ease-spring),
            opacity 240ms var(--ease);
          opacity: 0;
        }
        .aegis-eso-panel[data-entering='true'] {
          transform: translateX(0);
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .aegis-eso-backdrop,
          .aegis-eso-panel {
            transition-duration: 120ms !important;
            transition-timing-function: ease-out !important;
          }
        }
      `}</style>
    </div>
  )
}

// ── FieldRow ──────────────────────────────────────────────────────────────
// Internal — picks the right input element for a given FieldDef.type. Kept
// inline rather than extracted because it shares grid + error styling with
// EditSlideOver and has no other consumer.
// ─────────────────────────────────────────────────────────────────────────

function FieldRow({
  field,
  value,
  onChange,
  error,
  disabled,
}: {
  field: FieldDef
  value: any
  onChange: (v: any) => void
  error?: string
  disabled?: boolean
}) {
  const span = field.colSpan ?? (field.type === 'textarea' ? 2 : 1)
  const id = `eso-${field.key}`

  const baseInput =
    'w-full rounded-md border border-border bg-surface text-fg text-[13px] px-3 h-10 ' +
    'placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--signal)] focus:border-transparent ' +
    'disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

  const errorRing = error ? ' border-[var(--data-negative)] focus:ring-[var(--data-negative)]' : ''

  return (
    <div className={cn('flex flex-col gap-1', span === 2 && 'col-span-2')}>
      {field.type !== 'checkbox' && (
        <label
          htmlFor={id}
          className="text-[11.5px] font-medium uppercase tracking-wide text-fg-muted"
        >
          {field.label}
          {field.required && <span className="text-[var(--data-negative)] ml-0.5">*</span>}
        </label>
      )}

      {field.type === 'textarea' ? (
        <textarea
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          rows={4}
          className={cn(baseInput, 'h-auto py-2 resize-y min-h-[80px]', errorRing)}
        />
      ) : field.type === 'select' ? (
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(baseInput, errorRing)}
        >
          {!field.required && <option value="">—</option>}
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : field.type === 'checkbox' ? (
        <label className="flex items-center gap-2 h-10 text-[13px] text-fg cursor-pointer">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-border accent-[var(--signal)]"
          />
          <span>{field.label}</span>
        </label>
      ) : (
        <input
          id={id}
          type={
            field.type === 'number'
              ? 'number'
              : field.type === 'tel'
              ? 'tel'
              : field.type === 'email'
              ? 'email'
              : field.type === 'url'
              ? 'url'
              : 'text'
          }
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          disabled={disabled}
          className={cn(baseInput, errorRing)}
        />
      )}

      {error ? (
        <p className="text-[11.5px] text-[var(--data-negative)]">{error}</p>
      ) : field.hint ? (
        <p className="text-[11.5px] text-fg-subtle">{field.hint}</p>
      ) : null}
    </div>
  )
}

export default EditSlideOver
