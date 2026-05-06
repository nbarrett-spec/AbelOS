'use client';

// A-BIZ-9 — Pending price-change review queue.
//
// Lists PriceChangeRequest rows in PENDING by default with quick toggle
// to show APPROVED / REJECTED for audit. Approve applies the suggested
// price (or an override). Reject requires a reason.

import { useEffect, useState } from 'react';

interface ChangeRow {
  id: string;
  productId: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  oldCost: number;
  newCost: number;
  oldPrice: number;
  suggestedPrice: number;
  marginPct: number;
  costDeltaPct: number;
  priceDeltaPct: number;
  status: string;
  triggerSource: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  notes: string | null;
  createdAt: string;
}

function fmtCurrency(v: number | null | undefined) {
  if (v == null || isNaN(v)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
}

function fmtPct(v: number | null | undefined) {
  if (v == null || isNaN(v)) return '0%';
  return `${Number(v).toFixed(1)}%`;
}

function fmtDelta(v: number) {
  if (v == null || isNaN(v)) return '—';
  const s = Number(v).toFixed(1);
  if (Number(v) > 0) return `+${s}%`;
  return `${s}%`;
}

const STATUS_TABS: { id: string; label: string }[] = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
];

export default function PriceChangeReviewPage() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const load = async (s: typeof status) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ops/pricing/changes?status=${s}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.items || []);
      } else {
        setRows([]);
      }
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(status);
  }, [status]);

  const onApprove = async (row: ChangeRow) => {
    setBusyId(row.id);
    try {
      const overrideRaw = overrides[row.id];
      const overridePrice = overrideRaw ? parseFloat(overrideRaw) : undefined;
      const body: any = {};
      if (overridePrice && overridePrice > 0) body.overridePrice = overridePrice;
      const res = await fetch(`/api/ops/pricing/changes/${row.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Approve failed: ${j.error || res.statusText}`);
      } else {
        await load(status);
      }
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (row: ChangeRow) => {
    const reason = window.prompt('Reason for rejecting this price change?');
    if (!reason || !reason.trim()) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/ops/pricing/changes/${row.id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Reject failed: ${j.error || res.statusText}`);
      } else {
        await load(status);
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-surface text-fg px-8 py-8">
        <h1 className="text-3xl font-semibold">Pending Price Changes</h1>
        <p className="text-fg-muted mt-2">
          Vendor cost movements queued for review. Approve to push the suggested price to the catalog,
          reject to keep the old price.
        </p>
      </div>

      <div className="bg-white border-b border-gray-200 px-8">
        <div className="flex gap-1 -mb-px">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setStatus(t.id as any)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                status === t.id
                  ? 'border-signal text-signal'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto self-center text-sm text-gray-500">
            {loading ? 'Loading…' : `${rows.length} item${rows.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center text-gray-500">
            No {status.toLowerCase()} price-change requests.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['SKU', 'Product', 'Old → New Cost', 'Cost Δ', 'Old Price', 'Suggested Price', 'Price Δ', 'Margin', 'Source', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-900 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-row-hover">
                      <td className="px-4 py-2 text-sm font-mono">{r.sku || '—'}</td>
                      <td className="px-4 py-2 text-sm">
                        <div className="font-medium">{r.name || r.productId}</div>
                        <div className="text-xs text-gray-500">{r.category || ''}</div>
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {fmtCurrency(r.oldCost)} → {fmtCurrency(r.newCost)}
                      </td>
                      <td className={`px-4 py-2 text-sm font-medium ${r.costDeltaPct > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {fmtDelta(r.costDeltaPct)}
                      </td>
                      <td className="px-4 py-2 text-sm">{fmtCurrency(r.oldPrice)}</td>
                      <td className="px-4 py-2 text-sm">
                        {status === 'PENDING' ? (
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={r.suggestedPrice.toFixed(2)}
                            onChange={(e) => setOverrides((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                          />
                        ) : (
                          <span className="font-mono">{fmtCurrency(r.suggestedPrice)}</span>
                        )}
                      </td>
                      <td className={`px-4 py-2 text-sm font-medium ${r.priceDeltaPct > 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                        {fmtDelta(r.priceDeltaPct)}
                      </td>
                      <td className="px-4 py-2 text-sm">{fmtPct(r.marginPct)}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{r.triggerSource || '—'}</td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {status === 'PENDING' ? (
                          <div className="flex gap-2">
                            <button
                              disabled={busyId === r.id}
                              onClick={() => onApprove(r)}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs rounded"
                            >
                              Approve
                            </button>
                            <button
                              disabled={busyId === r.id}
                              onClick={() => onReject(r)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-xs rounded"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">
                            {r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString() : '—'}
                            {r.notes ? <div className="italic mt-0.5">{r.notes}</div> : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
