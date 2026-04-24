'use client'

import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, Check, Info, X } from 'lucide-react'
import { useToast, type Toast, type ToastType } from '@/contexts/ToastContext'
import { cn } from '@/lib/utils'

// ── Aegis v2 "Drafting Room" ToastContainer ──────────────────────────────
// Brass pill: navy bg + 1px gold border + rounded-pill.
// JetBrains Mono body. Success = gold bloom; Error = ember border.
// Stack with -2° rotation per toast, offset 8px (papers on desk).
// Enter: spring slide-up from bottom-right 240ms. Exit: fade + slide-down
// 180ms. 5s auto-dismiss, hover pauses.
// ─────────────────────────────────────────────────────────────────────────

const TONE: Record<
  ToastType,
  { icon: React.ComponentType<{ className?: string }>; border: string; bloom: string; iconColor: string }
> = {
  success: {
    icon: Check,
    border: 'var(--signal, var(--gold))',
    bloom: '0 0 24px var(--signal-glow)',
    iconColor: 'var(--signal, var(--gold))',
  },
  error: {
    icon: AlertCircle,
    border: 'var(--ember, #b64e3d)',
    bloom: '0 0 16px rgba(182, 78, 61, 0.35)',
    iconColor: 'var(--ember, #b64e3d)',
  },
  warning: {
    icon: AlertTriangle,
    border: 'var(--gold-dark, #a88a3a)',
    bloom: '0 0 16px rgba(198, 162, 78, 0.30)',
    iconColor: 'var(--gold, #c6a24e)',
  },
  info: {
    icon: Info,
    border: 'var(--sky, #8CA8B8)',
    bloom: '0 0 16px rgba(140, 168, 184, 0.30)',
    iconColor: 'var(--sky, #8CA8B8)',
  },
}

interface ToastItemProps {
  toast: Toast
  index: number
  onRemove: (id: string) => void
}

function ToastItem({ toast, index, onRemove }: ToastItemProps) {
  const tone = TONE[toast.type] ?? TONE.info
  const Icon = tone.icon
  const [exiting, setExiting] = useState(false)
  const [paused, setPaused] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<number>(Date.now())
  const remainRef = useRef<number>(toast.duration ?? 5000)

  const close = () => {
    if (exiting) return
    setExiting(true)
    setTimeout(() => onRemove(toast.id), 180)
  }

  useEffect(() => {
    if (paused) return
    timeoutRef.current = setTimeout(close, remainRef.current)
    startRef.current = Date.now()
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused])

  // Stack effect: slight rotation + offset per index (papers on desk)
  const rotation = -2 * Math.min(index, 3)
  const offsetY = index * 8

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => {
        setPaused(true)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          const elapsed = Date.now() - startRef.current
          remainRef.current = Math.max(200, remainRef.current - elapsed)
        }
      }}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        'aegis-toast pointer-events-auto relative flex items-center gap-3',
        'min-w-[280px] max-w-[420px]',
      )}
      data-entering={!exiting || undefined}
      data-exiting={exiting || undefined}
      style={{
        background: 'var(--navy-deep, #050d16)',
        color: 'var(--fg, #f5f1e8)',
        border: `1px solid ${tone.border}`,
        borderRadius: 9999,
        padding: '10px 14px 10px 12px',
        boxShadow: tone.bloom + ', var(--elev-3)',
        fontFamily: 'var(--font-mono, JetBrains Mono, monospace)',
        transform: `translateY(-${offsetY}px) rotate(${rotation}deg)`,
      }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full"
        style={{
          background: 'rgba(255,255,255,0.04)',
          color: tone.iconColor,
        }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold leading-tight truncate" style={{ color: 'var(--fg)' }}>
          {toast.title}
        </div>
        {toast.message && (
          <div className="text-[11px] leading-snug mt-0.5 truncate" style={{ color: 'var(--fg-muted)' }}>
            {toast.message}
          </div>
        )}
      </div>
      {toast.action && (
        <button
          onClick={() => {
            toast.action?.onClick()
            close()
          }}
          className="shrink-0 px-2 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider"
          style={{
            color: 'var(--signal, var(--gold))',
            background: 'var(--signal-subtle)',
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={close}
        aria-label="Dismiss"
        className="shrink-0 p-1 -mr-1 rounded-full text-fg-subtle hover:text-fg transition-colors"
      >
        <X className="w-3 h-3" />
      </button>

      <style jsx>{`
        .aegis-toast {
          transition:
            transform 240ms var(--ease-spring),
            opacity 180ms var(--ease);
          transform-origin: bottom right;
          opacity: 0;
        }
        .aegis-toast[data-entering='true'] {
          animation: aegis-toast-in 240ms var(--ease-spring) forwards;
        }
        .aegis-toast[data-exiting='true'] {
          animation: aegis-toast-out 180ms var(--ease) forwards;
        }
        @keyframes aegis-toast-in {
          from {
            opacity: 0;
            transform: translateY(24px) rotate(${rotation}deg);
          }
          to {
            opacity: 1;
            transform: translateY(-${offsetY}px) rotate(${rotation}deg);
          }
        }
        @keyframes aegis-toast-out {
          from {
            opacity: 1;
            transform: translateY(-${offsetY}px) rotate(${rotation}deg);
          }
          to {
            opacity: 0;
            transform: translateY(16px) rotate(${rotation}deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .aegis-toast,
          .aegis-toast[data-entering='true'],
          .aegis-toast[data-exiting='true'] {
            animation: none !important;
            transition: none !important;
            opacity: 1;
            transform: translateY(-${offsetY}px) rotate(${rotation}deg);
          }
        }
      `}</style>
    </div>
  )
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  if (toasts.length === 0) return null

  // Newest on bottom, visually stacked upward with rotation offsets
  const list: ReactNode[] = toasts.map((toast, i) => (
    <ToastItem
      key={toast.id}
      toast={{ ...toast, duration: toast.duration ?? 5000 }}
      index={toasts.length - 1 - i}
      onRemove={removeToast}
    />
  ))

  return (
    <div
      aria-label="Notifications"
      className={cn(
        'fixed z-[9999] pointer-events-none flex flex-col-reverse gap-2',
        isMobile
          ? 'bottom-4 left-1/2 -translate-x-1/2 items-center w-[calc(100%-32px)] max-w-[440px]'
          : 'bottom-6 right-6 items-end',
      )}
    >
      {list}
    </div>
  )
}

export default ToastContainer
