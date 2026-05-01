'use client'

/**
 * TaskPanel — Floating task list for ops staff.
 *
 * Spec: STAFF-TASK-SYSTEM-SPEC.md §4.
 *
 * Behavior summary:
 *   - 56px FAB at bottom-20/right-6 (above HelpPanel which lives at bottom-6/right-6)
 *   - Badge (red, top-right of FAB) shows overdue + critical count, pulses if > 0
 *   - Listens for `toggle-task-panel` custom event (dispatched by Shift+T in ops/layout)
 *   - Panel: 420px wide on desktop, full-width bottom sheet on mobile
 *   - Filter tabs: All / Today / Overdue / Done
 *   - Sections: OVERDUE, DUE TODAY, UPCOMING, COMPLETED (last 24h)
 *   - Inline add form at top of list when [+] clicked
 *   - localStorage: `abel_task_panel_open`, `abel_task_filter`
 *
 * Data:
 *   - GET /api/ops/tasks (full list — refetched on panel open + after mutations)
 *   - GET /api/ops/tasks?limit=1 (counts-only badge poll every 60s)
 *   - POST /api/ops/tasks (create standalone)
 *   - POST /api/ops/tasks/[id]/complete (mark done)
 *   - PATCH /api/ops/tasks/[id] (status / priority / etc.)
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  DollarSign,
  HardHat,
  MessageSquare,
  MoonStar,
  Package,
  Play,
  Plus,
  Search,
  Shield,
  Tag,
  X,
} from 'lucide-react'

interface PortalTaskCounts {
  total: number
  overdue: number
  critical: number
  dueToday: number
  completed24h: number
}

interface PortalTask {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED' | string
  category: string
  dueDate: string | null
  completedAt: string | null
  assigneeId: string
  creatorId: string
  jobId: string | null
  builderId: string | null
  communityId: string | null
  sourceKey: string | null
  createdAt: string
  updatedAt: string
  job: { jobNumber: string; address: string | null } | null
  builder: { companyName: string } | null
  creator: { firstName: string; lastName: string } | null
}

type Filter = 'all' | 'today' | 'overdue' | 'done'

const PANEL_OPEN_KEY = 'abel_task_panel_open'
const FILTER_KEY = 'abel_task_filter'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'done', label: 'Done' },
]

const CATEGORY_META: Record<
  string,
  { label: string; Icon: typeof ClipboardList }
> = {
  GENERAL: { label: 'General', Icon: ClipboardList },
  READINESS_CHECK: { label: 'Readiness', Icon: CheckCircle },
  MATERIAL_VERIFICATION: { label: 'Material', Icon: Package },
  BUILDER_COMMUNICATION: { label: 'Builder', Icon: MessageSquare },
  CREW_DISPATCH: { label: 'Crew', Icon: HardHat },
  QUALITY_REVIEW: { label: 'Quality', Icon: Shield },
  INVOICE_FOLLOW_UP: { label: 'Invoice', Icon: DollarSign },
  SCHEDULING: { label: 'Schedule', Icon: Calendar },
  EXCEPTION_RESOLUTION: { label: 'Exception', Icon: AlertTriangle },
}

const PRIORITY_DOT: Record<string, string> = {
  CRITICAL: '#DC2626', // red-600
  HIGH: '#F59E0B', // amber-500
  MEDIUM: '#3B82F6', // blue-500
  LOW: '#9CA3AF', // gray-400
}

interface TaskPanelProps {
  staffId: string
  staffRole?: string
}

export default function TaskPanel({ staffId, staffRole }: TaskPanelProps) {
  void staffRole // reserved for future role-aware filters; lint guard

  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<PortalTask[]>([])
  const [counts, setCounts] = useState<PortalTaskCounts>({
    total: 0,
    overdue: 0,
    critical: 0,
    dueToday: 0,
    completed24h: 0,
  })
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [showAdd, setShowAdd] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [completedExpanded, setCompletedExpanded] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  // v2 additions
  const [search, setSearch] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [snoozeMenuFor, setSnoozeMenuFor] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const fabRef = useRef<HTMLButtonElement | null>(null)

  // ── Hydrate persisted UI state ────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const o = window.localStorage.getItem(PANEL_OPEN_KEY)
      if (o === 'true') setOpen(true)
      const f = window.localStorage.getItem(FILTER_KEY)
      if (f === 'all' || f === 'today' || f === 'overdue' || f === 'done') {
        setFilter(f)
      }
    } catch {
      // localStorage may be unavailable in some contexts
    }
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      setReducedMotion(mq.matches)
      const onChange = () => setReducedMotion(mq.matches)
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PANEL_OPEN_KEY, String(open))
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(FILTER_KEY, filter)
  }, [filter])

  // ── Listen for the global Shift+T toggle event ────────────────────
  useEffect(() => {
    function handler() {
      setOpen((v) => !v)
    }
    window.addEventListener('toggle-task-panel', handler as EventListener)
    return () => window.removeEventListener('toggle-task-panel', handler as EventListener)
  }, [])

  // ── Close on Escape ───────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ── Click outside panel closes it ─────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (fabRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // ── Data fetching ─────────────────────────────────────────────────
  const fetchTasks = useCallback(
    async (currentFilter: Filter = filter) => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (currentFilter === 'done') {
          params.set('status', 'DONE')
        } else {
          params.set('status', 'TODO,IN_PROGRESS,BLOCKED')
          params.set('include_done', 'true')
        }
        params.set('limit', '100')
        const res = await fetch(`/api/ops/tasks?${params.toString()}`, {
          credentials: 'include',
          headers: { 'x-staff-id': staffId },
        })
        if (res.ok) {
          const data = (await res.json()) as {
            tasks: PortalTask[]
            counts: PortalTaskCounts
          }
          setTasks(data.tasks ?? [])
          setCounts(data.counts ?? counts)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [filter, staffId],
  )

  // Refetch full list on open + when filter changes
  useEffect(() => {
    if (!open) return
    fetchTasks(filter)
  }, [open, filter, fetchTasks])

  // Lightweight badge poll every 60s
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/ops/tasks?limit=1', {
          credentials: 'include',
          headers: { 'x-staff-id': staffId },
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { counts: PortalTaskCounts }
        if (!cancelled && data?.counts) setCounts(data.counts)
      } catch {
        // ignore
      }
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [staffId])

  // ── Mutations ─────────────────────────────────────────────────────
  async function handleComplete(taskId: string) {
    try {
      const res = await fetch(`/api/ops/tasks/${taskId}/complete`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-staff-id': staffId },
      })
      if (res.ok) {
        await fetchTasks(filter)
      }
    } catch {
      // ignore
    }
  }

  async function handleStart(taskId: string) {
    try {
      const res = await fetch(`/api/ops/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-staff-id': staffId,
        },
        body: JSON.stringify({ status: 'IN_PROGRESS' }),
      })
      if (res.ok) {
        await fetchTasks(filter)
      }
    } catch {
      // ignore
    }
  }

  async function handleAdd(form: AddFormState) {
    setAddError(null)
    try {
      const body: any = {
        title: form.title,
        priority: form.priority,
        category: form.category,
      }
      if (form.description.trim()) body.description = form.description.trim()
      if (form.dueDate) body.dueDate = new Date(form.dueDate).toISOString()
      const res = await fetch('/api/ops/tasks', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-staff-id': staffId,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to add task')
      }
      const created = (await res.json()) as PortalTask
      setShowAdd(false)
      setFlashId(created.id)
      setTimeout(() => setFlashId(null), 1500)
      await fetchTasks(filter)
    } catch (err: any) {
      setAddError(err?.message || 'Add failed')
    }
  }

  // ── Snooze (single task — pushes dueDate via PATCH) ───────────────
  async function handleSnooze(taskId: string, when: 'tomorrow' | 'next-week' | Date) {
    try {
      let dueDate: Date
      if (when === 'tomorrow') {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(17, 0, 0, 0) // 5 PM tomorrow
        dueDate = d
      } else if (when === 'next-week') {
        const d = new Date()
        d.setDate(d.getDate() + 7)
        d.setHours(17, 0, 0, 0)
        dueDate = d
      } else {
        dueDate = when
      }
      const res = await fetch(`/api/ops/tasks/${taskId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-staff-id': staffId,
        },
        body: JSON.stringify({ dueDate: dueDate.toISOString() }),
      })
      if (res.ok) {
        setSnoozeMenuFor(null)
        await fetchTasks(filter)
      }
    } catch {
      // ignore
    }
  }

  // ── Bulk actions ──────────────────────────────────────────────────
  function toggleBulkMode() {
    setBulkMode((v) => {
      if (v) setSelectedIds(new Set())
      return !v
    })
  }

  function toggleSelected(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  async function handleBulkAction(action: 'complete' | 'snooze' | 'cancel', dueDate?: Date) {
    if (bulkBusy || selectedIds.size === 0) return
    setBulkBusy(true)
    try {
      const body: any = {
        action,
        ids: Array.from(selectedIds),
      }
      if (action === 'snooze' && dueDate) body.dueDate = dueDate.toISOString()
      const res = await fetch('/api/ops/tasks/bulk', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-staff-id': staffId,
        },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSelectedIds(new Set())
        setBulkMode(false)
        await fetchTasks(filter)
      }
    } catch {
      // ignore
    } finally {
      setBulkBusy(false)
    }
  }

  // ── Sectioning logic ──────────────────────────────────────────────
  const sections = useMemo(() => {
    const overdue: PortalTask[] = []
    const dueToday: PortalTask[] = []
    const upcoming: PortalTask[] = []
    const noDate: PortalTask[] = []
    const completed: PortalTask[] = []

    const now = new Date()
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0,
    )
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23, 59, 59, 999,
    )

    // Apply client-side search filter (title + description + jobNumber + builder name)
    const q = search.trim().toLowerCase()
    const matchesSearch = (t: PortalTask): boolean => {
      if (!q) return true
      if (t.title?.toLowerCase().includes(q)) return true
      if (t.description?.toLowerCase().includes(q)) return true
      if (t.job?.jobNumber?.toLowerCase().includes(q)) return true
      if (t.builder?.companyName?.toLowerCase().includes(q)) return true
      if (t.category?.toLowerCase().includes(q)) return true
      return false
    }

    for (const t of tasks) {
      if (!matchesSearch(t)) continue
      if (t.status === 'DONE') {
        completed.push(t)
        continue
      }
      if (filter === 'done') continue
      const due = t.dueDate ? new Date(t.dueDate) : null
      if (!due) {
        if (filter === 'today' || filter === 'overdue') continue
        noDate.push(t)
        continue
      }
      if (due < now && (due < startOfToday || due.getTime() < now.getTime())) {
        // Overdue: due before now AND past today's window OR strictly before now
        if (due < startOfToday) {
          if (filter === 'today') continue
          overdue.push(t)
        } else if (due >= startOfToday && due <= endOfToday) {
          // due today but already past current time — still "due today"
          if (filter === 'overdue') continue
          dueToday.push(t)
        }
      } else if (due >= startOfToday && due <= endOfToday) {
        if (filter === 'overdue') continue
        dueToday.push(t)
      } else {
        if (filter === 'overdue' || filter === 'today') continue
        upcoming.push(t)
      }
    }

    return { overdue, dueToday, upcoming, noDate, completed }
  }, [tasks, filter, search])

  const badgeCount = counts.overdue + counts.critical
  const showBadge = badgeCount > 0
  const badgeText = badgeCount >= 100 ? '99+' : String(badgeCount)

  return (
    <>
      {/* FAB */}
      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          background: 'var(--signal, #C6A24E)',
          color: 'white',
          // Avoid covering HelpPanel at bottom-6.
        }}
        aria-label="My tasks (Shift+T)"
        title="My Tasks (Shift+T)"
      >
        <ClipboardList className="w-6 h-6" />
        {showBadge && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{
              background: '#DC2626',
              animation: reducedMotion
                ? 'none'
                : 'task-fab-pulse 2s ease-in-out infinite',
            }}
            aria-label={`${badgeCount} attention required`}
          >
            {badgeText}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed z-50 flex flex-col rounded-2xl overflow-hidden"
          style={{
            background: 'var(--surface, #FFFFFF)',
            color: 'var(--fg, #1F2937)',
            border: '1px solid var(--glass-border, rgba(0,0,0,0.08))',
            boxShadow:
              '0 24px 48px rgba(15, 42, 62, 0.18), 0 4px 12px rgba(15, 42, 62, 0.08)',
            backdropFilter: 'blur(16px)',
            // Desktop: bottom-right anchored panel; Mobile: full-width bottom sheet
            // — handled with media-query inline style would be awkward, so use
            // inline + CSS in the global style block below.
            right: 'min(1.5rem, max(1rem, env(safe-area-inset-right)))',
            bottom: '6rem',
            width: '420px',
            maxWidth: 'calc(100vw - 2rem)',
            maxHeight: 'calc(100vh - 8rem)',
            animation: reducedMotion
              ? 'none'
              : 'task-panel-slide 200ms ease-out',
          }}
          role="dialog"
          aria-label="Task panel"
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom: '1px solid var(--border, rgba(0,0,0,0.08))',
            }}
          >
            <div className="flex items-center gap-2">
              <ClipboardList
                className="w-4 h-4"
                style={{ color: 'var(--signal, #C6A24E)' }}
              />
              <h3 className="text-sm font-semibold">My Tasks</h3>
              {counts.total > 0 && (
                <span
                  className="text-[10px] tabular-nums px-1.5 rounded-full"
                  style={{
                    background: 'var(--surface-muted, #F4F4F5)',
                    color: 'var(--fg-muted, #6B7280)',
                  }}
                >
                  {counts.total}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleBulkMode}
                className="text-xs px-2 h-7 rounded-md font-medium inline-flex items-center gap-1 transition-colors"
                style={
                  bulkMode
                    ? {
                        background: 'var(--fg, #1F2937)',
                        color: 'white',
                      }
                    : {
                        background: 'var(--surface-muted, #F4F4F5)',
                        color: 'var(--fg-muted, #6B7280)',
                      }
                }
                aria-pressed={bulkMode}
                title="Bulk select"
              >
                {bulkMode ? `${selectedIds.size} sel` : 'Select'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd((v) => !v)}
                className="text-xs px-2.5 h-7 rounded-md font-medium inline-flex items-center gap-1 transition-colors"
                style={{
                  background: showAdd
                    ? 'var(--surface-muted, #F4F4F5)'
                    : 'var(--signal, #C6A24E)',
                  color: showAdd ? 'var(--fg, #1F2937)' : 'white',
                }}
                aria-label={showAdd ? 'Cancel add' : 'Add task'}
              >
                <Plus className="w-3 h-3" />
                {showAdd ? 'Close' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-md inline-flex items-center justify-center hover:bg-[var(--surface-muted,#F4F4F5)]"
                aria-label="Close panel"
              >
                <X
                  className="w-4 h-4"
                  style={{ color: 'var(--fg-muted, #6B7280)' }}
                />
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div
            className="px-3 py-2 relative"
            style={{
              borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
            }}
          >
            <Search
              className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
              style={{ color: 'var(--fg-muted, #6B7280)' }}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-full h-8 pl-7 pr-7 text-xs rounded focus:outline-none focus:ring-2 focus:ring-[var(--signal,#C6A24E)]/30"
              style={{
                background: 'var(--surface, #FFFFFF)',
                border: '1px solid var(--border, rgba(0,0,0,0.08))',
                color: 'var(--fg, #1F2937)',
              }}
              aria-label="Search tasks"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-[var(--surface-muted,#F4F4F5)]"
                aria-label="Clear search"
              >
                <X
                  className="w-3 h-3"
                  style={{ color: 'var(--fg-muted, #6B7280)' }}
                />
              </button>
            )}
          </div>

          {/* Status chips */}
          {(counts.overdue > 0 || counts.critical > 0 || counts.dueToday > 0) && (
            <div
              className="flex flex-wrap gap-2 px-4 py-2 text-[11px]"
              style={{
                borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
              }}
            >
              {counts.overdue > 0 && (
                <Chip
                  color="#DC2626"
                  label={`${counts.overdue} overdue`}
                />
              )}
              {counts.critical > 0 && (
                <Chip
                  color="#DC2626"
                  label={`${counts.critical} critical`}
                />
              )}
              {counts.dueToday > 0 && (
                <Chip
                  color="#F59E0B"
                  label={`${counts.dueToday} due today`}
                />
              )}
            </div>
          )}

          {/* Filter tabs */}
          <div
            className="flex gap-1 px-3 py-2"
            style={{
              borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
            }}
          >
            {FILTERS.map((f) => {
              const active = filter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className="text-xs h-7 px-2.5 rounded-md font-medium transition-colors"
                  style={
                    active
                      ? {
                          background: 'var(--fg, #1F2937)',
                          color: 'white',
                        }
                      : {
                          background: 'transparent',
                          color: 'var(--fg-muted, #6B7280)',
                        }
                  }
                >
                  {f.label}
                </button>
              )
            })}
          </div>

          {/* Add form (when open) */}
          {showAdd && (
            <AddTaskForm
              error={addError}
              onCancel={() => {
                setShowAdd(false)
                setAddError(null)
              }}
              onSubmit={handleAdd}
            />
          )}

          {/* Body */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ scrollBehavior: 'smooth' }}
          >
            {loading && tasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--fg-muted,#6B7280)]">
                Loading…
              </div>
            ) : tasks.length === 0 ? (
              <EmptyState filter={filter} search={search} />
            ) : (
              <div className="px-2 py-2 space-y-3">
                {(() => {
                  // Helper closure — keeps the 5 sections from re-listing
                  // every TaskCard prop and threads bulk + snooze state.
                  const renderTask = (t: PortalTask, done?: boolean) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      flashId={flashId}
                      reducedMotion={reducedMotion}
                      onComplete={() => handleComplete(t.id)}
                      onStart={() => handleStart(t.id)}
                      done={done}
                      bulkMode={!done && bulkMode}
                      selected={selectedIds.has(t.id)}
                      onToggleSelect={() => toggleSelected(t.id)}
                      onSnooze={(when) => handleSnooze(t.id, when)}
                      snoozeMenuOpen={snoozeMenuFor === t.id}
                      onSnoozeMenuToggle={() =>
                        setSnoozeMenuFor((cur) => (cur === t.id ? null : t.id))
                      }
                    />
                  )
                  return (
                    <>
                      {filter !== 'done' && sections.overdue.length > 0 && (
                        <Section
                          title="Overdue"
                          icon={<AlertTriangle className="w-3.5 h-3.5" />}
                          color="#DC2626"
                        >
                          {sections.overdue.map((t) => renderTask(t))}
                        </Section>
                      )}
                      {filter !== 'done' && sections.dueToday.length > 0 && (
                        <Section
                          title="Due Today"
                          icon={<Calendar className="w-3.5 h-3.5" />}
                          color="#F59E0B"
                        >
                          {sections.dueToday.map((t) => renderTask(t))}
                        </Section>
                      )}
                      {filter !== 'done' && sections.upcoming.length > 0 && (
                        <Section
                          title="Upcoming"
                          icon={<ClipboardList className="w-3.5 h-3.5" />}
                          color="var(--fg-muted, #6B7280)"
                        >
                          {sections.upcoming.map((t) => renderTask(t))}
                        </Section>
                      )}
                      {filter !== 'done' && sections.noDate.length > 0 && (
                        <Section
                          title="No Due Date"
                          icon={<Tag className="w-3.5 h-3.5" />}
                          color="var(--fg-muted, #6B7280)"
                        >
                          {sections.noDate.map((t) => renderTask(t))}
                        </Section>
                      )}
                      {sections.completed.length > 0 && (
                        <div>
                          <button
                            type="button"
                            onClick={() => setCompletedExpanded((v) => !v)}
                            className="w-full px-2 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold rounded transition-colors hover:bg-[var(--surface-muted,#F4F4F5)]"
                            style={{ color: '#16A34A' }}
                          >
                            <span className="flex items-center gap-1.5">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Completed (last 24h) · {sections.completed.length}
                            </span>
                            {completedExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {completedExpanded && (
                            <div className="mt-1 space-y-1">
                              {sections.completed.map((t) => renderTask(t, true))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Bulk-action footer (only when bulkMode + selection > 0) */}
          {bulkMode && selectedIds.size > 0 && (
            <div
              className="px-3 py-2 flex items-center justify-between gap-2"
              style={{
                background: 'var(--fg, #1F2937)',
                color: 'white',
                borderTop: '1px solid rgba(0,0,0,0.1)',
              }}
            >
              <span className="text-xs">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date()
                    d.setDate(d.getDate() + 1)
                    d.setHours(17, 0, 0, 0)
                    handleBulkAction('snooze', d)
                  }}
                  disabled={bulkBusy}
                  className="text-[11px] h-7 px-2 rounded font-medium disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    color: 'white',
                  }}
                >
                  Snooze
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction('cancel')}
                  disabled={bulkBusy}
                  className="text-[11px] h-7 px-2 rounded font-medium disabled:opacity-50"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    color: 'white',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction('complete')}
                  disabled={bulkBusy}
                  className="text-[11px] h-7 px-3 rounded font-medium inline-flex items-center gap-1 disabled:opacity-50"
                  style={{
                    background: '#16A34A',
                    color: 'white',
                  }}
                >
                  <CheckCircle className="w-3 h-3" />
                  {bulkBusy ? 'Working…' : 'Complete'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Inline animations + responsive panel sizing */}
      <style jsx global>{`
        @keyframes task-fab-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes task-panel-slide {
          from { transform: translateY(16px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes task-priority-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.6); }
          70% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
        }
        @keyframes task-flash {
          0%, 100% { background: var(--surface, #FFFFFF); }
          50% { background: rgba(34, 197, 94, 0.15); }
        }
        @media (max-width: 640px) {
          [role="dialog"][aria-label="Task panel"] {
            right: 0 !important;
            left: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            max-height: 80vh !important;
            border-radius: 16px 16px 0 0 !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"][aria-label="Task panel"],
          [aria-label*="attention required"] {
            animation: none !important;
          }
        }
      `}</style>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium"
      style={{
        background: `${color}1A`, // hex + 10% alpha
        color: color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

function Section({
  title,
  icon,
  color,
  children,
}: {
  title: string
  icon: React.ReactNode
  color: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div
        className="px-2 py-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold"
        style={{ color }}
      >
        {icon}
        {title}
      </div>
      <div className="space-y-1.5 mt-1">{children}</div>
    </div>
  )
}

function TaskCard({
  task,
  flashId,
  reducedMotion,
  onComplete,
  onStart,
  done,
  bulkMode,
  selected,
  onToggleSelect,
  onSnooze,
  snoozeMenuOpen,
  onSnoozeMenuToggle,
}: {
  task: PortalTask
  flashId: string | null
  reducedMotion: boolean
  onComplete: () => void
  onStart: () => void
  done?: boolean
  bulkMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  onSnooze?: (when: 'tomorrow' | 'next-week' | Date) => void
  snoozeMenuOpen?: boolean
  onSnoozeMenuToggle?: () => void
}) {
  const dot = PRIORITY_DOT[task.priority] || PRIORITY_DOT.MEDIUM
  const cat = CATEGORY_META[task.category] || CATEGORY_META.GENERAL
  const CatIcon = cat.Icon
  const dueLabel = formatDue(task.dueDate)
  const isOverdue =
    !done &&
    task.dueDate &&
    new Date(task.dueDate).getTime() < Date.now()
  const flashing = flashId === task.id

  return (
    <div
      className="group rounded-lg p-2.5 mx-1 transition-colors relative"
      style={{
        border: selected
          ? '1px solid var(--signal, #C6A24E)'
          : '1px solid var(--border, rgba(0,0,0,0.08))',
        background: selected
          ? 'rgba(198, 162, 78, 0.08)'
          : done
            ? 'var(--surface-muted, #F4F4F5)'
            : 'var(--surface, #FFFFFF)',
        opacity: done ? 0.7 : 1,
        animation: flashing && !reducedMotion ? 'task-flash 1.2s ease-out' : undefined,
      }}
      onClick={bulkMode && !done ? onToggleSelect : undefined}
      role={bulkMode && !done ? 'button' : undefined}
      tabIndex={bulkMode && !done ? 0 : undefined}
    >
      <div className="flex items-start gap-2">
        {bulkMode && !done && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 w-3.5 h-3.5 shrink-0"
            style={{ accentColor: 'var(--signal, #C6A24E)' }}
            aria-label={`Select ${task.title}`}
          />
        )}
        <span
          className="mt-1 w-2 h-2 rounded-full shrink-0"
          style={{
            background: dot,
            animation:
              task.priority === 'CRITICAL' && !done && !reducedMotion
                ? 'task-priority-pulse 2s ease-in-out infinite'
                : undefined,
          }}
          aria-label={`${task.priority} priority`}
        />
        <div className="min-w-0 flex-1">
          <div
            className={`text-[13px] font-medium leading-tight ${
              done ? 'line-through' : ''
            }`}
            style={{ color: 'var(--fg, #1F2937)' }}
          >
            {task.title}
          </div>
          {task.description && !done && (
            <div
              className="text-[11px] mt-0.5 line-clamp-1"
              style={{ color: 'var(--fg-muted, #6B7280)' }}
            >
              {task.description}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {dueLabel && (
              <span
                className="text-[10px] inline-flex items-center gap-0.5"
                style={{
                  color: isOverdue
                    ? '#DC2626'
                    : dueLabel === 'Due today'
                      ? '#F59E0B'
                      : 'var(--fg-muted, #6B7280)',
                }}
              >
                <Clock className="w-2.5 h-2.5" />
                {dueLabel}
              </span>
            )}
            <span
              className="text-[10px] inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full"
              style={{
                background: 'var(--surface-muted, #F4F4F5)',
                color: 'var(--fg-muted, #6B7280)',
              }}
            >
              <CatIcon className="w-2.5 h-2.5" />
              {cat.label}
            </span>
            {task.job && (
              <span
                className="text-[10px]"
                style={{ color: 'var(--fg-muted, #6B7280)' }}
              >
                · {task.job.jobNumber}
              </span>
            )}
            {task.builder && (
              <span
                className="text-[10px] truncate max-w-[120px]"
                style={{ color: 'var(--fg-muted, #6B7280)' }}
                title={task.builder.companyName}
              >
                · {task.builder.companyName}
              </span>
            )}
          </div>
        </div>
        {/* Actions */}
        {!done && !bulkMode && (
          <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
            {task.status === 'TODO' && (
              <button
                type="button"
                onClick={onStart}
                className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[var(--surface-muted,#F4F4F5)]"
                title="Start"
                aria-label="Start task"
              >
                <Play
                  className="w-3.5 h-3.5"
                  style={{ color: '#3B82F6' }}
                />
              </button>
            )}
            {onSnooze && (
              <div className="relative">
                <button
                  type="button"
                  onClick={onSnoozeMenuToggle}
                  className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[var(--surface-muted,#F4F4F5)]"
                  title="Snooze"
                  aria-label="Snooze task"
                  aria-expanded={!!snoozeMenuOpen}
                >
                  <MoonStar
                    className="w-3.5 h-3.5"
                    style={{ color: '#8B5CF6' }}
                  />
                </button>
                {snoozeMenuOpen && (
                  <SnoozeMenu
                    onClose={onSnoozeMenuToggle ?? (() => {})}
                    onSnooze={onSnooze}
                  />
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onComplete}
              className="w-7 h-7 rounded inline-flex items-center justify-center hover:bg-[var(--surface-muted,#F4F4F5)]"
              title="Complete"
              aria-label="Mark task complete"
            >
              <CheckCircle
                className="w-3.5 h-3.5"
                style={{ color: '#16A34A' }}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SnoozeMenu({
  onClose,
  onSnooze,
}: {
  onClose: () => void
  onSnooze: (when: 'tomorrow' | 'next-week' | Date) => void
}) {
  const [customDate, setCustomDate] = useState('')
  // Close on Escape / click outside.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-snooze-menu]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])
  return (
    <div
      data-snooze-menu
      className="absolute right-0 top-8 z-30 w-40 rounded-md py-1 shadow-lg"
      style={{
        background: 'var(--surface, #FFFFFF)',
        border: '1px solid var(--border, rgba(0,0,0,0.08))',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onSnooze('tomorrow')}
        className="w-full text-left text-xs px-2.5 py-1.5 hover:bg-[var(--surface-muted,#F4F4F5)]"
        style={{ color: 'var(--fg, #1F2937)' }}
      >
        Tomorrow
      </button>
      <button
        type="button"
        onClick={() => onSnooze('next-week')}
        className="w-full text-left text-xs px-2.5 py-1.5 hover:bg-[var(--surface-muted,#F4F4F5)]"
        style={{ color: 'var(--fg, #1F2937)' }}
      >
        Next Monday
      </button>
      <div className="border-t my-1" style={{ borderColor: 'var(--border, rgba(0,0,0,0.06))' }} />
      <div className="px-2 py-1">
        <input
          type="date"
          value={customDate}
          onChange={(e) => setCustomDate(e.target.value)}
          className="w-full h-7 px-1.5 text-[11px] rounded"
          style={{
            background: 'var(--surface, #FFFFFF)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            color: 'var(--fg, #1F2937)',
          }}
          aria-label="Custom snooze date"
        />
        <button
          type="button"
          onClick={() => {
            if (!customDate) return
            const d = new Date(customDate)
            d.setHours(17, 0, 0, 0)
            onSnooze(d)
          }}
          disabled={!customDate}
          className="mt-1 w-full text-[11px] h-6 rounded font-medium disabled:opacity-50"
          style={{
            background: 'var(--signal, #C6A24E)',
            color: 'white',
          }}
        >
          Snooze
        </button>
      </div>
    </div>
  )
}

interface AddFormState {
  title: string
  description: string
  dueDate: string
  priority: string
  category: string
}

function AddTaskForm({
  error,
  onCancel,
  onSubmit,
}: {
  error: string | null
  onCancel: () => void
  onSubmit: (form: AddFormState) => Promise<void>
}) {
  const [form, setForm] = useState<AddFormState>({
    title: '',
    description: '',
    dueDate: '',
    priority: 'MEDIUM',
    category: 'GENERAL',
  })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!form.title.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({ ...form, title: form.title.trim() })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="px-3 py-3 space-y-2"
      style={{
        background: 'var(--surface-muted, #F4F4F5)',
        borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
      }}
    >
      <input
        type="text"
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        placeholder="What needs to be done?"
        className="w-full h-8 px-2 text-sm rounded focus:outline-none focus:ring-2 focus:ring-[var(--signal,#C6A24E)]/30"
        style={{
          background: 'var(--surface, #FFFFFF)',
          border: '1px solid var(--border, rgba(0,0,0,0.08))',
          color: 'var(--fg, #1F2937)',
        }}
        autoFocus
        required
      />
      <input
        type="text"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        placeholder="Details (optional)"
        className="w-full h-8 px-2 text-xs rounded focus:outline-none focus:ring-2 focus:ring-[var(--signal,#C6A24E)]/30"
        style={{
          background: 'var(--surface, #FFFFFF)',
          border: '1px solid var(--border, rgba(0,0,0,0.08))',
          color: 'var(--fg, #1F2937)',
        }}
      />
      <div className="grid grid-cols-3 gap-1.5">
        <input
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          className="h-8 px-1.5 text-[11px] rounded focus:outline-none focus:ring-2 focus:ring-[var(--signal,#C6A24E)]/30"
          style={{
            background: 'var(--surface, #FFFFFF)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            color: 'var(--fg, #1F2937)',
          }}
        />
        <select
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: e.target.value })}
          className="h-8 px-1.5 text-[11px] rounded focus:outline-none focus:ring-2 focus:ring-[var(--signal,#C6A24E)]/30"
          style={{
            background: 'var(--surface, #FFFFFF)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            color: 'var(--fg, #1F2937)',
          }}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="h-8 px-1.5 text-[11px] rounded focus:outline-none focus:ring-2 focus:ring-[var(--signal,#C6A24E)]/30"
          style={{
            background: 'var(--surface, #FFFFFF)',
            border: '1px solid var(--border, rgba(0,0,0,0.08))',
            color: 'var(--fg, #1F2937)',
          }}
        >
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="text-[11px]" style={{ color: '#DC2626' }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-xs h-7 px-2.5 rounded transition-colors hover:bg-[var(--surface,#FFFFFF)]"
          style={{ color: 'var(--fg-muted, #6B7280)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !form.title.trim()}
          className="text-xs h-7 px-3 rounded font-medium disabled:opacity-50"
          style={{
            background: 'var(--signal, #C6A24E)',
            color: 'white',
          }}
        >
          {submitting ? 'Adding…' : 'Add Task'}
        </button>
      </div>
    </form>
  )
}

function EmptyState({
  filter,
  search,
}: {
  filter: Filter
  search?: string
}) {
  const hasSearch = !!search?.trim()
  return (
    <div className="px-4 py-10 text-center">
      <ClipboardList
        className="w-10 h-10 mx-auto mb-2 opacity-30"
        style={{ color: 'var(--fg-muted, #6B7280)' }}
        aria-hidden="true"
      />
      <p
        className="text-sm font-medium"
        style={{ color: 'var(--fg, #1F2937)' }}
      >
        {hasSearch
          ? `No tasks match "${search}"`
          : filter === 'done'
            ? 'Nothing completed in the last week'
            : filter === 'overdue'
              ? 'Nothing overdue — nice work'
              : filter === 'today'
                ? 'Nothing due today'
                : 'You’re all caught up'}
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: 'var(--fg-muted, #6B7280)' }}
      >
        {hasSearch ? 'Clear the search to see everything.' : (
          <>Click <strong>Add</strong> to create a task.</>
        )}
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Date formatting (native Intl.RelativeTimeFormat)
// ──────────────────────────────────────────────────────────────────────

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function formatDue(iso: string | null): string {
  if (!iso) return 'No due date'
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return ''
  const now = new Date()
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0,
  )
  const dueDay = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
    0, 0, 0, 0,
  )
  const diffDays = Math.round(
    (dueDay.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (diffDays < 0) {
    const days = Math.abs(diffDays)
    return `${days}d overdue`
  }
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Due tomorrow'
  if (diffDays <= 7) return `Due ${RELATIVE.format(diffDays, 'day').replace(/^in /, '')}`
  return `Due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}
