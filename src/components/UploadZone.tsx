'use client'

import { useState, useCallback } from 'react'

interface UploadZoneProps {
  projectId: string
  onUploadComplete: (blueprint: { id: string; fileName: string }) => void
}

export default function UploadZone({
  projectId,
  onUploadComplete,
}: UploadZoneProps) {
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const handleUpload = useCallback(
    async (file: File) => {
      setError('')
      setUploading(true)
      setProgress(0)

      // Validate client-side
      const allowed = [
        'application/pdf',
        'image/png',
        'image/jpeg',
        'image/tiff',
      ]
      if (!allowed.includes(file.type)) {
        setError('Please upload a PDF, PNG, JPEG, or TIFF file')
        setUploading(false)
        return
      }

      if (file.size > 50 * 1024 * 1024) {
        setError('File must be under 50MB')
        setUploading(false)
        return
      }

      // Simulate progress while uploading
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 10, 90))
      }, 200)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('projectId', projectId)

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        clearInterval(progressInterval)

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Upload failed')
        }

        setProgress(100)
        const { blueprint } = await res.json()
        onUploadComplete(blueprint)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        clearInterval(progressInterval)
        setUploading(false)
      }
    },
    [projectId, onUploadComplete]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const file = e.dataTransfer.files[0]
      if (file) handleUpload(file)
    },
    [handleUpload]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleUpload(file)
    },
    [handleUpload]
  )

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-xl p-12 text-center transition-all
        ${dragActive
          ? 'border-abel-amber bg-orange-50'
          : 'border-gray-300 hover:border-abel-walnut/50 bg-gray-50'
        }
        ${uploading ? 'pointer-events-none opacity-70' : 'cursor-pointer'}
      `}
    >
      {uploading ? (
        <div className="space-y-4">
          <div className="w-16 h-16 mx-auto border-4 border-abel-walnut border-t-transparent rounded-full animate-spin" />
          <p className="text-lg font-medium text-abel-walnut">
            Uploading blueprint...
          </p>
          <div className="w-64 mx-auto bg-gray-200 rounded-full h-2">
            <div
              className="bg-abel-amber h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-500">{progress}%</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="w-16 h-16 mx-auto bg-abel-walnut/10 rounded-full flex items-center justify-center">
            <svg
              className="w-8 h-8 text-abel-walnut"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-medium text-gray-700">
              Drop your blueprint here
            </p>
            <p className="text-sm text-gray-500 mt-1">
              or{' '}
              <label className="text-abel-amber hover:text-abel-amber-dark cursor-pointer font-medium">
                browse files
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
                  onChange={handleFileInput}
                />
              </label>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              PDF, PNG, JPEG, or TIFF — up to 50MB
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
