'use client'

import { useState, useEffect } from 'react'
import { TrendingUp } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

const TYPE_LABELS: Record<string, string> = {
  CROSS_SELL: 'Cross-Sell',
  VOLUME_UPGRADE: 'Volume Upgrade',
  WIN_BACK: 'Win-Back',
  PRICING_OPT: 'Pricing Optimization',
  NEW_NURTURE: 'New Builder Nurture',
}

const TYPE_COLORS: Record<string, string> = {
  CROSS_SELL: '#8e44ad',
  VOLUME_UPGRADE: '#27ae60',
  WIN_BACK: '#e74c3c',
  PRICING_OPT: '#f39c12',
  NEW_NURTURE: '#3498db',
}

const EFFORT_COLORS: Record<string, string> = {
  LOW: '#27ae60',
  MEDIUM: '#C6A24E',
  HIGH: '#e74c3c',
}

function KPICard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '18px 22px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color || '#0f2a3e'}` }}>
      <div className="text-xs text-fg-muted mb-1">{label}</div>
      <div className="text-2xl font-semibold" style={{ color: color || '#0f2a3e' }}>{value}</div>
    </div>
  )
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className="inline-block text-[12px] font-semibold" style={{ padding: '3px 12px', borderRadius: 12, background: color + '22', color, border: `1px solid ${color}44` }}>
      {text}
    </span>
  )
}

interface Opportunity {
  id: string
  type: string
  title: string
  description: string
  builderName?: string
  productName?: string
  estimatedImpact: number
  effort: string
  priority: number
}

export default function GrowthOpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [filteredOps, setFilteredOps] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('ALL')
  const [filterEffort, setFilterEffort] = useState('ALL')
  const [searchText, setSearchText] = useState('')
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  // Fetch opportunities
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/ops/growth')
      .then(r => {
        if (!r.ok) {
          throw new Error(`API error: ${r.statusText}`)
        }
        return r.json()
      })
      .then(d => {
        setOpportunities(d.opportunities || [])
        setLoading(false)
      })
      .catch(e => {
        console.error('Failed to load opportunities:', e)
        setError(String(e))
        setLoading(false)
      })
  }, [])

  // Apply filters
  useEffect(() => {
    let filtered = opportunities
    if (filterType !== 'ALL') {
      filtered = filtered.filter(o => o.type === filterType)
    }
    if (filterEffort !== 'ALL') {
      filtered = filtered.filter(o => o.effort === filterEffort)
    }
    if (searchText) {
      const lower = searchText.toLowerCase()
      filtered = filtered.filter(o => o.title.toLowerCase().includes(lower) || o.description.toLowerCase().includes(lower) || (o.builderName && o.builderName.toLowerCase().includes(lower)) || (o.productName && o.productName.toLowerCase().includes(lower)))
    }
    setFilteredOps(filtered)
  }, [opportunities, filterType, filterEffort, searchText])

  // Handle approval
  const handleApprove = async (opp: Opportunity) => {
    try {
      const res = await fetch('/api/ops/growth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          opportunityId: opp.id,
          opportunityType: opp.type,
          title: opp.title,
          description: opp.description,
          builderName: opp.builderName,
          builderIdForTask: opp.id.split('_')[1],
          estimatedImpact: opp.estimatedImpact,
          priority: opp.priority > 75 ? 'HIGH' : opp.priority > 50 ? 'MEDIUM' : 'LOW',
        }),
      })
      if (res.ok) {
        setApprovedIds(prev => new Set([...prev, opp.id]))
      }
    } catch (e) {
      console.error('Failed to approve opportunity:', e)
    }
  }

  // Handle dismiss
  const handleDismiss = async (opp: Opportunity) => {
    try {
      const res = await fetch('/api/ops/growth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dismiss',
          opportunityId: opp.id,
        }),
      })
      if (res.ok) {
        setDismissedIds(prev => new Set([...prev, opp.id]))
      }
    } catch (e) {
      console.error('Failed to dismiss opportunity:', e)
    }
  }

  // Summary counts by type
  const summaryByType: Record<string, number> = {}
  opportunities.forEach(o => {
    summaryByType[o.type] = (summaryByType[o.type] || 0) + 1
  })

  const totalOpportunities = opportunities.length
  const totalImpact = opportunities.reduce((sum, o) => sum + (o.estimatedImpact || 0), 0)

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400 }}>
      <PageHeader
        title="Growth Opportunities"
        description="Revenue expansion signals from live data — cross-sell, volume growth, win-back, pricing, and new account activation"
      />

      {error && (
        <div style={{ background: '#fee', border: '1px solid #fcc', borderRadius: 10, padding: 16, marginBottom: 24, color: '#c00' }}>
          <p className="font-semibold">Error Loading Opportunities</p>
          <p className="text-[13px] mt-1">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <KPICard label="Total Opportunities" value={totalOpportunities} color="#0f2a3e" />
        <KPICard label="Combined Impact" value={`$${(totalImpact / 1000).toFixed(0)}K`} color="#27ae60" />
        <KPICard label="Cross-Sell Opps" value={summaryByType['CROSS_SELL'] || 0} color={TYPE_COLORS.CROSS_SELL} />
        <KPICard label="Volume Upgrades" value={summaryByType['VOLUME_UPGRADE'] || 0} color={TYPE_COLORS.VOLUME_UPGRADE} />
      </div>

      {/* Filters */}
      <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, alignItems: 'end' }}>
          {/* Type Filter */}
          <div>
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">Type</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full text-[13px]" style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}>
              <option value="ALL">All Types</option>
              <option value="CROSS_SELL">Cross-Sell</option>
              <option value="VOLUME_UPGRADE">Volume Upgrade</option>
              <option value="WIN_BACK">Win-Back</option>
              <option value="PRICING_OPT">Pricing Optimization</option>
              <option value="NEW_NURTURE">New Builder Nurture</option>
            </select>
          </div>

          {/* Effort Filter */}
          <div>
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">Effort</label>
            <select value={filterEffort} onChange={e => setFilterEffort(e.target.value)} className="w-full text-[13px]" style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}>
              <option value="ALL">All Efforts</option>
              <option value="LOW">Low Effort</option>
              <option value="MEDIUM">Medium Effort</option>
              <option value="HIGH">High Effort</option>
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs font-semibold text-fg-muted mb-1.5">Search</label>
            <input type="text" placeholder="Search by builder, product, or title..." value={searchText} onChange={e => setSearchText(e.target.value)} className="w-full text-[13px]" style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }} />
          </div>
        </div>
      </div>

      {/* Opportunities List */}
      {loading ? (
        <div className="text-center py-16 text-fg-subtle">Loading opportunities...</div>
      ) : filteredOps.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="w-8 h-8 text-fg-subtle" />}
          title="No growth opportunities"
          description="No opportunities match your filters."
        />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filteredOps.filter(opp => !dismissedIds.has(opp.id)).map(opp => (
            <OpportunityCard key={opp.id} opportunity={opp} isApproved={approvedIds.has(opp.id)} onApprove={() => handleApprove(opp)} onDismiss={() => handleDismiss(opp)} />
          ))}
        </div>
      )}
    </div>
  )
}

