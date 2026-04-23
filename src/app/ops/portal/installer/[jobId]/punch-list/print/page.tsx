'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

/**
 * Print-optimized installer punch list.
 *
 * Letter 8.5×11, mono, high-contrast. Handed to the installer at the
 * jobsite with open items and space for the customer + installer
 * signatures at closeout. Checkboxes are un-filled so they can be
 * ticked in pen.
 *
 * Data source: /api/ops/portal/installer/jobs/[jobId]. Punch items come
 * from Task rows keyed to the job with category = PUNCH_LIST. Only
 * open items (status != DONE) are printed.
 *
 * This page lives inside the installer portal layout. The layout detects
 * `/print` in the route and skips its tablet-only print suppression so
 * this route renders as a clean full page.
 */

interface PunchItem {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
}

interface JobDetail {
  id: string
  jobNumber: string
  builderName: string
  community: string | null
  lotBlock: string | null
  jobAddress: string | null
  status: string
  scheduledDate: string | null
  actualDate: string | null
  completedAt: string | null
  order: { orderNumber: string; poNumber: string | null; total: number } | null
  pm: { firstName: string; lastName: string; email: string | null; phone: string | null } | null
  punchItems: PunchItem[]
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

function priorityWeight(p: string): number {
  const v = p?.toUpperCase()
  if (v === 'CRITICAL') return 0
  if (v === 'HIGH') return 1
  if (v === 'MEDIUM' || v === 'MED') return 2
  if (v === 'LOW') return 3
  return 4
}

export default function PunchListPrintPage() {
  const params = useParams()
  const jobId = params?.jobId as string

  const [job, setJob] = useState<JobDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installerName, setInstallerName] = useState('')

