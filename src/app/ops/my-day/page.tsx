'use client'

import { useEffect, useState } from 'react'

interface Task {
  id: string
  label: string
  count: number
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  href: string
  category: string
}

interface MyDayData {
  greeting: string
  role: string
  date: string
  tasks: Task[]
  summary: {
    totalTasks: number
    highPriority: number
    mediumPriority: number
    lowPriority: number
  }
}

type PriorityFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'

export default function MyDayPage() {
  const [data, setData] = useState<MyDayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<PriorityFilter>('ALL')

  const fetchMyDay = async () => {
    try {
      setError(null)
      const response = await fetch('/api/ops/my-day')

      if (!response.ok) {
        throw new Error(`Failed to load My Day (${response.status})`)
      }

      const result: MyDayData = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      console.error('Error fetching My Day:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMyDay()

    // Auto-refresh every 5 minutes (300,000 ms)
    const interval = setInterval(fetchMyDay, 300000)

    return () => clearInterval(interval)
  }, [])

  const getPriorityColor = (priority: 'HIGH' | 'MEDIUM' | 'LOW'): string => {
    switch (priority) {
      case 'HIGH':
        return 'bg-red-50'
      case 'MEDIUM':
        return 'bg-amber-50'
      case 'LOW':
        return 'bg-green-50'
    }
  }

  const getPriorityDotColor = (priority: 'HIGH' | 'MEDIUM' | 'LOW'): string => {
    switch (priority) {
      case 'HIGH':
        return 'bg-red-600'
      case 'MEDIUM':
        return 'bg-signal'
      case 'LOW':
        return 'bg-green-600'
    }
  }

  const getPriorityLabel = (priority: 'HIGH' | 'MEDIUM' | 'LOW'): string => {
    switch (priority) {
      case 'HIGH':
        return 'High'
      case 'MEDIUM':
        return 'Medium'
      case 'LOW':
        return 'Low'
    }
  }

  // Apply priority filter, then group tasks by category
  const visibleTasks = data?.tasks.filter((t) => filter === 'ALL' || t.priority === filter) ?? []
  const groupedTasks = visibleTasks.reduce(
    (acc, task) => {
      if (!acc[task.category]) {
        acc[task.category] = []
      }
      acc[task.category].push(task)
      return acc
    },
    {} as Record<string, Task[]>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        {loading ? (
          <div className="space-y-4 mb-8">
            <div className="h-12 bg-slate-200 rounded-lg animate-pulse" />
            <div className="h-6 bg-slate-200 rounded-lg animate-pulse w-1/3" />
          </div>
        ) : error ? (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-900 font-medium">Error loading My Day</p>
            <p className="text-red-700 text-sm mt-1">{error}</p>
            <button
              onClick={fetchMyDay}
              className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition"
            >
              Try Again
            </button>
          </div>
        ) : data ? (
          <>
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-slate-900 mb-2">{data.greeting}</h1>
              <p className="text-lg text-slate-600">{data.date}</p>
            </div>

            {/* Summary Cards — clickable filters */}
            <div className="grid grid-cols-4 gap-4 mb-8">
              <button
                type="button"
                onClick={() => setFilter('ALL')}
                aria-pressed={filter === 'ALL'}
                className={`text-left bg-white rounded-lg shadow-sm border p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                  filter === 'ALL' ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-200'
                }`}
              >
                <p className="text-slate-600 text-sm font-medium">Total Tasks</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{data.summary.totalTasks}</p>
              </button>

              <button
                type="button"
                onClick={() => setFilter(filter === 'HIGH' ? 'ALL' : 'HIGH')}
                aria-pressed={filter === 'HIGH'}
                className={`text-left bg-red-50 rounded-lg shadow-sm border p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-red-500 ${
                  filter === 'HIGH' ? 'border-red-600 ring-2 ring-red-600' : 'border-red-200'
                }`}
              >
                <p className="text-red-700 text-sm font-medium">High Priority</p>
                <p className="text-3xl font-bold text-red-900 mt-2">{data.summary.highPriority}</p>
              </button>

              <button
                type="button"
                onClick={() => setFilter(filter === 'MEDIUM' ? 'ALL' : 'MEDIUM')}
                aria-pressed={filter === 'MEDIUM'}
                className={`text-left bg-amber-50 rounded-lg shadow-sm border p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                  filter === 'MEDIUM' ? 'border-amber-600 ring-2 ring-amber-600' : 'border-amber-200'
                }`}
              >
                <p className="text-amber-700 text-sm font-medium">Medium Priority</p>
                <p className="text-3xl font-bold text-amber-900 mt-2">{data.summary.mediumPriority}</p>
              </button>

              <button
                type="button"
                onClick={() => setFilter(filter === 'LOW' ? 'ALL' : 'LOW')}
                aria-pressed={filter === 'LOW'}
                className={`text-left bg-green-50 rounded-lg shadow-sm border p-4 hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-green-500 ${
                  filter === 'LOW' ? 'border-green-600 ring-2 ring-green-600' : 'border-green-200'
                }`}
              >
                <p className="text-green-700 text-sm font-medium">Low Priority</p>
                <p className="text-3xl font-bold text-green-900 mt-2">{data.summary.lowPriority}</p>
              </button>
            </div>

            {/* Task List by Category */}
            {data.tasks.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">✓</div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">All caught up!</h2>
                <p className="text-slate-600">You have no pending tasks. Take a breather or review completed work.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {groupedTasks &&
                  Object.entries(groupedTasks)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([category, tasks]) => (
                      <div key={category}>
                        <h2 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                          <span className="inline-block w-1 h-6 rounded-full" style={{ backgroundColor: '#0f2a3e' }} />
                          {category}
                        </h2>
                        <div className="space-y-2">
                          {tasks.map((task) => (
                            <a
                              key={task.id}
                              href={task.href}
                              className={`flex items-center justify-between p-4 rounded-lg shadow-sm border border-slate-200 hover:shadow-md transition cursor-pointer ${getPriorityColor(task.priority)}`}
                            >
                              <div className="flex items-center gap-4 flex-1">
                                <div className={`w-3 h-3 rounded-full ${getPriorityDotColor(task.priority)}`} />
                                <div className="flex-1">
                                  <p className="text-slate-900 font-medium">{task.label}</p>
                                  <p className="text-sm text-slate-600 mt-1">{getPriorityLabel(task.priority)} priority</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-sm font-semibold bg-white border border-slate-200 text-slate-700">
                                  {task.count}
                                </span>
                                <svg
                                  className="w-5 h-5 text-slate-400"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                  />
                                </svg>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
              </div>
            )}

            {/* Last Updated */}
            <div className="mt-8 text-center text-xs text-slate-500">
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
