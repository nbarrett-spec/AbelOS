'use client'

import { useEffect, useState } from 'react'

/**
 * Print-optimized delivery manifest.
 *
 * Renders one page per driver. Mono font, big 14pt text, designed to be
 * slapped on a truck dashboard. Use Ctrl+P to print.
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

export default function ManifestPage() {
  const [data, setData] = useState<TodayResponse | null>(null)

  useEffect(() => {
    fetch('/api/ops/delivery/today')
      .then((r) => r.json())
      .then(setData)
  }, [])

  if (!data) {
    return <div className="p-8">Loading manifest…</div>
  }

  return (
    <div className="manifest-wrap">
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          .manifest-page {
            page-break-after: always;
          }
        }
        .manifest-wrap {
          background: white;
          color: black;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          padding: 0;
          margin: 0;
        }
        .manifest-page {
          padding: 1in 0.75in;
          min-height: 11in;
          border-bottom: 2px dashed #bbb;
        }
        .manifest-title {
          font-size: 28pt;
          font-weight: 900;
          letter-spacing: -0.01em;
        }
        .manifest-row {
          font-size: 14pt;
          line-height: 1.5;
          border-bottom: 1px solid #555;
          padding: 10pt 0;
        }
        .manifest-seq {
          font-size: 22pt;
          font-weight: 800;
          display: inline-block;
          width: 1.5em;
        }
      `}</style>

      <div className="no-print p-4 flex items-center gap-3 border-b bg-gray-100">
        <button
          onClick={() => window.print()}
          className="px-3 py-1.5 bg-black text-white text-sm rounded"
        >
          Print all
        </button>
        <span className="text-sm text-gray-600">
          {data.drivers.length} driver{data.drivers.length === 1 ? '' : 's'} ·{' '}
          {data.drivers.reduce((s, d) => s + d.deliveries.length, 0)} stops ·{' '}
          {new Date(data.date).toLocaleDateString('en-US')}
        </span>
      </div>

      {data.drivers.map((driver) => (
        <div className="manifest-page" key={driver.driverId ?? driver.driverName}>
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-widest">Abel Lumber · Delivery Manifest</div>
              <div className="manifest-title">{driver.driverName}</div>
              {driver.crewName && <div className="text-sm text-gray-600">{driver.crewName}</div>}
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest">Date</div>
              <div className="text-xl font-bold">
                {new Date(data.date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="text-sm">{driver.deliveries.length} stops</div>
            </div>
          </div>

          <div>
            {driver.deliveries.map((d, i) => (
              <div key={d.id} className="manifest-row">
                <div className="flex items-start gap-3">
                  <div className="manifest-seq">{i + 1}.</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">
                      {d.builderName} · {d.deliveryNumber}
                    </div>
                    <div>{d.address}</div>
                    <div className="text-sm text-gray-700 mt-1">
                      {d.orderNumber && <span>Order {d.orderNumber}</span>}
                      {d.orderTotal != null && (
                        <span> · ${Math.round(d.orderTotal).toLocaleString()}</span>
                      )}
                      {d.window && (
                        <span>
                          {' '}
                          ·{' '}
                          {new Date(d.window).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                    {d.notes && (
                      <div className="text-sm italic text-gray-600 mt-1">{d.notes}</div>
                    )}
                    {d.builderPhone && (
                      <div className="text-sm mt-1">Contact: {d.builderPhone}</div>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-sm">
                      <span>Signed:</span>
                      <span className="inline-block border-b border-black" style={{ width: '3in' }} />
                      <span className="ml-4">Time:</span>
                      <span className="inline-block border-b border-black" style={{ width: '1.2in' }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 text-xs text-gray-500">
            Driver check-in: _______________________ · Odometer start: __________ · Odometer end: __________
          </div>
        </div>
      ))}
    </div>
  )
}