function OpportunityCard({ opportunity, isApproved, onApprove, onDismiss }: { opportunity: Opportunity; isApproved: boolean; onApprove: () => void; onDismiss: () => void }) {
  const color = TYPE_COLORS[opportunity.type] || '#999'
  const effortColor = EFFORT_COLORS[opportunity.effort] || '#999'

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #f0f0f0', display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'start' }}>
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
          <Badge text={TYPE_LABELS[opportunity.type] || opportunity.type} color={color} />
          <Badge text={opportunity.effort} color={effortColor} />
        </div>

        <h3 className="text-base font-semibold mb-2" style={{ color: '#0f2a3e' }}>{opportunity.title}</h3>

        <p className="text-[13px] text-fg-muted mb-3 leading-relaxed">{opportunity.description}</p>

        {/* Entity Info */}
        {(opportunity.builderName || opportunity.productName) && (
          <div className="text-xs text-fg-subtle mb-3">
            {opportunity.builderName && <span>Builder: <strong>{opportunity.builderName}</strong></span>}
            {opportunity.productName && <span>Product: <strong>{opportunity.productName}</strong></span>}
          </div>
        )}

        {/* Impact */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div>
            <div className="text-[11px] text-fg-subtle mb-1">Estimated Impact</div>
            <div className="text-lg font-semibold" style={{ color: '#27ae60' }}>${(opportunity.estimatedImpact / 1000).toFixed(0)}K</div>
          </div>
          <div>
            <div className="text-[11px] text-fg-subtle mb-1">Priority Score</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${opportunity.priority}%`, height: '100%', background: color, borderRadius: 3 }} />
              </div>
              <span className="text-[13px] font-semibold" style={{ color, minWidth: 32 }}>{opportunity.priority}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 140 }}>
        {isApproved ? (
          <div className="text-[13px] font-semibold text-center" style={{ padding: '12px 16px', background: '#27ae60', color: '#fff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <span>✓</span>
            Approved
          </div>
        ) : (
          <>
            <button onClick={onApprove} className="text-[13px] font-semibold cursor-pointer" style={{ padding: '10px 16px', background: '#0f2a3e', color: '#fff', borderRadius: 6, border: 'none' }}>
              Approve
            </button>
            <button onClick={onDismiss} className="text-[13px] font-semibold cursor-pointer text-fg-muted" style={{ padding: '10px 16px', background: '#f5f5f5', borderRadius: 6, border: '1px solid #ddd' }}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  )
}
