'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useToast } from '@/contexts/ToastContext'

interface Job {
  id: string
  jobNumber: string
  builderName: string
  community: string
  status: string
  scheduledDate: string | null
}

interface Delivery {
  id: string
  title: string
  scheduledDate: string
  job: { builderName: string; jobAddress?: string } | null
}

interface Task {
  id: string
  title: string
  description?: string
  status: string
  dueDate: string | null
  priority: string
}

interface DecisionNote {
  id: string
  jobId: string
  type: string
  priority: string
  createdAt: string
  job: { jobNumber: string; builderName: string } | null
}

interface Builder {
  id: string
  companyName: string
  activeJobsCount?: number
  ytdRevenue?: number
  revenue?: number // trailing 12mo revenue from pm-briefing
}

export default function PMPortal() {
  const { addToast } = useToast()
  const [myJobs, setMyJobs] = useState<Job[]>([])
  const [upcomingDeliveries, setUpcomingDeliveries] = useState<Delivery[]>([])
  const [openTasks, setOpenTasks] = useState<Task[]>([])
  const [recentNotes, setRecentNotes] = useState<DecisionNote[]>([])
  const [topBuilders, setTopBuilders] = useState<Builder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal states
  const [noteModal, setNoteModal] = useState<{ open: boolean; jobId?: string }>({ open: false })
  const [decisionNoteModal, setDecisionNoteModal] = useState(false)
  const [taskModal, setTaskModal] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteJobId, setNoteJobId] = useState('')
  const [decisionNoteJobId, setDecisionNoteJobId] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskJobId, setTaskJobId] = useState('')
  const [taskPriority, setTaskPriority] = useState('MEDIUM')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [submittingNote, setSubmittingNote] = useState(false)

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      const today = new Date()
      const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      const todayStr = today.toISOString().split('T')[0]
      const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0]

      // Top builders come from pm-briefing (per-PM, revenue-sorted trailing 12mo);
      // other widgets stay on the existing endpoints.
      const [jobsRes, deliveriesRes, tasksRes, notesRes, briefingRes] = await Promise.all([
        fetch('/api/ops/jobs?limit=10&status=CREATED,READINESS_CHECK,MATERIALS_LOCKED,IN_PRODUCTION,STAGED'),
        fetch(`/api/ops/schedule?startDate=${todayStr}&endDate=${sevenDaysStr}&entryType=DELIVERY&limit=5`),
        fetch('/api/ops/jobs?limit=10'),
        fetch('/api/ops/jobs?limit=10'),
        fetch('/api/ops/pm-briefing'),
      ])

      const [jobsData, deliveriesData, tasksData, notesData, briefingData] = await Promise.all([
        jobsRes.ok ? jobsRes.json() : { jobs: [] },
        deliveriesRes.ok ? deliveriesRes.json() : { entries: [] },
        tasksRes.ok ? tasksRes.json() : { jobs: [] },
        notesRes.ok ? notesRes.json() : { jobs: [] },
        briefingRes.ok ? briefingRes.json() : { topBuilders: [] },
      ])
      const buildersData = { builders: briefingData.topBuilders || [] }

      setMyJobs((jobsData.jobs || []).slice(0, 5))
      setUpcomingDeliveries((deliveriesData.entries || []).slice(0, 5))

      // Extract tasks from jobs
      const allTasks: Task[] = []
      ;(tasksData.jobs || []).forEach((job: any) => {
        if (job.tasks) {
          job.tasks.forEach((task: any) => {
            if (task.status !== 'COMPLETE') {
              allTasks.push(task)
            }
          })
        }
      })
      setOpenTasks(allTasks.slice(0, 5))

      // Extract decision notes
      const allNotes: DecisionNote[] = []
      ;(notesData.jobs || []).forEach((job: any) => {
        if (job.decisionNotes) {
          job.decisionNotes.forEach((note: any) => {
            allNotes.push({ ...note, job })
          })
        }
      })
      setRecentNotes(allNotes.slice(0, 5))

      // Set top builders with real data (from pm-briefing — revenue trailing 12mo)
      const builders = (buildersData.builders || []).map((builder: any) => ({
        id: builder.id,
        companyName: builder.companyName,
        activeJobsCount: builder.activeJobsCount || 0,
        ytdRevenue: builder.revenue ?? builder.ytdRevenue ?? 0,
      }))
      setTopBuilders(builders.slice(0, 4))
    } catch (error) {
      console.error('Failed to load PM data:', error)
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const statusColors: Record<string, string> = {
    CREATED: 'bg-gray-100 text-gray-700',
    READINESS_CHECK: 'bg-blue-100 text-blue-700',
    MATERIALS_LOCKED: 'bg-orange-100 text-orange-700',
    IN_PRODUCTION: 'bg-yellow-100 text-yellow-700',
    STAGED: 'bg-purple-100 text-purple-700',
    LOADED: 'bg-orange-100 text-orange-700',
    IN_TRANSIT: 'bg-cyan-100 text-cyan-700',
    DELIVERED: 'bg-green-100 text-green-700',
  }

  const priorityColors: Record<string, string> = {
    HIGH: 'text-red-600 font-semibold',
    MEDIUM: 'text-orange-600 font-medium',
    LOW: 'text-gray-600',
  }

  // Handle note submission
  const handleSubmitNote = async () => {
    if (!noteText.trim() || !noteJobId) return

    setSubmittingNote(true)
    try {
      const response = await fetch(`/api/ops/jobs/${noteJobId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteType: 'GENERAL',
          subject: 'Note',
          body: noteText,
          priority: 'MEDIUM',
          authorId: 'system', // In production, get from auth context
        }),
      })

      if (response.ok) {
        setNoteText('')
        setNoteJobId('')
        setNoteModal({ open: false })
        addToast({ type: 'success', title: 'Note Added', message: 'Note added successfully' })
      } else {
        addToast({ type: 'error', title: 'Error', message: 'Failed to add note' })
      }
    } catch (error) {
      console.error('Failed to submit note:', error)
      addToast({ type: 'error', title: 'Error', message: 'Error adding note' })
    } finally {
      setSubmittingNote(false)
    }
  }

  // Handle decision note submission
  const handleSubmitDecisionNote = async () => {
    if (!noteText.trim() || !decisionNoteJobId) return

    setSubmittingNote(true)
    try {
      const response = await fetch(`/api/ops/jobs/${decisionNoteJobId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteType: 'DECISION',
          subject: 'Decision Note',
          body: noteText,
          priority: 'MEDIUM',
          authorId: 'system',
        }),
      })

      if (response.ok) {
        setNoteText('')
        setDecisionNoteJobId('')
        setDecisionNoteModal(false)
        addToast({ type: 'success', title: 'Decision Recorded', message: 'Decision note added successfully' })
      } else {
        addToast({ type: 'error', title: 'Error', message: 'Failed to add decision note' })
      }
    } catch (error) {
      console.error('Failed to submit decision note:', error)
      addToast({ type: 'error', title: 'Error', message: 'Error adding decision note' })
    } finally {
      setSubmittingNote(false)
    }
  }

  // Handle task creation
  const handleSubmitTask = async () => {
    if (!taskTitle.trim() || !taskJobId) return

    setSubmittingNote(true)
    try {
      const response = await fetch(`/api/ops/jobs/${taskJobId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          dueDate: taskDueDate || null,
          status: 'OPEN',
          priority: taskPriority,
        }),
      })

      if (response.ok) {
        setTaskTitle('')
        setTaskDescription('')
        setTaskDueDate('')
        setTaskJobId('')
        setTaskPriority('MEDIUM')
        setTaskModal(false)
        addToast({ type: 'success', title: 'Task Created', message: 'Task created successfully' })
      } else {
        addToast({ type: 'error', title: 'Error', message: 'Failed to create task' })
      }
    } catch (error) {
      console.error('Failed to submit task:', error)
      addToast({ type: 'error', title: 'Error', message: 'Error creating task' })
    } finally {
      setSubmittingNote(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0f2a3e]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-gray-600 font-medium">{error}</p>
        <button onClick={() => { setError(null); loadData() }} className="mt-4 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] text-sm">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Project Manager Dashboard</h1>
          <p className="text-gray-600 mt-1">Track jobs, deliveries, and team tasks</p>
        </div>
        <div className="flex gap-2">
          <Link href="/ops/jobs" className="px-4 py-2 bg-[#0f2a3e] text-white rounded-lg hover:bg-[#0a1a28] transition-colors text-sm font-medium">
            + Create Job
          </Link>
          <button
            onClick={() => setNoteModal({ open: true })}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium">
            Add Note
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* My Jobs - spans 2 columns */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">My Jobs</h2>
            <Link href="/ops/jobs" className="text-sm text-[#0f2a3e] hover:text-[#C6A24E]">
              View All →
            </Link>
          </div>

          {myJobs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">👷</p>
              <p>No active jobs assigned</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myJobs.map((job) => (
                <Link key={job.id} href={`/ops/jobs/${job.id}`}>
                  <div className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:border-[#0f2a3e] hover:bg-blue-50 transition-all">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{job.jobNumber}</p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {job.builderName} • {job.community}
                      </p>
                      {job.scheduledDate && (
                        <p className="text-xs text-gray-500 mt-1">
                          📅 {new Date(job.scheduledDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[job.status] || 'bg-gray-100 text-gray-700'}`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl border p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-2">
            <Link href="/ops/portal/pm/briefing" className="block px-4 py-3 rounded-lg border border-[#C6A24E] bg-orange-50 hover:bg-orange-100 transition-all text-sm font-medium text-gray-900">
              ☀️ Morning Briefing
            </Link>
            <Link href="/ops/jobs" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-[#0f2a3e] transition-all text-sm font-medium text-gray-900">
              🆕 Create Job
            </Link>
            <button
              onClick={() => setDecisionNoteModal(true)}
              className="w-full px-4 py-3 rounded-lg border border-gray-200 hover:bg-orange-50 hover:border-[#C6A24E] transition-all text-sm font-medium text-gray-900">
              📝 Add Decision Note
            </button>
            <Link href="/ops/schedule" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-green-50 hover:border-[#27AE60] transition-all text-sm font-medium text-gray-900">
              📅 Schedule Delivery
            </Link>
            <Link href="/ops/portal/pm/material" className="block px-4 py-3 rounded-lg border border-[#0f2a3e] bg-blue-50 hover:bg-blue-100 transition-all text-sm font-medium text-gray-900">
              📊 My Material Status
            </Link>
            <Link href="/ops/portal/pm/material-eta" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-[#0f2a3e] transition-all text-sm font-medium text-gray-900">
              📦 Material ETA
            </Link>
            <Link href="/ops/portal/pm/scorecard" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all text-sm font-medium text-gray-900">
              📈 PM Scorecard
            </Link>
            <Link href="/ops/reports" className="block px-4 py-3 rounded-lg border border-gray-200 hover:bg-purple-50 hover:border-purple-500 transition-all text-sm font-medium text-gray-900">
              📊 View Reports
            </Link>
          </div>
        </div>
      </div>

      {/* Upcoming Deliveries */}
      <div className="bg-white rounded-xl border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Upcoming Deliveries (Next 7 Days)</h2>
          <Link href="/ops/schedule" className="text-sm text-[#0f2a3e] hover:text-[#C6A24E]">
            Full Schedule →
          </Link>
        </div>

        {upcomingDeliveries.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p className="text-3xl mb-2">🚚</p>
            <p>No deliveries scheduled</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingDeliveries.map((delivery) => (
              <div key={delivery.id} className="p-4 rounded-lg border border-gray-200 hover:border-[#C6A24E] transition-all">
                <p className="font-semibold text-gray-900 truncate">{delivery.title}</p>
                <p className="text-sm text-gray-600 mt-1">
                  {delivery.job?.builderName || 'Unassigned'}
                </p>
                {delivery.job?.jobAddress && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">{delivery.job.jobAddress}</p>
                )}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-500">
                    📅 {new Date(delivery.scheduledDate).toLocaleDateString()}
                  </span>
                  <span className="text-xs font-medium text-[#0f2a3e]">View →</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two column layout for Tasks and Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Tasks */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Open Tasks</h2>
            <button
              onClick={() => setTaskModal(true)}
              className="text-sm text-[#0f2a3e] hover:text-[#C6A24E]">
              New Task →
            </button>
          </div>

          {openTasks.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">✅</p>
              <p>All tasks completed!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {openTasks.map((task) => (
                <div key={task.id} className="p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-gray-500 mt-1">{task.description}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ml-2 ${priorityColors[task.priority] || 'text-gray-600'}`}>
                      {task.priority}
                    </span>
                  </div>
                  {task.dueDate && (
                    <p className="text-xs text-gray-500 mt-2">
                      Due: {new Date(task.dueDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Decision Notes */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Recent Decision Notes</h2>
            <button
              onClick={() => setDecisionNoteModal(true)}
              className="text-sm text-[#0f2a3e] hover:text-[#C6A24E]">
              Add Note →
            </button>
          </div>

          {recentNotes.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p className="text-3xl mb-2">📝</p>
              <p>No decision notes yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentNotes.map((note) => (
                <div key={note.id} className="p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-all">
                  <div className="flex items-start justify-between mb-1">
                    <p className="font-medium text-gray-900 text-sm">{note.job?.jobNumber}</p>
                    {note.priority && (
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        note.priority === 'HIGH' ? 'bg-red-100 text-red-700' :
                        note.priority === 'MEDIUM' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {note.priority}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">{note.type}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(note.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Builder Account Summaries */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Key Builder Accounts</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {topBuilders.length === 0 ? (
            <div className="col-span-full text-center py-8 text-gray-500">
              <p>No builders loaded</p>
            </div>
          ) : (
            topBuilders.map((builder) => (
              <div key={builder.id} className="p-4 rounded-lg border border-gray-200 hover:border-[#0f2a3e] transition-all">
                <p className="font-semibold text-gray-900 text-sm">{builder.companyName}</p>
                <div className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Active Jobs</span>
                    <span className="font-semibold">{builder.activeJobsCount || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">YTD Revenue</span>
                    <span className="font-semibold">${(builder.ytdRevenue || 0) / 1000}K</span>
                  </div>
                </div>
                <Link
                  href={`/ops/accounts/${builder.id}`}
                  className="w-full block mt-3 text-xs py-1.5 rounded border border-gray-200 hover:bg-gray-50 text-gray-700 transition-colors text-center">
                  View Account
                </Link>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Note Modal */}
      {noteModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Add Note</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Job</label>
                  <select
                    value={noteJobId}
                    onChange={(e) => setNoteJobId(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent">
                    <option value="">Choose a job...</option>
                    {myJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.jobNumber} - {job.builderName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Enter your note..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent resize-none"
                    rows={5}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setNoteModal({ open: false })
                    setNoteJobId('')
                    setNoteText('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmitNote}
                  disabled={submittingNote || !noteText.trim() || !noteJobId}
                  className="flex-1 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg text-sm font-medium hover:bg-[#0a1a28] transition-colors disabled:opacity-50">
                  {submittingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Decision Note Modal */}
      {decisionNoteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Add Decision Note</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Job</label>
                  <select
                    value={decisionNoteJobId}
                    onChange={(e) => setDecisionNoteJobId(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent">
                    <option value="">Choose a job...</option>
                    {myJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.jobNumber} - {job.builderName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Decision Note</label>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Enter your decision note..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent resize-none"
                    rows={5}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setDecisionNoteModal(false)
                    setDecisionNoteJobId('')
                    setNoteText('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmitDecisionNote}
                  disabled={submittingNote || !noteText.trim() || !decisionNoteJobId}
                  className="flex-1 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg text-sm font-medium hover:bg-[#0a1a28] transition-colors disabled:opacity-50">
                  {submittingNote ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {taskModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-md w-full">
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Create New Task</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Task Title</label>
                  <input
                    type="text"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Enter task title..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Select Job</label>
                  <select
                    value={taskJobId}
                    onChange={(e) => setTaskJobId(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent">
                    <option value="">Choose a job...</option>
                    {myJobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.jobNumber} - {job.builderName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent">
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder="Enter task description..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0f2a3e] focus:border-transparent resize-none"
                    rows={3}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setTaskModal(false)
                    setTaskTitle('')
                    setTaskJobId('')
                    setTaskPriority('MEDIUM')
                    setTaskDescription('')
                    setTaskDueDate('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmitTask}
                  disabled={submittingNote || !taskTitle.trim() || !taskJobId}
                  className="flex-1 px-4 py-2 bg-[#0f2a3e] text-white rounded-lg text-sm font-medium hover:bg-[#0a1a28] transition-colors disabled:opacity-50">
                  {submittingNote ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
