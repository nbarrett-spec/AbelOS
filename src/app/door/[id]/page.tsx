'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

// NFC Door Scan Page — Lifecycle-aware, mobile-first
// Opens when anyone taps the NFC tag on a door
// Shows different UI based on door status + whether scanner is staff or public

export default function DoorScanPage() {
  const params = useParams()
  const doorId = params.id as string
  const [door, setDoor] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [showServiceForm, setShowServiceForm] = useState(false)

  useEffect(() => {
    fetch(`/api/door/${doorId}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setDoor(d) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [doorId])

  const doAction = async (action: string, extra: any = {}) => {
    setActionLoading(true)
    setActionMessage('')
    try {
      const res = await fetch(`/api/door/${doorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, staffId: 'scan', staffName: 'NFC Scan', ...extra }),
      })
      const data = await res.json()
      if (data.success) {
        setActionMessage(`Done — ${action.replace(/_/g, ' ')}`)
        // Refresh
        const r2 = await fetch(`/api/door/${doorId}`)
        const d2 = await r2.json()
        if (!d2.error) setDoor(d2)
      } else {
        setActionMessage(`Error: ${data.error}`)
      }
    } catch (e: any) {
      setActionMessage(`Error: ${e.message}`)
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) return <Shell><div style={{ textAlign: 'center', padding: 60, color: '#999' }}>Loading door...</div></Shell>
  if (error) return <Shell><div style={{ textAlign: 'center', padding: 60, color: '#C0392B' }}>Door not found</div></Shell>
  if (!door) return null

  // Route to the right view based on status and auth
  const isStaff = door.isStaff
  const status = door.status

  // Post-install = homeowner/warranty view (for non-staff)
  if (!isStaff && (status === 'INSTALLED' || status === 'DELIVERED')) {
    return <HomeownerView door={door} doorId={doorId} showServiceForm={showServiceForm} setShowServiceForm={setShowServiceForm} />
  }

  // Staff sees full operational view
  return <StaffView door={door} doorId={doorId} doAction={doAction} actionLoading={actionLoading} actionMessage={actionMessage} />
}

