'use client'

import { useState, useRef, useCallback } from 'react'
import { useStaffAuth } from '@/hooks/useStaffAuth'
import { Camera, Upload, FileCheck, Loader2, AlertCircle, CheckCircle2, X, RotateCcw } from 'lucide-react'

// ──────────────────────────────────────────────────────────────────────────
// Sheet Scanner — Upload completed job packet pages for AI processing
// Photographs of printed sheets are sent to Claude Vision which extracts
// checked boxes, handwritten notes, signatures, and defect info. Results
// are written back to Aegis: task completion, job status, notes, activity log.
// ──────────────────────────────────────────────────────────────────────────

type SheetType = 'PICK_LIST' | 'BUILD_SHEET' | 'DELIVERY' | 'QC_PUNCH' | 'AUTO'

interface ScanResult {
  success: boolean
  sheetType: string
  jobNumber: string
  jobId: string
  extraction: {
    checkedItems: string[]
    uncheckedItems: string[]
    handwrittenNotes: string[]
    signatures: { role: string; name: string | null; signed: boolean }[]
    defects: { type: string; location: string; notes: string }[]
    disposition: string | null
    punchItemCount: number | null
  }
  writeback: {
    tasksCompleted: number
    notesAdded: number
    activitiesCreated: number
    statusAdvanced: boolean
    newStatus: string | null
  }
  confidence: number
  rawSummary: string
}

const SHEET_TYPES: { value: SheetType; label: string; desc: string }[] = [
  { value: 'AUTO', label: 'Auto-Detect', desc: 'Let AI identify the sheet type' },
  { value: 'PICK_LIST', label: 'Pick List', desc: 'Warehouse picking sheet with checkboxes' },
  { value: 'BUILD_SHEET', label: 'Build Sheet', desc: 'Assembly unit build sheet with QC sign-off' },
  { value: 'DELIVERY', label: 'Delivery & Install', desc: 'Pre-delivery checklist and sign-offs' },
  { value: 'QC_PUNCH', label: 'QC / Punch Walk', desc: 'Site walkthrough inspection and punch items' },
]

