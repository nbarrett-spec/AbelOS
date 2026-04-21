'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import Tabs from './Tabs'
import Avatar from './Avatar'

// ── Aegis v2 "Drafting Room" Sheet ───────────────────────────────────────
// Right-side slide-over. Spring 480ms. Standard tabs across the top:
// Details / Timeline / Files / Linked / Audit / Raw. Raw tab is JSON with
// git-style diff vs last version. Timeline tab is vertical rail.
// ─────────────────────────────────────────────────────────────────────────

export type SheetWidth = 'default' | 'wide'

export interface SheetTimelineEntry {
  id: string
  timestamp: string | Date
  actor?: { name: string; id?: string; avatarSrc?: string | null }
  title: ReactNode
  detail?: ReactNode
}

export interface SheetFile {
  id: string
  name: string
  size?: number
  meta?: ReactNode
  href?: string
}

export interface SheetLink {
  id: string
  label: ReactNode
  href?: string
  onClick?: () => void
  meta?: ReactNode
}

export interface SheetAuditEntry {
  id: string
  timestamp: string | Date
  actor: string
  action: string
  target?: string
  detail?: ReactNode
}

export type SheetTabId =
  | 'details'
  | 'timeline'
  | 'files'
  | 'linked'
  | 'audit'
  | 'raw'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  width?: SheetWidth
  /** Primary tab content — rendered in the Details tab */
  children?: ReactNode
  timeline?: SheetTimelineEntry[]
  files?: SheetFile[]
  linked?: SheetLink[]
  audit?: SheetAuditEntry[]
  /** Current raw JSON value for the Raw tab */
  raw?: unknown
  /** Previous raw JSON value — used to render a git-style line diff */
  rawPrev?: unknown
  /** Tabs to show (default: all) */
  tabs?: SheetTabId[]
  /** Initial tab */
  defaultTab?: SheetTabId
  footer?: ReactNode
  closeOnOverlay?: boolean
  'aria-label'?: string
}

const ALL_TABS: SheetTabId[] = ['details', 'timeline', 'files', 'linked', 'audit', 'raw']

function formatTs(ts: string | Date): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toJsonLines(value: unknown): string[] {
  try {
    return JSON.stringify(value, null, 2).split('\n')
  } catch {
    return [String(value)]
  }
}