  useEffect(() => {
    if (!jobId) return
    fetch(`/api/ops/portal/installer/jobs/${jobId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setJob(data)
      })
      .catch((e) => setError(e?.message || 'Failed to load'))
  }, [jobId])

  if (error) {
    return <div className="p-8 text-red-700">Could not load job: {error}</div>
  }
  if (!job) {
    return <div className="p-8">Loading job…</div>
  }

  // Only OPEN items print. Sort by priority (CRITICAL first), then due date.
  const openPunch = (job.punchItems || [])
    .filter((p) => p.status !== 'DONE' && p.status !== 'CANCELED' && p.status !== 'COMPLETED')
    .sort((a, b) => {
      const pd = priorityWeight(a.priority) - priorityWeight(b.priority)
      if (pd !== 0) return pd
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      }
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return 0
    })

  // Always print at least a minimum number of rows so the installer has
  // room to write additional items in pen. 10 rows feels right for 1 page.
  const MIN_ROWS = 10
  const blanksNeeded = Math.max(0, MIN_ROWS - openPunch.length)

  const today = new Date()

  return (
    <div className="punch-print-wrap">
      <style jsx global>{`
        @page punch-list {
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
          .punch-print-wrap { page: punch-list; }
          .punch-page {
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
            page-break-after: auto;
          }
          .punch-row,
          .punch-signature-block,
          .punch-meta-grid {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }

        .punch-print-wrap {
          background: #f4f2ee;
          color: #000;
          font-family: 'JetBrains Mono', 'Consolas', ui-monospace, monospace;
          padding: 16px 0;
          min-height: 100vh;
        }
        .punch-page {
          width: 7.5in;
          margin: 0 auto;
          padding: 0;
          background: #fff;
          color: #000;
          box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        }
        .punch-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 2px solid #000;
          padding-bottom: 10pt;
          margin-bottom: 12pt;
        }
        .punch-brand {
          font-size: 9pt;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 700;
        }
        .punch-title {
          font-size: 22pt;
          font-weight: 900;
          line-height: 1.05;
          margin-top: 2pt;
        }
        .punch-job-no {
          display: inline-block;
          border: 2pt solid #000;
          padding: 4pt 10pt;
          font-size: 16pt;
          font-weight: 900;
          letter-spacing: 0.05em;
        }
        .punch-meta-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8pt 14pt;
          font-size: 10pt;
          margin-bottom: 14pt;
        }
        .punch-label {
          font-size: 8pt;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          font-weight: 700;
        }
        .punch-value {
          font-size: 11pt;
          font-weight: 700;
          margin-top: 1pt;
        }
        .punch-section-title {
          font-size: 12pt;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border-bottom: 1.5pt solid #000;
          padding-bottom: 4pt;
          margin: 14pt 0 8pt;
        }
        .punch-row {
          display: grid;
          grid-template-columns: 18pt 0.5in 1fr 0.9in;
          gap: 10pt;
          padding: 7pt 0;
          border-bottom: 1pt solid #aaa;
          font-size: 10.5pt;
          align-items: baseline;
        }
        .punch-row.blank { color: #6b6459; }
        .punch-checkbox {
          width: 14pt;
          height: 14pt;
          border: 1.5pt solid #000;
          display: inline-block;
          vertical-align: middle;
          margin-top: 2pt;
        }
        .punch-priority {
          font-size: 9pt;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .punch-priority.critical { color: #5f2015; }
        .punch-priority.high { color: #865415; }
        .punch-priority.medium { color: #0e0d0b; }
        .punch-priority.low { color: #6b6459; }
        .punch-item-title { font-weight: 700; }
        .punch-item-desc { font-size: 9pt; color: #333; margin-top: 1pt; }
        .punch-item-due {
          font-size: 9pt;
          font-weight: 700;
          text-align: right;
        }
        .punch-dash-line {
          display: inline-block;
          width: 100%;
          border-bottom: 1pt dashed #000;
          height: 14pt;
          vertical-align: bottom;
        }
        .punch-signature-block {
          margin-top: 20pt;
          padding-top: 10pt;
          border-top: 2pt solid #000;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20pt;
          font-size: 10pt;
        }
        .punch-sig-line {
          border-bottom: 1.5pt solid #000;
          height: 40pt;
          margin-bottom: 4pt;
        }
        .punch-date-line {
          border-bottom: 1pt solid #000;
          display: inline-block;
          width: 1.4in;
          height: 1pt;
          vertical-align: bottom;
        }
        /* Screen-default: hide print-only. */
        .print-only { display: none; }
      `}</style>

      {/* Screen toolbar — not printed. */}
      <div
        className="print-hidden"
        style={{ maxWidth: '7.5in', margin: '0 auto 16px', display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <button
          onClick={() => window.print()}
          style={{
            padding: '8px 14px', background: '#000', color: '#fff', borderRadius: 6,
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700, border: 0, cursor: 'pointer',
          }}
        >
          Print
        </button>
        <input
          type="text"
          value={installerName}
          onChange={(e) => setInstallerName(e.target.value)}
          placeholder="Installer name (optional — pre-fills printed form)"
          style={{
            flex: 1, padding: '8px 10px', border: '1px solid #b8ae9e',
            borderRadius: 6, fontSize: 13, fontFamily: 'inherit',
          }}
        />
        <span style={{ fontSize: 12, color: '#36322d' }}>
          {openPunch.length} open item{openPunch.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="punch-page" style={{ padding: '0.5in' }}>
        <div className="punch-header">
          <div>
            <div className="punch-brand">Abel Lumber · Installer Punch List</div>
            <div className="punch-title">{job.builderName}</div>
            {job.community && (
              <div style={{ fontSize: '11pt', fontWeight: 700, marginTop: 2 }}>
                {job.community}{job.lotBlock ? ` · ${job.lotBlock}` : ''}
              </div>
            )}
            {job.jobAddress && (
              <div style={{ fontSize: '10pt', marginTop: 4 }}>{job.jobAddress}</div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="punch-job-no">{job.jobNumber}</div>
            <div style={{ fontSize: '9pt', marginTop: 6, fontWeight: 700 }}>
              Printed {today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>

        <div className="punch-meta-grid">
          <div>
            <div className="punch-label">Installer</div>
            <div className="punch-value">
              {installerName || '______________________'}
            </div>
          </div>
          <div>
            <div className="punch-label">Scheduled</div>
            <div className="punch-value">{prettyDate(job.scheduledDate)}</div>
          </div>
          <div>
            <div className="punch-label">PM</div>
            <div className="punch-value">
              {job.pm ? `${job.pm.firstName} ${job.pm.lastName}` : '—'}
            </div>
          </div>
          <div>
            <div className="punch-label">PM Phone</div>
            <div className="punch-value">{job.pm?.phone || '—'}</div>
          </div>
          {job.order && (
            <>
              <div>
                <div className="punch-label">Order</div>
                <div className="punch-value">{job.order.orderNumber}</div>
              </div>
              {job.order.poNumber && (
                <div>
                  <div className="punch-label">PO #</div>
                  <div className="punch-value">{job.order.poNumber}</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="punch-section-title">
          Open Punch Items ({openPunch.length})
        </div>

        <div>
          {openPunch.length === 0 && blanksNeeded === 0 && (
            <div style={{ fontSize: 10, padding: '8pt 0', fontStyle: 'italic', color: '#6b6459' }}>
              No open punch items recorded for this job.
            </div>
          )}

          {openPunch.map((p) => (
            <div key={p.id} className="punch-row">
              <span className="punch-checkbox" aria-hidden />
              <div className={`punch-priority ${p.priority?.toLowerCase() || 'medium'}`}>
                {(p.priority || 'MED').toUpperCase()}
              </div>
              <div>
                <div className="punch-item-title">{p.title}</div>
                {p.description && <div className="punch-item-desc">{p.description}</div>}
              </div>
              <div className="punch-item-due">
                {p.dueDate ? `Due ${prettyDate(p.dueDate)}` : ''}
              </div>
            </div>
          ))}

          {/* Blank rows — handwritten items added at jobsite. */}
          {Array.from({ length: blanksNeeded }).map((_, i) => (
            <div key={`blank-${i}`} className="punch-row blank">
              <span className="punch-checkbox" aria-hidden />
              <div>—</div>
              <div>
                <span className="punch-dash-line" />
              </div>
              <div>
                <span className="punch-dash-line" />
              </div>
            </div>
          ))}
        </div>

        {/* Signatures */}
        <div className="punch-signature-block">
          <div>
            <div className="punch-label">Customer Signature</div>
            <div className="punch-sig-line" />
            <div style={{ fontSize: '9pt' }}>
              Name: ______________________________
            </div>
            <div style={{ fontSize: '9pt', marginTop: 4 }}>
              Date: <span className="punch-date-line" />
            </div>
            <div style={{ fontSize: '8pt', marginTop: 4, color: '#36322d' }}>
              Signature confirms acknowledgement of open items.
              Sign-off of completion comes at closeout.
            </div>
          </div>
          <div>
            <div className="punch-label">Installer Signature</div>
            <div className="punch-sig-line" />
            <div style={{ fontSize: '9pt' }}>
              Name: {installerName ? installerName : '______________________________'}
            </div>
            <div style={{ fontSize: '9pt', marginTop: 4 }}>
              Date: <span className="punch-date-line" />
            </div>
            <div style={{ fontSize: '8pt', marginTop: 4, color: '#36322d' }}>
              I reviewed this list with the customer on the date above.
            </div>
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
          <span>Abel Lumber · Installer Punch List</span>
          <span>Job {job.jobNumber}</span>
        </div>
      </div>
    </div>
  )
}
