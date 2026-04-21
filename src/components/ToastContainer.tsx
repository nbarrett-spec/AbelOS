'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Check, X, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { useToast, Toast, ToastType } from '@/contexts/ToastContext';

// ── Tone tokens ──────────────────────────────────────────────────────────

const TONE: Record<ToastType, {
  icon: React.ComponentType<{ className?: string }>
  rail: string // tailwind bg for left rail
  bar:  string // progress bar
  chip: string // icon chip bg
  fg:   string // icon color
}> = {
  success: { icon: Check,        rail: 'bg-data-positive', bar: 'bg-data-positive', chip: 'bg-data-positive-bg', fg: 'text-data-positive-fg' },
  error:   { icon: AlertCircle,  rail: 'bg-data-negative', bar: 'bg-data-negative', chip: 'bg-data-negative-bg', fg: 'text-data-negative-fg' },
  warning: { icon: AlertTriangle,rail: 'bg-data-warning',  bar: 'bg-data-warning',  chip: 'bg-data-warning-bg',  fg: 'text-data-warning-fg'  },
  info:    { icon: Info,         rail: 'bg-forecast',      bar: 'bg-forecast',      chip: 'bg-data-info-bg',     fg: 'text-data-info-fg'     },
}

// ── Item ─────────────────────────────────────────────────────────────────

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onRemove }) => {
  const [isRemoving, setIsRemoving] = useState(false);
  const tone = TONE[toast.type] ?? TONE.info;
  const Icon = tone.icon;
  const duration = toast.duration ?? 4000;

  const handleClose = useCallback(() => {
    setIsRemoving(true);
    setTimeout(() => onRemove(toast.id), 220);
  }, [toast.id, onRemove]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'panel panel-elevated relative overflow-hidden',
        'min-w-[320px] max-w-[440px] pointer-events-auto',
        'transition-all duration-200 ease-out',
        isRemoving ? 'opacity-0 translate-x-6 scale-[0.98]' : 'opacity-100 translate-x-0 scale-100',
        'shadow-[0_16px_32px_rgba(0,0,0,0.25)]',
      ].join(' ')}
      style={{ animation: !isRemoving ? 'slideUp 220ms var(--ease-out) both' : undefined }}
    >
      {/* Left accent rail */}
      <span aria-hidden className={`absolute left-0 top-0 bottom-0 w-[3px] ${tone.rail}`} />

      <div className="flex items-start gap-3 px-4 py-3 pl-5">
        <span className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${tone.chip} ${tone.fg}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-fg leading-tight">{toast.title}</div>
          {toast.message && (
            <div className="text-[12px] text-fg-muted mt-1 leading-snug">{toast.message}</div>
          )}
        </div>
        {toast.action && (
          <button
            onClick={() => { toast.action?.onClick(); handleClose(); }}
            className="btn btn-ghost btn-sm shrink-0 text-accent hover:bg-accent-subtle"
          >
            {toast.action.label}
          </button>
        )}
        <button
          onClick={handleClose}
          aria-label="Close notification"
          className="text-fg-subtle hover:text-fg transition-colors shrink-0 p-1 -m-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* Animated progress bar — pure CSS animation, no JS timer tick */}
      <div
        className={`h-[2px] ${tone.bar} origin-left`}
        style={{
          animation: `toast-progress ${duration}ms linear forwards`,
        }}
      />
      <style jsx>{`
        @keyframes toast-progress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
};

// ── Container ────────────────────────────────────────────────────────────

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className={[
        'fixed z-[9999] pointer-events-none flex flex-col gap-2.5',
        isMobile
          ? 'bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[500px] items-center'
          : 'bottom-6 right-6 items-end',
      ].join(' ')}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className={isMobile ? 'w-full max-w-[500px]' : ''}>
          <ToastItem toast={toast} onRemove={removeToast} />
        </div>
      ))}
    </div>
  );
};
