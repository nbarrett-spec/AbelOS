'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'

interface SOPItem {
  id: string
  title: string
  category: string
  steps: string[]
  tips: string[]
  troubleshooting: string[]
}

export default function HelpPanel() {
  const [open, setOpen] = useState(false)
  const [sops, setSops] = useState<SOPItem[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pathname = usePathname()

  const fetchSOPs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ops/sops?page=${encodeURIComponent(pathname)}`)
      if (res.ok) {
        const data = await res.json()
        setSops(data.sops || [])
      }
    } catch (err) {
      console.error('Failed to load SOPs:', err)
    }
    setLoading(false)
  }, [pathname])

  useEffect(() => {
    if (open) fetchSOPs()
  }, [open, fetchSOPs])

  // Close on route change
  useEffect(() => {
    setExpanded(null)
  }, [pathname])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-[#0f2a3e] text-white rounded-full shadow-lg hover:bg-[#0a1a28] transition-all flex items-center justify-center text-lg"
        title="Help & How-Tos"
      >
        ?
      </button>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setOpen(false)} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-96 max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="bg-[#0f2a3e] text-white px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Help & How-Tos</h2>
            <p className="text-xs text-blue-200 mt-0.5">Step-by-step guides for this page</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-xl">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading...</div>
          ) : sops.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-3xl mb-3">📖</p>
              <p className="font-medium">No guides for this page yet</p>
              <p className="text-sm mt-1">Try the AI Assistant for help with specific tasks.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sops.map((sop) => (
                <div key={sop.id} className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpanded(expanded === sop.id ? null : sop.id)}
                    className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-medium text-sm text-gray-900">{sop.title}</span>
                    <span className="text-gray-400 text-xs ml-2">{expanded === sop.id ? '▲' : '▼'}</span>
                  </button>

                  {expanded === sop.id && (
                    <div className="px-4 pb-4 border-t bg-gray-50">
                      {/* Steps */}
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Steps</p>
                        <ol className="space-y-2">
                          {sop.steps.map((step, i) => (
                            <li key={i} className="flex gap-2 text-sm text-gray-700">
                              <span className="flex-shrink-0 w-5 h-5 bg-[#0f2a3e] text-white rounded-full text-xs flex items-center justify-center mt-0.5">
                                {i + 1}
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {/* Tips */}
                      {sop.tips.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-[#C6A24E] uppercase tracking-wide mb-2">Tips</p>
                          <ul className="space-y-1">
                            {sop.tips.map((tip, i) => (
                              <li key={i} className="text-sm text-gray-600 pl-4 relative before:content-['→'] before:absolute before:left-0 before:text-[#C6A24E]">
                                {tip}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Troubleshooting */}
                      {sop.troubleshooting.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Troubleshooting</p>
                          <ul className="space-y-1">
                            {sop.troubleshooting.map((item, i) => (
                              <li key={i} className="text-sm text-gray-600 pl-4 relative before:content-['!'] before:absolute before:left-0 before:text-red-400 before:font-bold">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-4 py-3 bg-gray-50">
          <a href="/ops/ai" className="block text-center text-sm text-[#0f2a3e] hover:text-[#C6A24E] font-medium">
            Need more help? Ask the AI Assistant →
          </a>
        </div>
      </div>
    </>
  )
}
