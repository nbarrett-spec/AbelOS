'use client'

import { useEffect, useState } from 'react'

const NAVY = '#1B4F72'
const ORANGE = '#E67E22'

export default function SEODashboardPage() {
  const [keywords, setKeywords] = useState<any[]>([])
  const [content, setContent] = useState<any[]>([])
  const [kwSummary, setKwSummary] = useState<any>({})
  const [contentStats, setContentStats] = useState<any>({})
  const [activeTab, setActiveTab] = useState<'keywords' | 'content'>('keywords')
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [kwRes, contentRes] = await Promise.all([
        fetch('/api/agent-hub/seo/keywords'),
        fetch('/api/agent-hub/seo/content'),
      ])
      if (kwRes.ok) {
        const d = await kwRes.json()
        setKeywords(d.data || [])
        setKwSummary(d.summary || {})
      }
      if (contentRes.ok) {
        const d = await contentRes.json()
        setContent(d.data || [])
        setContentStats(d.stats || {})
      }
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const difficultyColor = (d: number) => d >= 70 ? '#c0392b' : d >= 50 ? ORANGE : d >= 30 ? '#f39c12' : '#27ae60'
  const rankBadge = (rank: number | null) => {
    if (!rank) return <span style={{ color: '#999', fontSize: '12px' }}>—</span>
    const color = rank <= 10 ? '#27ae60' : rank <= 20 ? ORANGE : '#c0392b'
    return <span style={{ fontWeight: '600', color }}>{rank}</span>
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>Loading SEO dashboard...</div>

  return (
    <div style={{ padding: 0, minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <div style={{ backgroundColor: NAVY, color: 'white', padding: '30px 40px', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: '0 0 8px 0' }}>SEO & Content Dashboard</h1>
        <p style={{ fontSize: '14px', color: '#ccc', margin: 0 }}>Keyword rankings, content performance, and publishing pipeline</p>
      </div>

      {/* Summary Cards */}
      <div style={{ padding: '0 40px 20px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
        {[
          { label: 'Keywords Tracked', value: kwSummary.totalKeywords || 0, color: NAVY },
          { label: 'Page 1 Rankings', value: kwSummary.page1 || 0, color: '#27ae60' },
          { label: 'Page 2', value: kwSummary.page2 || 0, color: ORANGE },
          { label: 'Published Content', value: contentStats.published || 0, color: NAVY },
          { label: 'Total Page Views', value: (contentStats.totalPageViews || 0).toLocaleString(), color: '#27ae60' },
          { label: 'Conversions', value: contentStats.totalConversions || 0, color: ORANGE },
        ].map((c, i) => (
          <div key={i} style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', padding: '15px' }}>
            <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', marginBottom: '6px' }}>{c.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 40px 15px', display: 'flex', gap: '8px' }}>
        {(['keywords', 'content'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '10px 20px', borderRadius: '4px', border: '1px solid #ddd',
            backgroundColor: activeTab === t ? NAVY : 'white',
            color: activeTab === t ? 'white' : '#333',
            cursor: 'pointer', fontSize: '14px', fontWeight: '500', textTransform: 'capitalize',
          }}>
            {t === 'keywords' ? `Keywords (${keywords.length})` : `Content (${content.length})`}
          </button>
        ))}
      </div>

      {/* Keywords Table */}
      {activeTab === 'keywords' && (
        <div style={{ padding: '0 40px 20px' }}>
          <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                    {['Keyword', 'Volume', 'Difficulty', 'Rank', 'Change', 'Intent', 'Linked Content'].map(h => (
                      <th key={h} style={{ padding: '12px 10px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keywords.map(kw => (
                    <tr key={kw.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px', fontSize: '13px', fontWeight: '500' }}>{kw.keyword}</td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{kw.searchVolume?.toLocaleString()}</td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '40px', height: '6px', backgroundColor: '#eee', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${kw.difficulty}%`, height: '100%', backgroundColor: difficultyColor(kw.difficulty) }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#666' }}>{kw.difficulty}</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>{rankBadge(kw.currentRank)}</td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>
                        {kw.rankChange != null ? (
                          <span style={{ color: kw.rankChange > 0 ? '#27ae60' : kw.rankChange < 0 ? '#c0392b' : '#666', fontWeight: '500' }}>
                            {kw.rankChange > 0 ? `↑${kw.rankChange}` : kw.rankChange < 0 ? `↓${Math.abs(kw.rankChange)}` : '—'}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          padding: '2px 6px', borderRadius: '3px', fontSize: '11px', fontWeight: '500',
                          backgroundColor: kw.intent === 'COMMERCIAL' ? '#e8f5e9' : kw.intent === 'TRANSACTIONAL' ? '#fff3e0' : kw.intent === 'LOCAL' ? '#e3f2fd' : '#f5f5f5',
                          color: kw.intent === 'COMMERCIAL' ? '#2e7d32' : kw.intent === 'TRANSACTIONAL' ? '#e65100' : kw.intent === 'LOCAL' ? '#1565c0' : '#666',
                        }}>
                          {kw.intent}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '12px', color: kw.linkedContentTitle ? NAVY : '#999' }}>
                        {kw.linkedContentTitle || 'Not linked'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {keywords.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>No keywords tracked yet</div>}
          </div>
        </div>
      )}

      {/* Content Table */}
      {activeTab === 'content' && (
        <div style={{ padding: '0 40px 20px' }}>
          <div style={{ backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '2px solid #ddd' }}>
                    {['Title', 'Type', 'Status', 'Views', 'Conversions', 'Published'].map(h => (
                      <th key={h} style={{ padding: '12px 10px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#666' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {content.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px', fontSize: '13px', fontWeight: '500', color: NAVY }}>{c.title}</td>
                      <td style={{ padding: '10px', fontSize: '12px' }}>{c.contentType}</td>
                      <td style={{ padding: '10px' }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: '600',
                          backgroundColor: c.status === 'PUBLISHED' ? '#d4edda' : c.status === 'REVIEW' ? '#fff3cd' : '#f5f5f5',
                          color: c.status === 'PUBLISHED' ? '#155724' : c.status === 'REVIEW' ? '#856404' : '#666',
                        }}>
                          {c.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px', fontSize: '13px' }}>{c.pageViews.toLocaleString()}</td>
                      <td style={{ padding: '10px', fontSize: '13px', fontWeight: '500', color: c.conversions > 0 ? '#27ae60' : '#999' }}>{c.conversions}</td>
                      <td style={{ padding: '10px', fontSize: '12px', color: '#666' }}>
                        {c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {content.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: '#999' }}>No content yet. The Marketing Agent will generate content based on keyword opportunities.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
