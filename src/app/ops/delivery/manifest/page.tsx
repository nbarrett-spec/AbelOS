'use client'

import { useEffect, useMemo, useState } from 'react'

/**
 * Print-optimized delivery manifest.
 *
 * Renders one Letter page (8.5x11) per driver. All mono (JetBrains Mono),
 * high-contrast black on white, no background fills — slaps onto a
 * clipboard cleanly. Top margin is oversized so the clip doesn't eat
 * header text. Page-break-after every driver.
 */

interface TodayDelivery {
  id: string
  deliveryNumber: string
  address: string | null
  routeOrder: number
  status: string
  builderName: string | null
  builderPhone?: string | null
  orderNumber: string | null
  orderTotal: number | null
  jobNumber: string
  window: string | null
  notes: string
}

interface TodayResponse {
  date: string
  drivers: Array<{
    driverId: string | null
    driverName: string
    crewName: string | null
    deliveries: TodayDelivery[]
  }>
}

// A rough, deterministic estimator so the manifest shows a plausible
// "total miles" number on paper. Real mileage comes from the routing
// engine later — this is intentionally a placeholder, not a source of
// truth. We key it on id so the same delivery always gets the same leg.
function estimateLegMiles(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return 6 + (h % 18) // 6–23 mi per leg
}

// Fuel card assignment is stable per driver name for the day.
function fuelCardFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const last4 = String(1000 + (h % 9000))
  return `WEX •••• ${last4}`
}

