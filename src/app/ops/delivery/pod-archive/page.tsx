'use client'

import { useEffect, useState } from 'react'
import { PageHeader, Card, Button, DataTable, EmptyState, Modal } from '@/components/ui'
import { Camera } from 'lucide-react'

// D-15 — POD Archive search

interface PodRow {
  id: string
  deliveryNumber: string
  status: string
  completedAt: string
  builderName: string | null
  orderNumber: string | null
  jobNumber: string | null
  signedBy: string | null
  photosCount: number
  hasSignature: boolean
  proof: {
    recipientName: string | null
    capturedAt: string | null
    damagedItems: string[]
    hasSignature: boolean
    photosCount: number
    signatureDataUrl?: string | null
    photos?: string[]
  } | null
}

export default function PodArchivePage() {
  const [rows, setRows] = useState<PodRow[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [withSig, setWithSig] = useState(false)
  const [selected, setSelected] = useState<PodRow | null>(null)
  const [enlargedPhoto, setEnlargedPhoto] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (withSig) params.set('withSignature', '1')
      const res = await fetch(`/api/ops/delivery/pod-archive?${params}`)
      if (res.ok) {
        const data = await res.json()
        setRows(data.deliveries || [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [withSig])

  const fmtDate = (s: string) => new Date(s).toLocaleString()

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[1600px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Delivery"
          title="POD Archive"
          description="Search proof-of-delivery records — signature, photos, damage notes, recipient."
          crumbs={[{ label: 'Ops', href: '/ops' }, { label: 'Delivery', href: '/ops/delivery' }, { label: 'POD Archive' }]}
        />

        <Card padding="md">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] uppercase font-semibold text-fg-muted">Search</label>
              <input
                type="text"
                placeholder="Delivery #, order #, builder"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                className="input w-full text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-fg-muted">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-full text-sm mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-fg-muted">To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input w-full text-sm mt-1" />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={withSig} onChange={(e) => setWithSig(e.target.checked)} />
                With signature
              </label>
              <Button size="sm" onClick={load}>Search</Button>
            </div>
          </div>
        </Card>

        {rows.length === 0 && !loading ? (
          <EmptyState icon={<Camera />} title="No PODs found" description="Try widening filters or clearing them." />
        ) : (
          <Card padding="none" className="overflow-hidden">
            <DataTable
              data={rows}
              rowKey={(r) => r.id}
              empty="No PODs."
              columns={[
                { key: 'date', header: 'Completed', cell: (r) => <span className="text-xs">{fmtDate(r.completedAt)}</span> },
                { key: 'delivery', header: 'Delivery #', cell: (r) => <span className="font-mono text-xs">{r.deliveryNumber}</span> },
                { key: 'builder', header: 'Builder', cell: (r) => r.builderName || '—' },
                { key: 'recipient', header: 'Recipient', cell: (r) => r.signedBy || '—' },
                { key: 'photos', header: 'Photos', numeric: true, cell: (r) => r.photosCount > 0 ? `📷 ${r.photosCount}` : '—' },
                { key: 'sig', header: 'Sig', cell: (r) => r.hasSignature ? '✓' : '—' },
                { key: 'action', header: '', cell: (r) => (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>View</Button>
                ) },
              ]}
            />
          </Card>
        )}

        {/* Detail modal */}
        {selected && (
          <Modal open={!!selected} onClose={() => setSelected(null)} title={`POD — ${selected.deliveryNumber}`} size="lg">
            <div className="space-y-4">
              <div className="text-sm">
                <div><strong>Builder:</strong> {selected.builderName || '—'}</div>
                <div><strong>Order:</strong> {selected.orderNumber || '—'}</div>
                <div><strong>Completed:</strong> {fmtDate(selected.completedAt)}</div>
                <div><strong>Recipient:</strong> {selected.signedBy || '—'}</div>
              </div>

              {selected.proof?.signatureDataUrl && (
                <div>
                  <div className="text-xs uppercase font-semibold text-fg-muted mb-1">Signature</div>
                  <img src={selected.proof.signatureDataUrl} alt="signature" className="border rounded max-h-32" />
                </div>
              )}

              {selected.proof?.photos && selected.proof.photos.length > 0 && (
                <div>
                  <div className="text-xs uppercase font-semibold text-fg-muted mb-1">Photos ({selected.proof.photos.length})</div>
                  <div className="grid grid-cols-3 gap-2">
                    {selected.proof.photos.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`photo ${i + 1}`}
                        className="border rounded cursor-pointer hover:opacity-80"
                        onClick={() => setEnlargedPhoto(src)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {selected.proof?.damagedItems && selected.proof.damagedItems.length > 0 && (
                <div>
                  <div className="text-xs uppercase font-semibold text-fg-muted mb-1">Damaged items</div>
                  <ul className="text-sm list-disc list-inside">
                    {selected.proof.damagedItems.map((it, i) => <li key={i}>{it}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Modal>
        )}

        {enlargedPhoto && (
          <Modal open={true} onClose={() => setEnlargedPhoto(null)} title="Photo" size="lg">
            <img src={enlargedPhoto} alt="enlarged" className="w-full" />
          </Modal>
        )}
      </div>
    </div>
  )
}
