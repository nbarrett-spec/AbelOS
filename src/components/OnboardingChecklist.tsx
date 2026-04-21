'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'

interface OnboardingStep {
  id: string
  name: string
  description: string
  completed: boolean
  optional: boolean
  ctaText: string
  href: string
}

interface OnboardingData {
  steps: OnboardingStep[]
  completedCount: number
  totalCount: number
  percentComplete: number
}

interface OnboardingChecklistProps {
  onClose?: () => void
}

export default function OnboardingChecklist({ onClose }: OnboardingChecklistProps) {
  const [data, setData] = useState<OnboardingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fetchOnboarding = async () => {
      try {
        const response = await fetch('/api/builder/onboarding')
        if (!response.ok) {
          throw new Error('Failed to load onboarding data')
        }
        const onboardingData: OnboardingData = await response.json()
        setData(onboardingData)

        // Track completed steps for animations
        const completed = new Set(
          onboardingData.steps
            .filter(s => s.completed)
            .map(s => s.id)
        )
        setCompletedSteps(completed)
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Onboarding fetch error:', err)
        }
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }

    fetchOnboarding()
  }, [])

  const handleDismiss = async (stepId: string) => {
    try {
      await fetch('/api/builder/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId, dismissed: true })
      })
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to dismiss step:', err)
      }
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden">
        <div className="h-48 bg-gray-100 animate-pulse" />
      </div>
    )
  }

  if (!data || error) {
    return null
  }

  // Hide if 100% complete
  if (data.percentComplete === 100) {
    return null
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-transparent">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎯</span>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Get Started with Abel Lumber</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {data.completedCount} of {data.totalCount} steps completed
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          aria-label="Toggle"
        >
          <svg
            className={`w-5 h-5 text-gray-600 transition-transform ${collapsed ? '-rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      </div>

      {/* Progress Bar */}
      {!collapsed && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-600">Progress</span>
            <span className="text-xs font-bold text-[var(--c1, #4F46E5)]">{data.percentComplete}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[var(--canvas, #080D1A)] to-[var(--c1, #4F46E5)] h-2 rounded-full transition-all duration-700"
              style={{ width: `${data.percentComplete}%` }}
            />
          </div>
        </div>
      )}

      {/* Steps */}
      {!collapsed && (
        <div className="divide-y divide-gray-50">
          {data.steps.map((step, index) => {
            const isRecent = completedSteps.has(step.id)

            return (
              <div
                key={step.id}
                className={`px-4 py-4 transition-colors ${
                  step.completed ? 'bg-green-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox/Badge */}
                  <div className="flex-shrink-0 mt-1">
                    {step.completed ? (
                      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-gray-300 flex items-center justify-center">
                        <span className="text-xs text-gray-500 font-bold">{index + 1}</span>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <h4 className={`text-sm font-medium ${step.completed ? 'text-green-900 line-through' : 'text-gray-900'}`}>
                      {step.name}
                    </h4>
                    <p className={`text-xs mt-1 ${step.completed ? 'text-green-700' : 'text-gray-600'}`}>
                      {step.description}
                    </p>
                    {step.optional && (
                      <p className="text-xs text-gray-400 font-medium mt-1">Optional</p>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {!step.completed && (
                      <Link
                        href={step.href}
                        className="px-3 py-1.5 bg-[var(--c1, #4F46E5)] hover:bg-[var(--c2, #2563EB)] text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                      >
                        {step.ctaText}
                      </Link>
                    )}
                    {step.completed && (
                      <span className="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-semibold rounded-lg whitespace-nowrap">
                        Done ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Collapsed Summary */}
      {collapsed && (
        <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[var(--c1, #4F46E5)] flex items-center justify-center text-white text-xs font-bold">
              {data.completedCount}
            </div>
            <span className="text-sm text-gray-600">
              <span className="font-medium">{data.completedCount}</span> completed
            </span>
          </div>
          <button
            onClick={() => setCollapsed(false)}
            className="text-xs text-[var(--c1, #4F46E5)] font-medium hover:underline"
          >
            View All
          </button>
        </div>
      )}
    </div>
  )
}
