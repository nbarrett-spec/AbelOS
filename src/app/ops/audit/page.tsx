'use client'

import { useState, useEffect, useCallback } from 'react'

interface AuditLog {
  id: string; staffId: string; staffName: string; action: string; entity: string;
  entityId: string; details: Record<string, any>; ipAddress: string; userAgent: string;
  severity: string; createdAt: string;
}

interface Stats {
  totalLogs: number; criticalCount: number; warnCount: number;
  todayCount: number; weekCount: number; uniqueUsers: number;
}

const ENTITY_OPTIONS = ['', 'Order', 'Invoice', 'Payment', 'Quote', 'Builder', 'Staff', 'Job', 'Delivery', 'Schedule', 'Product', 'Conversation', 'ScheduleChangeRequest']
const SEVERITY_OPTIONS = ['', 'INFO', 'WARN', 'CRITICAL']

const severityColors: Record<string, { bg: string; text: string; dot: string }> = {
  INFO: { bg: '#EBF5FB', text: '#3E2A1E', dot: '#3498DB' },
  WARN: { bg: '#FEF9E7', text: '#7D6608', dot: '#D9993F' },
  CRITICAL: { bg: '#FDEDEC', text: '#922B21', dot: '#E74C3C' },
}

const actionColors: Record<string, { bg: string; text: string }> = {
  CREATE: { bg: '#E8F8F5', text: '#1E8449' },
  UPDATE: { bg: '#EBF5FB', text: '#3E2A1E' },
  DELETE: { bg: '#FDEDEC', text: '#922B21' },
  APPROVE: { bg: '#E8F8F5', text: '#1E8449' },
  DENY: { bg: '#FDEDEC', text: '#922B21' },
  VOID: { bg: '#FDEDEC', text: '#922B21' },
  RESOLVE: { bg: '#E8F8F5', text: '#1E8449' },
  ESCALATE: { bg: '#FEF9E7', text: '#7D6608' },
  LOGIN: { bg: '#F4F6F7', text: '#5D6D7E' },
  RECORD_PAYMENT: { bg: '#E8F8F5', text: '#1E8449' },
  STATUS_CHANGE: { bg: '#EBF5FB', text: '#3E2A1E' },
  CANCEL: { bg: '#FEF9E7', text: '#7D6608' },
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const limit = 30

  // Filters
  const [search, setSearch] = useState('')
  const [entity, setEntity] = useState('')
  const [severity, setSeverity] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Detail modal
  const [selected, setSelected] = useState<AuditLog | null>(null)

  const fetchLogs = useCallback(async (newOffset: number = 0) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('offset', String(newOffset))
      if (search) params.set('search', search)
      if (entity) params.set('entity', entity)
      if (severity) params.set('severity', severity)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const [logsRes, statsRes] = await Promise.all([
        fetch(`/api/ops/audit?${params}`),
        fetch('/api/ops/audit?view=stats'),
      ])
      const logsData = await logsRes.json()
      const statsData = await statsRes.json()

      setLogs(logsData.logs || [])
      setTotal(logsData.total || 0)
      setOffset(newOffset)
      setStats(statsData.stats || null)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [search, entity, severity, startDate, endDate])

  useEffect(() => { fetchLogs(0) }, [search, entity, severity, startDate, endDate])

  function formatDate(d: string) {
    if (!d) return '\u2014'
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function escapeHtml(t: string): string {
    return (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  const page = Math.floor(offset / limit) + 1
  const totalPages = Math.ceil(total / limit)

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#3E2A1E', margin: 0 }}>Audit Trail</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: '14px' }}>
            Every data change tracked with who, what, when, and why
          </p>
        </div>
        <button onClick={() => fetchLogs(offset)} style={{ background: '#3E2A1E', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '14px' }}>
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          {[
            { label: 'Total Events', value: stats.totalLogs, color: '#3E2A1E', icon: '\uD83D\uDCCB' },
            { label: 'Critical', value: stats.criticalCount, color: '#E74C3C', icon: '\uD83D\uDD34' },
            { label: 'Warnings', value: stats.warnCount, color: '#D9993F', icon: '\u26A0\uFE0F' },
            { label: 'Today', value: stats.todayCount, color: '#27AE60', icon: '\uD83D\uDCC5' },
            { label: 'This Week', value: stats.weekCount, color: '#8E44AD', icon: '\uD83D\uDCC6' },
            { label: 'Active Users', value: stats.uniqueUsers, color: '#2980B9', icon: '\uD83D\uDC64' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderLeft: `4px solid ${s.color}` }}>
              <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: '24px', fontWeight: '700', color: s.color, marginTop: '4px' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, action, entity..." style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
        </div>
        <div style={{ flex: '0 0 160px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>Entity</label>
          <select value={entity} onChange={e => setEntity(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}>
            <option value="">All Entities</option>
            {ENTITY_OPTIONS.filter(Boolean).map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 0 130px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>Severity</label>
          <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }}>
            <option value="">All</option>
            {SEVERITY_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 0 150px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
        </div>
        <div style={{ flex: '0 0 150px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #d1d5db', fontSize: '13px' }} />
        </div>
        <button onClick={() => { setSearch(''); setEntity(''); setSeverity(''); setStartDate(''); setEndDate('') }} style={{ padding: '8px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#374151' }}>Clear</button>
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                {['Severity', 'Timestamp', 'User', 'Action', 'Entity', 'Entity ID', 'Details', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: '600', color: '#374151', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#9ca3af' }}>No audit events found. Events will appear here as staff make changes.</td></tr>
              ) : logs.map((log, i) => {
                const sev = severityColors[log.severity] || severityColors.INFO
                const act = actionColors[log.action] || { bg: '#F4F6F7', text: '#5D6D7E' }
                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} onClick={() => setSelected(log)}>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: sev.bg, color: sev.text, padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '600' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: sev.dot, display: 'inline-block' }}></span>
                        {log.severity || 'INFO'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: '12px', whiteSpace: 'nowrap' }}>{formatDate(log.createdAt)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: '500' }}>{escapeHtml(log.staffName || log.staffId)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: act.bg, color: act.text, padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: '600' }}>{log.action}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#374151' }}>{log.entity}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '11px', color: '#6b7280' }}>{(log.entityId || '').substring(0, 12)}{(log.entityId || '').length > 12 ? '...' : ''}</td>
                    <td style={{ padding: '10px 14px', color: '#6b7280', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.details && typeof log.details === 'object' ? Object.entries(log.details).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ') : '\u2014'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={(e) => { e.stopPropagation(); setSelected(log) }} style={{ background: '#EBF5FB', color: '#3E2A1E', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>View</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: '#6b7280' }}>Showing {offset + 1}\u2013{Math.min(offset + limit, total)} of {total}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => fetchLogs(Math.max(0, offset - limit))} disabled={offset === 0} style={{ padding: '6px 14px', background: offset === 0 ? '#e5e7eb' : '#3E2A1E', color: offset === 0 ? '#9ca3af' : 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: offset === 0 ? 'default' : 'pointer' }}>\u2190 Prev</button>
              <span style={{ padding: '6px 10px', fontSize: '13px', color: '#374151' }}>Page {page} / {totalPages}</span>
              <button onClick={() => fetchLogs(offset + limit)} disabled={offset + limit >= total} style={{ padding: '6px 14px', background: offset + limit >= total ? '#e5e7eb' : '#3E2A1E', color: offset + limit >= total ? '#9ca3af' : 'white', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: offset + limit >= total ? 'default' : 'pointer' }}>Next \u2192</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', padding: '24px', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 25px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#3E2A1E', margin: 0 }}>Audit Event Detail</h2>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#6b7280' }}>{'\u00D7'}</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              {[
                { label: 'Severity', value: selected.severity || 'INFO' },
                { label: 'Timestamp', value: formatDate(selected.createdAt) },
                { label: 'User', value: selected.staffName || selected.staffId },
                { label: 'Action', value: selected.action },
                { label: 'Entity', value: selected.entity },
                { label: 'Entity ID', value: selected.entityId || '\u2014' },
                { label: 'IP Address', value: selected.ipAddress || '\u2014' },
                { label: 'User Agent', value: (selected.userAgent || '\u2014').substring(0, 60) },
              ].map((f, i) => (
                <div key={i}>
                  <div style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', marginBottom: '2px' }}>{f.label}</div>
                  <div style={{ fontSize: '14px', color: '#1f2937', wordBreak: 'break-all' }}>{f.value}</div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px' }}>Change Details</div>
              <pre style={{ background: '#f9fafb', padding: '12px', borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace', color: '#1f2937', border: '1px solid #e5e7eb', overflow: 'auto', maxHeight: '300px', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(selected.details, null, 2)}
              </pre>
            </div>
            <button onClick={() => setSelected(null)} style={{ marginTop: '16px', width: '100%', padding: '10px', background: '#3E2A1E', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
