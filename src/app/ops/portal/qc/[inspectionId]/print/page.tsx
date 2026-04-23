'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

/**
 * Print-optimized QC inspection report.
 *
 * Letter 8.5×11, mono, high-contrast. Built to live on the job file and
 * to be handed to a PM / builder. One report per page. Uses the shared
 * .print-only / .print-hidden utility classes so the only thing on paper
 * is the report itself — no app chrome.
 *
 * Data source: /api/ops/inspections/[id] GET. Template items come back
 * on `templateItems` (JSON blob); the per-item pass/fail verdict lives
 * on `results` (JSON blob keyed by item id). Photos are stored as a
 * JSON array of data URLs or http(s) URLs on the inspection row.
 */

interface TemplateItem {
  id: string
  title?: string
  label?: string
  description?: string
  category?: string
  critical?: boolean
}

interface InspectionResult {
  // Accept either boolean pass or one of the allowed verdict strings.
  pass?: boolean
  status?: 'PASS' | 'FAIL' | 'N/A' | 'NA' | 'SKIP'
  notes?: string
}

interface Inspection {
  id: string
  status: 'PENDING' | 'PASS' | 'PASS_WITH_NOTES' | 'FAIL' | string
  scheduledDate: string | null
  completedDate: string | null
  notes: string | null
  passRate: number | null
  photos: string[] | null
  results: Record<string, InspectionResult> | null
  signatureData: string | null
  // Joined fields from the GET handler
  templateName: string | null
  templateCode: string | null
  category: string | null
  templateItems: TemplateItem[] | null
  jobNumber: string | null
  builderName: string | null
  jobAddress: string | null
  inspectorName: string | null
}

function verdictOf(r: InspectionResult | undefined): 'PASS' | 'FAIL' | 'N/A' | '—' {
  if (!r) return '—'
  if (r.status) {
    const s = r.status.toUpperCase()
    if (s === 'PASS') return 'PASS'
    if (s === 'FAIL') return 'FAIL'
    if (s === 'N/A' || s === 'NA' || s === 'SKIP') return 'N/A'
  }
  if (r.pass === true) return 'PASS'
  if (r.pass === false) return 'FAIL'
  return '—'
}

function verdictMark(v: 'PASS' | 'FAIL' | 'N/A' | '—'): string {
  if (v === 'PASS') return '[✓]'
  if (v === 'FAIL') return '[✗]'
  if (v === 'N/A') return '[—]'
  return '[ ]'
}

function prettyDate(v: string | null | undefined): string {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch {
    return v
  }
}

