'use client'

import { ReactNode, useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Optional footer rendered in a sticky bottom bar (buttons, metadata). */
  footer?: ReactNode
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
} as const

// ── Component ─────────────────────────────────────────────────────────────

/**
 * Shared ops-area Modal. Uses Aegis panel tokens, traps focus, closes on ESC,
 * and exposes an optional footer slot for primary/secondary actions.
 *
 * Kept API-compatible with older callers — `title` + `children` remain required,
 * `size` stays the same, and ESC dismiss still fires `onClose()`.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'lg',
  footer,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      // Simple focus trap
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    // Focus the first focusable element for accessibility.
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ?.focus()
    })
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, handleKey])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Overlay */}
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        className={[
          'relative w-full panel panel-elevated',
          'animate-[slideUp_200ms_var(--ease-out)]',
          'flex flex-col max-h-[85vh]',
          'shadow-[0_24px_48px_rgba(0,0,0,0.35)]',
          sizeClasses[size],
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg tracking-tight">{title}</h2>
            {description && (
              <p className="mt-1 text-[12.5px] text-fg-muted leading-snug">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 -mt-0.5 p-1.5 rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 scrollbar-thin">
          {children}
        </div>

        {/* Footer (optional, sticky) */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-border bg-surface-muted/40">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
