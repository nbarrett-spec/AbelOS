'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import DocumentAttachments from '@/components/ops/DocumentAttachments'

interface VendorDetail {
  id: string
  name: string
  code: string
  contactName: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
  accountNumber: string | null
  creditLimit: number | null
  creditUsed: number | null
  creditHold: boolean
  creditUtilizationPercent: number | null
  creditAvailable: number | null
  paymentTerms: string | null
  paymentTermDays: number | null
  earlyPayDiscount: number | null
  earlyPayDays: number | null
  taxId: string | null
  notes: string | null
  active: boolean
  performanceMetrics: {
    avgLeadDays: number | null
    onTimeRate: string | null
  }
  createdAt: string
  updatedAt: string
}

interface PurchaseOrder {
  id: string
  poNumber: string
  status: string
  subtotal: number
  shippingCost: number
  total: number
  orderedAt: string | null
  expectedDate: string | null
  receivedAt: string | null
  notes: string | null
}

interface VendorProduct {
  vendorProductId: string
  productId: string
  vendorSku: string
  vendorName: string | null
  vendorCost: number | null
  minOrderQty: number
  leadTimeDays: number | null
  preferred: boolean
}

interface VendorDetailResponse {
  vendor: VendorDetail
  openPOs: {
    count: number
    totalAmount: number
  }
  recentPOs: PurchaseOrder[]
  products: VendorProduct[]
  summary: {
    totalProductsSupplied: number
    openPOCount: number
    openPOTotal: number
    creditUtilizationPercent: number | null
  }
}