export default function ScanPage() {
  const { staff, loading: authLoading } = useStaffAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const [sheetType, setSheetType] = useState<SheetType>('AUTO')
  const [jobNumber, setJobNumber] = useState('')
  const [jobId, setJobId] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState('')
  const [confirmWriteback, setConfirmWriteback] = useState(false)

  // ── Job search ──
  const searchJobs = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setSearchResults([]); return }
    try {
      const res = await fetch(`/api/ops/jobs?search=${encodeURIComponent(q)}&limit=6`)
      if (res.ok) {
        const d = await res.json()
        setSearchResults(d.data || [])
      }
    } catch { /* */ }
  }, [])

  const selectJob = (job: any) => {
    setJobId(job.id)
    setJobNumber(job.jobNumber)
    setJobSearch('')
    setSearchResults([])
  }

  // ── File handling ──
  const handleFile = (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/') && f.type !== 'application/pdf') {
      setError('Please upload an image (JPG, PNG) or PDF')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      setError('File too large — max 20MB')
      return
    }
    setFile(f)
    setError('')
    setResult(null)

    if (f.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => setPreview(e.target?.result as string)
      reader.readAsDataURL(f)
    } else {
      setPreview(null) // PDF — no preview
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  // ── Submit scan ──
  const handleScan = async () => {
    if (!file) { setError('No image selected'); return }
    if (!jobId) { setError('Select a job first'); return }

    setScanning(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('jobId', jobId)
      formData.append('jobNumber', jobNumber)
      formData.append('sheetType', sheetType)
      formData.append('staffId', staff?.id || '')
      formData.append('writeBack', confirmWriteback ? 'true' : 'false')

      const res = await fetch('/api/ops/scan-sheet', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Scan failed')
      }

      setResult(data)
    } catch (e: any) {
      setError(e.message || 'Failed to process scan')
    } finally {
      setScanning(false)
    }
  }

  const reset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError('')
    setConfirmWriteback(false)
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Loader2 className="animate-spin" size={32} style={{ color: '#6B7280' }} />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: '#0f2a3e', margin: '0 0 4px' }}>
          📱 Scan Job Packet Sheet
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
          Photograph a completed sheet — AI reads checkboxes, notes, and signatures, then updates the job in Abel OS
        </p>
      </div>

      {/* ── Step 1: Select Job ── */}
      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          1. Select Job
        </div>
        {jobId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8 }}>
            <CheckCircle2 size={18} style={{ color: '#16A34A' }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, color: '#0f2a3e' }}>{jobNumber}</span>
            </div>
            <button onClick={() => { setJobId(''); setJobNumber('') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4 }}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search by job number or builder..."
              value={jobSearch}
              onChange={e => { setJobSearch(e.target.value); searchJobs(e.target.value) }}
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
            />
            {searchResults.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, marginTop: 4, boxShadow: '0 10px 25px rgba(0,0,0,0.15)', maxHeight: 240, overflow: 'auto' }}>
                {searchResults.map((j: any) => (
                  <button key={j.id} onClick={() => selectJob(j)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #F3F4F6' }}>
                    <strong>{j.jobNumber}</strong>
                    <span style={{ color: '#6B7280', marginLeft: 8 }}>{j.builderName}</span>
                    <span style={{ color: '#9CA3AF', marginLeft: 8, fontSize: 12 }}>{j.community}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Step 2: Sheet Type ── */}
      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          2. Sheet Type
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {SHEET_TYPES.map(st => (
            <button
              key={st.value}
              onClick={() => setSheetType(st.value)}
              style={{
                padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: sheetType === st.value ? '2px solid #0f2a3e' : '1px solid #D1D5DB',
                background: sheetType === st.value ? '#EFF6FF' : 'white',
                color: sheetType === st.value ? '#0f2a3e' : '#6B7280',
                cursor: 'pointer', textAlign: 'center',
              }}
            >
              {st.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 12, color: '#9CA3AF', margin: '8px 0 0' }}>
          {SHEET_TYPES.find(s => s.value === sheetType)?.desc}
        </p>
      </div>

      {/* ── Step 3: Upload Image ── */}
      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          3. Upload or Capture Photo
        </div>

        {!preview && !file ? (
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            style={{ border: '2px dashed #D1D5DB', borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer', background: '#FAFAFA' }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={36} style={{ color: '#9CA3AF', margin: '0 auto 12px' }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', margin: '0 0 4px' }}>
              Drop image here or tap to browse
            </p>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
              JPG, PNG, or PDF — max 20MB
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={(e) => { e.stopPropagation(); cameraInputRef.current?.click() }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: '#0f2a3e', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <Camera size={18} /> Take Photo
              </button>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            {preview && (
              <img
                src={preview}
                alt="Scanned sheet"
                style={{ width: '100%', borderRadius: 8, border: '1px solid #E5E7EB' }}
              />
            )}
            {file && !preview && (
              <div style={{ padding: 20, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB', textAlign: 'center' }}>
                <FileCheck size={32} style={{ color: '#0f2a3e', margin: '0 auto 8px' }} />
                <p style={{ fontWeight: 600, margin: 0 }}>{file.name}</p>
                <p style={{ fontSize: 12, color: '#6B7280', margin: '4px 0 0' }}>{(file.size / 1024 / 1024).toFixed(1)} MB</p>
              </div>
            )}
            <button onClick={reset}
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0] || null)} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0] || null)} />
      </div>

      {/* ── Write-back toggle ── */}
      <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={confirmWriteback}
            onChange={e => setConfirmWriteback(e.target.checked)}
            style={{ marginTop: 3, width: 18, height: 18, accentColor: '#0f2a3e' }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f2a3e' }}>
              Auto-update job in Abel OS
            </div>
            <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.5, marginTop: 2 }}>
              When checked, scan results will automatically: mark tasks done, add notes to the job record,
              create communication log entries, and advance job status if all gates pass.
              Uncheck to preview results without making changes.
            </div>
          </div>
        </label>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 16, color: '#991B1B', fontSize: 14 }}>
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* ── Scan button ── */}
      {!result && (
        <button
          onClick={handleScan}
          disabled={scanning || !file || !jobId}
          style={{
            width: '100%', padding: '14px 24px', fontSize: 16, fontWeight: 700,
            background: scanning || !file || !jobId ? '#D1D5DB' : '#0f2a3e',
            color: 'white', border: 'none', borderRadius: 10, cursor: scanning || !file || !jobId ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginBottom: 16,
          }}
        >
          {scanning ? (
            <>
              <Loader2 className="animate-spin" size={20} />
              Processing with AI...
            </>
          ) : (
            <>
              <Camera size={20} />
              Scan &amp; Process Sheet
            </>
          )}
        </button>
      )}

      {/* ── Results ── */}
      {result && (
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          {/* Result header */}
          <div style={{ padding: '16px 20px', background: result.success ? '#F0FDF4' : '#FEF2F2', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 10 }}>
            {result.success ? <CheckCircle2 size={22} style={{ color: '#16A34A' }} /> : <AlertCircle size={22} style={{ color: '#DC2626' }} />}
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f2a3e' }}>
                {result.sheetType.replace(/_/g, ' ')} — {result.jobNumber}
              </div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                Confidence: {Math.round(result.confidence * 100)}%
              </div>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {/* Extraction summary */}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase' }}>Extracted Data</div>

            {result.extraction.checkedItems.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#16A34A', marginBottom: 4 }}>
                  ✅ Checked Items ({result.extraction.checkedItems.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
                  {result.extraction.checkedItems.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}

            {result.extraction.handwrittenNotes.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f2a3e', marginBottom: 4 }}>
                  ✍️ Handwritten Notes ({result.extraction.handwrittenNotes.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
                  {result.extraction.handwrittenNotes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
              </div>
            )}

            {result.extraction.signatures.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>
                  🖊️ Signatures
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {result.extraction.signatures.map((sig, i) => (
                    <div key={i} style={{ padding: '6px 12px', background: sig.signed ? '#F0FDF4' : '#FEF2F2', borderRadius: 6, fontSize: 12 }}>
                      <strong>{sig.role}:</strong> {sig.signed ? (sig.name || 'Signed') : 'Not signed'}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.extraction.defects.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#DC2626', marginBottom: 4 }}>
                  ⚠️ Defects / Punch Items ({result.extraction.defects.length})
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Type</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Location</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.extraction.defects.map((d, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '6px 8px' }}>{d.type}</td>
                        <td style={{ padding: '6px 8px' }}>{d.location}</td>
                        <td style={{ padding: '6px 8px' }}>{d.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.extraction.disposition && (
              <div style={{ padding: '8px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                <strong>Disposition:</strong> {result.extraction.disposition}
                {result.extraction.punchItemCount != null && (
                  <span style={{ marginLeft: 12 }}>| Punch items: <strong>{result.extraction.punchItemCount}</strong></span>
                )}
              </div>
            )}

            {/* AI Summary */}
            <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>
              <strong>AI Summary:</strong> {result.rawSummary}
            </div>

            {/* Writeback results */}
            {confirmWriteback && result.writeback && (
              <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase' }}>System Updates Applied</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div style={{ padding: '8px 12px', background: '#F0FDF4', borderRadius: 6 }}>
                    Tasks completed: <strong>{result.writeback.tasksCompleted}</strong>
                  </div>
                  <div style={{ padding: '8px 12px', background: '#EFF6FF', borderRadius: 6 }}>
                    Notes added: <strong>{result.writeback.notesAdded}</strong>
                  </div>
                  <div style={{ padding: '8px 12px', background: '#FFF7ED', borderRadius: 6 }}>
                    Activity log entries: <strong>{result.writeback.activitiesCreated}</strong>
                  </div>
                  <div style={{ padding: '8px 12px', background: result.writeback.statusAdvanced ? '#F0FDF4' : '#F9FAFB', borderRadius: 6 }}>
                    Status: <strong>{result.writeback.statusAdvanced ? `→ ${result.writeback.newStatus}` : 'No change'}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Scan another ── */}
      {result && (
        <button
          onClick={reset}
          style={{
            width: '100%', padding: '12px 24px', fontSize: 14, fontWeight: 600,
            background: 'white', color: '#0f2a3e', border: '2px solid #0f2a3e',
            borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <RotateCcw size={18} />
          Scan Another Sheet
        </button>
      )}
    </div>
  )
}