// ─── Shell wrapper ───
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#F5F6FA', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px 32px' }}>
        {/* Header */}
        <div style={{ padding: '20px 0 12px', textAlign: 'center', borderBottom: '3px solid #E67E22' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1B4F72', letterSpacing: -0.5 }}>ABEL LUMBER</div>
          <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Door Identity System</div>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Status badge ───
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    PRODUCTION: { bg: '#FFF3CD', fg: '#856404' },
    QC_PENDING: { bg: '#FFF3CD', fg: '#856404' },
    QC_PASSED: { bg: '#D1ECF1', fg: '#0C5460' },
    QC_FAILED: { bg: '#F8D7DA', fg: '#721C24' },
    STORED: { bg: '#D4EDDA', fg: '#155724' },
    STAGED: { bg: '#E2D9F3', fg: '#4A235A' },
    IN_TRANSIT: { bg: '#D1ECF1', fg: '#0C5460' },
    DELIVERED: { bg: '#D5F5E3', fg: '#1E8449' },
    INSTALLED: { bg: '#D5F5E3', fg: '#1E8449' },
  }
  const c = colors[status] || { bg: '#eee', fg: '#666' }
  return (
    <span style={{
      display: 'inline-block', padding: '4px 12px', borderRadius: 20,
      background: c.bg, color: c.fg, fontSize: 12, fontWeight: 700,
      letterSpacing: 0.5, textTransform: 'uppercase',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

// ─── Homeowner / Warranty View ───
function HomeownerView({ door, doorId, showServiceForm, setShowServiceForm }: any) {
  const [serviceData, setServiceData] = useState({ name: '', email: '', phone: '', issueType: 'GENERAL', description: '', isWarrantyClaim: false })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const warrantyActive = door.warranty?.isActive
  const warrantyEnd = door.warranty?.endDate ? new Date(door.warranty.endDate) : null

  const submitService = async () => {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/door/${doorId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_service', ...serviceData }),
      })
      const data = await res.json()
      if (data.success) setSubmitted(true)
    } catch {}
    setSubmitting(false)
  }

  return (
    <Shell>
      {/* Product Card */}
      <div style={{ background: 'white', borderRadius: 12, marginTop: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ background: '#1B4F72', padding: '16px 20px', color: 'white' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{door.product?.name || 'Abel Lumber Door'}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>Serial: {door.serialNumber}</div>
        </div>
        <div style={{ padding: 20 }}>
          {/* Warranty Status */}
          <div style={{
            padding: 16, borderRadius: 8, marginBottom: 16,
            background: warrantyActive ? '#D5F5E3' : '#FFF3CD',
            border: `1px solid ${warrantyActive ? '#82E0AA' : '#F9E79F'}`,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: warrantyActive ? '#1E8449' : '#856404' }}>
              {warrantyActive ? 'Warranty Active' : warrantyEnd ? 'Warranty Expired' : 'Warranty Pending'}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {door.warranty?.policyName || 'Standard Warranty'}
              {warrantyEnd && ` — Expires ${warrantyEnd.toLocaleDateString()}`}
            </div>
            {door.warranty?.description && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{door.warranty.description}</div>
            )}
          </div>

          {/* Door Specs */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>Door Specifications</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                ['Category', door.product?.category],
                ['Size', door.product?.doorSize],
                ['Handing', door.product?.handing],
                ['Core', door.product?.coreType],
                ['Panel', door.product?.panelStyle],
                ['Jamb', door.product?.jambSize],
                ['Material', door.product?.material],
                ['Hardware', door.product?.hardwareFinish],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string} style={{ padding: '6px 10px', background: '#F8F9FA', borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: 13, color: '#333', fontWeight: 500 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Components */}
          {door.components?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>Components</div>
              {door.components.map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                  <span style={{ color: '#333' }}>{c.name || c.sku}</span>
                  <span style={{ color: '#999' }}>x{c.quantity}</span>
                </div>
              ))}
            </div>
          )}

          {/* Key Dates */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>Timeline</div>
            {[
              ['Manufactured', door.dates?.manufactured],
              ['Quality Checked', door.dates?.qcPassed],
              ['Delivered', door.dates?.delivered],
              ['Installed', door.dates?.installed],
            ].filter(([, v]) => v).map(([label, date]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                <span style={{ color: '#666' }}>{label}</span>
                <span style={{ color: '#333', fontWeight: 500 }}>{new Date(date as string).toLocaleDateString()}</span>
              </div>
            ))}
          </div>

          {/* Care Instructions */}
          {door.warranty?.careInstructions && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>Care Instructions</div>
              <div style={{ fontSize: 12, color: '#555', lineHeight: 1.6, background: '#F8F9FA', padding: 12, borderRadius: 8 }}>
                {door.warranty.careInstructions}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Request Service Button */}
      {!showServiceForm && !submitted && (
        <button onClick={() => setShowServiceForm(true)} style={{
          width: '100%', padding: 16, marginTop: 16, borderRadius: 10,
          background: '#E67E22', color: 'white', border: 'none',
          fontSize: 16, fontWeight: 700, cursor: 'pointer',
        }}>
          Request Service
        </button>
      )}

      {/* Service Request Form */}
      {showServiceForm && !submitted && (
        <div style={{ background: 'white', borderRadius: 12, marginTop: 16, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1B4F72', marginBottom: 16 }}>Request Service</div>
          {[
            { key: 'name', label: 'Your Name', type: 'text' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'phone', label: 'Phone', type: 'tel' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>{f.label}</label>
              <input type={f.type} value={(serviceData as any)[f.key]}
                onChange={e => setServiceData(p => ({ ...p, [f.key]: e.target.value }))}
                style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
            </div>
          ))}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Issue Type</label>
            <select value={serviceData.issueType} onChange={e => setServiceData(p => ({ ...p, issueType: e.target.value }))}
              style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}>
              <option value="GENERAL">General Issue</option>
              <option value="DAMAGE">Damage</option>
              <option value="HARDWARE">Hardware Problem</option>
              <option value="WEATHERSTRIPPING">Weatherstripping</option>
              <option value="FINISH">Finish/Paint</option>
              <option value="ALIGNMENT">Door Alignment</option>
              <option value="GLASS">Glass/Lite Issue</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Describe the issue</label>
            <textarea value={serviceData.description}
              onChange={e => setServiceData(p => ({ ...p, description: e.target.value }))}
              rows={4} style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13, color: '#333' }}>
            <input type="checkbox" checked={serviceData.isWarrantyClaim}
              onChange={e => setServiceData(p => ({ ...p, isWarrantyClaim: e.target.checked }))} />
            This is a warranty claim
          </label>
          <button onClick={submitService} disabled={submitting || !serviceData.description}
            style={{
              width: '100%', padding: 14, borderRadius: 8,
              background: serviceData.description ? '#1B4F72' : '#ccc',
              color: 'white', border: 'none', fontSize: 15, fontWeight: 600,
              cursor: serviceData.description ? 'pointer' : 'default',
            }}>
            {submitting ? 'Submitting...' : 'Submit Service Request'}
          </button>
        </div>
      )}

      {submitted && (
        <div style={{
          background: '#D5F5E3', borderRadius: 12, marginTop: 16, padding: 20,
          textAlign: 'center', color: '#1E8449',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>&#10003;</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Service Request Submitted</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Our team will reach out within 1 business day.</div>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#999' }}>
        Abel Lumber Co. — Quality doors, built to last.
      </div>
    </Shell>
  )
}

// ─── Staff Operational View ───
function StaffView({ door, doorId, doAction, actionLoading, actionMessage }: any) {
  const [bayInput, setBayInput] = useState('')
  const [installData, setInstallData] = useState({ address: '', city: '', state: 'TX', zip: '', homeownerName: '', notes: '' })

  const status = door.status
  const op = door.operational || {}

  return (
    <Shell>
      {/* Door Header */}
      <div style={{ background: 'white', borderRadius: 12, marginTop: 16, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ background: '#1B4F72', padding: '16px 20px', color: 'white' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{door.product?.name || 'Door Unit'}</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>SN: {door.serialNumber}</div>
            </div>
            <StatusBadge status={status} />
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {/* Quick Info Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              ['SKU', door.product?.sku],
              ['Category', door.product?.category],
              ['SO', op.orderId?.slice(0, 16)],
              ['Job', op.jobId?.slice(0, 16)],
              ['Builder', op.builderName],
              ['Bay', op.bay ? `${op.bay.number} (${op.bay.zone})` : 'Not assigned'],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label as string} style={{ padding: '8px 10px', background: '#F8F9FA', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: '#999', textTransform: 'uppercase' }}>{label}</div>
                <div style={{ fontSize: 13, color: '#333', fontWeight: 500, wordBreak: 'break-all' }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>LIFECYCLE</div>
            {[
              ['Manufactured', door.dates?.manufactured, op.manufacturedBy],
              ['QC Passed', door.dates?.qcPassed, op.qcPassedBy],
              ['Staged', door.dates?.staged, op.stagedBy],
              ['Delivered', door.dates?.delivered, op.deliveredBy],
              ['Installed', door.dates?.installed, op.installedBy],
            ].map(([label, date, by], i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 13,
                opacity: date ? 1 : 0.4,
              }}>
                <span style={{ color: '#333' }}>{date ? '\u2713' : '\u25CB'} {label as string}</span>
                <span style={{ color: '#999', fontSize: 12 }}>
                  {date ? `${new Date(date as string).toLocaleDateString()} ${by ? `\u2022 ${by}` : ''}` : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Message */}
      {actionMessage && (
        <div style={{
          padding: 12, borderRadius: 8, marginTop: 12, fontSize: 13, textAlign: 'center',
          background: actionMessage.startsWith('Error') ? '#F8D7DA' : '#D5F5E3',
          color: actionMessage.startsWith('Error') ? '#721C24' : '#1E8449',
        }}>
          {actionMessage}
        </div>
      )}

      {/* Context-Aware Actions */}
      <div style={{ background: 'white', borderRadius: 12, marginTop: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F72', marginBottom: 12 }}>ACTIONS</div>

        {/* QC Actions */}
        {(status === 'PRODUCTION' || status === 'QC_PENDING') && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <ActionBtn label="Pass QC" color="#27AE60" loading={actionLoading} onClick={() => doAction('qc_pass')} />
            <ActionBtn label="Fail QC" color="#C0392B" loading={actionLoading} onClick={() => doAction('qc_fail', { notes: prompt('Failure reason:') || '' })} />
          </div>
        )}

        {/* Bay Move (available in most states) */}
        {['QC_PASSED', 'STORED', 'PRODUCTION'].includes(status) && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="Bay # or scan bay tag" value={bayInput} onChange={e => setBayInput(e.target.value)}
                style={{ flex: 1, padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
              <ActionBtn label="Move" color="#2E86C1" loading={actionLoading}
                onClick={() => { if (bayInput) doAction('move_to_bay', { bayId: bayInput }); setBayInput('') }} />
            </div>
          </div>
        )}

        {/* Stage */}
        {(status === 'STORED' || status === 'QC_PASSED') && (
          <ActionBtn label="Mark as Staged for Delivery" color="#7D3C98" loading={actionLoading}
            onClick={() => doAction('stage')} full />
        )}

        {/* Deliver */}
        {status === 'STAGED' && (
          <ActionBtn label="Confirm Delivered" color="#E67E22" loading={actionLoading}
            onClick={() => doAction('deliver')} full />
        )}

        {/* Install */}
        {status === 'DELIVERED' && (
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Record Installation</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input placeholder="Street address" value={installData.address}
                onChange={e => setInstallData(p => ({ ...p, address: e.target.value }))}
                style={{ padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 13, gridColumn: '1/3' }} />
              <input placeholder="City" value={installData.city}
                onChange={e => setInstallData(p => ({ ...p, city: e.target.value }))}
                style={{ padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="ST" value={installData.state} maxLength={2}
                  onChange={e => setInstallData(p => ({ ...p, state: e.target.value }))}
                  style={{ width: 50, padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 13, textAlign: 'center' }} />
                <input placeholder="ZIP" value={installData.zip}
                  onChange={e => setInstallData(p => ({ ...p, zip: e.target.value }))}
                  style={{ flex: 1, padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }} />
              </div>
              <input placeholder="Homeowner name (optional)" value={installData.homeownerName}
                onChange={e => setInstallData(p => ({ ...p, homeownerName: e.target.value }))}
                style={{ padding: 10, border: '1px solid #ddd', borderRadius: 6, fontSize: 13, gridColumn: '1/3' }} />
            </div>
            <ActionBtn label="Record Installation" color="#1E8449" loading={actionLoading}
              onClick={() => doAction('install', installData)} full />
          </div>
        )}

        {/* Installed — view only for staff */}
        {status === 'INSTALLED' && door.installation && (
          <div style={{ padding: 12, background: '#F0FFF4', borderRadius: 8, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: '#1E8449', marginBottom: 4 }}>Installed</div>
            <div>{door.installation.address}</div>
            <div>{door.installation.city}, {door.installation.state} {door.installation.zip}</div>
            {door.homeowner?.name && <div style={{ marginTop: 4, color: '#666' }}>Homeowner: {door.homeowner.name}</div>}
          </div>
        )}

        {/* Reassign SO — always available for staff before install */}
        {status !== 'INSTALLED' && status !== 'DELIVERED' && (
          <div style={{ marginTop: 12, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <button onClick={() => {
              const newOrder = prompt('Enter new Order/SO ID:')
              const reason = prompt('Reason for reassignment:')
              if (newOrder) doAction('reassign_order', { newOrderId: newOrder, reason })
            }}
              style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #ddd', background: 'white', color: '#666', fontSize: 13, cursor: 'pointer' }}>
              Reassign to Different SO
            </button>
          </div>
        )}
      </div>

      {/* Event History */}
      {door.events?.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, marginTop: 12, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1B4F72', marginBottom: 8 }}>EVENT LOG</div>
          {door.events.slice(0, 10).map((e: any) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f5f5f5', fontSize: 12 }}>
              <div>
                <span style={{ fontWeight: 600, color: '#333' }}>{e.eventType.replace(/_/g, ' ')}</span>
                {e.notes && <span style={{ color: '#999', marginLeft: 6 }}>— {e.notes}</span>}
              </div>
              <span style={{ color: '#999', whiteSpace: 'nowrap', marginLeft: 8 }}>
                {new Date(e.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

function ActionBtn({ label, color, loading, onClick, full }: { label: string; color: string; loading: boolean; onClick: () => void; full?: boolean }) {
  return (
    <button onClick={onClick} disabled={loading}
      style={{
        flex: full ? undefined : 1, width: full ? '100%' : undefined,
        padding: '12px 16px', borderRadius: 8, border: 'none',
        background: color, color: 'white', fontSize: 14, fontWeight: 600,
        cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
        marginBottom: full ? 8 : 0,
      }}>
      {label}
    </button>
  )
}
