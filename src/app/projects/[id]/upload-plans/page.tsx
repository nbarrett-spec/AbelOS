'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface BlueprintFile {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  uploadedAt: string
  status: 'UPLOADED' | 'PROCESSING' | 'UNDER_REVIEW' | 'READY'
  processedAt?: string
}

interface UploadState {
  loading: boolean
  error: string | null
  blueprints: BlueprintFile[]
}

export default function UploadPlansPage() {
  const params = useParams()
  const projectId = params.id as string
  const [uploadState, setUploadState] = useState<UploadState>({
    loading: true,
    error: null,
    blueprints: [],
  })
  const [notes, setNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDropRef = useRef<HTMLDivElement>(null)

  // Fetch existing blueprints
  useEffect(() => {
    fetchBlueprints()
    const interval = setInterval(fetchBlueprints, 5000) // Poll for updates
    return () => clearInterval(interval)
  }, [projectId])

  const fetchBlueprints = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/blueprints`)
      const data = await response.json()
      if (response.ok) {
        setUploadState({
          loading: false,
          error: null,
          blueprints: data.blueprints || [],
        })
      }
    } catch (error) {
      console.error('Error fetching blueprints:', error)
    }
  }

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files)
    }
  }, [])

  // Handle file selection
  const handleFileSelect = (files: FileList) => {
    const validTypes = ['image/png', 'image/jpeg', 'application/pdf']
    const validFiles = Array.from(files).filter((file) => validTypes.includes(file.type))

    if (validFiles.length === 0) {
      setUploadState((s) => ({
        ...s,
        error: 'Only PNG, JPG, and PDF files are supported',
      }))
      return
    }

    uploadFiles(validFiles)
  }

  // Upload files
  const uploadFiles = async (files: File[]) => {
    setUploading(true)
    setUploadState((s) => ({ ...s, error: null }))

    try {
      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('notes', notes)

        const response = await fetch(`/api/projects/${projectId}/blueprints`, {
          method: 'POST',
          body: formData,
        })

        const data = await response.json()
        if (!response.ok) {
          setUploadState((s) => ({ ...s, error: data.error || 'Upload failed' }))
          setUploading(false)
          return
        }
      }

      setNotes('')
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      fetchBlueprints()
    } catch (error) {
      setUploadState((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Upload error',
      }))
    } finally {
      setUploading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'UPLOADED':
        return 'bg-blue-50 text-blue-700'
      case 'PROCESSING':
        return 'bg-amber-50 text-amber-700'
      case 'UNDER_REVIEW':
        return 'bg-purple-50 text-purple-700'
      case 'READY':
        return 'bg-green-50 text-green-700'
      default:
        return 'bg-gray-50 text-gray-700'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'UPLOADED':
        return 'Uploaded'
      case 'PROCESSING':
        return 'Analyzing...'
      case 'UNDER_REVIEW':
        return 'Under Review'
      case 'READY':
        return 'Takeoff Ready'
      default:
        return status
    }
  }

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <Link href={`/projects/${projectId}`} className="hover:text-gray-700">
            Project
          </Link>
          <span>/</span>
          <span>Upload Floor Plans</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900">Upload Floor Plans</h1>
        <p className="text-gray-500 mt-2">
          Upload your blueprints and we'll automatically generate accurate material takeoffs.
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-8 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Upload Blueprints</h2>

        {/* Drag and drop zone */}
        <div
          ref={dragDropRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-[#3E2A1E] hover:bg-blue-50 transition mb-6"
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-gray-900 font-medium mb-1">Drag and drop your floor plans</p>
          <p className="text-sm text-gray-500">or click to select PDF, PNG, or JPG files</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
            className="hidden"
          />
        </div>

        {/* Notes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Project Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., 4 bedroom, 3 bath, 2-car garage..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#3E2A1E]/20 focus:border-[#3E2A1E] resize-none"
            rows={3}
          />
        </div>

        {/* Error */}
        {uploadState.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm mb-6">
            {uploadState.error}
          </div>
        )}

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full bg-[#3E2A1E] text-white py-3 rounded-lg font-semibold hover:bg-[#163d5c] disabled:opacity-50 transition flex items-center justify-center gap-2"
        >
          {uploading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Select Files to Upload
            </>
          )}
        </button>
      </div>

      {/* Existing blueprints */}
      {uploadState.blueprints.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Uploaded Plans</h2>

          <div className="space-y-3">
            {uploadState.blueprints.map((bp) => (
              <div
                key={bp.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    {bp.fileType === 'pdf' ? (
                      <svg className="w-6 h-6 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm0 2h12v10H4V5z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M5 9V7a1 1 0 011-1h8a1 1 0 011 1v2M5 9c0 1.657-.895 3-2 3s-2-1.343-2-3m14 0c0 1.657.895 3 2 3s2-1.343 2-3m-14 0V5a2 2 0 012-2h8a2 2 0 012 2v4" />
                      </svg>
                    )}
                  </div>

                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{bp.fileName}</p>
                    <p className="text-xs text-gray-500">
                      {(bp.fileSize / 1024 / 1024).toFixed(2)} MB •{' '}
                      {new Date(bp.uploadedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-3 py-1 rounded-lg ${getStatusColor(bp.status)}`}>
                    {getStatusLabel(bp.status)}
                  </span>

                  {bp.status === 'PROCESSING' && (
                    <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  )}

                  {bp.status === 'READY' && (
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>

          {uploadState.blueprints.some((bp) => bp.status === 'READY') && (
            <div className="mt-6 pt-6 border-t border-gray-200">
              <Link
                href={`/ops/blueprints/analyze`}
                className="inline-block bg-[#C9822B] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#d46d1a] transition"
              >
                Review & Generate Takeoffs →
              </Link>
            </div>
          )}
        </div>
      )}

      {uploadState.loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-[#3E2A1E] border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
