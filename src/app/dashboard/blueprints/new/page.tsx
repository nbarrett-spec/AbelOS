'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'

interface ProjectOption {
  id: string
  name: string
  address: string
  status: string
}

interface UploadedFile {
  file: File
  preview: string | null
  uploading: boolean
  progress: number
  error: string | null
  blueprintId: string | null
}

const ALLOWED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
]

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff']

export default function BlueprintUploadPage() {
  const router = useRouter()
  const { builder, loading: authLoading } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [step, setStep] = useState<'select-project' | 'upload' | 'processing' | 'done'>('select-project')
  const [error, setError] = useState('')

  // Fetch projects for dropdown
  useEffect(() => {
    if (builder) {
      fetch('/api/projects')
        .then((r) => r.json())
        .then((data) => {
          setProjects(data.projects || [])
          // Auto-select if only one project
          if (data.projects?.length === 1) {
            setSelectedProject(data.projects[0].id)
            setStep('upload')
          }
        })
        .catch(() => {})
    }
  }, [builder])

  // Handle file selection
  const handleFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const validated: UploadedFile[] = []
      for (const file of Array.from(newFiles)) {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase()
        if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(ext)) {
          setError(`"${file.name}" is not a supported format. Use PDF, PNG, or JPG.`)
          continue
        }
        if (file.size > 50 * 1024 * 1024) {
          setError(`"${file.name}" is too large. Maximum 50 MB.`)
          continue
        }
        // Generate preview for images
        let preview: string | null = null
        if (file.type.startsWith('image/')) {
          preview = URL.createObjectURL(file)
        }
        validated.push({
          file,
          preview,
          uploading: false,
          progress: 0,
          error: null,
          blueprintId: null,
        })
      }
      if (validated.length > 0) {
        setFiles((prev) => [...prev, ...validated])
        setError('')
      }
    },
    []
  )

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles]
  )

  // Remove a file before upload
  function removeFile(index: number) {
    setFiles((prev) => {
      const next = [...prev]
      if (next[index].preview) URL.revokeObjectURL(next[index].preview!)
      next.splice(index, 1)
      return next
    })
  }

  // Upload all files, then trigger analysis
  async function handleUploadAndAnalyze() {
    if (!selectedProject || files.length === 0) return

    setUploading(true)
    setStep('processing')
    setError('')

    const uploadedIds: string[] = []

    for (let i = 0; i < files.length; i++) {
      try {
        setFiles((prev) => {
          const next = [...prev]
          next[i] = { ...next[i], uploading: true, progress: 30 }
          return next
        })

        const formData = new FormData()
        formData.append('file', files[i].file)
        formData.append('projectId', selectedProject)

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(errData.error || 'Upload failed')
        }

        const data = await res.json()
        const bpId = data.blueprint?.id

        setFiles((prev) => {
          const next = [...prev]
          next[i] = { ...next[i], progress: 60, blueprintId: bpId }
          return next
        })

        if (bpId) {
          uploadedIds.push(bpId)

          // Trigger AI analysis
          setAnalyzing(true)
          const analyzeRes = await fetch(`/api/blueprints/${bpId}/analyze`, {
            method: 'POST',
          })

          if (analyzeRes.ok) {
            const analyzeData = await analyzeRes.json()

            // If analysis complete, generate takeoff
            if (analyzeData.analysis) {
              setFiles((prev) => {
                const next = [...prev]
                next[i] = { ...next[i], progress: 80 }
                return next
              })

              await fetch(`/api/blueprints/${bpId}/takeoff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ analysis: analyzeData.analysis }),
              })
            }
          }

          setFiles((prev) => {
            const next = [...prev]
            next[i] = { ...next[i], progress: 100, uploading: false }
            return next
          })
        }
      } catch (err: any) {
        setFiles((prev) => {
          const next = [...prev]
          next[i] = { ...next[i], error: err.message, uploading: false }
          return next
        })
      }
    }

    setUploading(false)
    setAnalyzing(false)

    // Navigate to the first blueprint's detail page, or back to list
    if (uploadedIds.length === 1) {
      setStep('done')
      setTimeout(() => router.push(`/dashboard/blueprints/${uploadedIds[0]}`), 1500)
    } else if (uploadedIds.length > 1) {
      setStep('done')
      setTimeout(() => router.push('/dashboard/blueprints'), 1500)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/blueprints"
          className="p-2 hover:bg-surface-muted rounded-lg transition"
        >
          ← Back
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-fg">Upload Blueprint</h1>
          <p className="text-sm text-fg-muted">
            Upload floor plans and our AI will generate a complete material takeoff
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-4">
        {['Select Project', 'Upload Files', 'AI Processing'].map((label, i) => {
          const stepIndex =
            step === 'select-project' ? 0 : step === 'upload' ? 1 : 2
          const isActive = i === stepIndex
          const isDone = i < stepIndex || step === 'done'
          return (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                  isDone
                    ? 'bg-green-500 text-white'
                    : isActive
                    ? 'bg-[#0f2a3e] text-white'
                    : 'bg-surface-muted text-fg-muted'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span
                className={`text-sm font-medium ${
                  isActive || isDone ? 'text-fg' : 'text-fg-subtle'
                }`}
              >
                {label}
              </span>
              {i < 2 && (
                <div
                  className={`flex-1 h-0.5 ${
                    isDone ? 'bg-green-300' : 'bg-surface-muted'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1: Project Selection */}
      {step === 'select-project' && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold text-fg mb-4">
            Which project is this blueprint for?
          </h2>
          {projects.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-fg-muted mb-4">
                You need a project to upload blueprints to.
              </p>
              <Link
                href="/projects/new"
                className="px-5 py-2.5 bg-[#0f2a3e] hover:bg-[#15405e] text-white font-semibold rounded-xl transition"
              >
                Create Project First
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    setSelectedProject(project.id)
                    setStep('upload')
                  }}
                  className={`w-full text-left p-4 rounded-xl border-2 transition ${
                    selectedProject === project.id
                      ? 'border-[#0f2a3e] bg-[#0f2a3e]/5'
                      : 'border-border hover:border-border-strong'
                  }`}
                >
                  <p className="font-medium text-fg">{project.name}</p>
                  <p className="text-sm text-fg-muted">{project.address}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 2: File Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Selected Project Banner */}
          <div className="bg-[#0f2a3e]/5 border border-[#0f2a3e]/20 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-fg-muted uppercase font-medium">Project</p>
              <p className="font-medium text-fg">
                {projects.find((p) => p.id === selectedProject)?.name}
              </p>
            </div>
            <button
              onClick={() => setStep('select-project')}
              className="text-sm text-[#0f2a3e] hover:underline"
            >
              Change
            </button>
          </div>

          {/* Drop Zone */}
          <div
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition ${
              isDragging
                ? 'border-[#C6A24E] bg-orange-50'
                : 'border-border-strong hover:border-[#0f2a3e] hover:bg-surface-muted'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files)
                e.target.value = ''
              }}
              className="hidden"
            />
            <div className="text-5xl mb-4">📐</div>
            <p className="text-lg font-medium text-fg-muted">
              {isDragging ? 'Drop files here' : 'Drag & drop blueprints here'}
            </p>
            <p className="text-sm text-fg-muted mt-1">
              or click to browse • PDF, PNG, JPG up to 50 MB each
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 bg-white rounded-xl border p-4"
                >
                  {/* Preview / Icon */}
                  <div className="w-14 h-14 rounded-lg bg-surface-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {f.preview ? (
                      // Blob URL from FileReader — next/image would need the
                      // loader disabled; raw img is the right call here.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.preview}
                        alt=""
                        width={56}
                        height={56}
                        decoding="async"
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl">📋</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-fg truncate">
                      {f.file.name}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {(f.file.size / 1024 / 1024).toFixed(1)} MB •{' '}
                      {f.file.type.split('/')[1]?.toUpperCase()}
                    </p>
                    {f.error && (
                      <p className="text-xs text-red-600 mt-1">{f.error}</p>
                    )}
                  </div>

                  <button
                    onClick={() => removeFile(i)}
                    className="p-2 text-fg-subtle hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload Button */}
          {files.length > 0 && (
            <button
              onClick={handleUploadAndAnalyze}
              disabled={uploading}
              className="w-full py-3.5 bg-[#C6A24E] hover:bg-[#A8882A] text-white font-bold rounded-xl shadow-lg transition disabled:opacity-50 text-lg"
            >
              Upload & Analyze {files.length > 1 ? `${files.length} Files` : 'Blueprint'}
            </button>
          )}
        </div>
      )}

      {/* Step 3: Processing */}
      {(step === 'processing' || step === 'done') && (
        <div className="bg-white rounded-xl border p-8">
          <div className="text-center mb-8">
            {step === 'done' ? (
              <>
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-xl font-bold text-fg">Takeoff Complete!</h2>
                <p className="text-sm text-fg-muted mt-1">
                  Redirecting to your results...
                </p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-4 animate-pulse">🤖</div>
                <h2 className="text-xl font-bold text-fg">
                  {analyzing ? 'AI is Analyzing Your Blueprint...' : 'Uploading...'}
                </h2>
                <p className="text-sm text-fg-muted mt-1">
                  {analyzing
                    ? 'Reading dimensions, identifying materials, calculating quantities'
                    : 'Sending your files to the server'}
                </p>
              </>
            )}
          </div>

          {/* File Progress */}
          <div className="space-y-3">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-surface-muted flex items-center justify-center text-lg flex-shrink-0">
                  {f.progress === 100 ? '✅' : f.error ? '❌' : '📄'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">
                    {f.file.name}
                  </p>
                  <div className="w-full bg-surface-muted rounded-full h-2 mt-1">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${
                        f.error
                          ? 'bg-red-400'
                          : f.progress === 100
                          ? 'bg-green-500'
                          : 'bg-[#C6A24E]'
                      }`}
                      style={{ width: `${f.progress}%` }}
                    />
                  </div>
                  {f.error && (
                    <p className="text-xs text-red-600 mt-1">{f.error}</p>
                  )}
                </div>
                <span className="text-sm font-medium text-fg-muted w-10 text-right">
                  {f.progress}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
