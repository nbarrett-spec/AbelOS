'use client';

import React, { useEffect, useState } from 'react';

// ── SopQuickAccess ─────────────────────────────────────────────────
// Small portal widget that shows the top N SOPs surfaced for the
// current staff role. Backed by GET /api/ops/sops?source=files.
//
// Usage:
//   <SopQuickAccess role="DRIVER" />
//   <SopQuickAccess role="WAREHOUSE_TECH" limit={3} />
// ───────────────────────────────────────────────────────────────────

interface SopRow {
  id: string;
  title: string;
  roles: string[];
  department: string | null;
  filePath: string | null;
  fileType: string | null;
  summary: string | null;
  lastUpdatedAt: string | null;
}

interface Props {
  role?: string;
  limit?: number;
  title?: string;
  className?: string;
}

export default function SopQuickAccess({
  role,
  limit = 5,
  title = 'Standard Operating Procedures',
  className = '',
}: Props) {
  const [sops, setSops] = useState<SopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ source: 'files', limit: String(limit) });
        if (role) params.set('role', role);
        const res = await fetch(`/api/ops/sops?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!aborted) setSops(Array.isArray(data.sops) ? data.sops : []);
      } catch (e: any) {
        if (!aborted) setError(e?.message || 'Failed to load SOPs');
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [role, limit]);

  if (loading) {
    return (
      <div className={`bg-white rounded-lg p-4 shadow-sm ${className}`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
        <p className="text-xs text-gray-400">Loading SOPs…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg p-4 shadow-sm border border-red-100 ${className}`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
        <p className="text-xs text-red-600">Couldn't load SOPs ({error})</p>
      </div>
    );
  }

  if (sops.length === 0) {
    return (
      <div className={`bg-white rounded-lg p-4 shadow-sm ${className}`}>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">{title}</h3>
        <p className="text-xs text-gray-500">No SOPs assigned to your role yet.</p>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        <span className="text-[10px] uppercase tracking-wide text-gray-400">
          {sops.length} {sops.length === 1 ? 'doc' : 'docs'}
        </span>
      </div>
      <ul className="space-y-2">
        {sops.map((s) => {
          const expanded = expandedId === s.id;
          return (
            <li key={s.id} className="border border-gray-100 rounded-md">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : s.id)}
                className="w-full text-left px-3 py-2 flex items-start justify-between gap-2 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{s.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {[s.department, s.fileType].filter(Boolean).join(' • ') || 'SOP'}
                  </p>
                </div>
                <span className="text-gray-400 text-xs mt-0.5">{expanded ? '−' : '+'}</span>
              </button>
              {expanded && s.summary && (
                <div className="px-3 pb-3 pt-0">
                  <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {s.summary}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