export default function QCInspectionPrintPage() {
  const params = useParams()
  const inspectionId = params?.inspectionId as string

  const [data, setData] = useState<Inspection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!inspectionId) return
    fetch(`/api/ops/inspections/${inspectionId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = await r.json()
        setData(body.inspection)
      })
      .catch((e) => setError(e?.message || 'Failed to load'))
  }, [inspectionId])

  if (error) {
    return <div className="p-8 text-red-700">Could not load inspection: {error}</div>
  }
  if (!data) {
    return <div className="p-8">Loading inspection…</div>
  }

  // Normalize shapes that come back as either arrays or JSON-encoded strings.
  const items: TemplateItem[] = Array.isArray(data.templateItems)
    ? data.templateItems
    : typeof data.templateItems === 'string'
      ? (safeParse(data.templateItems as unknown as string) || [])
      : []

  const results: Record<string, InspectionResult> = data.results && typeof data.results === 'object'
    ? (data.results as Record<string, InspectionResult>)
    : typeof data.results === 'string'
      ? (safeParse(data.results as unknown as string) || {})
      : {}

  const photos: string[] = Array.isArray(data.photos)
    ? data.photos
    : typeof data.photos === 'string'
      ? (safeParse(data.photos as unknown as string) || [])
      : []

  // Summary counts from results — fallback to 0/0 when nothing recorded.
  let passCount = 0
  let failCount = 0
  let naCount = 0
  for (const it of items) {
    const v = verdictOf(results[it.id])
    if (v === 'PASS') passCount++
    else if (v === 'FAIL') failCount++
    else if (v === 'N/A') naCount++
  }
  const graded = passCount + failCount
  const computedPassRate = graded > 0 ? Math.round((passCount / graded) * 100) : null

  const overall: 'PASS' | 'PASS_WITH_NOTES' | 'FAIL' | 'PENDING' =
    data.status === 'PASS' || data.status === 'PASS_WITH_NOTES' || data.status === 'FAIL'
      ? data.status
      : 'PENDING'

  return (
    <div className="qc-print-wrap">
      <style jsx global>{`
        /* Letter page, Abel mono palette — matches delivery manifest. */
        @page qc-report {
          size: letter;
          margin: 0.5in;
        }
        @media print {
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'JetBrains Mono', 'Consolas', ui-monospace, monospace !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print-only { display: block !important; }
          .print-hidden { display: none !important; }
          .qc-print-wrap { page: qc-report; }
          .qc-report-page {
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
            page-break-after: always;
            break-after: page;
          }
          .qc-report-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .qc-row, .qc-photo-grid, .qc-signature-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }

        /* Screen preview uses the same sizing so QA matches printed output. */
        .qc-print-wrap {
          background: #f4f2ee;
          color: #000;
          font-family: 'JetBrains Mono', 'Consolas', ui-monospace, monospace;
          padding: 16px 0;
          min-height: 100vh;
        }
        .qc-report-page {
          width: 7.5in;
          margin: 0 auto;
          padding: 0;
          background: #fff;
          color: #000;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        }
        .qc-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #000;
          padding-bottom: 10pt;
          margin-bottom: 12pt;
        }
        .qc-brand {
          font-size: 9pt;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 700;
        }
        .qc-title {
          font-size: 22pt;
          font-weight: 900;
          line-height: 1.05;
          margin-top: 2pt;
        }
        .qc-status {
          display: inline-block;
          border: 2pt solid #000;
          padding: 4pt 10pt;
          font-size: 16pt;
          font-weight: 900;
          letter-spacing: 0.08em;
        }
        .qc-status.pass { background: #eef7ef; }
        .qc-status.fail { background: #faeeeb; }
        .qc-status.pending { background: #fdf6e8; }
        .qc-meta-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8pt 14pt;
          font-size: 10pt;
          margin-bottom: 14pt;
        }
        .qc-label {
          font-size: 8pt;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          font-weight: 700;
        }
        .qc-value {
          font-size: 11pt;
          font-weight: 700;
          margin-top: 1pt;
        }
        .qc-section-title {
          font-size: 12pt;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border-bottom: 1.5pt solid #000;
          padding-bottom: 4pt;
          margin: 14pt 0 8pt;
        }
        .qc-row {
          display: grid;
          grid-template-columns: 1.1in 1fr 0.9in;
          gap: 8pt;
          padding: 6pt 0;
          border-bottom: 1pt solid #aaa;
          font-size: 10.5pt;
          align-items: baseline;
        }
        .qc-verdict {
          font-weight: 900;
          font-size: 11pt;
          letter-spacing: 0.08em;
        }
        .qc-verdict.pass { color: #1a4b21; }
        .qc-verdict.fail { color: #5f2015; }
        .qc-verdict.na { color: #6b6459; }
        .qc-item-title { font-weight: 700; }
        .qc-item-desc { font-size: 9pt; color: #333; margin-top: 1pt; }
        .qc-item-notes {
          font-size: 9pt;
          font-style: italic;
          margin-top: 1pt;
          color: #36322d;
        }
        .qc-item-cat {
          font-size: 8pt;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #6b6459;
        }
        .qc-summary-box {
          border: 2pt solid #000;
          padding: 8pt 12pt;
          margin-top: 12pt;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8pt;
          font-size: 10pt;
          font-weight: 700;
        }
        .qc-summary-num {
          font-size: 18pt;
          font-weight: 900;
          line-height: 1;
        }
        .qc-photo-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8pt;
          margin-top: 8pt;
        }
        .qc-photo {
          aspect-ratio: 4 / 3;
          border: 1pt solid #000;
          overflow: hidden;
          background: #f4f2ee;
        }
        .qc-photo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .qc-signature-block {
          margin-top: 18pt;
          padding-top: 10pt;
          border-top: 2pt solid #000;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16pt;
          font-size: 10pt;
        }
        .qc-sig-line {
          border-bottom: 1.5pt solid #000;
          height: 36pt;
          margin-bottom: 4pt;
        }
        .qc-sig-image {
          max-height: 36pt;
          max-width: 100%;
          object-fit: contain;
          display: block;
        }
        /* Hide print-only utility on screen by default. */
        .print-only { display: none; }
      `}</style>

      {/* Screen-only toolbar */}
      <div className="print-hidden" style={{ maxWidth: '7.5in', margin: '0 auto 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 14px', background: '#000', color: '#fff', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, border: 0, cursor: 'pointer' }}
        >
          Print
        </button>
        <span style={{ fontSize: 12, color: '#36322d' }}>
          Inspection {data.id.slice(0, 8)} · {items.length} item{items.length === 1 ? '' : 's'} · {photos.length} photo{photos.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="qc-report-page" style={{ padding: '0.5in' }}>
        <div className="qc-header">
          <div>
            <div className="qc-brand">Abel Lumber · QC Inspection Report</div>
            <div className="qc-title">{data.templateName || 'Quality Inspection'}</div>
            {data.category && (
              <div style={{ fontSize: '10pt', letterSpacing: '0.1em', marginTop: 2 }}>
                Category: {data.category}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              className={`qc-status ${
                overall === 'PASS' ? 'pass'
                  : overall === 'FAIL' ? 'fail'
                    : 'pending'
              }`}
            >
              {overall.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: '9pt', marginTop: 6, fontWeight: 700 }}>
              {prettyDate(data.completedDate || data.scheduledDate)}
            </div>
          </div>
        </div>

        <div className="qc-meta-grid">
          <div>
            <div className="qc-label">Inspection ID</div>
            <div className="qc-value" style={{ fontFamily: 'inherit' }}>{data.id.slice(0, 12)}</div>
          </div>
          <div>
            <div className="qc-label">Inspector</div>
            <div className="qc-value">{data.inspectorName || '—'}</div>
          </div>
          <div>
            <div className="qc-label">Job #</div>
            <div className="qc-value">{data.jobNumber || '—'}</div>
          </div>
          <div>
            <div className="qc-label">Builder</div>
            <div className="qc-value">{data.builderName || '—'}</div>
          </div>
          {data.jobAddress && (
            <div style={{ gridColumn: 'span 4' }}>
              <div className="qc-label">Job Address</div>
              <div className="qc-value">{data.jobAddress}</div>
            </div>
          )}
        </div>

        {/* Checklist */}
        <div className="qc-section-title">Checklist</div>
        {items.length === 0 ? (
          <div style={{ fontSize: 10, padding: '8pt 0', fontStyle: 'italic', color: '#6b6459' }}>
            No template items recorded for this inspection.
          </div>
        ) : (
          <div>
            {items.map((it) => {
              const r = results[it.id]
              const v = verdictOf(r)
              const label = it.title || it.label || '(untitled item)'
              return (
                <div key={it.id} className="qc-row">
                  <div className={`qc-verdict ${v === 'PASS' ? 'pass' : v === 'FAIL' ? 'fail' : 'na'}`}>
                    {verdictMark(v)} {v}
                  </div>
                  <div>
                    <div className="qc-item-title">
                      {label}
                      {it.critical && (
                        <span style={{ marginLeft: 6, color: '#5f2015', fontSize: 8, letterSpacing: '0.1em' }}>
                          CRITICAL
                        </span>
                      )}
                    </div>
                    {it.description && <div className="qc-item-desc">{it.description}</div>}
                    {r?.notes && <div className="qc-item-notes">Note: {r.notes}</div>}
                  </div>
                  <div className="qc-item-cat">{it.category || ''}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* Summary */}
        <div className="qc-summary-box">
          <div>
            <div className="qc-label">Total</div>
            <div className="qc-summary-num">{items.length}</div>
          </div>
          <div>
            <div className="qc-label">Pass</div>
            <div className="qc-summary-num" style={{ color: '#1a4b21' }}>{passCount}</div>
          </div>
          <div>
            <div className="qc-label">Fail</div>
            <div className="qc-summary-num" style={{ color: '#5f2015' }}>{failCount}</div>
          </div>
          <div>
            <div className="qc-label">N/A</div>
            <div className="qc-summary-num" style={{ color: '#6b6459' }}>{naCount}</div>
          </div>
          <div>
            <div className="qc-label">Pass Rate</div>
            <div className="qc-summary-num">
              {data.passRate != null ? `${Math.round(data.passRate)}%` : computedPassRate != null ? `${computedPassRate}%` : '—'}
            </div>
          </div>
        </div>

        {data.notes && (
          <>
            <div className="qc-section-title">Inspector Notes</div>
            <div style={{ fontSize: '10.5pt', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
              {data.notes}
            </div>
          </>
        )}

        {photos.length > 0 && (
          <>
            <div className="qc-section-title">Photos</div>
            <div className="qc-photo-grid">
              {photos.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <div key={i} className="qc-photo">
                  <img src={src} alt={`Inspection photo ${i + 1}`} />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Signature */}
        <div className="qc-signature-block">
          <div>
            <div className="qc-label">Inspector Signature</div>
            {data.signatureData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.signatureData} alt="Inspector signature" className="qc-sig-image" />
            ) : (
              <div className="qc-sig-line" />
            )}
            <div style={{ fontSize: '9pt', fontWeight: 700 }}>
              {data.inspectorName || '—'}
            </div>
            <div style={{ fontSize: '9pt' }}>
              Date: {prettyDate(data.completedDate || data.scheduledDate)}
            </div>
          </div>
          <div>
            <div className="qc-label">PM / Builder Acknowledgement</div>
            <div className="qc-sig-line" />
            <div style={{ fontSize: '9pt' }}>Name: ___________________________</div>
            <div style={{ fontSize: '9pt' }}>Date: ___________________________</div>
          </div>
        </div>

        {/* Print-only footer strip */}
        <div
          className="print-only"
          style={{
            marginTop: '14pt',
            paddingTop: '6pt',
            borderTop: '1pt solid #000',
            fontSize: '8pt',
            display: 'flex',
            justifyContent: 'space-between',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          <span>Abel Lumber · Quality Control</span>
          <span>Report {data.id.slice(0, 8)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Utils ────────────────────────────────────────────────────────────
function safeParse<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}
