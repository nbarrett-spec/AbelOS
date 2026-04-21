'use client'

import { useState, useEffect } from 'react'

interface Contract {
  id: string
  contractNumber: string
  title: string
  description?: string
  paymentTerm: string
  discountPercent: number
  rebatePercent: number
  status: string
  effectiveDate?: string
  expirationDate?: string
  organization: { id: string; name: string; code: string }
  pricingTiers: PricingTier[]
}

interface PricingTier {
  id: string
  category: string
  subcategory?: string
  priceType: string
  fixedPrice?: number
  discountPct?: number
  costPlusPct?: number
  description?: string
}

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: '#6B7280', bg: '#F3F4F6' },
  PENDING_REVIEW: { color: '#F59E0B', bg: '#FFFBEB' },
  ACTIVE: { color: '#10B981', bg: '#ECFDF5' },
  EXPIRED: { color: '#EF4444', bg: '#FEF2F2' },
  TERMINATED: { color: '#DC2626', bg: '#FEF2F2' },
  RENEWED: { color: '#3B82F6', bg: '#EFF6FF' },
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetchContracts()
  }, [])

  async function fetchContracts() {
    try {
      const res = await fetch('/api/ops/contracts')
      const data = await res.json()
      setContracts(data.contracts || [])
    } catch (err) {
      console.error('Failed to fetch contracts:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1f2937' }}>Contracts & Pricing</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            Builder pricing contracts with volume discounts, rebates, and category-level pricing tiers
          </p>
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>Loading contracts...</p>
      ) : contracts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <p style={{ fontSize: 48 }}>📝</p>
          <p style={{ fontSize: 16, marginTop: 8 }}>No contracts yet</p>
          <p style={{ fontSize: 13 }}>Create contracts from the Organizations page</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {contracts.map(contract => {
            const statusCfg = STATUS_COLORS[contract.status] || STATUS_COLORS.DRAFT
            const isExpanded = expanded === contract.id

            return (
              <div key={contract.id} style={{
                padding: 20,
                backgroundColor: 'white',
                borderRadius: 12,
                border: '1px solid #e5e7eb',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ cursor: 'pointer' }} onClick={() => setExpanded(isExpanded ? null : contract.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af' }}>{contract.contractNumber}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 12,
                        backgroundColor: statusCfg.bg, color: statusCfg.color,
                        fontSize: 11, fontWeight: 600,
                      }}>
                        {contract.status}
                      </span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', marginTop: 4 }}>{contract.title}</h3>
                    <p style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{contract.organization.name}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {contract.discountPercent > 0 && (
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#27AE60' }}>{contract.discountPercent}% discount</p>
                    )}
                    {contract.rebatePercent > 0 && (
                      <p style={{ fontSize: 12, color: '#6b7280' }}>{contract.rebatePercent}% annual rebate</p>
                    )}
                    <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                      {contract.paymentTerm}
                    </p>
                    {contract.expirationDate && (
                      <p style={{ fontSize: 11, color: new Date(contract.expirationDate) < new Date() ? '#EF4444' : '#9ca3af' }}>
                        Expires: {new Date(contract.expirationDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Pricing Tiers */}
                {isExpanded && (
                  <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f3f4f6' }}>
                    <h4 style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>PRICING TIERS</h4>
                    {contract.pricingTiers.length === 0 ? (
                      <div style={{ padding: '20px 16px', textAlign: 'center', backgroundColor: '#f9fafb', borderRadius: 8, border: '1px dashed #d1d5db' }}>
                        <p style={{ fontSize: 13, color: '#6b7280' }}>No pricing tiers configured for this contract.</p>
                        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Category-level pricing can be added to define specific rates for product categories.</p>
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Category</th>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Subcategory</th>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Type</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', color: '#6b7280', fontWeight: 600 }}>Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {contract.pricingTiers.map(tier => (
                            <tr key={tier.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '8px', color: '#1f2937' }}>{tier.category}</td>
                              <td style={{ padding: '8px', color: '#6b7280' }}>{tier.subcategory || '—'}</td>
                              <td style={{ padding: '8px', color: '#6b7280' }}>{tier.priceType}</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600, color: '#0f2a3e' }}>
                                {tier.priceType === 'FIXED' && tier.fixedPrice ? `$${tier.fixedPrice.toFixed(2)}` : ''}
                                {tier.priceType === 'DISCOUNT_PCT' && tier.discountPct ? `${tier.discountPct}% off` : ''}
                                {tier.priceType === 'COST_PLUS' && tier.costPlusPct ? `Cost + ${tier.costPlusPct}%` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
