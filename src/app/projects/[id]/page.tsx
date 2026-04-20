'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import UploadZone from '@/components/UploadZone'
import TakeoffViewer from '@/components/TakeoffViewer'
import QuoteBuilder from '@/components/QuoteBuilder'
import { formatDate } from '@/lib/utils'
import { PROJECT_STATUS_LABELS } from '@/lib/constants'

type FlowStep = 'upload' | 'processing' | 'takeoff' | 'quote'

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState<FlowStep>('upload')

  // Takeoff state
  const [takeoff, setTakeoff] = useState<any>(null)
  const [takeoffNotes, setTakeoffNotes] = useState<string[]>([])
  const [processingTakeoff, setProcessingTakeoff] = useState(false)

  // Quote state
  const [quote, setQuote] = useState<any>(null)
  const [quotePaymentTerm, setQuotePaymentTerm] = useState('')
  const [generatingQuote, setGeneratingQuote] = useState(false)

  // Blueprint
  const [blueprint, setBlueprint] = useState<any>(null)

  // Toast state
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        const proj = data.projects.find((p: any) => p.id === projectId)
        if (proj) {
          setProject(proj)
          // Determine current step based on project status
          if (proj.quotes?.length > 0) {
            setCurrentStep('quote')
            // Fetch full quote data
            const qRes = await fetch(`/api/quotes?projectId=${projectId}`)
            if (qRes.ok) {
              const qData = await qRes.json()
              if (qData.quotes.length > 0) setQuote(qData.quotes[0])
            }
          } else if (proj.takeoffs?.length > 0) {
            setCurrentStep('takeoff')
            // Fetch full takeoff data
            const tRes = await fetch(`/api/takeoff?projectId=${projectId}`)
            if (tRes.ok) {
              const tData = await tRes.json()
              if (tData.takeoffs.length > 0) {
                setTakeoff(tData.takeoffs[0])
                setTakeoffNotes(
                  tData.takeoffs[0].rawResult?.notes || []
                )
              }
            }
          } else if (proj.blueprints?.length > 0) {
            setBlueprint(proj.blueprints[0])
            setCurrentStep('upload') // ready to run takeoff
          }
        }
      }
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  const handleUploadComplete = async (bp: { id: string; fileName: string }) => {
    setBlueprint(bp)
    // Auto-run takeoff
    handleRunTakeoff(bp.id)
  }

  const handleRunTakeoff = async (blueprintId: string) => {
    setCurrentStep('processing')
    setProcessingTakeoff(true)

    try {
      const res = await fetch('/api/takeoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprintId,
          projectId,
          sqFootage: project?.sqFootage,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setTakeoff(data.takeoff)
        setTakeoffNotes(data.notes || [])
        setCurrentStep('takeoff')
      }
    } catch (err) {
      console.error('Takeoff failed:', err)
    } finally {
      setProcessingTakeoff(false)
    }
  }

  const handleGenerateQuote = async () => {
    if (!takeoff) return
    setGeneratingQuote(true)

    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          takeoffId: takeoff.id,
          projectId,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setQuote(data.quote)
        setQuotePaymentTerm(data.paymentTerm)
        setCurrentStep('quote')
      } else {
        // If quote already exists, try to load it
        console.error('Quote generation failed:', data.error)
        const qRes = await fetch(`/api/quotes?projectId=${projectId}`)
        if (qRes.ok) {
          const qData = await qRes.json()
          if (qData.quotes.length > 0) {
            setQuote(qData.quotes[0])
            setCurrentStep('quote')
          }
        }
      }
    } catch (err) {
      console.error('Quote generation failed:', err)
    } finally {
      setGeneratingQuote(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-8 h-8 border-4 border-abel-walnut border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="text-center py-20">
          <p className="text-gray-500">Project not found.</p>
          <Link href="/dashboard" className="btn-accent inline-block mt-4">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // Step indicator
  const steps = [
    { key: 'upload', label: 'Upload', num: 1 },
    { key: 'processing', label: 'AI Takeoff', num: 2 },
    { key: 'takeoff', label: 'Review', num: 2 },
    { key: 'quote', label: 'Quote', num: 3 },
  ]
  const currentNum =
    currentStep === 'upload'
      ? 1
      : currentStep === 'processing' || currentStep === 'takeoff'
        ? 2
        : 3

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#3E2A1E]'
        }`}>
          {toast}
        </div>
      )}
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Project Header */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href="/dashboard" className="hover:text-abel-walnut">
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-abel-charcoal">{project.name}</span>
        </div>

        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-abel-charcoal">
              {project.name}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              {project.planName && `${project.planName} · `}
              Created {formatDate(project.createdAt)}
            </p>
          </div>
        </div>

        {/* Step Progress */}
        <div className="flex items-center gap-4 mb-8">
          {[
            { num: 1, label: 'Upload Blueprint' },
            { num: 2, label: 'AI Takeoff' },
            { num: 3, label: 'Quote' },
          ].map((step, idx) => (
            <div key={step.num} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  step.num <= currentNum
                    ? 'bg-abel-walnut text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {step.num < currentNum ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.num
                )}
              </div>
              <span
                className={`text-sm font-medium ${
                  step.num <= currentNum ? 'text-abel-charcoal' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
              {idx < 2 && (
                <div
                  className={`flex-1 h-0.5 ${
                    step.num < currentNum ? 'bg-abel-walnut' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Content based on step */}
        {currentStep === 'upload' && !blueprint && (
          <UploadZone
            projectId={projectId}
            onUploadComplete={handleUploadComplete}
          />
        )}

        {currentStep === 'upload' && blueprint && (
          <div className="card p-8 text-center">
            <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-abel-charcoal mb-1">
              Blueprint uploaded: {blueprint.fileName}
            </h3>
            <p className="text-gray-500 mb-4">
              Ready to run AI takeoff analysis
            </p>
            <button
              onClick={() => handleRunTakeoff(blueprint.id)}
              className="btn-accent"
            >
              Run AI Takeoff
            </button>
          </div>
        )}

        {currentStep === 'processing' && (
          <div className="card p-12 text-center">
            <div className="w-20 h-20 mx-auto mb-6 relative">
              <div className="w-20 h-20 border-4 border-abel-walnut/20 border-t-abel-amber rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl">🤖</span>
              </div>
            </div>
            <h3 className="text-xl font-semibold text-abel-charcoal mb-2">
              AI is analyzing your blueprint
            </h3>
            <p className="text-gray-500 max-w-md mx-auto">
              Our engine is identifying doors, hardware, and trim from your floor
              plan. This typically takes 3-8 seconds.
            </p>
            <div className="mt-6 flex justify-center gap-8 text-sm text-gray-400">
              <span>Scanning rooms...</span>
              <span>Detecting doors...</span>
              <span>Matching products...</span>
            </div>
          </div>
        )}

        {currentStep === 'takeoff' && takeoff && (
          <TakeoffViewer
            items={takeoff.items}
            confidence={takeoff.confidence}
            notes={takeoffNotes}
            onGenerateQuote={handleGenerateQuote}
            loading={generatingQuote}
          />
        )}

        {currentStep === 'quote' && quote && (
          <QuoteBuilder
            quoteId={quote.id}
            quoteNumber={quote.quoteNumber}
            items={quote.items}
            subtotal={quote.subtotal}
            termAdjustment={quote.termAdjustment}
            total={quote.total}
            paymentTerm={quotePaymentTerm || 'NET_15'}
            validUntil={quote.validUntil}
            onApprove={async () => {
              try {
                const res = await fetch('/api/orders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ quoteId: quote.id })
                })
                if (res.ok) {
                  const data = await res.json()
                  router.push(`/orders/${data.orderId}`)
                } else {
                  const err = await res.json()
                  showToast(err.error || 'Failed to create order', 'error')
                }
              } catch {
                showToast('Failed to create order. Please try again.', 'error')
              }
            }}
          />
        )}
      </main>
    </div>
  )
}