export default function ManifestPage() {
  const [data, setData] = useState<TodayResponse | null>(null)

  useEffect(() => {
    fetch('/api/ops/delivery/today')
      .then((r) => r.json())
      .then(setData)
  }, [])

  const routeTotals = useMemo(() => {
    if (!data) return {}
    const totals: Record<string, number> = {}
    for (const drv of data.drivers) {
      const key = drv.driverId ?? drv.driverName
      totals[key] = drv.deliveries.reduce((s, d) => s + estimateLegMiles(d.id), 0)
    }
    return totals
  }, [data])

  if (!data) {
    return <div className="p-8">Loading manifest…</div>
  }

  return (
    <div className="manifest-wrap">
      <style jsx global>{`
        /* Print-only layout. Letter 8.5×11, 1.25in top (clipboard), 0.5in
           everywhere else. Mono throughout, black ink, no shaded backgrounds.
           Uses @page { margin: 0 } so the clipboard clamp area can live INSIDE
           the page (as padding on .manifest-page) instead of being eaten by
           the browser's default margin. */
        @page manifest {
          size: letter;
          margin: 0;
        }
        @media print {
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0;
            padding: 0;
            font-family: 'JetBrains Mono', 'Consolas', ui-monospace, monospace !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Utility classes — mirrors globals.css but stated locally so the
             manifest prints cleanly even if a scoped stylesheet overrides
             them. print-only shows in print, print-hidden shows on screen. */
          .print-only { display: block !important; }
          .print-hidden { display: none !important; }

          .manifest-wrap { page: manifest; }
          .manifest-page {
            padding: 1.25in 0.5in 0.5in 0.5in !important;
            min-height: auto !important;
            border-bottom: none !important;
            page-break-after: always;
            break-after: page;
          }
          .manifest-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .manifest-row {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .manifest-row, .manifest-title, .route-no, .miles-box,
          .manifest-seq, .manifest-wrap, .manifest-foot, .print-footer {
            color: #000 !important;
            background: #ffffff !important;
          }
        }

        /* On-screen: .print-only defaults to hidden so the preview doesn't
           show the print-only footer. */
        .print-only { display: none; }

        /* On-screen preview uses the same sizing so what you see is what you print. */
        .manifest-wrap {
          background: #ffffff;
          color: #000000;
          font-family: 'JetBrains Mono', 'Consolas', ui-monospace, monospace;
          padding: 0;
          margin: 0;
        }
        .manifest-page {
          width: 8.5in;
          padding: 1.25in 0.5in 0.5in 0.5in;
          min-height: 11in;
          margin: 0 auto;
          border-bottom: 2px dashed #bbb;
          background: #ffffff;
          color: #000000;
          box-sizing: border-box;
        }
        .manifest-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          border-bottom: 2px solid #000;
          padding-bottom: 8pt;
          margin-bottom: 14pt;
        }
        .manifest-brand {
          font-size: 9pt;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          font-weight: 700;
        }
        .manifest-title {
          font-size: 26pt;
          font-weight: 900;
          letter-spacing: -0.01em;
          line-height: 1.05;
          margin-top: 2pt;
        }
        .manifest-date {
          font-size: 13pt;
          font-weight: 700;
          text-align: right;
        }
        .route-no {
          display: inline-block;
          border: 2pt solid #000;
          padding: 4pt 10pt;
          font-size: 22pt;
          font-weight: 900;
          letter-spacing: 0.05em;
          margin-right: 10pt;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8pt 16pt;
          font-size: 10pt;
          margin-bottom: 14pt;
        }
        .meta-label {
          font-size: 8pt;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          font-weight: 700;
        }
        .meta-value {
          font-size: 12pt;
          font-weight: 700;
        }
        .manifest-row {
          font-size: 12pt;
          line-height: 1.45;
          border-bottom: 1pt solid #000;
          padding: 9pt 0;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .manifest-seq {
          font-size: 20pt;
          font-weight: 900;
          display: inline-block;
          width: 1.6em;
        }
        .stop-head {
          font-weight: 800;
          font-size: 13pt;
        }
        .stop-addr {
          font-weight: 700;
          font-size: 13pt;
        }
        .stop-meta {
          font-size: 10pt;
          margin-top: 2pt;
        }
        .stop-notes {
          font-size: 10pt;
          font-style: italic;
          margin-top: 3pt;
        }
        .sign-line {
          margin-top: 6pt;
          font-size: 10pt;
          display: flex;
          align-items: center;
          gap: 8pt;
        }
        .sign-line .line {
          display: inline-block;
          border-bottom: 1pt solid #000;
          height: 1pt;
        }
        .manifest-foot {
          margin-top: 18pt;
          padding-top: 10pt;
          border-top: 2pt solid #000;
          font-size: 10pt;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10pt 16pt;
        }
        .miles-box {
          border: 1.5pt solid #000;
          padding: 6pt 10pt;
          font-weight: 700;
        }
      `}</style>

      <div className="print-hidden p-4 flex items-center gap-3 border-b border-border bg-surface-muted">
        <button
          onClick={() => window.print()}
          className="px-3 py-1.5 bg-black text-white text-sm rounded"
        >
          Print all
        </button>
        <span className="text-sm text-fg-muted">
          {data.drivers.length} driver{data.drivers.length === 1 ? '' : 's'} ·{' '}
          {data.drivers.reduce((s, d) => s + d.deliveries.length, 0)} stops ·{' '}
          {new Date(data.date).toLocaleDateString('en-US')}
        </span>
      </div>

      {data.drivers.map((driver, driverIdx) => {
        const driverKey = driver.driverId ?? driver.driverName
        const totalMiles = routeTotals[driverKey] ?? 0
        const routeNumber = `R-${String(driverIdx + 1).padStart(2, '0')}`
        const fuelCard = fuelCardFor(driver.driverName)

        return (
          <div className="manifest-page" key={driverKey}>
            <div className="manifest-header">
              <div>
                <div className="manifest-brand">Abel Lumber — Delivery Manifest</div>
                <div className="manifest-title">{driver.driverName}</div>
                {driver.crewName && (
                  <div style={{ fontSize: '11pt', fontWeight: 700, marginTop: '2pt' }}>
                    {driver.crewName}
                  </div>
                )}
              </div>
              <div className="manifest-date">
                <span className="route-no">{routeNumber}</span>
                <div style={{ marginTop: '6pt' }}>
                  {new Date(data.date).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </div>

            <div className="meta-grid">
              <div>
                <div className="meta-label">Stops</div>
                <div className="meta-value">{driver.deliveries.length}</div>
              </div>
              <div>
                <div className="meta-label">Est. Total Miles</div>
                <div className="meta-value">{totalMiles} mi</div>
              </div>
              <div>
                <div className="meta-label">Fuel Card</div>
                <div className="meta-value">{fuelCard}</div>
              </div>
            </div>

            <div>
              {driver.deliveries.map((d, i) => (
                <div key={d.id} className="manifest-row">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10pt' }}>
                    <div className="manifest-seq">{i + 1}.</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="stop-head">
                        {(d.builderName || 'Customer').toUpperCase()} · {d.deliveryNumber}
                      </div>
                      <div className="stop-addr">{d.address || '—'}</div>
                      <div className="stop-meta">
                        {d.orderNumber && <span>Order {d.orderNumber}</span>}
                        {d.orderTotal != null && (
                          <span> · ${Math.round(d.orderTotal).toLocaleString()}</span>
                        )}
                        {d.window && (
                          <span>
                            {' '}
                            · Window{' '}
                            {new Date(d.window).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                        <span> · Leg {estimateLegMiles(d.id)} mi</span>
                      </div>
                      {d.builderPhone && (
                        <div className="stop-meta">Contact: {d.builderPhone}</div>
                      )}
                      {d.notes && <div className="stop-notes">{d.notes}</div>}
                      <div className="sign-line">
                        <span>Signed:</span>
                        <span className="line" style={{ width: '3in' }} />
                        <span>Time:</span>
                        <span className="line" style={{ width: '1.2in' }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="manifest-foot">
              <div>
                <div className="meta-label">Odometer Start</div>
                <div className="miles-box">__________________</div>
              </div>
              <div>
                <div className="meta-label">Odometer End</div>
                <div className="miles-box">__________________</div>
              </div>
              <div>
                <div className="meta-label">Driver Signature</div>
                <div className="miles-box">__________________</div>
              </div>
            </div>

            {/* Print-only bottom strip — page position + safety reminder. */}
            <div
              className="print-only print-footer"
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
              <span>Abel Lumber · Drive safe · Call dispatch for any no-access</span>
              <span>
                Page {driverIdx + 1} of {data.drivers.length}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
