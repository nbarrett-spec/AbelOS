'use client'

import { useState, useEffect } from 'react'

export interface WidgetConfig {
  stats: boolean
  quickLinks: boolean
  activeOrders: boolean
  projects: boolean
}

const DEFAULTS: WidgetConfig = {
  stats: true,
  quickLinks: true,
  activeOrders: true,
  projects: true,
}

const WIDGET_LABELS: Record<keyof WidgetConfig, string> = {
  stats: 'Stats Cards',
  quickLinks: 'Quick Links',
  activeOrders: 'Active Orders',
  projects: 'Your Projects',
}

const STORAGE_KEY = 'abel-dashboard-widgets'

export function useDashboardWidgets() {
  const [widgets, setWidgets] = useState<WidgetConfig>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setWidgets({ ...DEFAULTS, ...JSON.parse(stored) })
      }
    } catch {}
    setLoaded(true)
  }, [])

  const updateWidgets = (updated: WidgetConfig) => {
    setWidgets(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const resetDefaults = () => {
    setWidgets(DEFAULTS)
    localStorage.removeItem(STORAGE_KEY)
  }

  return { widgets, updateWidgets, resetDefaults, loaded }
}

interface Props {
  widgets: WidgetConfig
  onChange: (w: WidgetConfig) => void
  onReset: () => void
  onClose: () => void
}

export default function DashboardCustomizer({ widgets, onChange, onReset, onClose }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-gray-900">Customize Dashboard</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Reset to defaults
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-3">Toggle which sections appear on your dashboard.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(Object.keys(WIDGET_LABELS) as Array<keyof WidgetConfig>).map(key => (
          <label
            key={key}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
              widgets[key]
                ? 'border-[#0f2a3e] bg-[#0f2a3e]/5'
                : 'border-gray-200 bg-gray-50 opacity-60'
            }`}
          >
            <input
              type="checkbox"
              checked={widgets[key]}
              onChange={() => onChange({ ...widgets, [key]: !widgets[key] })}
              className="sr-only"
            />
            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
              widgets[key] ? 'border-[#0f2a3e] bg-[#0f2a3e]' : 'border-gray-300'
            }`}>
              {widgets[key] && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-xs font-medium text-gray-700">{WIDGET_LABELS[key]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
