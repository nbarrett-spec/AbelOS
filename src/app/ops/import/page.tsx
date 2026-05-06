'use client'

/**
 * /ops/import — Generic bulk import wizard (B-FEAT-6 / A-API-14).
 *
 * Flow:
 *   1. Pick import type (INVENTORY_COUNT | PRICE_LIST | BUILDER_LIST).
 *   2. Upload CSV/XLSX file.
 *   3. /api/ops/import/preview returns headers + first 10 rows + auto-mapping.
 *   4. User reviews/edits column mapping.
 *   5. Confirm + Run → /api/ops/import/run actually writes to DB.
 *   6. Result panel shows rowsCreated/Updated/Errored + per-row errors.
 *
 * PRODUCT_CATALOG is intentionally absent (deferred — bulk-creating Products
 * cascades into BoMs/inventory/pricing in ways we don't want to ship in v1).
 */

import { useEffect, useState } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import { Upload, FileText, ArrowRight, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react'

interface ImportFieldDef {
  key: string
  label: string
  required: boolean
  hint?: string
}

interface ImportTypeDef {
  type: 'INVENTORY_COUNT' | 'PRICE_LIST' | 'BUILDER_LIST'
  label: string
  description: string
  targetModel: string
  fields: ImportFieldDef[]
}

interface PreviewResponse {
  success: boolean
  fileName: string
  importType: ImportTypeDef['type']
  typeDef: ImportTypeDef
  headers: string[]
  rowsPreviewed: number
  previewRows: Record<string, string>[]
  suggestedMapping: Record<string, string | null>
}

interface RunResponse {
  success: boolean
  importLogId: string | null
  rowsTotal: number
  rowsCreated: number
  rowsUpdated: number
  rowsErrored: number
  errors: { row: number; message: string }[]
}

type Step = 'pick-type' | 'upload' | 'map' | 'confirm' | 'done'

export default function BulkImportPage() {
  const [importTypes, setImportTypes] = useState<ImportTypeDef[]>([])
  const [step, setStep] = useState<Step>('pick-type')
  const [selectedType, setSelectedType] = useState<ImportTypeDef | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [allRows, setAllRows] = useState<Record<string, string>[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RunResponse | null>(null)

  // Load type catalog on mount
  useEffect(() => {
    fetch('/api/ops/import/preview')
      .then(r => r.json())
      .then(d => setImportTypes(d.importTypes || []))
      .catch(() => setError('Failed to load import types'))
  }, [])

  function reset() {
    setStep('pick-type')
    setSelectedType(null)
    setFile(null)
    setPreview(null)
    setMapping({})
    setAllRows(null)
    setError('')
    setResult(null)
  }

  function pickType(t: ImportTypeDef) {
    setSelectedType(t)
    setStep('upload')
    setError('')
  }

  async function uploadAndPreview() {
    if (!file || !selectedType) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('importType', selectedType.type)
      const res = await fetch('/api/ops/import/preview', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Preview failed')
        return
      }
      setPreview(data)
      // Apply auto-mapping suggestions
      const initial: Record<string, string> = {}
      for (const k of Object.keys(data.suggestedMapping || {})) {
        if (data.suggestedMapping[k]) initial[k] = data.suggestedMapping[k]
      }
      setMapping(initial)

      // Parse the full file client-side so the run endpoint gets all rows.
      // Re-uses the same file the preview endpoint just read; cheap.
      const fullRows = await parseClientSide(file)
      setAllRows(fullRows)

      setStep('map')
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!preview || !selectedType || !allRows) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/ops/import/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importType: selectedType.type,
          fileName: preview.fileName,
          mapping,
          rows: allRows,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Import failed')
        return
      }
      setResult(data)
      setStep('done')
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setBusy(false)
    }
  }

  // ─── render ──────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <PageHeader
        title="Bulk Import"
        description="Upload CSV or XLSX files to update inventory counts, price lists, or builder accounts."
        crumbs={[{ label: 'Operations', href: '/ops' }, { label: 'Bulk Import' }]}
        actions={
          step !== 'pick-type' && (
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Start over
            </button>
          )
        }
      />

      <StepBar current={step} />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Step 1 — pick type */}
      {step === 'pick-type' && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {importTypes.map(t => (
            <button
              key={t.type}
              onClick={() => pickType(t)}
              className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-white p-5 text-left transition hover:border-slate-900 hover:shadow-md"
            >
              <FileText className="h-5 w-5 text-slate-700" />
              <h3 className="font-semibold text-slate-900">{t.label}</h3>
              <p className="text-sm text-slate-600">{t.description}</p>
              <div className="mt-2 text-xs text-slate-500">
                Target: <code className="rounded bg-slate-100 px-1.5 py-0.5">{t.targetModel}</code>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2 — upload */}
      {step === 'upload' && selectedType && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-600">Importing as</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-semibold text-slate-900">{selectedType.label}</span>
              <span className="text-xs text-slate-500">→ {selectedType.targetModel}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{selectedType.description}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {selectedType.fields.map(f => (
                <span
                  key={f.key}
                  className={`rounded-full px-2.5 py-1 ${f.required ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}
                >
                  {f.label}
                  {f.required && ' *'}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border-2 border-dashed border-slate-300 bg-white p-8 text-center">
            <Upload className="mx-auto h-8 w-8 text-slate-400" />
            <div className="mt-3">
              <label className="cursor-pointer text-sm font-medium text-slate-900 hover:underline">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? file.name : 'Choose a CSV or XLSX file'}
              </label>
              <p className="mt-1 text-xs text-slate-500">Up to 25MB. CSV preferred for v1.</p>
            </div>
            {file && (
              <button
                onClick={uploadAndPreview}
                disabled={busy}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Reading…' : 'Preview rows'}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 3 — map columns */}
      {step === 'map' && preview && selectedType && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Map columns</h3>
                <p className="mt-1 text-sm text-slate-600">
                  File: <strong>{preview.fileName}</strong> · Detected {preview.headers.length} columns,{' '}
                  {allRows?.length ?? 0} rows
                </p>
              </div>
            </div>

            <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              {selectedType.fields.map(f => (
                <div key={f.key} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-3 sm:items-center">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {f.label}
                      {f.required && <span className="ml-1 text-amber-600">*</span>}
                    </div>
                    {f.hint && <div className="text-xs text-slate-500">{f.hint}</div>}
                  </div>
                  <div className="sm:col-span-2">
                    <select
                      value={mapping[f.key] || ''}
                      onChange={e => setMapping({ ...mapping, [f.key]: e.target.value })}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">— Don't import —</option>
                      {preview.headers.map(h => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <PreviewTable preview={preview} mapping={mapping} fields={selectedType.fields} />

          <div className="flex justify-end">
            <button
              onClick={() => setStep('confirm')}
              disabled={!areRequiredFieldsMapped(selectedType, mapping)}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Review & confirm
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4 — confirm */}
      {step === 'confirm' && preview && selectedType && allRows && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-semibold text-amber-900">Ready to import</h3>
            <ul className="mt-2 space-y-1 text-sm text-amber-900">
              <li>
                Type: <strong>{selectedType.label}</strong>
              </li>
              <li>
                File: <strong>{preview.fileName}</strong>
              </li>
              <li>
                Rows to process: <strong>{allRows.length}</strong>
              </li>
              <li>
                Mapped fields:{' '}
                <strong>
                  {Object.entries(mapping)
                    .filter(([, v]) => v)
                    .map(([k, v]) => `${k} ← ${v}`)
                    .join(', ')}
                </strong>
              </li>
            </ul>
            <p className="mt-3 text-sm text-amber-800">
              This action writes to the live database. An ImportLog row will be created with the run details.
            </p>
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => setStep('map')}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              onClick={runImport}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Running…' : 'Run import'}
            </button>
          </div>
        </div>
      )}

      {/* Step 5 — done */}
      {step === 'done' && result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div className="flex-1">
                <h3 className="font-semibold text-emerald-900">Import complete</h3>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Total rows" value={result.rowsTotal} />
                  <Stat label="Created" value={result.rowsCreated} tone="emerald" />
                  <Stat label="Updated" value={result.rowsUpdated} tone="emerald" />
                  <Stat
                    label="Errored"
                    value={result.rowsErrored}
                    tone={result.rowsErrored > 0 ? 'red' : 'slate'}
                  />
                </div>
                {result.importLogId && (
                  <p className="mt-3 text-xs text-emerald-800">ImportLog ID: {result.importLogId}</p>
                )}
              </div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-white">
              <div className="border-b border-red-100 bg-red-50 px-4 py-2">
                <h3 className="text-sm font-semibold text-red-900">{result.errors.length} row error(s)</h3>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Row</th>
                      <th className="px-4 py-2 text-left">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono text-slate-700">{e.row}</td>
                        <td className="px-4 py-2 text-slate-700">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={reset}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── child components ─────────────────────────────────────────────
function StepBar({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'pick-type', label: 'Type' },
    { key: 'upload', label: 'Upload' },
    { key: 'map', label: 'Map' },
    { key: 'confirm', label: 'Confirm' },
    { key: 'done', label: 'Done' },
  ]
  const idx = steps.findIndex(s => s.key === current)
  return (
    <div className="mt-4 flex items-center gap-2 text-xs">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full font-semibold ${
              i < idx
                ? 'bg-emerald-600 text-white'
                : i === idx
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-200 text-slate-500'
            }`}
          >
            {i + 1}
          </span>
          <span className={i === idx ? 'font-semibold text-slate-900' : 'text-slate-500'}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-slate-300">→</span>}
        </div>
      ))}
    </div>
  )
}

function PreviewTable({
  preview,
  mapping,
  fields,
}: {
  preview: PreviewResponse
  mapping: Record<string, string>
  fields: ImportFieldDef[]
}) {
  if (preview.previewRows.length === 0) {
    return <div className="text-sm text-slate-500">No preview rows.</div>
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-600">
        Preview ({preview.previewRows.length} of {preview.rowsPreviewed})
      </div>
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs uppercase text-slate-500">
            {fields.map(f => (
              <th key={f.key} className="px-3 py-2 text-left">
                {f.label}
                {f.required && <span className="ml-1 text-amber-600">*</span>}
                {mapping[f.key] && <div className="text-[10px] font-normal normal-case text-slate-400">← {mapping[f.key]}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {preview.previewRows.map((r, i) => (
            <tr key={i}>
              {fields.map(f => {
                const src = mapping[f.key]
                const v = src ? r[src] : ''
                return (
                  <td key={f.key} className="px-3 py-2 text-slate-700">
                    {v || <span className="text-slate-300">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'slate',
}: {
  label: string
  value: number
  tone?: 'slate' | 'emerald' | 'red'
}) {
  const colors: Record<string, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
  }
  return (
    <div>
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${colors[tone]}`}>{value.toLocaleString()}</div>
    </div>
  )
}

// ─── helpers ──────────────────────────────────────────────────────
function areRequiredFieldsMapped(t: ImportTypeDef, mapping: Record<string, string>) {
  return t.fields.filter(f => f.required).every(f => !!mapping[f.key])
}

/**
 * Parse the file in the browser using the same xlsx lib server-side uses.
 * Returns full row set so the run endpoint can process everything in one
 * shot. For 50k rows this is fine; the 25 MB file size cap on preview keeps
 * memory in check.
 */
async function parseClientSide(file: File): Promise<Record<string, string>[]> {
  // Lazy-load xlsx so the bundle doesn't pay for it on every ops page.
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false, cellNF: false })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  const rowsAA = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as string[][]
  if (rowsAA.length === 0) return []
  const headers = (rowsAA[0] || []).map(h => String(h ?? '').trim())
  const out: Record<string, string>[] = []
  for (let i = 1; i < rowsAA.length; i++) {
    const row = rowsAA[i] || []
    const obj: Record<string, string> = {}
    let hasAny = false
    for (let j = 0; j < headers.length; j++) {
      const v = row[j]
      const s = v == null ? '' : String(v).trim()
      obj[headers[j]] = s
      if (s) hasAny = true
    }
    if (hasAny) out.push(obj)
  }
  return out
}
