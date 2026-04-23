'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ────────────────────────────────────────────────────────────────────────────
// QR Tag Sheet Generator (admin)
//
// Three tabs:
//   Products – search + multi-select, generate Avery-5160 sheet
//   Bays     – paste/CSV list of bay codes
//   Pallets  – generate N random pallet IDs
//
// Layout: 30 labels per US Letter page (3 cols × 10 rows), 1" × 2.625"
// Each label: QR + code/SKU + short name.
// ────────────────────────────────────────────────────────────────────────────

// Encode helpers are duplicated inline rather than imported from
// @/lib/qr-tags to keep this file tree-shakeable on the client. They MUST
// match src/lib/qr-tags.ts.
const encodeProductTag = (sku: string) => `abel://product/${sku.trim()}`
const encodeBayTag = (code: string) => `abel://bay/${code.trim()}`
const encodePalletTag = (id: string) => `abel://pallet/${id.trim()}`
const generatePalletId = () =>
  `plt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

type Tab = 'products' | 'bays' | 'pallets'

interface ProductRow {
  id: string
  sku: string
  name: string
  category?: string | null
}

interface TagToRender {
  code: string
  title: string
  subtitle?: string
  uri: string
}

const TAP_TARGET = 48

export default function QRTagsPage() {
  const [tab, setTab] = useState<Tab>('products')

  // Product state
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<ProductRow[]>([])
  const [selected, setSelected] = useState<Map<string, ProductRow>>(new Map())
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Bay state
  const [bayText, setBayText] = useState('')

  // Pallet state
  const [palletCount, setPalletCount] = useState(30)
  const [palletIds, setPalletIds] = useState<string[]>([])

  // Print tags state
  const [tags, setTags] = useState<TagToRender[] | null>(null)
  const [tagKindForPrint, setTagKindForPrint] = useState<'product' | 'bay' | 'pallet' | null>(null)
  const [printing, setPrinting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  // ── Product search ─────────────────────────────────────────────────────
  const loadProducts = useCallback(async (q: string) => {
    try {
      setLoadingProducts(true)
      const params = new URLSearchParams({ kind: 'product', search: q })
      const res = await fetch(`/api/ops/admin/qr-tags/preview?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCandidates(Array.isArray(data.candidates) ? data.candidates : [])
    } catch (err) {
      console.error(err)
      setCandidates([])
    } finally {
      setLoadingProducts(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'products') loadProducts(search)
    }, 250)
    return () => clearTimeout(t)
  }, [search, tab, loadProducts])

  const toggleProduct = (p: ProductRow) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(p.id)) next.delete(p.id)
      else next.set(p.id, p)
      return next
    })
  }

  const clearSelection = () => setSelected(new Map())

  // ── Generate tag batch ─────────────────────────────────────────────────
  const buildProductTags = (): TagToRender[] =>
    Array.from(selected.values()).map(p => ({
      code: p.sku,
      title: p.sku,
      subtitle: p.name,
      uri: encodeProductTag(p.sku),
    }))

  const buildBayTags = (): TagToRender[] => {
    const codes = bayText
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)
    return codes.map(c => ({
      code: c,
      title: c,
      subtitle: 'BAY',
      uri: encodeBayTag(c),
    }))
  }

  const buildPalletTags = (): { tags: TagToRender[]; ids: string[] } => {
    const n = Math.max(1, Math.min(500, palletCount))
    const ids = Array.from({ length: n }).map(() => generatePalletId())
    return {
      tags: ids.map(id => ({
        code: id,
        title: id.replace(/^plt_/, '').toUpperCase(),
        subtitle: 'PALLET',
        uri: encodePalletTag(id),
      })),
      ids,
    }
  }

  const onGenerate = () => {
    setStatus(null)
    if (tab === 'products') {
      const t = buildProductTags()
      if (!t.length) {
        setStatus('Select at least one product.')
        return
      }
      setTags(t)
      setTagKindForPrint('product')
    } else if (tab === 'bays') {
      const t = buildBayTags()
      if (!t.length) {
        setStatus('Enter at least one bay code.')
        return
      }
      setTags(t)
      setTagKindForPrint('bay')
    } else {
      const { tags: t, ids } = buildPalletTags()
      setPalletIds(ids)
      setTags(t)
      setTagKindForPrint('pallet')
    }
  }

  // ── Print flow (log + browser print) ───────────────────────────────────
  const onPrint = async () => {
    if (!tags || !tags.length || !tagKindForPrint) return
    setPrinting(true)
    setStatus(null)
    try {
      const ids =
        tagKindForPrint === 'product'
          ? Array.from(selected.values()).map(p => p.id)
          : tagKindForPrint === 'pallet'
            ? palletIds
            : tags.map(t => t.code)

      await fetch('/api/ops/admin/qr-tags/log-print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: tagKindForPrint,
          count: tags.length,
          ids,
          label: `${tagKindForPrint} sheet (${tags.length})`,
        }),
      }).catch(() => {
        /* logging is best-effort — never block printing */
      })

      // Delay a tick so the render is stable before the print dialog
      await new Promise(r => setTimeout(r, 100))
      window.print()
    } finally {
      setPrinting(false)
    }
  }

  // ── Tab rendering ──────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#1a1a2e',
        color: '#fff',
        padding: '1rem',
      }}
      className="qr-tags-page"
    >
      {/* --- screen-only header --- */}
      <div className="no-print">
        <div style={{ marginBottom: '1rem' }}>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', margin: 0 }}>
            QR Tag Sheets
          </h1>
          <p style={{ color: '#aaa', margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>
            Generate Avery-5160 compatible sheets (30 labels per page). All prints are
            logged to the audit trail.
          </p>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            borderBottom: '2px solid #333',
            marginBottom: '1rem',
            flexWrap: 'wrap',
          }}
        >
          {(['products', 'bays', 'pallets'] as Tab[]).map(t => {
            const isActive = t === tab
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t)
                  setTags(null)
                  setStatus(null)
                }}
                style={{
                  minHeight: TAP_TARGET,
                  padding: '0.75rem 1.25rem',
                  backgroundColor: isActive ? '#C6A24E' : 'transparent',
                  color: isActive ? '#1a1a2e' : '#fff',
                  border: 'none',
                  borderBottom: isActive ? '3px solid #C6A24E' : '3px solid transparent',
                  borderRadius: '0.5rem 0.5rem 0 0',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>

        {/* Tab bodies */}
        {tab === 'products' && (
          <ProductsTab
            search={search}
            setSearch={setSearch}
            candidates={candidates}
            selected={selected}
            toggleProduct={toggleProduct}
            clearSelection={clearSelection}
            loading={loadingProducts}
          />
        )}

        {tab === 'bays' && <BaysTab value={bayText} setValue={setBayText} />}

        {tab === 'pallets' && (
          <PalletsTab count={palletCount} setCount={setPalletCount} />
        )}

        {/* Action bar */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            marginTop: '1.25rem',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onGenerate}
            style={{
              minHeight: TAP_TARGET,
              padding: '0.75rem 1.25rem',
              backgroundColor: '#C6A24E',
              color: '#1a1a2e',
              border: 'none',
              borderRadius: '0.5rem',
              fontSize: '1rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Generate tag sheet
          </button>
          {tags && tags.length > 0 && (
            <button
              type="button"
              onClick={onPrint}
              disabled={printing}
              style={{
                minHeight: TAP_TARGET,
                padding: '0.75rem 1.25rem',
                backgroundColor: '#27AE60',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: 'bold',
                cursor: printing ? 'wait' : 'pointer',
                opacity: printing ? 0.7 : 1,
              }}
            >
              {printing ? 'Logging...' : `Print ${tags.length} label${tags.length === 1 ? '' : 's'}`}
            </button>
          )}
          {tags && (
            <button
              type="button"
              onClick={() => {
                setTags(null)
                setTagKindForPrint(null)
              }}
              style={{
                minHeight: TAP_TARGET,
                padding: '0.75rem 1.25rem',
                backgroundColor: 'transparent',
                color: '#fff',
                border: '2px solid #444',
                borderRadius: '0.5rem',
                fontSize: '1rem',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              Clear preview
            </button>
          )}
        </div>

        {status && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem 1rem',
              backgroundColor: 'rgba(231, 76, 60, 0.15)',
              border: '1px solid #E74C3C',
              borderRadius: '0.5rem',
              color: '#FF9B9B',
              fontSize: '0.9rem',
            }}
          >
            {status}
          </div>
        )}
      </div>

      {/* Printable area — appears both on screen (preview) and on the
          printed sheet. */}
      {tags && tags.length > 0 && (
        <div className="tag-sheet" aria-label="Tag sheet preview">
          {tags.map((t, i) => (
            <LabelCell key={`${t.code}-${i}`} tag={t} />
          ))}
        </div>
      )}

      {/* Print + layout styles — Avery 5160 (3 × 10 @ US Letter) */}
      <style jsx global>{`
        .tag-sheet {
          display: grid;
          grid-template-columns: repeat(3, 2.625in);
          grid-auto-rows: 1in;
          column-gap: 0.156in;
          row-gap: 0in;
          background: #fff;
          color: #000;
          padding: 0.5in 0.1875in;
          width: 8.5in;
          box-sizing: border-box;
          margin: 1.25rem auto 0 auto;
          border: 1px solid #333;
          border-radius: 0.25rem;
        }
        .tag-cell {
          width: 2.625in;
          height: 1in;
          box-sizing: border-box;
          padding: 0.08in 0.1in;
          display: flex;
          gap: 0.1in;
          align-items: center;
          overflow: hidden;
        }
        .tag-cell__qr {
          flex: 0 0 0.84in;
          width: 0.84in;
          height: 0.84in;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .tag-cell__qr canvas,
        .tag-cell__qr svg {
          width: 100% !important;
          height: 100% !important;
        }
        .tag-cell__meta {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 1px;
        }
        .tag-cell__title {
          font-family: 'Courier New', monospace;
          font-size: 11pt;
          font-weight: bold;
          line-height: 1.1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #000;
        }
        .tag-cell__sub {
          font-family: Arial, sans-serif;
          font-size: 7.25pt;
          line-height: 1.1;
          color: #000;
          max-height: 2.4em;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .tag-cell__brand {
          font-family: Arial, sans-serif;
          font-size: 6pt;
          color: #555;
        }
        @media print {
          @page {
            size: letter;
            margin: 0;
          }
          body {
            margin: 0;
            background: #fff !important;
          }
          .no-print {
            display: none !important;
          }
          .qr-tags-page {
            background: #fff !important;
            color: #000 !important;
            padding: 0 !important;
            min-height: 0 !important;
          }
          .tag-sheet {
            margin: 0 !important;
            border: none !important;
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  )
}

// ─── Tabs ───────────────────────────────────────────────────────────────
function ProductsTab({
  search,
  setSearch,
  candidates,
  selected,
  toggleProduct,
  clearSelection,
  loading,
}: {
  search: string
  setSearch: (v: string) => void
  candidates: ProductRow[]
  selected: Map<string, ProductRow>
  toggleProduct: (p: ProductRow) => void
  clearSelection: () => void
  loading: boolean
}) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search SKU or name..."
          style={{
            flex: '1 1 260px',
            minHeight: TAP_TARGET,
            padding: '0.75rem 1rem',
            fontSize: '1rem',
            backgroundColor: '#2a2a3e',
            border: '1px solid #444',
            borderRadius: '0.5rem',
            color: '#fff',
          }}
          autoComplete="off"
        />
        <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
          {selected.size} selected
        </div>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearSelection}
            style={{
              minHeight: TAP_TARGET,
              padding: '0.5rem 1rem',
              backgroundColor: 'transparent',
              color: '#C6A24E',
              border: '1px solid #444',
              borderRadius: '0.5rem',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Clear selection
          </button>
        )}
      </div>

      <div
        style={{
          marginTop: '0.75rem',
          maxHeight: 360,
          overflowY: 'auto',
          border: '1px solid #333',
          borderRadius: '0.5rem',
        }}
      >
        {loading ? (
          <div style={{ padding: '1rem', color: '#ccc' }}>Loading products...</div>
        ) : candidates.length === 0 ? (
          <div style={{ padding: '1rem', color: '#ccc' }}>
            {search ? 'No products match.' : 'Type to search products.'}
          </div>
        ) : (
          candidates.map(p => {
            const isSel = selected.has(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleProduct(p)}
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  alignItems: 'center',
                  width: '100%',
                  padding: '0.6rem 0.9rem',
                  backgroundColor: isSel ? '#2a3a2e' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid #2a2a3e',
                  color: '#fff',
                  fontSize: '0.95rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  minHeight: TAP_TARGET,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: `2px solid ${isSel ? '#27AE60' : '#666'}`,
                    backgroundColor: isSel ? '#27AE60' : 'transparent',
                    flexShrink: 0,
                    fontSize: 14,
                    fontWeight: 'bold',
                    color: '#1a1a2e',
                  }}
                >
                  {isSel ? 'x' : ''}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#C6A24E', minWidth: 120 }}>
                  {p.sku}
                </span>
                <span style={{ flex: 1, color: '#eee' }}>{p.name}</span>
                {p.category && (
                  <span style={{ color: '#999', fontSize: '0.8rem' }}>{p.category}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function BaysTab({ value, setValue }: { value: string; setValue: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)

  const importCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      // strip header row if it looks non-numeric
      const lines = text.split(/\r?\n/).filter(Boolean)
      setValue(lines.join('\n'))
    }
    reader.readAsText(f)
  }

  return (
    <div>
      <p style={{ color: '#ccc', marginBottom: '0.5rem' }}>
        Enter bay codes — one per line, or comma-separated. Or import a CSV.
      </p>
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={8}
        placeholder={'A-01-01\nA-01-02\nB-02-03\n...'}
        style={{
          width: '100%',
          padding: '0.75rem',
          fontFamily: 'monospace',
          fontSize: '0.95rem',
          backgroundColor: '#2a2a3e',
          border: '1px solid #444',
          borderRadius: '0.5rem',
          color: '#fff',
          minHeight: 180,
          resize: 'vertical',
        }}
      />
      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: 'none' }}
          onChange={importCsv}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            minHeight: TAP_TARGET,
            padding: '0.5rem 1rem',
            backgroundColor: 'transparent',
            color: '#C6A24E',
            border: '1px solid #444',
            borderRadius: '0.5rem',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Import CSV
        </button>
      </div>
    </div>
  )
}

function PalletsTab({ count, setCount }: { count: number; setCount: (n: number) => void }) {
  return (
    <div>
      <p style={{ color: '#ccc', marginBottom: '0.5rem' }}>
        Generate N pallet tags with unique one-time-use IDs. Pallet IDs are not persisted — the
        audit log records how many were printed and who printed them.
      </p>
      <label
        style={{
          display: 'block',
          color: '#ccc',
          fontSize: '0.85rem',
          marginBottom: '0.25rem',
          fontWeight: 'bold',
          textTransform: 'uppercase',
        }}
      >
        How many pallet tags?
      </label>
      <input
        type="number"
        value={count}
        min={1}
        max={500}
        onChange={e => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
        style={{
          width: 140,
          minHeight: TAP_TARGET,
          padding: '0.5rem 0.75rem',
          fontSize: '1rem',
          backgroundColor: '#2a2a3e',
          border: '1px solid #444',
          borderRadius: '0.5rem',
          color: '#fff',
          fontWeight: 'bold',
          textAlign: 'center',
        }}
      />
      <div style={{ marginTop: '0.5rem', color: '#888', fontSize: '0.85rem' }}>
        Max 500 per batch. One sheet = 30 tags.
      </div>
    </div>
  )
}

// ─── Label cell (client-side QR render) ─────────────────────────────────
function LabelCell({ tag }: { tag: TagToRender }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mod: any = await import('qrcode')
        const QR = mod.default ?? mod
        if (cancelled || !canvasRef.current) return
        await QR.toCanvas(canvasRef.current, tag.uri, {
          errorCorrectionLevel: 'M',
          margin: 0,
          width: 220, // retina-grade for 0.84in @ ~300dpi
          color: { dark: '#000000', light: '#FFFFFF' },
        })
      } catch (e) {
        // fallback: leave canvas blank
        console.error('QR render failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tag.uri])

  return (
    <div className="tag-cell">
      <div className="tag-cell__qr">
        <canvas ref={canvasRef} />
      </div>
      <div className="tag-cell__meta">
        <div className="tag-cell__title">{tag.title}</div>
        {tag.subtitle && <div className="tag-cell__sub">{tag.subtitle}</div>}
        <div className="tag-cell__brand">abel</div>
      </div>
    </div>
  )
}
