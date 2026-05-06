'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import DocumentAttachments from '@/components/ops/DocumentAttachments'

// ─── Types ──────────────────────────────────────────────────────────────

interface CommunityDetail {
  id: string
  builderId: string
  builderName: string
  builderType: string
  builderEmail: string
  builderContactName: string
  builderPhone: string | null
  name: string
  code: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  totalLots: number
  activeLots: number
  phase: string | null
  status: string
  division: string | null
  notes: string | null
  boltId: string | null
  createdAt: string
}

interface Contact {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  mobile: string | null
  title: string | null
  role: string
  isPrimary: boolean
  receivesPO: boolean
  receivesInvoice: boolean
}

interface FloorPlan {
  id: string
  name: string
  planNumber: string | null
  sqFootage: number | null
  bedrooms: number | null
  bathrooms: number | null
  stories: number | null
  interiorDoorCount: number | null
  exteriorDoorCount: number | null
  basePackagePrice: number | null
}

interface Job {
  id: string
  jobNumber: string
  lotBlock: string | null
  community: string | null
  jobAddress: string | null
  status: string
  scopeType: string
  scheduledDate: string | null
  completedAt: string | null
  builderName: string
  pmName: string | null
  createdAt: string
}

interface Task {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  category: string
  dueDate: string | null
  assigneeName: string
}

interface CommLog {
  id: string
  channel: string
  direction: string
  subject: string | null
  body: string | null
  fromAddress: string | null
  toAddresses: string[] | null
  sentAt: string
  status: string
}

interface CommunityNote {
  id: string
  category: string
  content: string
  pinned: boolean
  authorName: string | null
  createdAt: string
}

interface Stats {
  jobsByStatus: Array<{ status: string; count: number }>
  totalOrders: number
  totalRevenue: number
  avgOrderValue: number
  lastOrderDate: string | null
}

// ─── Helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  PLANNING: 'bg-purple-100 text-purple-800',
  ACTIVE: 'bg-green-100 text-green-800',
  WINDING_DOWN: 'bg-yellow-100 text-yellow-800',
  CLOSED: 'bg-gray-100 text-gray-600',
}

const JOB_STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  READINESS_CHECK: 'bg-blue-100 text-blue-700',
  MATERIALS_LOCKED: 'bg-indigo-100 text-indigo-700',
  IN_PRODUCTION: 'bg-purple-100 text-purple-700',
  STAGED: 'bg-yellow-100 text-yellow-700',
  LOADED: 'bg-orange-100 text-orange-700',
  IN_TRANSIT: 'bg-amber-100 text-amber-800',
  DELIVERED: 'bg-green-100 text-green-700',
  INSTALLING: 'bg-teal-100 text-teal-700',
  PUNCH_LIST: 'bg-red-100 text-red-700',
  COMPLETE: 'bg-emerald-100 text-emerald-800',
  INVOICED: 'bg-sky-100 text-sky-700',
  CLOSED: 'bg-gray-100 text-gray-500',
}

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-gray-500',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-orange-600',
  CRITICAL: 'text-red-600 font-semibold',
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  DIVISION_VP: 'Division VP',
  PURCHASING: 'Purchasing',
  SUPERINTENDENT: 'Superintendent',
  PROJECT_MANAGER: 'Project Manager',
  ESTIMATOR: 'Estimator',
  ACCOUNTS_PAYABLE: 'Accounts Payable',
  OTHER: 'Other',
}

function fmt$(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Tabs ───────────────────────────────────────────────────────────────

type Tab = 'overview' | 'contacts' | 'jobs' | 'tasks' | 'comms' | 'floorplans' | 'notes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'comms', label: 'Comm Log' },
  { key: 'floorplans', label: 'Floor Plans' },
  { key: 'notes', label: 'Notes' },
]

// ─── Page Component ─────────────────────────────────────────────────────

