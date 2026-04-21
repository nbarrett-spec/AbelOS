'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" Dialog ──────────────────────────────────────
// Enter: spring (ease-spring) 320ms, scale 0.95 → 1.0, opacity 0 → 1
// Backdrop: navy @ 70% + backdrop-blur(16px) saturate(1.4)
// Container: bg-raised + elev-4 + 8px radius
// Exit: 180ms fade + scale 0.97
// ─────────────────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  closeOnOverlay?: boolean
  showClose?: boolean
  footer?: ReactNode
  /** Accessible label when no title is visible */
  'aria-label'?: string
}

const SIZE: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw] max-h-[90vh]',
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeOnOverlay = true,
  showClose = true,
  footer,
  'aria-label': ariaLabel,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(open)
  const [entering, setEntering] = useState(false)

  // Mount/unmount with exit transition
  useEffect(() => {
    if (open) {
      setVisible(true)
      // next frame so the enter transition runs
      requestAnimationFrame(() => setEntering(true))
    } else if (visible) {
      setEntering(false)
      const t = setTimeout(() => setVisible(false), 180)
      return () => clearTimeout(t)
    }
    return
  }, [open, visible])

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      first?.focus()
    })
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prev
    }
  }, [open, handleKey])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={
        typeof title === 'string' ? title : (ariaLabel ?? 'Dialog')
      }
    >
      <div
        className="aegis-dialog-backdrop absolute inset-0"
        onClick={closeOnOverlay ? onClose : undefined}
        data-entering={entering || undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={cn(
          'aegis-dialog-panel relative w-full flex flex-col',
          'max-h-[85vh]',
          SIZE[size],
        )}
        data-entering={entering || undefined}
      >
        {(title || showClose) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border">
            <div className="min-w-0">
              {title && (
                <h2 className="text-[15px] font-semibold text-fg tracking-tight leading-tight">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-[12.5px] text-fg-muted leading-snug">
                  {description}
                </p>
              )}
            </div>
            {showClose && (
              <button
                onClick={onClose}
                className="p-1.5 -m-1 rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal)] focus-visible:ring-offset-1"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-border bg-surface-muted/40">
            {footer}
          </div>
        )}
      </div>

      <style jsx>{`
        .aegis-dialog-backdrop {
          background: rgba(10, 26, 40, 0.7);
          backdrop-filter: blur(16px) saturate(1.4);
          -webkit-backdrop-filter: blur(16px) saturate(1.4);
          opacity: 0;
          transition: opacity 180ms var(--ease);
        }
        .aegis-dialog-backdrop[data-entering='true'] { opacity: 1; }

        .aegis-dialog-panel {
          background: var(--bg-raised, var(--surface-elevated));
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--elev-4);
          opacity: 0;
          transform: scale(0.95);
          transition:
            opacity 320ms var(--ease-spring),
            transform 320ms var(--ease-spring);
        }
        .aegis-dialog-panel[data-entering='true'] {
          opacity: 1;
          transform: scale(1);
        }
        .aegis-dialog-panel:not([data-entering]) {
          opacity: 0;
          transform: scale(0.97);
          transition-duration: 180ms;
          transition-timing-function: var(--ease);
        }

        @media (prefers-reduced-motion: reduce) {
          .aegis-dialog-backdrop,
          .aegis-dialog-panel {
            transition-duration: 120ms !important;
            transition-timing-function: ease-out !important;
          }
        }
      `}</style>
    </div>
  )
}

export default Dialog
