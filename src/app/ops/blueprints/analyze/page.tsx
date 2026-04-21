'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { BlueprintAnalysis } from '@/lib/blueprint-ai'

interface UploadedFile {
  file: File
  preview: string
}

interface AnalysisState {
  loading: boolean
  analysis: BlueprintAnalysis | null
  error: string | null
  blueprintId?: string
}

interface TakeoffPreview {
  items: Array<{
    category: string
    description: string
    location?: string
    quantity: number
    unit: string
  }>
  totalDoors: number
  totalWindows: number
  totalClosets: number
}

export default function BlueprintAnalyzePage() {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null)
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    loading: false,
    analysis: null,
    error: null,
  })
  const [takeoffState, setTakeoffState] = useState<{
    loading: boolean
    takeoffId: string | null
    error: string | null
  }>({
    loading: false,
    takeoffId: null,
    error: null,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDropRef = useRef<HTMLDivElement>(null)

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files[0])
    }
  }, [])

  // Handle file selection
  const handleFileSelect = (file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'application/pdf']
    if (!validTypes.includes(file.type)) {
      setAnalysisState((s) => ({ ...s, error: 'Only PNG, JPG, and PDF files are supported' }))
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const preview = e.target?.result as string
      setUploadedFile({ file, preview })
      setAnalysisState({ loading: false, analysis: null, error: null })
    }
    reader.readAsDataURL(file)
  }

  // Analyze blueprint
  const analyzeBlueprint = async () => {
    if (!uploadedFile) return

    setAnalysisState({ loading: true, analysis: null, error: null })

    try {
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1]
        if (!base64) {
          setAnalysisState((s) => ({ ...s, error: 'Failed to encode image' }))
          return
        }

        const response = await fetch('/api/ops/blueprints/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mediaType: uploadedFile.file.type,
          }),
        })

        const data = await response.json()
        if (!response.ok) {
          setAnalysisState((s) => ({ ...s, error: data.error || 'Analysis failed' }))
          return
        }

        setAnalysisState({
          loading: false,
          analysis: data.analysis,
          error: null,
        })
      }
      reader.readAsDataURL(uploadedFile.file)
    } catch (error) {
      setAnalysisState((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
  }

  // Generate takeoff from analysis
  const generateTakeoff = async () => {
    if (!analysisState.analysis || !uploadedFile) return

    setTakeoffState({ loading: true, takeoffId: null, error: null })

    try {
      const response = await fetch('/api/ops/blueprints/generate-takeoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blueprintId: analysisState.blueprintId || '',
          analysis: analysisState.analysis,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        setTakeoffState((s) => ({ ...s, error: data.error || 'Takeoff generation failed' }))
        return
      }

      setTakeoffState({
        loading: false,
        takeoffId: data.takeoff.id,
        error: null,
      })
    } catch (error) {
      setTakeoffState((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600 bg-green-50'
    if (confidence >= 50) return 'text-signal bg-amber-50'
    return 'text-red-600 bg-red-50'
  }

  const getConfidenceBgColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-green-500'
    if (confidence >= 50) return 'bg-signal'
    return 'bg-red-500'
  }

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Blueprint Analysis</h1>
        <p className="text-gray-500 mt-2">
          Upload a floor plan to automatically generate material takeoffs using AI vision analysis.
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Floor Plan</h2>

        {!uploadedFile ? (
          <div
            ref={dragDropRef}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-[#0f2a3e] hover:bg-blue-50 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg
              className="w-12 h-12 text-gray-400 mx-auto mb-4"
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
            <p className="text-gray-900 font-medium mb-1">Drag and drop your floor plan</p>
            <p className="text-sm text-gray-500">or click to select PNG, JPG, or PDF</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
              onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
              className="hidden"
            />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Preview */}
            <div className="relative">
              {/* Blob URL from client-side upload — raw img is correct here */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadedFile.preview}
                alt="Blueprint preview"
                decoding="async"
                className="max-h-96 mx-auto rounded-lg border border-gray-200"
              />
            </div>

            {/* File info */}
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
              <div>
                <p className="font-medium text-gray-900">{uploadedFile.file.name}</p>
                <p className="text-sm text-gray-500">
                  {(uploadedFile.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={() => {
                  setUploadedFile(null)
                  setAnalysisState({ loading: false, analysis: null, error: null })
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            {/* Error message */}
            {analysisState.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                {analysisState.error}
              </div>
            )}

            {/* Analyze button */}
            <button
              onClick={analyzeBlueprint}
              disabled={analysisState.loading}
              className="w-full bg-[#0f2a3e] text-white py-3 rounded-lg font-semibold hover:bg-[#163d5c] disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              {analysisState.loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing floor plan...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Analyze Blueprint
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Analysis Results */}
      {analysisState.analysis && (
        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500 mb-1">Total Doors</p>
              <p className="text-2xl font-bold text-[#0f2a3e]">
                {analysisState.analysis.summary.totalDoors}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500 mb-1">Total Windows</p>
              <p className="text-2xl font-bold text-[#0f2a3e]">
                {analysisState.analysis.summary.totalWindows}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500 mb-1">Closets</p>
              <p className="text-2xl font-bold text-[#0f2a3e]">
                {analysisState.analysis.summary.totalClosets}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm text-gray-500 mb-1">Floor Plan</p>
              <p className="text-2xl font-bold text-[#0f2a3e]">
                {analysisState.analysis.summary.floorPlanSqFt.toLocaleString()} sf
              </p>
            </div>
          </div>

          {/* Confidence Meter */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Analysis Confidence</h3>
              <span className={`text-lg font-bold px-3 py-1 rounded-lg ${getConfidenceColor(analysisState.analysis.confidence)}`}>
                {analysisState.analysis.confidence}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${getConfidenceBgColor(analysisState.analysis.confidence)}`}
                style={{ width: `${analysisState.analysis.confidence}%` }}
              />
            </div>
            {analysisState.analysis.confidence < 80 && (
              <p className="text-sm text-signal mt-2">
                Low confidence: Please review analysis results carefully before generating takeoff.
              </p>
            )}
          </div>

          {/* Room Breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Room Analysis</h3>
            <div className="space-y-4">
              {analysisState.analysis.rooms.map((room, idx) => (
                <details
                  key={idx}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer"
                  open={idx === 0}
                >
                  <summary className="font-medium text-gray-900 flex justify-between">
                    <span>
                      {room.name} ({room.type})
                    </span>
                    <span className="text-sm text-gray-500">{room.estimatedSqFt} sf</span>
                  </summary>

                  <div className="mt-4 space-y-3 text-sm">
                    {room.doors.length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">Doors:</p>
                        <ul className="ml-4 space-y-1 text-gray-600">
                          {room.doors.map((door, di) => (
                            <li key={di}>
                              • {door.quantity}x {door.type} {door.width && `(${door.width}")`}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {room.windows.length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">Windows:</p>
                        <ul className="ml-4 space-y-1 text-gray-600">
                          {room.windows.map((w, wi) => (
                            <li key={wi}>
                              • {w.quantity}x {w.type}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {room.closets.length > 0 && (
                      <div>
                        <p className="font-medium text-gray-700 mb-1">Closets:</p>
                        <ul className="ml-4 space-y-1 text-gray-600">
                          {room.closets.map((c, ci) => (
                            <li key={ci}>
                              • {c.type} {c.width && `(${c.width}")`}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>

          {/* Notes */}
          {analysisState.analysis.notes.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
              <h3 className="font-semibold text-blue-900 mb-3">AI Analysis Notes</h3>
              <ul className="space-y-2">
                {analysisState.analysis.notes.map((note, idx) => (
                  <li key={idx} className="text-blue-800 text-sm flex gap-2">
                    <span>•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Generate Takeoff Error */}
          {takeoffState.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              {takeoffState.error}
            </div>
          )}

          {/* Generate Takeoff Success */}
          {takeoffState.takeoffId && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <div className="text-green-600 text-xl">✓</div>
                <div>
                  <h4 className="font-semibold text-green-900 mb-1">Takeoff Generated Successfully</h4>
                  <p className="text-green-800 text-sm mb-3">
                    Your takeoff has been created and is ready for review.
                  </p>
                  <Link
                    href={`/ops/takeoff-review/${takeoffState.takeoffId}`}
                    className="inline-block bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
                  >
                    Review Takeoff →
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Generate Takeoff Button */}
          {!takeoffState.takeoffId && (
            <button
              onClick={generateTakeoff}
              disabled={takeoffState.loading}
              className="w-full bg-[#C6A24E] text-white py-3 rounded-lg font-semibold hover:bg-[#d46d1a] disabled:opacity-50 transition flex items-center justify-center gap-2"
            >
              {takeoffState.loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Generating Takeoff...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6v6m0 0v6m0-6h6m0 0h6m-6-6H6m0 0H0"
                    />
                  </svg>
                  Generate Takeoff
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