function diffLines(prev: string[], next: string[]) {
  // Simple LCS-free line diff — good enough for audit view.
  const out: Array<{ kind: 'same' | 'add' | 'del'; text: string }> = []
  const prevSet = new Set(prev)
  const nextSet = new Set(next)
  const all = Array.from(new Set([...prev, ...next]))
  // Preserve next order for rendering
  const byLine = new Map<string, 'same' | 'add' | 'del'>()
  for (const l of prev) byLine.set(l, prevSet.has(l) && nextSet.has(l) ? 'same' : 'del')
  for (const l of next) {
    if (prevSet.has(l) && nextSet.has(l)) byLine.set(l, 'same')
    else if (!prevSet.has(l) && nextSet.has(l)) byLine.set(l, 'add')
  }
  // Render in next-order, then append removed lines at the end
  for (const l of next) {
    out.push({ kind: byLine.get(l) ?? 'same', text: l })
  }
  for (const l of prev) {
    if (!nextSet.has(l)) out.push({ kind: 'del', text: l })
  }
  void all
  return out
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  width = 'default',
  children,
  timeline,
  files,
  linked,
  audit,
  raw,
  rawPrev,
  tabs = ALL_TABS,
  defaultTab = 'details',
  footer,
  closeOnOverlay = true,
  'aria-label': ariaLabel,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(open)
  const [entering, setEntering] = useState(false)
  const [activeTab, setActiveTab] = useState<SheetTabId>(defaultTab)

  useEffect(() => {
    if (open) {
      setVisible(true)
      setActiveTab(defaultTab)
      requestAnimationFrame(() => setEntering(true))
    } else if (visible) {
      setEntering(false)
      const t = setTimeout(() => setVisible(false), 240)
      return () => clearTimeout(t)
    }
    return
  }, [open, visible, defaultTab])

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

  const tabDefs = useMemo(
    () =>
      tabs.map((t) => ({
        id: t,
        label:
          t === 'details'
            ? 'Details'
            : t === 'timeline'
            ? 'Timeline'
            : t === 'files'
            ? 'Files'
            : t === 'linked'
            ? 'Linked'
            : t === 'audit'
            ? 'Audit'
            : 'Raw',
      })),
    [tabs],
  )

  const rawNext = useMemo(() => toJsonLines(raw), [raw])
  const rawDiff = useMemo(
    () => (rawPrev !== undefined ? diffLines(toJsonLines(rawPrev), rawNext) : null),
    [rawPrev, rawNext],
  )

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : (ariaLabel ?? 'Panel')}
    >
      <div
        className="aegis-sheet-backdrop absolute inset-0"
        onClick={closeOnOverlay ? onClose : undefined}
        data-entering={entering || undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        className={cn(
          'aegis-sheet-panel relative h-full flex flex-col ml-auto',
          'max-w-full',
        )}
        style={{
          width:
            width === 'wide'
              ? 'min(640px, 100vw)'
              : 'min(480px, 100vw)',
        }}
        data-entering={entering || undefined}
      >
        <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[15px] font-semibold text-fg leading-tight truncate">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-1 text-[12px] text-fg-muted truncate">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -m-1 rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-5 pt-2">
          <Tabs
            tabs={tabDefs}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as SheetTabId)}
          />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          {activeTab === 'details' && (
            <div className="space-y-4 text-[13px] text-fg">{children}</div>
          )}

          {activeTab === 'timeline' && (
            <div className="relative pl-8">
              {(timeline ?? []).length === 0 ? (
                <p className="text-[13px] text-fg-muted">No timeline entries.</p>
              ) : (
                <>
                  <div
                    aria-hidden
                    className="absolute top-0 bottom-0 left-[15px] w-px"
                    style={{ background: 'var(--border)' }}
                  />
                  <ul className="space-y-4">
                    {(timeline ?? []).map((e) => (
                      <li key={e.id} className="relative">
                        <span
                          className="absolute -left-[30px] top-0"
                          aria-hidden
                        >
                          {e.actor ? (
                            <Avatar
                              size="sm"
                              name={e.actor.name}
                              id={e.actor.id}
                              src={e.actor.avatarSrc ?? undefined}
                            />
                          ) : (
                            <span
                              className="block rounded-full"
                              style={{
                                width: 10,
                                height: 10,
                                margin: '6px 7px',
                                background: 'var(--signal, var(--gold))',
                                boxShadow: '0 0 0 3px var(--bg-raised, var(--surface-elevated))',
                              }}
                            />
                          )}
                        </span>
                        <div className="pl-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[12.5px] text-fg">{e.title}</span>
                            <span className="shrink-0 text-[10.5px] font-mono tabular-nums text-fg-subtle">
                              {formatTs(e.timestamp)}
                            </span>
                          </div>
                          {e.detail && (
                            <div className="mt-1 text-[12px] text-fg-muted">{e.detail}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {activeTab === 'files' && (
            <ul className="space-y-1">
              {(files ?? []).length === 0 ? (
                <p className="text-[13px] text-fg-muted">No files.</p>
              ) : (
                (files ?? []).map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-surface-muted"
                  >
                    <a
                      href={f.href}
                      className="text-[12.5px] text-fg hover:text-[var(--signal)] truncate"
                      target={f.href ? '_blank' : undefined}
                      rel={f.href ? 'noreferrer' : undefined}
                    >
                      {f.name}
                    </a>
                    <span className="text-[10.5px] font-mono tabular-nums text-fg-subtle shrink-0">
                      {f.meta ?? (typeof f.size === 'number' ? `${Math.round(f.size / 1024)} KB` : '')}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}

          {activeTab === 'linked' && (
            <ul className="space-y-1">
              {(linked ?? []).length === 0 ? (
                <p className="text-[13px] text-fg-muted">No linked records.</p>
              ) : (
                (linked ?? []).map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-surface-muted"
                  >
                    {l.href ? (
                      <a
                        href={l.href}
                        className="text-[12.5px] text-fg hover:text-[var(--signal)] truncate"
                      >
                        {l.label}
                      </a>
                    ) : (
                      <button
                        onClick={l.onClick}
                        className="text-[12.5px] text-fg hover:text-[var(--signal)] truncate text-left"
                      >
                        {l.label}
                      </button>
                    )}
                    {l.meta && (
                      <span className="text-[10.5px] text-fg-subtle shrink-0">{l.meta}</span>
                    )}
                  </li>
                ))
              )}
            </ul>
          )}

          {activeTab === 'audit' && (
            <ul className="space-y-2">
              {(audit ?? []).length === 0 ? (
                <p className="text-[13px] text-fg-muted">No audit events.</p>
              ) : (
                (audit ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-2 text-[12.5px] border-b border-border pb-2 last:border-0"
                  >
                    <span className="mt-0.5 font-mono text-[10.5px] tabular-nums text-fg-subtle w-[96px] shrink-0">
                      {formatTs(a.timestamp)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-fg">
                        <span className="font-medium">{a.actor}</span>{' '}
                        <span className="text-fg-muted">{a.action}</span>
                        {a.target && (
                          <>
                            {' '}
                            <span className="font-mono text-[11.5px] text-fg">
                              {a.target}
                            </span>
                          </>
                        )}
                      </div>
                      {a.detail && (
                        <div className="mt-0.5 text-[11.5px] text-fg-muted">{a.detail}</div>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}

          {activeTab === 'raw' && (
            <pre className="font-mono text-[11.5px] leading-[1.5] text-fg overflow-x-auto">
              {rawDiff ? (
                rawDiff.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      'px-2 -mx-2',
                      line.kind === 'add' && 'bg-[var(--data-positive-bg)] text-[var(--data-positive-fg)]',
                      line.kind === 'del' && 'bg-[var(--data-negative-bg)] text-[var(--data-negative-fg)]',
                    )}
                  >
                    <span className="inline-block w-3 select-none text-fg-subtle">
                      {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                    </span>
                    {line.text}
                  </div>
                ))
              ) : (
                rawNext.map((line, i) => (
                  <div key={i} className="px-2 -mx-2">
                    <span className="inline-block w-3 select-none text-fg-subtle"> </span>
                    {line}
                  </div>
                ))
              )}
            </pre>
          )}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-muted/40">
            {footer}
          </div>
        )}
      </div>

      <style jsx>{`
        .aegis-sheet-backdrop {
          background: rgba(10, 26, 40, 0.7);
          backdrop-filter: blur(16px) saturate(1.4);
          -webkit-backdrop-filter: blur(16px) saturate(1.4);
          opacity: 0;
          transition: opacity 240ms var(--ease);
        }
        .aegis-sheet-backdrop[data-entering='true'] { opacity: 1; }

        .aegis-sheet-panel {
          background: var(--bg-raised, var(--surface-elevated));
          border-left: 1px solid var(--border);
          box-shadow: var(--elev-4);
          transform: translateX(100%);
          transition:
            transform 480ms var(--ease-spring),
            opacity 240ms var(--ease);
          opacity: 0;
        }
        .aegis-sheet-panel[data-entering='true'] {
          transform: translateX(0);
          opacity: 1;
        }

        @media (prefers-reduced-motion: reduce) {
          .aegis-sheet-backdrop,
          .aegis-sheet-panel {
            transition-duration: 120ms !important;
            transition-timing-function: ease-out !important;
          }
        }
      `}</style>
    </div>
  )
}

export default Sheet
