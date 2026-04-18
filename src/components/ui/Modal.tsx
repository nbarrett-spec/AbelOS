'use client'

import { useEffect, useRef, type ReactNode, useCallback } from 'react'
import { clsx } from 'clsx'
import { X } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  closeOnOverlay?: boolean
  showClose?: boolean
  footer?: ReactNode
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw] max-h-[90vh]',
}

// ── Component ─────────────────────────────────────────────────────────────

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  closeOnOverlay = true,
  showClose = true,
  footer,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Trap focus & handle escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      // Trap focus within modal
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
    [onClose]
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    // Focus first focusable element
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      first?.focus()
    })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Overlay */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/40 backdrop-blur-sm',
          'animate-[fadeIn_200ms_ease-out]'
        )}
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={clsx(
          'relative w-full bg-white dark:bg-gray-900 rounded-2xl shadow-elevation-5',
          'border border-gray-200 dark:border-gray-800',
          'animate-[slideUp_250ms_ease-out]',
          'flex flex-col max-h-[85vh]',
          sizeClasses[size]
        )}
      >
        {/* Header */}
        {(title || showClose) && (
          <div className="flex items-start justify-between px-6 pt-6 pb-0">
            <div>
              {title && (
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
              )}
            </div>
            {showClose && (
              <button
                onClick={onClose}
                className={clsx(
                  'ml-4 -mt-1 p-1.5 rounded-lg text-gray-400',
                  'hover:bg-gray-100 hover:text-gray-600',
                  'dark:hover:bg-gray-800 dark:hover:text-gray-300',
                  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-abel-navy/40'
                )}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
