'use client'

import React, { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

interface BriefingStop {
  id: string
  stopNumber: number
  timeWindow: string
  type: 'DELIVERY' | 'INSTALLATION' | 'PICKUP'
  address: string
  builderName: string
  builderCompany?: string
  jobNumber: string
  specialInstructions?: string
  items: Array<{
    description: string
    quantity: number
  }>
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
}

interface DailyBriefing {
  crewName: string
  crewId: string
  date: string
  totalStops: number
  deliveries: number
  installations: number
  estimatedDriveTime: string
  stops: BriefingStop[]
  allCompleted: boolean
}

function CrewBriefingInner() {
  const searchParams = useSearchParams()
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completedStops, setCompletedStops] = useState<Set<string>>(new Set())

  const crewId = searchParams.get('crewId')
  const date = new Date().toISOString().split('T')[0]

  useEffect(() => {
    const fetchBriefing = async () => {
      if (!crewId) {
        setError('Crew ID required')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(
          `/api/crew/daily-briefing?crewId=${crewId}&date=${date}`
        )

        if (!response.ok) {
          throw new Error('Failed to load briefing')
        }

        const data: DailyBriefing = await response.json()
        setBriefing(data)

        // Track which stops are completed
        const completed = new Set(
          data.stops
            .filter(s => s.status === 'COMPLETED')
            .map(s => s.id)
        )
        setCompletedStops(completed)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load briefing')
      } finally {
        setLoading(false)
      }
    }

    fetchBriefing()
  }, [crewId, date])

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'DELIVERY':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'INSTALLATION':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'PICKUP':
        return 'bg-orange-100 text-orange-800 border-orange-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  const getTypeEmoji = (type: string) => {
    switch (type) {
      case 'DELIVERY':
        return '📦'
      case 'INSTALLATION':
        return '🔧'
      case 'PICKUP':
        return '🚛'
      default:
        return '📍'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'NOT_STARTED':
        return 'bg-gray-100 text-gray-700'
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-700'
      case 'COMPLETED':
        return 'bg-green-100 text-green-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-32 bg-gradient-to-r from-[#3E2A1E] to-[#0D2438] rounded-lg animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-lg p-4 h-40 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !briefing) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">{error || 'Failed to load briefing'}</p>
        </div>
      </div>
    )
  }

  const progressPercent = briefing.totalStops > 0
    ? Math.round((completedStops.size / briefing.totalStops) * 100)
    : 0

  const formattedDate = new Date(briefing.date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  })

  return (
    <div className="p-4 space-y-4 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#3E2A1E] to-[#0D2438] text-white rounded-lg p-5">
        <p className="text-sm text-blue-200 mb-1">Good Morning</p>
        <h1 className="text-2xl font-bold mb-3">{briefing.crewName}</h1>
        <p className="text-lg font-semibold">{formattedDate}</p>
        <p className="text-sm text-blue-100 mt-2">
          {briefing.totalStops} stop{briefing.totalStops !== 1 ? 's' : ''} today
        </p>
      </div>

      {/* Progress Bar */}
      {briefing.totalStops > 0 && !briefing.allCompleted && (
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">Progress</p>
            <p className="text-sm font-bold text-[#C9822B]">{progressPercent}%</p>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-[#C9822B] h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {completedStops.size} of {briefing.totalStops} stops completed
          </p>
        </div>
      )}

      {/* Completion Celebration */}
      {briefing.allCompleted && briefing.totalStops > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-300 rounded-lg p-6 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-lg font-bold text-green-900">All stops completed!</p>
          <p className="text-sm text-green-700 mt-1">Great work today</p>
        </div>
      )}

      {/* Summary Cards */}
      {briefing.totalStops > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-200">
            <p className="text-xl font-bold text-blue-900">{briefing.deliveries}</p>
            <p className="text-xs text-blue-700 mt-1">Deliveries</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 text-center border border-green-200">
            <p className="text-xl font-bold text-green-900">{briefing.installations}</p>
            <p className="text-xs text-green-700 mt-1">Installations</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-3 text-center border border-orange-200">
            <p className="text-sm font-bold text-orange-900">{briefing.estimatedDriveTime}</p>
            <p className="text-xs text-orange-700 mt-1">Drive Time</p>
          </div>
        </div>
      )}

      {/* Stops */}
      {briefing.totalStops === 0 ? (
        <div className="bg-white rounded-lg p-8 text-center border border-gray-200">
          <p className="text-4xl mb-3">📅</p>
          <p className="text-lg font-medium text-gray-900">No stops scheduled</p>
          <p className="text-sm text-gray-500 mt-1">Check back later or contact your manager</p>
        </div>
      ) : (
        <div className="space-y-3">
          {briefing.stops.map(stop => (
            <Link
              key={stop.id}
              href={`/crew/${stop.type === 'DELIVERY' ? 'delivery' : 'install'}/${stop.jobNumber}?briefing=true`}
              className="block"
            >
              <div className={`rounded-lg p-4 border-2 transition-all hover:shadow-md ${
                stop.status === 'COMPLETED'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-white border-gray-200 hover:border-[#C9822B]'
              }`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 text-gray-700 font-bold text-sm">
                      {stop.stopNumber}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-600 uppercase flex items-center gap-1">
                        <span>{getTypeEmoji(stop.type)}</span>
                        {stop.type}
                      </p>
                      <p className="text-sm font-bold text-gray-900 mt-0.5">{stop.jobNumber}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(stop.status)}`}>
                    {stop.status.replace('_', ' ')}
                  </span>
                </div>

                {/* Builder & Address */}
                <div className="mb-3">
                  <p className="font-semibold text-base text-gray-900">{stop.builderName}</p>
                  <p className="text-sm text-gray-600 mt-1 flex items-start gap-2">
                    <span className="mt-0.5">📍</span>
                    <span>{stop.address}</span>
                  </p>
                </div>

                {/* Time */}
                <div className="flex items-center gap-2 mb-3 text-sm text-gray-600">
                  <span>🕐</span>
                  <span>{stop.timeWindow}</span>
                </div>

                {/* Items Summary */}
                {stop.items.length > 0 && (
                  <div className="bg-gray-50 rounded p-3 mb-3 border border-gray-200">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Items:</p>
                    <ul className="space-y-1">
                      {stop.items.map((item, idx) => (
                        <li key={idx} className="text-xs text-gray-700">
                          {item.quantity}x {item.description}
                        </li>
                      ))}
                      {briefing.stops.find(s => s.id === stop.id)?.items && briefing.stops.find(s => s.id === stop.id)!.items.length > 5 && (
                        <li className="text-xs text-gray-500 italic">+ more items</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Special Instructions */}
                {stop.specialInstructions && (
                  <div className="bg-yellow-50 rounded p-3 mb-3 border border-yellow-200">
                    <p className="text-xs font-semibold text-yellow-900 mb-1">⚠️ Special Instructions</p>
                    <p className="text-xs text-yellow-800">{stop.specialInstructions}</p>
                  </div>
                )}

                {/* CTA Buttons */}
                <div className="flex gap-2 pt-3" onClick={(e) => e.preventDefault()}>
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(stop.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-2 px-3 rounded text-sm transition-colors"
                  >
                    Navigate
                  </a>
                  {stop.status !== 'COMPLETED' && (
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                      }}
                      className="flex-1 bg-[#C9822B] hover:bg-[#A86B1F] text-white font-semibold py-2 px-3 rounded text-sm transition-colors"
                    >
                      Start
                    </button>
                  )}
                  {stop.status === 'COMPLETED' && (
                    <button
                      disabled
                      className="flex-1 bg-green-500 text-white font-semibold py-2 px-3 rounded text-sm"
                    >
                      ✓ Completed
                    </button>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Helper Text */}
      <div className="bg-orange-50 border border-[#C9822B] rounded-lg p-4 text-sm">
        <p className="text-orange-900">
          💡 <strong>Tip:</strong> Tap any stop to view full details. Use the Navigate button to open directions in Maps.
        </p>
      </div>
    </div>
  )
}

export default function CrewBriefingPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center"><p className="text-gray-500">Loading briefing...</p></div>}>
      <CrewBriefingInner />
    </Suspense>
  )
}
