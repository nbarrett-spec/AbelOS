'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import TakeoffViewer from '@/components/TakeoffViewer'

interface BlueprintDetail {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number
  fileType: string
  pageCount: number | null
  processingStatus: string
  processedAt: string | null
  createdAt: string
  project: { id: string; name: string; address: string }
}

interface TakeoffDetail {
  id: string
  status: string
  confidence: number | null
  rawResult: any
  createdAt: string
  items: TakeoffItemDetail[]
  totalItems: number
  matchedCount: number
  estimatedTotal: number
}

interface TakeoffItemDetail {
  id: string
  category: string
  description: string
  location: string | null
  quantity: number
  confidence: number | null
  aiNotes: string | null
  overridden: boolean
  product: {
    id: string
    name: string
    sku: string
    basePrice: number
    category: string
  } | null
}

export default function BlueprintDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()

  const [blueprint, setBlueprint] = useState<BlueprintDetail | null>(null)
  const [takeoff, setTakeoff] = useState<TakeoffDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [generatingTakeoff, setGeneratingTakeoff] = useState(false)
  const [converting, setConverting] = useState(false)
  const [conversionResult, setConversionResult] = useState<any>(null)

  useEffect(() => {
    if (builder && params.id) {
      fetchBlueprint()
    }
  }, [builder, params.id])

  async function fetchBlueprint() {
    try {
      setLoading(true)
      setError('')
      const res = await fetch(`/api/blueprints/${params.id}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Blueprint not found')
        if (res.status === 403) throw new Error('You don\'t have access to this blueprint')
        throw new Error('Failed to load blueprint')
      }
      const data = await res.json()
      setBlueprint(data.blueprint)
      setTakeoff(data.takeoff)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Trigger AI analysis if blueprint is uploaded but not yet analyzed
  async function handleAnalyze() {
    if (!blueprint) return
    setAnalyzing(true)
    setError('')
    try {
      const res = await fetch(`/api/blueprints/${blueprint.id}/analyze`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Analysis failed' }))
        throw new Error(data.error || 'Analysis failed')
      }

      const data = await res.json()

      // If analysis succeeded, auto-generate takeoff
      if (data.analysis) {
        setGeneratingTakeoff(true)
        const takeoffRes = await fetch(`/api/blueprints/${blueprint.id}/takeoff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analysis: data.analysis }),
        })

        if (takeoffRes.ok) {
          // Reload the page data
          await fetchBlueprint()
        }
        setGeneratingTakeoff(false)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // Convert takeoff to quote
  async function handleConvertToQuote() {
    if (!blueprint || !takeoff) return
    setConverting(true)
    setError('')
    try {
      const res = await fetch(`/api/blueprints/${blueprint.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quote',
          takeoffId: takeoff.id,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create quote')
      }

      setConversionResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setConverting(false)
    }
  }

  // Delete blueprint
  async function handleDelete() {
    if (!blueprint) return
    if (!confirm('Delete this blueprint and all associated takeoffs? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/blueprints/${blueprint.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        router.push('/dashboard/blueprints')
      }
    } catch {}
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !blueprint) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">{error}</h2>
        <Link
          href="/dashboard/blueprints"
          className="text-[#0f2a3e] hover:underline"
        >
          ← Back to Blueprints
        </Link>
      </div>
    )
  }

  if (!blueprint) return null

  const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
    PENDING: { label: 'Uploaded — Ready to Analyze', color: 'bg-gray-100 text-gray-700', icon: '📄' },
    PROCESSING: { label: 'AI Analysis in Progress', color: 'bg-blue-100 text-blue-700', icon: '⏳' },
    COMPLETE: { label: 'Analysis Complete', color: 'bg-green-100 text-green-700', icon: '✅' },
    FAILED: { label: 'Analysis Failed', color: 'bg-red-100 text-red-700', icon: '❌' },
  }

  const status = STATUS_MAP[blueprint.processingStatus] || STATUS_MAP.PENDING

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link
            href="/dashboard/blueprints"
            className="p-2 hover:bg-gray-100 rounded-lg transition mt-1"
          >
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{blueprint.fileName}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              <span>{blueprint.project.name}</span>
              <span>•</span>
              <span>{blueprint.project.address}</span>
              <span>•</span>
              <span>
                {new Date(blueprint.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-xs px-3 py-1 rounded-full font-medium ${status.color}`}>
                {status.icon} {status.label}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Conversion Success */}
      {conversionResult?.success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🎉</div>
            <div>
              <h3 className="font-bold text-green-800">Quote Created Successfully!</h3>
              <p className="text-sm text-green-700 mt-1">
                Quote #{conversionResult.quote.quoteNumber} •{' '}
                {conversionResult.quote.itemCount} items •{' '}
                ${conversionResult.quote.total.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                })}
              </p>
              <Link
                href="/dashboard/quotes"
                className="inline-block mt-3 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition"
              >
                View Quote →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* No Takeoff Yet — Show Analyze Button */}
      {!takeoff && blueprint.processingStatus === 'PENDING' && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Ready for AI Analysis
          </h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Our AI will read your blueprint, identify all doors, windows, trim,
            hardware, and closet components, then generate a complete material
            list with quantities and pricing.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={analyzing || generatingTakeoff}
            className="px-8 py-3.5 bg-[#C6A24E] hover:bg-[#A8882A] text-white font-bold rounded-xl shadow-lg transition disabled:opacity-50 text-lg"
          >
            {analyzing
              ? '🔍 Analyzing Blueprint...'
              : generatingTakeoff
              ? '📦 Generating Takeoff...'
              : '🤖 Run AI Analysis'}
          </button>
          <p className="text-xs text-gray-400 mt-3">
            Takes 30–60 seconds depending on blueprint complexity
          </p>
        </div>
      )}

      {/* Analysis Failed */}
      {!takeoff && blueprint.processingStatus === 'FAILED' && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Analysis Failed
          </h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            The AI couldn't analyze this blueprint. This can happen with
            low-resolution images or unusual formats. Try re-uploading a clearer version.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="px-6 py-3 bg-[#C6A24E] hover:bg-[#A8882A] text-white font-semibold rounded-xl transition disabled:opacity-50"
          >
            {analyzing ? 'Retrying...' : 'Retry Analysis'}
          </button>
        </div>
      )}

      {/* Processing State */}
      {!takeoff && blueprint.processingStatus === 'PROCESSING' && (
        <div className="bg-white rounded-xl border p-8 text-center">
          <div className="text-5xl mb-4 animate-pulse">🤖</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            AI Analysis in Progress
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Reading dimensions, identifying materials, calculating quantities...
          </p>
          <div className="w-48 mx-auto bg-gray-200 rounded-full h-2">
            <div className="bg-[#C6A24E] h-2 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* Takeoff Results — use the existing TakeoffViewer component */}
      {takeoff && (
        <>
          <TakeoffViewer
            items={takeoff.items.map((item) => ({
              id: item.id,
              category: item.category,
              description: item.description,
              location: item.location,
              quantity: item.quantity,
              confidence: item.confidence,
              aiNotes: item.aiNotes,
              product: item.product
                ? {
                    id: item.product.id,
                    sku: item.product.sku,
                    name: item.product.name,
                    basePrice: item.product.basePrice,
                  }
                : null,
            }))}
            confidence={takeoff.confidence || 0}
            notes={
              takeoff.rawResult?.notes ||
              takeoff.rawResult?.summary
                ? [
                    `${takeoff.totalItems} items detected`,
                    `${takeoff.matchedCount}/${takeoff.totalItems} matched to Abel products`,
                    takeoff.estimatedTotal > 0
                      ? `Estimated total: $${takeoff.estimatedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                      : '',
                  ].filter(Boolean)
                : [`${takeoff.totalItems} items detected`]
            }
            onGenerateQuote={handleConvertToQuote}
            loading={converting}
          />

          {/* Additional Action Buttons */}
          <div className="flex items-center justify-between bg-white rounded-xl border p-4">
            <div className="flex gap-3">
              <Link
                href={`/dashboard/blueprints/new`}
                className="px-4 py-2 text-sm font-medium text-[#0f2a3e] bg-[#0f2a3e]/10 hover:bg-[#0f2a3e]/20 rounded-lg transition"
              >
                📐 Upload Another Blueprint
              </Link>
              <Link
                href={`/dashboard/projects`}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                📁 Back to Projects
              </Link>
            </div>
            {!conversionResult?.success && takeoff.matchedCount > 0 && (
              <button
                onClick={handleConvertToQuote}
                disabled={converting}
                className="px-6 py-2.5 bg-[#C6A24E] hover:bg-[#A8882A] text-white font-semibold rounded-xl shadow transition disabled:opacity-50"
              >
                {converting ? 'Creating Quote...' : '📋 Convert to Quote'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
