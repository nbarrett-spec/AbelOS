'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface RecentTakeoff {
  id: string
  status: string
  confidence: number | null
  createdAt: string
  projectName: string | null
  builderName: string | null
  blueprintName: string | null
  itemCount: number
  matchedCount: number
}

export default function TakeoffToolLandingPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentTakeoff[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true)
    try {
      const r = await fetch('/api/ops/takeoffs?limit=20', { cache: 'no-store' })
      const data = await r.json()
      setRecent(Array.isArray(data.takeoffs) ? data.takeoffs : [])
    } catch (e) {
      console.error('Failed to load recent takeoffs', e)
    } finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  const handleFile = async (file: File) => {
    setUploadError(null)
    const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!ok.includes(file.type)) {
      setUploadError(`Unsupported file type: ${file.type}`)
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError('File too large — keep blueprints under 25 MB')
      return
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('projectName', file.name.replace(/\.[^.]+$/, ''))
      const r = await fetch('/api/ops/takeoffs/upload', { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) {
        setUploadError(data.error || `Upload failed (${r.status})`)
        return
      }
      router.push(`/ops/takeoff-tool/${data.takeoffId}`)
    } catch (e: any) {
      setUploadError(e?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AI Takeoff Tool</h1>
        <p className="text-gray-500 mt-2 max-w-2xl">
          Upload a blueprint PDF, let the model extract doors, windows and trim,
          then review + approve. Draft Sales Order generated at the end.
        </p>
      </div>

      {/* Drop zone */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Blueprint</h2>
        <div
          className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${
            dragActive
              ? 'border-[#0f2a3e] bg-blue-50'
              : 'border-gray-300 hover:border-[#0f2a3e] hover:bg-blue-50'
          } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            className="w-14 h-14 text-gray-400 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className="text-gray-900 font-medium mb-1">
            {uploading ? 'Uploading…' : 'Drop a blueprint PDF or image here'}
          </p>
          <p className="text-sm text-gray-500">
            PDF, PNG, JPG, WEBP · up to 25 MB · click to browse
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </div>

        {uploadError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {uploadError}
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500">
          Estimated cost per AI extraction: ~$0.05 · Limit 20 extractions per staff per hour.
        </div>
      </div>

      {/* Recent takeoffs */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Takeoffs</h2>
          <button
            type="button"
            onClick={loadRecent}
            className="text-sm text-[#0f2a3e] hover:underline"
          >
            Refresh
          </button>
        </div>
        {loadingRecent ? (
          <div className="p-6 text-gray-500 text-sm">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-6 text-gray-500 text-sm">
            No takeoffs yet. Upload a blueprint above to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-6 py-3 text-left">Project</th>
                  <th className="px-6 py-3 text-left">Builder</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-right">Items</th>
                  <th className="px-6 py-3 text-right">Matched</th>
                  <th className="px-6 py-3 text-right">Created</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {recent.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {t.projectName || t.blueprintName || 'Untitled'}
                    </td>
                    <td className="px-6 py-3 text-gray-600">{t.builderName || '—'}</td>
                    <td className="px-6 py-3">
                      <StatusChip status={t.status} />
                    </td>
                    <td className="px-6 py-3 text-right text-gray-900">{t.itemCount}</td>
                    <td className="px-6 py-3 text-right text-gray-900">
                      {t.matchedCount}/{t.itemCount}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-500 text-xs">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Link
                        href={`/ops/takeoff-tool/${t.id}`}
                        className="text-sm text-[#0f2a3e] hover:underline"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    PROCESSING: 'bg-blue-50 text-blue-700 border-blue-200',
    NEEDS_REVIEW: 'bg-amber-50 text-amber-700 border-amber-200',
    APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    REJECTED: 'bg-red-50 text-red-700 border-red-200',
  }
  const cls = colorMap[status] || 'bg-gray-50 text-gray-700 border-gray-200'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}