export default function CommunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  const [community, setCommunity] = useState<CommunityDetail | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([])
  const [notes, setNotes] = useState<CommunityNote[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [commLogs, setCommLogs] = useState<CommLog[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`/api/ops/communities/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setCommunity(data.community)
        setContacts(data.contacts || [])
        setFloorPlans(data.floorPlans || [])
        setNotes(data.notes || [])
        setJobs(data.jobs || [])
        setTasks(data.tasks || [])
        setCommLogs(data.commLogs || [])
        setStats(data.stats || null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
        <p className="mt-4 text-gray-500">Loading community...</p>
      </div>
    )
  }

  if (error || !community) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error || 'Community not found'}
        </div>
        <Link href="/ops/communities" className="mt-4 inline-block text-blue-600 hover:underline">
          Back to Communities
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/ops/communities" className="text-gray-400 hover:text-gray-600 text-sm">
              Communities
            </Link>
            <span className="text-gray-300">/</span>
            <Link href={`/ops/accounts/${community.builderId}`} className="text-blue-600 hover:underline text-sm">
              {community.builderName}
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            {community.name}
            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[community.status] || 'bg-gray-100'}`}>
              {community.status}
            </span>
            {community.code && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono">
                {community.code}
              </span>
            )}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {[community.city, community.state].filter(Boolean).join(', ')}
            {community.division && <> &middot; {community.division}</>}
            {community.phase && <> &middot; {community.phase}</>}
          </p>
        </div>

        {/* KPI cards */}
        <div className="flex gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{community.totalLots}</div>
            <div className="text-xs text-gray-500">Total Lots</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{community.activeLots}</div>
            <div className="text-xs text-gray-500">Active Lots</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">{stats?.totalOrders || 0}</div>
            <div className="text-xs text-gray-500">Orders</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">{fmt$(stats?.totalRevenue || 0)}</div>
            <div className="text-xs text-gray-500">Revenue</div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Link href={`/ops/jobs?community=${encodeURIComponent(community.name)}`}
          className="px-3 py-1.5 bg-surface-elevated text-fg rounded text-sm font-medium hover:bg-surface-muted inline-flex items-center gap-1.5 no-underline">
          🏗️ View Jobs
        </Link>
        <Link href={`/ops/blueprints/analyze?communityId=${community.id}`}
          className="px-3 py-1.5 bg-surface-elevated text-fg rounded text-sm font-medium hover:bg-surface-muted inline-flex items-center gap-1.5 no-underline">
          📐 Add Blueprint
        </Link>
        <Link href={`/ops/takeoff-tool?communityId=${community.id}&community=${encodeURIComponent(community.name)}`}
          className="px-3 py-1.5 bg-signal text-fg-on-accent rounded text-sm font-medium hover:bg-signal-hover inline-flex items-center gap-1.5 no-underline">
          🤖 AI Takeoff
        </Link>
        <Link href={`/ops/schedule?communityId=${community.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          📅 Schedule Task
        </Link>
        <Link href={`/ops/delivery?communityId=${community.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          🚚 Schedule Delivery
        </Link>
        <Link href={`/ops/orders?communityId=${community.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          📦 Orders
        </Link>
        <Link href={`/ops/floor-plans?communityId=${community.id}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          🗺️ Floor Plans
        </Link>
        <Link href={`/ops/accounts/${community.builderId}`}
          className="px-3 py-1.5 border border-border text-fg rounded text-sm font-medium hover:bg-row-hover inline-flex items-center gap-1.5 no-underline">
          🏢 Builder Account
        </Link>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
              {t.key === 'contacts' && contacts.length > 0 && (
                <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{contacts.length}</span>
              )}
              {t.key === 'jobs' && jobs.length > 0 && (
                <span className="ml-1 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{jobs.length}</span>
              )}
              {t.key === 'tasks' && tasks.length > 0 && (
                <span className="ml-1 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">{tasks.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ─────────────────────────────────────── */}
      {tab === 'overview' && <OverviewTab community={community} stats={stats} contacts={contacts} jobs={jobs} tasks={tasks} notes={notes} />}
      {tab === 'contacts' && <ContactsTab contacts={contacts} />}
      {tab === 'jobs' && <JobsTab jobs={jobs} stats={stats} />}
      {tab === 'tasks' && <TasksTab tasks={tasks} />}
      {tab === 'comms' && <CommsTab commLogs={commLogs} />}
      {tab === 'floorplans' && <FloorPlansTab floorPlans={floorPlans} communityId={id} />}
      {tab === 'notes' && <NotesTab notes={notes} />}

      {/* ── Blueprints & Documents (B-FEAT-2) ────────────────── */}
      <div className="mt-8 bg-white border border-gray-200 rounded-lg p-4">
        <DocumentAttachments
          entityType="community"
          entityId={community.id}
          defaultCategory="BLUEPRINT"
          allowedCategories={['BLUEPRINT', 'FLOOR_PLAN', 'SPEC_SHEET', 'CORRESPONDENCE', 'GENERAL']}
          title="Blueprints & Documents"
        />
      </div>
    </div>
  )
}

// ─── Overview Tab ───────────────────────────────────────────────────────

function OverviewTab({ community, stats, contacts, jobs, tasks, notes }: {
  community: CommunityDetail
  stats: Stats | null
  contacts: Contact[]
  jobs: Job[]
  tasks: Task[]
  notes: CommunityNote[]
}) {
  const primaryContact = contacts.find(c => c.isPrimary)
  const activeJobs = jobs.filter(j => !['COMPLETE', 'CLOSED', 'INVOICED'].includes(j.status))
  const pinnedNotes = notes.filter(n => n.pinned)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Community info + primary contact */}
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Community Details</h3>
          <dl className="space-y-2 text-sm">
            {community.address && <div><dt className="text-gray-400">Address</dt><dd>{community.address}</dd></div>}
            {community.county && <div><dt className="text-gray-400">County</dt><dd>{community.county}</dd></div>}
            {community.division && <div><dt className="text-gray-400">Division</dt><dd>{community.division}</dd></div>}
            {community.phase && <div><dt className="text-gray-400">Phase</dt><dd>{community.phase}</dd></div>}
            <div><dt className="text-gray-400">Lots</dt><dd>{community.activeLots} active / {community.totalLots} total</dd></div>
            <div><dt className="text-gray-400">Created</dt><dd>{fmtDate(community.createdAt)}</dd></div>
          </dl>
        </div>

        {primaryContact && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Primary Contact</h3>
            <p className="font-medium">{primaryContact.firstName} {primaryContact.lastName}</p>
            {primaryContact.title && <p className="text-sm text-gray-500">{primaryContact.title}</p>}
            {primaryContact.email && <p className="text-sm text-blue-600">{primaryContact.email}</p>}
            {primaryContact.phone && <p className="text-sm text-gray-600">{primaryContact.phone}</p>}
          </div>
        )}

        {pinnedNotes.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-yellow-800 mb-2">Pinned Notes</h3>
            {pinnedNotes.map(n => (
              <div key={n.id} className="text-sm text-yellow-900 mb-2 last:mb-0">
                <span className="text-xs bg-yellow-200 text-yellow-700 px-1.5 py-0.5 rounded mr-1">{n.category}</span>
                {n.content}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Center: Performance & job status */}
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Performance</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xl font-bold text-gray-900">{fmt$(stats?.totalRevenue || 0)}</div>
              <div className="text-xs text-gray-500">Total Revenue</div>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{fmt$(stats?.avgOrderValue || 0)}</div>
              <div className="text-xs text-gray-500">Avg Order</div>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{stats?.totalOrders || 0}</div>
              <div className="text-xs text-gray-500">Total Orders</div>
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">{fmtDate(stats?.lastOrderDate || null)}</div>
              <div className="text-xs text-gray-500">Last Order</div>
            </div>
          </div>
        </div>

        {stats?.jobsByStatus && stats.jobsByStatus.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Jobs by Status</h3>
            <div className="space-y-1.5">
              {stats.jobsByStatus.map(s => (
                <div key={s.status} className="flex items-center justify-between text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs ${JOB_STATUS_COLORS[s.status] || 'bg-gray-100'}`}>
                    {s.status.replace(/_/g, ' ')}
                  </span>
                  <span className="font-medium">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: Active jobs & tasks */}
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Active Jobs ({activeJobs.length})</h3>
          {activeJobs.length === 0 ? (
            <p className="text-sm text-gray-400">No active jobs</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {activeJobs.slice(0, 10).map(j => (
                <Link key={j.id} href={`/ops/jobs/${j.id}/profile`} className="block p-2 hover:bg-row-hover rounded text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-gray-500">{j.jobNumber}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${JOB_STATUS_COLORS[j.status] || 'bg-gray-100'}`}>
                      {j.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {j.jobAddress && <div className="text-gray-900 text-xs">{j.jobAddress}</div>}
                  {j.lotBlock && <div className="text-gray-500 text-xs">{j.lotBlock}</div>}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Open Tasks ({tasks.length})</h3>
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-400">No open tasks</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {tasks.slice(0, 8).map(t => (
                <div key={t.id} className="p-2 border-l-2 border-gray-200 text-sm">
                  <div className={`font-medium ${PRIORITY_COLORS[t.priority] || ''}`}>{t.title}</div>
                  <div className="text-xs text-gray-500">
                    {t.assigneeName} {t.dueDate && <>&middot; Due {fmtDate(t.dueDate)}</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Contacts Tab ───────────────────────────────────────────────────────

function ContactsTab({ contacts }: { contacts: Contact[] }) {
  if (contacts.length === 0) {
    return <p className="text-gray-400 text-center py-8">No contacts yet. Add contacts from the builder account page.</p>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-600">Name</th>
            <th className="px-4 py-3 font-medium text-gray-600">Role</th>
            <th className="px-4 py-3 font-medium text-gray-600">Email</th>
            <th className="px-4 py-3 font-medium text-gray-600">Phone</th>
            <th className="px-4 py-3 font-medium text-gray-600">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {contacts.map(c => (
            <tr key={c.id} className="hover:bg-row-hover">
              <td className="px-4 py-3">
                <div className="font-medium">
                  {c.firstName} {c.lastName}
                  {c.isPrimary && <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Primary</span>}
                </div>
                {c.title && <div className="text-xs text-gray-500">{c.title}</div>}
              </td>
              <td className="px-4 py-3 text-gray-600">{ROLE_LABELS[c.role] || c.role}</td>
              <td className="px-4 py-3 text-blue-600">{c.email || '—'}</td>
              <td className="px-4 py-3 text-gray-600">{c.phone || c.mobile || '—'}</td>
              <td className="px-4 py-3">
                {c.receivesPO && <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded mr-1">PO</span>}
                {c.receivesInvoice && <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">Invoice</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Jobs Tab ───────────────────────────────────────────────────────────

function JobsTab({ jobs, stats }: { jobs: Job[]; stats: Stats | null }) {
  return (
    <div>
      {stats?.jobsByStatus && (
        <div className="flex flex-wrap gap-2 mb-4">
          {stats.jobsByStatus.map(s => (
            <span key={s.status} className={`text-xs px-2 py-1 rounded ${JOB_STATUS_COLORS[s.status] || 'bg-gray-100'}`}>
              {s.status.replace(/_/g, ' ')}: {s.count}
            </span>
          ))}
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-600">Job #</th>
              <th className="px-4 py-3 font-medium text-gray-600">Address</th>
              <th className="px-4 py-3 font-medium text-gray-600">Lot/Block</th>
              <th className="px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 font-medium text-gray-600">Scope</th>
              <th className="px-4 py-3 font-medium text-gray-600">PM</th>
              <th className="px-4 py-3 font-medium text-gray-600">Scheduled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map(j => (
              <tr key={j.id} className="hover:bg-row-hover cursor-pointer">
                <td className="px-4 py-3">
                  <Link href={`/ops/jobs/${j.id}/profile`} className="font-mono text-blue-600 hover:underline text-xs">
                    {j.jobNumber}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/ops/jobs/${j.id}/profile`} className="text-gray-900 hover:text-blue-600 hover:underline">
                    {j.jobAddress || '—'}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-700">{j.lotBlock || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded ${JOB_STATUS_COLORS[j.status] || 'bg-gray-100'}`}>
                    {j.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">{j.scopeType}</td>
                <td className="px-4 py-3 text-gray-600">{j.pmName || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{fmtDate(j.scheduledDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {jobs.length === 0 && (
          <p className="text-gray-400 text-center py-8">No jobs found for this community</p>
        )}
      </div>
    </div>
  )
}

// ─── Tasks Tab ──────────────────────────────────────────────────────────

function TasksTab({ tasks }: { tasks: Task[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-600">Task</th>
            <th className="px-4 py-3 font-medium text-gray-600">Priority</th>
            <th className="px-4 py-3 font-medium text-gray-600">Category</th>
            <th className="px-4 py-3 font-medium text-gray-600">Assigned To</th>
            <th className="px-4 py-3 font-medium text-gray-600">Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tasks.map(t => (
            <tr key={t.id} className="hover:bg-row-hover">
              <td className="px-4 py-3">
                <div className="font-medium text-gray-900">{t.title}</div>
                {t.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{t.description}</div>}
              </td>
              <td className={`px-4 py-3 text-xs ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</td>
              <td className="px-4 py-3 text-xs text-gray-500">{t.category.replace(/_/g, ' ')}</td>
              <td className="px-4 py-3 text-gray-700">{t.assigneeName}</td>
              <td className="px-4 py-3 text-gray-600">{fmtDate(t.dueDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && (
        <p className="text-gray-400 text-center py-8">No open tasks for this community</p>
      )}
    </div>
  )
}

// ─── Communication Log Tab ──────────────────────────────────────────────

function CommsTab({ commLogs }: { commLogs: CommLog[] }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {commLogs.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No communication logs linked to this community yet</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {commLogs.map(log => (
            <div key={log.id} className="px-4 py-3 hover:bg-row-hover">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  log.direction === 'INBOUND' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                }`}>
                  {log.direction === 'INBOUND' ? 'IN' : 'OUT'}
                </span>
                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{log.channel}</span>
                <span className="text-xs text-gray-400">{fmtDate(log.sentAt)}</span>
              </div>
              <div className="font-medium text-sm text-gray-900">{log.subject || '(No subject)'}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {log.fromAddress && <>From: {log.fromAddress}</>}
                {log.toAddresses && log.toAddresses.length > 0 && <> &rarr; {log.toAddresses.join(', ')}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Floor Plans Tab ────────────────────────────────────────────────────

interface BomLine {
  id: string
  section: string | null
  lineOrder: number
  itemName: string
  quantity: number | null
  unit: string | null
  unitPrice: number | null
  extended: number | null
  wall: string | null
  location: string | null
}

interface BomPayload {
  plan: {
    id: string
    name: string
    planNumber: string | null
    sqFootage: number | null
    basePackagePrice: number | null
    builderName: string
    communityName: string
  }
  lineCount: number
  sections: Record<string, BomLine[]>
  revisionTag: string | null
}

function FloorPlansTab({ floorPlans, communityId }: { floorPlans: FloorPlan[]; communityId: string }) {
  const [openPlanId, setOpenPlanId] = useState<string | null>(null)
  const [bom, setBom] = useState<BomPayload | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  const [bomError, setBomError] = useState<string | null>(null)

  function openBom(planId: string) {
    setOpenPlanId(planId)
    setBom(null)
    setBomError(null)
    setBomLoading(true)
    fetch(`/api/ops/communities/${communityId}/floor-plans/${planId}/bom`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setBom(data)
      })
      .catch(e => setBomError(e.message))
      .finally(() => setBomLoading(false))
  }

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {floorPlans.length === 0 ? (
          <p className="text-gray-400 text-center py-8">No floor plans added yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Plan Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Plan #</th>
                <th className="px-4 py-3 font-medium text-gray-600">Sq Ft</th>
                <th className="px-4 py-3 font-medium text-gray-600">Bed/Bath</th>
                <th className="px-4 py-3 font-medium text-gray-600">Int Doors</th>
                <th className="px-4 py-3 font-medium text-gray-600">Ext Doors</th>
                <th className="px-4 py-3 font-medium text-gray-600">Package Price</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-right">BoM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {floorPlans.map(fp => (
                <tr key={fp.id} className="hover:bg-row-hover">
                  <td className="px-4 py-3 font-medium text-gray-900">{fp.name}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{fp.planNumber || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fp.sqFootage?.toLocaleString() || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fp.bedrooms || '—'} / {fp.bathrooms || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fp.interiorDoorCount || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fp.exteriorDoorCount || '—'}</td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{fp.basePackagePrice ? fmt$(fp.basePackagePrice) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openBom(fp.id)}
                      className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-700 hover:bg-surface-muted hover:border-gray-400"
                    >
                      View BoM
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openPlanId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenPlanId(null)}>
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {bom?.plan?.name || 'Plan BoM'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {bom?.plan?.builderName} · {bom?.plan?.communityName}
                  {bom?.plan?.sqFootage ? ` · ${bom.plan.sqFootage.toLocaleString()} sqft` : ''}
                  {bom?.revisionTag ? ` · ${bom.revisionTag}` : ''}
                  {bom?.lineCount ? ` · ${bom.lineCount} lines` : ''}
                </p>
              </div>
              <button onClick={() => setOpenPlanId(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-auto px-6 py-4">
              {bomLoading && <p className="text-sm text-gray-500 py-8 text-center">Loading BoM…</p>}
              {bomError && <p className="text-sm text-red-600 py-8 text-center">Error: {bomError}</p>}
              {bom && bom.lineCount === 0 && (
                <p className="text-sm text-gray-500 py-8 text-center">No BoM lines on file for this plan yet.</p>
              )}
              {bom && bom.lineCount > 0 && (
                <div className="space-y-5">
                  {Object.entries(bom.sections).map(([section, lines]) => (
                    <div key={section}>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{section}</h4>
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-left">
                          <tr>
                            <th className="px-2 py-1.5 font-medium text-gray-600">Item</th>
                            <th className="px-2 py-1.5 font-medium text-gray-600">Qty</th>
                            <th className="px-2 py-1.5 font-medium text-gray-600">Wall/UOM</th>
                            <th className="px-2 py-1.5 font-medium text-gray-600">Location</th>
                            <th className="px-2 py-1.5 font-medium text-gray-600 text-right">Unit Price</th>
                            <th className="px-2 py-1.5 font-medium text-gray-600 text-right">Extended</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {lines.map(l => (
                            <tr key={l.id}>
                              <td className="px-2 py-1.5 text-gray-900">{l.itemName}</td>
                              <td className="px-2 py-1.5 text-gray-700 tabular-nums">{l.quantity ?? '—'}</td>
                              <td className="px-2 py-1.5 text-gray-600">{l.wall || l.unit || '—'}</td>
                              <td className="px-2 py-1.5 text-gray-600">{l.location || '—'}</td>
                              <td className="px-2 py-1.5 text-gray-900 tabular-nums text-right">
                                {l.unitPrice != null ? `$${l.unitPrice.toFixed(2)}` : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-gray-900 tabular-nums text-right">
                                {l.extended != null
                                  ? `$${l.extended.toFixed(2)}`
                                  : (l.quantity != null && l.unitPrice != null
                                      ? `$${(l.quantity * l.unitPrice).toFixed(2)}`
                                      : '—')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Notes Tab ──────────────────────────────────────────────────────────

function NotesTab({ notes }: { notes: CommunityNote[] }) {
  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No notes yet</p>
      ) : (
        notes.map(n => (
          <div key={n.id} className={`bg-white border rounded-lg p-4 ${n.pinned ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              {n.pinned && <span className="text-xs">&#128204;</span>}
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{n.category}</span>
              <span className="text-xs text-gray-400">{n.authorName || 'System'} &middot; {fmtDate(n.createdAt)}</span>
            </div>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.content}</p>
          </div>
        ))
      )}
    </div>
  )
}