export default function VendorDetailPage() {
  const params = useParams()
  const [data, setData] = useState<VendorDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState<any>({})
  const [editLoading, setEditLoading] = useState(false)

  const NAVY = '#0f2a3e'
  const ORANGE = '#C6A24E'

  useEffect(() => {
    async function loadVendor() {
      try {
        setLoading(true)
        const resp = await fetch(`/api/ops/vendors/${params.vendorId}`)
        if (!resp.ok) {
          throw new Error('Failed to load vendor')
        }
        const d = await resp.json()
        setData(d)
        setEditForm(d.vendor)
      } catch (err) {
        console.error('Failed to load vendor:', err)
        setError('Failed to load vendor details')
      } finally {
        setLoading(false)
      }
    }
    if (params.vendorId) {
      loadVendor()
    }
  }, [params.vendorId])

  async function handleEditSubmit() {
    if (!data) return
    setEditLoading(true)
    try {
      const resp = await fetch(`/api/ops/vendors/${data.vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!resp.ok) {
        const err = await resp.json()
        throw new Error(err.error || 'Failed to update vendor')
      }
      const updated = await resp.json()
      setData({
        ...data,
        vendor: updated.vendor,
      })
      setEditModalOpen(false)
    } catch (err) {
      console.error('Failed to update vendor:', err)
      alert('Failed to update vendor')
    } finally {
      setEditLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
        <div style={{ color: NAVY, fontSize: 14 }}>Loading vendor details...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9CA3AF' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontSize: 18, color: '#374151', marginBottom: 8 }}>Vendor not found</h2>
        <p style={{ fontSize: 14, marginBottom: 24 }}>{error || 'Unable to load vendor details'}</p>
        <Link href="/ops/vendors" style={{ color: NAVY, textDecoration: 'none', fontWeight: 600 }}>
          ← Back to vendors
        </Link>
      </div>
    )
  }

  const { vendor, openPOs, recentPOs, products, summary } = data
  const creditHealthColor = vendor.creditHold ? '#DC2626' : (vendor.creditUtilizationPercent ?? 0) > 80 ? '#F97316' : '#16A34A'

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 20px' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 24, fontSize: 13, color: '#6B7280' }}>
        <Link href="/ops/vendors" style={{ color: NAVY, textDecoration: 'none' }}>
          Vendors
        </Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: '#374151' }}>{vendor.name}</span>
      </div>

      {/* Header card */}
      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: `1px solid #E5E7EB`,
        padding: 24,
        marginBottom: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: NAVY,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              fontWeight: 700,
            }}>
              {vendor.name.substring(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111', margin: 0 }}>{vendor.name}</h1>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
                {vendor.contactName ? `${vendor.contactName} • ` : ''}{vendor.email}
              </p>
            </div>
          </div>
          {vendor.website && (
            <p style={{ fontSize: 12, color: '#0f2a3e', margin: 0 }}>
              <a href={vendor.website} target="_blank" rel="noopener noreferrer" style={{ color: ORANGE, textDecoration: 'none' }}>
                {vendor.website}
              </a>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{
            padding: '4px 12px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            background: vendor.active ? '#EFF6FF' : '#F3F4F6',
            color: vendor.active ? '#1E40AF' : '#6B7280',
          }}>
            {vendor.active ? 'Active' : 'Inactive'}
          </span>
          {vendor.creditHold && (
            <span style={{
              padding: '4px 12px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              background: '#FEE2E2',
              color: '#991B1B',
            }}>
              Credit Hold
            </span>
          )}
          <button
            onClick={() => setEditModalOpen(true)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: `1px solid #D1D5DB`,
              background: '#fff',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              color: '#374151',
            }}
          >
            Edit Vendor
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}>
        <StatCard
          label="Payment Terms"
          value={vendor.paymentTerms ? `${vendor.paymentTerms} (${vendor.paymentTermDays || 0}d)` : 'Not set'}
          isString
        />
        <StatCard
          label="Lead Time"
          value={vendor.performanceMetrics.avgLeadDays ? `${vendor.performanceMetrics.avgLeadDays} days` : 'No data'}
          isString
        />
        <StatCard
          label="On-Time Rate"
          value={vendor.performanceMetrics.onTimeRate || 'No data'}
          isString
        />
        <StatCard
          label="Open POs"
          value={openPOs.count}
        />
      </div>

      {/* AP Summary Section */}
      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: `1px solid #E5E7EB`,
        padding: 24,
        marginBottom: 24,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: '0 0 16px' }}>AP & Credit Summary</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
        }}>
          <div>
            <p style={{ fontSize: 12, color: '#6B7280', textTransform: 'uppercase', margin: '0 0 4px', fontWeight: 600 }}>
              Outstanding Balance
            </p>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#111', margin: 0 }}>
              ${(openPOs.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p style={{ fontSize: 11, color: '#6B7280', margin: '4px 0 0' }}>
              {openPOs.count} open POs
            </p>
          </div>

          <div>
            <p style={{ fontSize: 12, color: '#6B7280', textTransform: 'uppercase', margin: '0 0 4px', fontWeight: 600 }}>
              Credit Limit
            </p>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#111', margin: 0 }}>
              {vendor.creditLimit ? `$${vendor.creditLimit.toLocaleString()}` : '—'}
            </p>
            <p style={{ fontSize: 11, color: '#6B7280', margin: '4px 0 0' }}>
              {vendor.accountNumber ? `Account: ${vendor.accountNumber}` : 'No account #'}
            </p>
          </div>

          <div>
            <p style={{ fontSize: 12, color: '#6B7280', textTransform: 'uppercase', margin: '0 0 4px', fontWeight: 600 }}>
              Credit Used
            </p>
            <p style={{ fontSize: 20, fontWeight: 700, color: '#111', margin: 0 }}>
              {vendor.creditUsed ? `$${vendor.creditUsed.toLocaleString()}` : '—'}
            </p>
            <p style={{ fontSize: 11, color: '#6B7280', margin: '4px 0 0' }}>
              {vendor.creditUtilizationPercent ? `${vendor.creditUtilizationPercent}% utilized` : 'No credit set'}
            </p>
          </div>

          <div>
            <p style={{ fontSize: 12, color: '#6B7280', textTransform: 'uppercase', margin: '0 0 4px', fontWeight: 600 }}>
              Credit Available
            </p>
            <p style={{ fontSize: 20, fontWeight: 700, color: creditHealthColor, margin: 0 }}>
              {vendor.creditAvailable !== null ? `$${vendor.creditAvailable.toLocaleString()}` : '—'}
            </p>
            <p style={{ fontSize: 11, color: '#6B7280', margin: '4px 0 0' }}>
              {vendor.creditHold ? 'On hold' : 'Available for use'}
            </p>
          </div>
        </div>

        {vendor.notes && (
          <div style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: '#FEF3C7',
            borderLeft: `3px solid ${ORANGE}`,
          }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#92400E', margin: '0 0 4px' }}>Notes:</p>
            <p style={{ fontSize: 12, color: '#78350F', margin: 0 }}>{vendor.notes}</p>
          </div>
        )}
      </div>

      {/* Contact & Payment Info */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}>
        <div style={{
          background: '#fff',
          borderRadius: 12,
          border: `1px solid #E5E7EB`,
          padding: 20,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: '0 0 12px' }}>Contact Information</h3>
          <dl style={{ display: 'grid', gap: 10 }}>
            {[
              ['Name', vendor.contactName || '—'],
              ['Email', vendor.email ? <a key="email" href={`mailto:${vendor.email}`} style={{ color: NAVY, textDecoration: 'none' }}>{vendor.email}</a> : '—'],
              ['Phone', vendor.phone ? <a key="phone" href={`tel:${vendor.phone}`} style={{ color: NAVY, textDecoration: 'none' }}>{vendor.phone}</a> : '—'],
              ['Address', vendor.address ? [vendor.address, vendor.address].join(', ') : '—'],
            ].map(([label, value]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <dt style={{ color: '#6B7280', fontWeight: 500 }}>{label}</dt>
                <dd style={{ color: '#111', margin: 0, textAlign: 'right' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div style={{
          background: '#fff',
          borderRadius: 12,
          border: `1px solid #E5E7EB`,
          padding: 20,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: '0 0 12px' }}>Payment Terms & Tax</h3>
          <dl style={{ display: 'grid', gap: 10 }}>
            {[
              ['Terms', vendor.paymentTerms || '—'],
              ['Days', vendor.paymentTermDays ? `${vendor.paymentTermDays} days` : '—'],
              ['Early Pay Discount', vendor.earlyPayDiscount ? `${vendor.earlyPayDiscount}% in ${vendor.earlyPayDays}d` : '—'],
              ['Tax ID', vendor.taxId || '—'],
            ].map(([label, value]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <dt style={{ color: '#6B7280', fontWeight: 500 }}>{label}</dt>
                <dd style={{ color: '#111', margin: 0, textAlign: 'right' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Recent POs Section */}
      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: `1px solid #E5E7EB`,
        marginBottom: 24,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid #E5E7EB` }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>Recent Purchase Orders (Last 10)</h3>
        </div>

        {recentPOs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            No purchase orders
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: `1px solid #E5E7EB` }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>PO #</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Subtotal</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Total</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Ordered</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Expected</th>
                </tr>
              </thead>
              <tbody>
                {recentPOs.map(po => (
                  <tr key={po.id} style={{ borderBottom: `1px solid #E5E7EB` }}>
                    <td style={{ padding: '12px 16px', color: NAVY, fontWeight: 600 }}>{po.poNumber}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: po.status === 'RECEIVED' ? '#DCFCE7' : po.status === 'PENDING' ? '#FEF3C7' : '#E0E7FF',
                        color: po.status === 'RECEIVED' ? '#166534' : po.status === 'PENDING' ? '#92400E' : '#3730A3',
                      }}>
                        {po.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#6B7280' }}>
                      ${po.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#111' }}>
                      ${po.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#6B7280', fontSize: 12 }}>
                      {po.orderedAt ? new Date(po.orderedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#6B7280', fontSize: 12 }}>
                      {po.expectedDate ? new Date(po.expectedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Products Supplied Section */}
      <div style={{
        background: '#fff',
        borderRadius: 12,
        border: `1px solid #E5E7EB`,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid #E5E7EB` }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>
            Products Supplied ({products.length})
          </h3>
        </div>

        {products.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            No products configured
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: `1px solid #E5E7EB` }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Vendor SKU</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Product Name</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Vendor Cost</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Min Order</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Lead (days)</th>
                  <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, color: '#6B7280', fontSize: 11, textTransform: 'uppercase' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map(prod => (
                  <tr key={prod.vendorProductId} style={{ borderBottom: `1px solid #E5E7EB` }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#111' }}>
                      {prod.vendorSku}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#111' }}>
                      {prod.vendorName || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#111' }}>
                      {prod.vendorCost ? `$${prod.vendorCost.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6B7280' }}>
                      {prod.minOrderQty || '1'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center', color: '#6B7280' }}>
                      {prod.leadTimeDays || '—'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {prod.preferred ? (
                        <span style={{
                          display: 'inline-block',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background: '#DBEAFE',
                          color: '#1E40AF',
                        }}>
                          Preferred
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>Standard</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Vendor Modal */}
      {editModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '16px',
        }}>
          <form
            onSubmit={e => {
              e.preventDefault()
              handleEditSubmit()
            }}
            style={{
              background: '#fff',
              borderRadius: 12,
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{
              borderBottom: `1px solid #E5E7EB`,
              padding: '20px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111', margin: 0 }}>Edit Vendor</h2>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 20,
                  color: '#9CA3AF',
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <FormField
                label="Company Name"
                value={editForm.name || ''}
                onChange={v => setEditForm({ ...editForm, name: v })}
              />
              <FormField
                label="Vendor Code"
                value={editForm.code || ''}
                onChange={v => setEditForm({ ...editForm, code: v })}
              />
              <FormField
                label="Contact Name"
                value={editForm.contactName || ''}
                onChange={v => setEditForm({ ...editForm, contactName: v })}
              />
              <FormField
                label="Email"
                type="email"
                value={editForm.email || ''}
                onChange={v => setEditForm({ ...editForm, email: v })}
              />
              <FormField
                label="Phone"
                type="tel"
                value={editForm.phone || ''}
                onChange={v => setEditForm({ ...editForm, phone: v })}
              />
              <FormField
                label="Website"
                type="url"
                value={editForm.website || ''}
                onChange={v => setEditForm({ ...editForm, website: v })}
              />
              <FormField
                label="Address"
                value={editForm.address || ''}
                onChange={v => setEditForm({ ...editForm, address: v })}
              />
              <FormField
                label="Account #"
                value={editForm.accountNumber || ''}
                onChange={v => setEditForm({ ...editForm, accountNumber: v })}
              />
              <FormField
                label="Tax ID"
                value={editForm.taxId || ''}
                onChange={v => setEditForm({ ...editForm, taxId: v })}
              />
              <FormField
                label="Credit Limit"
                type="number"
                value={editForm.creditLimit || ''}
                onChange={v => setEditForm({ ...editForm, creditLimit: v ? parseFloat(v) : null })}
              />
              <FormField
                label="Payment Terms"
                value={editForm.paymentTerms || ''}
                onChange={v => setEditForm({ ...editForm, paymentTerms: v })}
                placeholder="NET_30, NET_60, etc."
              />
              <FormField
                label="Payment Days"
                type="number"
                value={editForm.paymentTermDays || ''}
                onChange={v => setEditForm({ ...editForm, paymentTermDays: v ? parseInt(v) : null })}
              />
              <FormField
                label="Early Pay Discount %"
                type="number"
                step="0.1"
                value={editForm.earlyPayDiscount || ''}
                onChange={v => setEditForm({ ...editForm, earlyPayDiscount: v ? parseFloat(v) : null })}
              />
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 6,
                }}>
                  Credit Hold
                </label>
                <select
                  value={editForm.creditHold ? 'true' : 'false'}
                  onChange={e => setEditForm({ ...editForm, creditHold: e.target.value === 'true' })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid #D1D5DB`,
                    fontSize: 14,
                  }}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#374151',
                  marginBottom: 6,
                }}>
                  Notes
                </label>
                <textarea
                  value={editForm.notes || ''}
                  onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid #D1D5DB`,
                    fontSize: 14,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>

            <div style={{
              borderTop: `1px solid #E5E7EB`,
              padding: '16px 20px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
            }}>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid #D1D5DB`,
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#374151',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editLoading}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: editLoading ? '#9CA3AF' : NAVY,
                  color: '#fff',
                  cursor: editLoading ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Document attachments — FIX-1 from AEGIS-OPS-FINANCE-HANDOFF */}
      <div style={{ backgroundColor: '#fff', padding: 24, borderRadius: 12, marginTop: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <DocumentAttachments
          entityType="vendor"
          entityId={data.vendor.id}
          defaultCategory="CONTRACT"
          allowedCategories={['CONTRACT', 'CORRESPONDENCE', 'INVOICE', 'PURCHASE_ORDER', 'REPORT', 'GENERAL']}
        />
      </div>
    </div>
  )
}

function StatCard({ label, value, isString }: { label: string; value: number | string; isString?: boolean }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #E5E7EB',
      padding: 16,
    }}>
      <p style={{ fontSize: 11, color: '#6B7280', margin: '0 0 8px', fontWeight: 600, textTransform: 'uppercase' }}>
        {label}
      </p>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#111', margin: 0 }}>
        {isString ? value : typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type,
  step,
}: {
  label: string
  value: any
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  step?: string
}) {
  return (
    <div>
      <label style={{
        display: 'block',
        fontSize: 12,
        fontWeight: 600,
        color: '#374151',
        marginBottom: 6,
      }}>
        {label}
      </label>
      <input
        type={type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        step={step}
        style={{
          width: '100%',
          padding: '8px 12px',
          borderRadius: 8,
          border: `1px solid #D1D5DB`,
          fontSize: 14,
        }}
      />
    </div>
  )
}
