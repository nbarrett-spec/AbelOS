'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

interface BlueprintEntry {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  processingStatus: string
  processedAt: string | null
  createdAt: string
  project: { id: string; name: string; address: string }
  takeoff: {
    id: string
    status: string
    confidence: number | null
    itemCount: number
    createdAt: string
  } | null
}

const STATUS_BADGE: Record<string, { label: string; color: string; icon: string }> = {
  PENDING: { label: 'Uploaded', color: 'bg-gray-100 text-gray-700', icon: '📄' },
  PROCESSING: { label: 'Analyzing...', color: 'bg-blue-100 text-blue-700', icon: '⏳' },
  COMPLETE: { label: 'Ready', color: 'bg-green-100 text-green-700', icon: '✅' },
  FAILED: { label: 'Failed', color: 'bg-red-100 text-red-700', icon: '❌' },
}

const TAKEOFF_STATUS: Record<string, { label: string; color: string }> = {
  PROCESSING: { label: 'Processing', color: 'bg-blue-100 text-blue-700' },
  NEEDS_REVIEW: { label: 'Ready for Review', color: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'Approved', color: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return formatDate(dateStr)
}

export default function BlueprintsPage() {
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()

  const [blueprints, setBlueprints] = useState<BlueprintEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    if (builder) fetchBlueprints()
  }, [builder])

  async function fetchBlueprints() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch('/api/blueprints')
      if (!res.ok) throw new Error('Failed to load blueprints')
      const data = await res.json()
      setBlueprints(data.blueprints || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filtered =
    filter === 'all'
      ? blueprints
      : blueprints.filter((bp) => bp.processingStatus === filter)

  const counts = {
    all: blueprints.length,
    COMPLETE: blueprints.filter((b) => b.processingStatus === 'COMPLETE').length,
    PENDING: blueprints.filter((b) => b.processingStatus === 'PENDING').length,
    PROCESSING: blueprints.filter((b) => b.processingStatus === 'PROCESSING').length,
    FAILED: blueprints.filter((b) => b.processingStatus === 'FAILED').length,
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#1B4F72] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Blueprint Takeoff</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload blueprints, get instant AI-generated material lists and quotes
          </p>
        </div>
        <Link
          href="/dashboard/blueprints/new"
          className="px-5 py-2.5 bg-[#E67E22] hover:bg-[#D35400] text-white font-semibold rounded-xl shadow transition flex items-center gap-2"
        >
          <span className="text-lg">📐</span>
          Upload Blueprint
        </Link>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Blueprints"
          value={counts.all}
          icon="📄"
          color="bg-white"
        />
        <StatCard
          label="Takeoffs Ready"
          value={counts.COMPLETE}
          icon="✅"
          color="bg-green-50"
        />
        <StatCard
          label="Awaiting Analysis"
          value={counts.PENDING + counts.PROCESSING}
          icon="⏳"
          color="bg-blue-50"
        />
        <StatCard
          label="Failed"
          value={counts.FAILED}
          icon="❌"
          color="bg-red-50"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'all', label: 'All' },
          { key: 'COMPLETE', label: 'Ready' },
          { key: 'PENDING', label: 'Uploaded' },
          { key: 'PROCESSING', label: 'Analyzing' },
          { key: 'FAILED', label: 'Failed' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === f.key
                ? 'bg-[#1B4F72] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label} ({counts[f.key as keyof typeof counts] || 0})
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Empty State */}
      {filtered.length === 0 && !error && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <div className="text-5xl mb-4">📐</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {filter === 'all'
              ? 'No blueprints yet'
              : `No ${filter.toLowerCase()} blueprints`}
          </h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Upload your first blueprint and our AI will analyze it to generate a
            complete material takeoff with quantities and pricing.
          </p>
          <Link
            href="/dashboard/blueprints/new"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#E67E22] hover:bg-[#D35400] text-white font-semibold rounded-xl shadow transition"
          >
            Upload Your First Blueprint
          </Link>
        </div>
      )}

      {/* Blueprint List */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((bp) => {
            const badge = STATUS_BADGE[bp.processingStatus] || STATUS_BADGE.PENDING
            const takeoffBadge = bp.takeoff
              ? TAKEOFF_STATUS[bp.takeoff.status] || TAKEOFF_STATUS.PROCESSING
              : null

            return (
              <div
                key={bp.id}
                onClick={() => {
                  router.push(`/dashboard/blueprints/${bp.id}`)
                }}
                className="bg-white rounded-xl border p-5 hover:shadow-md transition cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    {/* File Icon */}
                    <div className="w-12 h-12 rounded-xl bg-[#1B4F72]/10 flex items-center justify-center text-xl flex-shrink-0">
                      {bp.fileType === 'pdf' ? '📋' : '🖼️'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {bp.fileName}
                        </h3>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${badge.color}`}
                        >
                          {badge.icon} {badge.label}
                        </span>
                        {takeoffBadge && (
                          <span
                            className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${takeoffBadge.color}`}
                          >
                            {takeoffBadge.label}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{bp.project.name}</span>
                        <span>•</span>
                        <span>{formatFileSize(bp.fileSize)}</span>
                        <span>•</span>
                        <span>{timeAgo(bp.createdAt)}</span>
                      </div>

                      {bp.takeoff && (
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          <span className="text-gray-600">
                            📦 {bp.takeoff.itemCount} items
                          </span>
                          {bp.takeoff.confidence && (
                            <span
                              className={`font-medium ${
                                bp.takeoff.confidence >= 0.9
                                  ? 'text-green-600'
                                  : bp.takeoff.confidence >= 0.8
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                              }`}
                            >
                              {Math.round(bp.takeoff.confidence * 100)}% confidence
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action */}
                  <div className="flex-shrink-0">
                    {bp.processingStatus === 'COMPLETE' && bp.takeoff && (
                      <Link
                        href={`/dashboard/blueprints/${bp.id}`}
                        className="px-4 py-2 text-sm font-medium text-[#1B4F72] bg-[#1B4F72]/10 hover:bg-[#1B4F72]/20 rounded-lg transition"
                        onClick={(e) => e.stopPropagation()}
                      >
                        View Takeoff →
                      </Link>
                    )}
                    {bp.processingStatus === 'COMPLETE' && !bp.takeoff && (
                      <Link
                        href={`/dashboard/blueprints/${bp.id}`}
                        className="px-4 py-2 text-sm font-medium text-white bg-[#E67E22] hover:bg-[#D35400] rounded-lg transition"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Generate Takeoff →
                      </Link>
                    )}
                    {bp.processingStatus === 'PROCESSING' && (
                      <span className="text-xs text-blue-600 flex items-center gap-1">
                        <span className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                        Analyzing...
                      </span>
                    )}
                    {bp.processingStatus === 'FAILED' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          // Retry analysis
                          fetch(`/api/blueprints/${bp.id}/analyze`, {
                            method: 'POST',
                          }).then(() => fetchBlueprints())
                        }}
                        className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition"
                      >
                        Retry Analysis
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number
  icon: string
  color: string
}) {
  return (
    <div className={`${color} rounded-xl border p-4`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-medium text-gray-500 uppercase">{label}</span>
      </div>
      <p className="text-2xl font-bold text-[#1B4F72]">{value}</p>
    </div>
  )
}
