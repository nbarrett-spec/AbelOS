'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

const NAVY = '#0f2a3e'
const ORANGE = '#C6A24E'

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

  const difficultyColor = (d: number) => d >= 70 ? '#c0392b' : d >= 50 ? ORANGE : d >= 30 ? '#D4B96A' : '#27ae60'
  const rankBadge = (rank: number | null) => {
    if (!rank) return <span style={{ color: '#999', fontSize: '12px' }}>—</span>
    const color = rank <= 10 ? '#27ae60' : rank <= 20 ? ORANGE : '#c0392b'
    return <span style={{ fontWeight: '600', color }}>{rank}</span>
  }

  if (loading) return <div className="text-center py-10 text-fg-muted">Loading SEO dashboard...</div>

  return (
    <div style={{ padding: 0, minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <div style={{ backgroundColor: NAVY, color: 'white', padding: '30px 40px', marginBottom: '20px' }}>
        <h1 className="text-2xl font-semibold" style={{ margin: '0 0 8px 0' }}>SEO & Content Dashboard</h1>
        <p className="text-sm" style={{ color: '#ccc', margin: 0 }}>Keyword rankings, content performance, and publishing pipeline</p>
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
            <div className="text-[11px] text-fg-muted uppercase mb-1.5">{c.label}</div>
            <div className="text-xl font-semibold" style={{ color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 40px 15px', display: 'flex', gap: '8px' }}>
        {(['keywords', 'content'] as const).map(t => (
          <button key={t} onClick={() => setActiveTab(t)} className="text-sm font-medium capitalize cursor-pointer" style={{
            padding: '10px 20px', borderRadius: '4px', border: '1px solid #ddd',
            backgroundColor: activeTab === t ? NAVY : 'white',
            color: activeTab === t ? 'white' : '#333',
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
                      <th key={h} className="text-xs font-semibold text-fg-muted" style={{ padding: '12px 10px', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keywords.map(kw => (
                    <tr key={kw.id} className="hover:bg-row-hover" style={{ borderBottom: '1px solid #eee' }}>
                      <td className="text-[13px] font-medium" style={{ padding: '10px' }}>{kw.keyword}</td>
                      <td className="text-[13px]" style={{ padding: '10px' }}>{kw.searchVolume?.toLocaleString()}</td>
                      <td style={{ padding: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '40px', height: '6px', backgroundColor: '#eee', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${kw.difficulty}%`, height: '100%', backgroundColor: difficultyColor(kw.difficulty) }} />
                          </div>
                          <span className="text-xs text-fg-muted">{kw.difficulty}</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>{rankBadge(kw.currentRank)}</td>
                      <td className="text-[13px]" style={{ padding: '10px' }}>
                        {kw.rankChange != null ? (
                          <span className="font-medium" style={{ color: kw.rankChange > 0 ? '#27ae60' : kw.rankChange < 0 ? '#c0392b' : '#666' }}>
                            {kw.rankChange > 0 ? `↑${kw.rankChange}` : kw.rankChange < 0 ? `↓${Math.abs(kw.rankChange)}` : '—'}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <span className="text-[11px] font-medium" style={{
                          padding: '2px 6px', borderRadius: '3px',
                          backgroundColor: kw.intent === 'COMMERCIAL' ? '#e8f5e9' : kw.intent === 'TRANSACTIONAL' ? '#fff3e0' : kw.intent === 'LOCAL' ? '#e3f2fd' : '#f5f5f5',
                          color: kw.intent === 'COMMERCIAL' ? '#2e7d32' : kw.intent === 'TRANSACTIONAL' ? '#e65100' : kw.intent === 'LOCAL' ? '#1565c0' : '#666',
                        }}>
                          {kw.intent}
                        </span>
                      </td>
                      <td className="text-xs" style={{ padding: '10px', color: kw.linkedContentTitle ? NAVY : '#999' }}>
                        {kw.linkedContentTitle || 'Not linked'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {keywords.length === 0 && (
              <EmptyState
                icon={<Search className="w-8 h-8 text-fg-subtle" />}
                title="No keywords tracked yet"
                description="Track keywords to monitor your search rankings and traffic."
              />
            )}
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
                      <th key={h} className="text-xs font-semibold text-fg-muted" style={{ padding: '12px 10px', textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {content.map(c => (
                    <tr key={c.id} className="hover:bg-row-hover" style={{ borderBottom: '1px solid #eee' }}>
                      <td className="text-[13px] font-medium" style={{ padding: '10px', color: NAVY }}>{c.title}</td>
                      <td className="text-xs" style={{ padding: '10px' }}>{c.contentType}</td>
                      <td style={{ padding: '10px' }}>
                        <span className="text-[11px] font-semibold" style={{
                          padding: '3px 8px', borderRadius: '3px',
                          backgroundColor: c.status === 'PUBLISHED' ? '#d4edda' : c.status === 'REVIEW' ? '#fff3cd' : '#f5f5f5',
                          color: c.status === 'PUBLISHED' ? '#155724' : c.status === 'REVIEW' ? '#856404' : '#666',
                        }}>
                          {c.status}
                        </span>
                      </td>
                      <td className="text-[13px]" style={{ padding: '10px' }}>{c.pageViews.toLocaleString()}</td>
                      <td className="text-[13px] font-medium" style={{ padding: '10px', color: c.conversions > 0 ? '#27ae60' : '#999' }}>{c.conversions}</td>
                      <td className="text-xs text-fg-muted" style={{ padding: '10px' }}>
                        {c.publishedAt ? new Date(c.publishedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {content.length === 0 && (
              <EmptyState
                icon={<Search className="w-8 h-8 text-fg-subtle" />}
                title="No content yet"
                description="The Marketing Agent will generate content based on keyword opportunities."
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
