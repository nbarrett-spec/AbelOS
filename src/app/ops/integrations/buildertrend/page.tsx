'use client'

import { useState, useEffect } from 'react'

interface BTStats {
  connectionStatus: 'connected' | 'error' | 'configuring'
  syncedProjects: number
  upcomingMilestones: number
  scheduleAlerts: number
  isConfigured: boolean
}

interface Credentials {
  apiKey: string
  apiSecret: string
}

interface MappedProject {
  id: string
  btProjectName: string
  builder: string
  community: string
  abelJob: string | null
  lastSync: string
  status: 'synced' | 'pending' | 'error'
  errorMessage?: string
}

interface Milestone {
  id: string
  btProjectName: string
  description: string
  daysUntil: number
  alertType: 'T-72' | 'T-48' | 'T-24'
}

const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  connected: { bg: '#D1FAE5', text: '#047857' },
  error: { bg: '#FEE2E2', text: '#DC2626' },
  configuring: { bg: '#FEF3C7', text: '#D97706' },
  synced: { bg: '#D1FAE5', text: '#059669' },
  pending: { bg: '#FEF3C7', text: '#D97706' },
}

const ALERT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  'T-72': { bg: '#DBEAFE', text: '#0369A1' },
  'T-48': { bg: '#FEF3C7', text: '#B45309' },
  'T-24': { bg: '#FEE2E2', text: '#991B1B' },
}

export default function BuilderTrendPage() {
  const [stats, setStats] = useState<BTStats>({
    connectionStatus: 'configuring',
    syncedProjects: 0,
    upcomingMilestones: 0,
    scheduleAlerts: 0,
    isConfigured: false,
  })
  const [mappedProjects, setMappedProjects] = useState<MappedProject[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [showCredentialForm, setShowCredentialForm] = useState(false)
  const [credentials, setCredentials] = useState<Credentials>({
    apiKey: '',
    apiSecret: '',
  })
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'success' | 'error'>('success')

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg)
    setToastType(type)
    setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    try {
      const res = await fetch('/api/ops/integrations/buildertrend')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      // Map API response to BTStats interface
      const mappedStats: BTStats = {
        connectionStatus: data.status === 'CONNECTED' ? 'connected' : data.status === 'DISCONNECTED' ? 'error' : 'configuring',
        syncedProjects: data.projects?.mapped || 0,
        upcomingMilestones: data.upcomingSchedules?.length || 0,
        scheduleAlerts: data.upcomingSchedules?.filter((s: any) => s.status !== 'COMPLETED')?.length || 0,
        isConfigured: data.integrationConfig?.syncEnabled || false,
      }

      setStats(mappedStats)
      setMappedProjects(data.mappedProjects || [])
      setMilestones(data.milestones || [])
    } catch (err) {
      console.error('Error fetching BuilderTrend data:', err)
      showToast('Failed to load BuilderTrend data', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveCredentials() {
    if (!credentials.apiKey || !credentials.apiSecret) {
      showToast('Please enter both API key and secret', 'error')
      return
    }

    setSyncing('credentials')
    try {
      const res = await fetch('/api/ops/integrations/buildertrend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure',
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
        }),
      })
      if (!res.ok) throw new Error('Configuration failed')
      const result = await res.json()
      showToast(result.message || 'Configuration saved successfully')
      setShowCredentialForm(false)
      setCredentials({ apiKey: '', apiSecret: '' })
      fetchData()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to save credentials',
        'error'
      )
    } finally {
      setSyncing(null)
    }
  }

  async function handleAction(action: string) {
    setSyncing(action)
    try {
      const res = await fetch('/api/ops/integrations/buildertrend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error('Action failed')
      const result = await res.json()
      showToast(result.message || `${action} completed successfully`)
      fetchData()
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : `Failed to ${action}`,
        'error'
      )
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '400px',
        }}
      >
        <div
          style={{
            animation: 'spin 1s linear infinite',
            width: '32px',
            height: '32px',
            border: '4px solid #0f2a3e',
            borderTop: '4px solid #C6A24E',
            borderRadius: '50%',
          }}
        />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#111827' }}>
          BuilderTrend Integration
        </h1>
        <p style={{ fontSize: '14px', color: '#6B7280', marginTop: '8px' }}>
          Sync builder project schedules, material selections, and delivery
          milestones
        </p>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px',
        }}
      >
        {/* Connection Status */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: `4px solid ${
              stats.connectionStatus === 'connected'
                ? '#10B981'
                : stats.connectionStatus === 'error'
                  ? '#EF4444'
                  : '#F59E0B'
            }`,
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Connection Status
          </p>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#111827',
              marginTop: '8px',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                marginRight: '8px',
                backgroundColor:
                  stats.connectionStatus === 'connected'
                    ? '#10B981'
                    : stats.connectionStatus === 'error'
                      ? '#EF4444'
                      : '#F59E0B',
              }}
            />
            {stats.connectionStatus ? stats.connectionStatus.charAt(0).toUpperCase() +
              stats.connectionStatus.slice(1) : 'Unknown'}
          </div>
        </div>

        {/* Synced Projects */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #0284C7',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Synced Projects
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.syncedProjects}
          </p>
        </div>

        {/* Upcoming Milestones */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #8B5CF6',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Upcoming (7 days)
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.upcomingMilestones}
          </p>
        </div>

        {/* Schedule Alerts */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderLeft: '4px solid #F59E0B',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <p style={{ fontSize: '12px', color: '#6B7280', textTransform: 'uppercase' }}>
            Schedule Alerts
          </p>
          <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginTop: '8px' }}>
            {stats.scheduleAlerts}
          </p>
        </div>
      </div>

      {/* Configuration Section */}
      {!stats.isConfigured && (
        <div style={{ marginBottom: '32px' }}>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
              Configuration Required
            </h3>
            <p style={{ fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
              Enter your BuilderTrend API credentials to enable synchronization
            </p>

            {!showCredentialForm ? (
              <button
                onClick={() => setShowCredentialForm(true)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#C6A24E',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) =>
                  (e.currentTarget.style.backgroundColor = '#D97706')
                }
                onMouseOut={(e) =>
                  (e.currentTarget.style.backgroundColor = '#C6A24E')
                }
              >
                Configure API Credentials
              </button>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '16px',
                }}
              >
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#374151',
                      marginBottom: '8px',
                    }}
                  >
                    API Key
                  </label>
                  <input
                    type="password"
                    placeholder="Enter API key"
                    value={credentials.apiKey}
                    onChange={(e) =>
                      setCredentials({
                        ...credentials,
                        apiKey: e.target.value,
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#374151',
                      marginBottom: '8px',
                    }}
                  >
                    API Secret
                  </label>
                  <input
                    type="password"
                    placeholder="Enter API secret"
                    value={credentials.apiSecret}
                    onChange={(e) =>
                      setCredentials({
                        ...credentials,
                        apiSecret: e.target.value,
                      })
                    }
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            {showCredentialForm && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                <button
                  onClick={handleSaveCredentials}
                  disabled={syncing === 'credentials'}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#10B981',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    cursor:
                      syncing === 'credentials' ? 'default' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    opacity: syncing === 'credentials' ? 0.6 : 1,
                    transition: 'background-color 0.2s',
                  }}
                  onMouseOver={(e) => {
                    if (syncing !== 'credentials') {
                      e.currentTarget.style.backgroundColor = '#059669'
                    }
                  }}
                  onMouseOut={(e) => {
                    if (syncing !== 'credentials') {
                      e.currentTarget.style.backgroundColor = '#10B981'
                    }
                  }}
                >
                  {syncing === 'credentials' ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setShowCredentialForm(false)
                    setCredentials({ apiKey: '', apiSecret: '' })
                  }}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#6B7280',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'background-color 0.2s',
                  }}
                  onMouseOver={(e) =>
                    (e.currentTarget.style.backgroundColor = '#4B5563')
                  }
                  onMouseOut={(e) =>
                    (e.currentTarget.style.backgroundColor = '#6B7280')
                  }
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sync Actions */}
      {stats.isConfigured && (
        <div style={{ marginBottom: '32px' }}>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
              Sync Actions
            </h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleAction('sync_projects')}
                disabled={syncing === 'sync_projects'}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#C6A24E',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: syncing === 'sync_projects' ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: syncing === 'sync_projects' ? 0.6 : 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => {
                  if (syncing !== 'sync_projects') {
                    e.currentTarget.style.backgroundColor = '#D97706'
                  }
                }}
                onMouseOut={(e) => {
                  if (syncing !== 'sync_projects') {
                    e.currentTarget.style.backgroundColor = '#C6A24E'
                  }
                }}
              >
                {syncing === 'sync_projects' ? 'Syncing...' : 'Sync Projects'}
              </button>
              <button
                onClick={() => handleAction('sync_schedules')}
                disabled={syncing === 'sync_schedules'}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#C6A24E',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  cursor:
                    syncing === 'sync_schedules' ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: syncing === 'sync_schedules' ? 0.6 : 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => {
                  if (syncing !== 'sync_schedules') {
                    e.currentTarget.style.backgroundColor = '#D97706'
                  }
                }}
                onMouseOut={(e) => {
                  if (syncing !== 'sync_schedules') {
                    e.currentTarget.style.backgroundColor = '#C6A24E'
                  }
                }}
              >
                {syncing === 'sync_schedules'
                  ? 'Syncing...'
                  : 'Sync Schedules'}
              </button>
              <button
                onClick={() => handleAction('sync_materials')}
                disabled={syncing === 'sync_materials'}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#C6A24E',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  cursor:
                    syncing === 'sync_materials' ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  opacity: syncing === 'sync_materials' ? 0.6 : 1,
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => {
                  if (syncing !== 'sync_materials') {
                    e.currentTarget.style.backgroundColor = '#D97706'
                  }
                }}
                onMouseOut={(e) => {
                  if (syncing !== 'sync_materials') {
                    e.currentTarget.style.backgroundColor = '#C6A24E'
                  }
                }}
              >
                {syncing === 'sync_materials'
                  ? 'Syncing...'
                  : 'Sync Materials'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mapped Projects Table */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
          Mapped Projects
        </h2>
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
            }}
          >
            <thead style={{ backgroundColor: '#F9FAFB' }}>
              <tr>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  BuilderTrend Project
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Builder
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Community/Lot
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Abel Job
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Last Sync
                </th>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#6B7280',
                    textTransform: 'uppercase',
                  }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTop: '1px solid #E5E7EB' }}>
              {mappedProjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: 'center',
                      padding: '32px 16px',
                      color: '#9CA3AF',
                      fontSize: '14px',
                    }}
                  >
                    No mapped projects
                  </td>
                </tr>
              ) : (
                mappedProjects.map((project) => (
                  <tr
                    key={project.id}
                    style={{
                      borderBottom: '1px solid #E5E7EB',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseOver={(e) =>
                      (e.currentTarget.style.backgroundColor = '#F9FAFB')
                    }
                    onMouseOut={(e) =>
                      (e.currentTarget.style.backgroundColor = 'transparent')
                    }
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#111827',
                        fontWeight: '500',
                      }}
                    >
                      {project.btProjectName}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#374151',
                      }}
                    >
                      {project.builder}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                      }}
                    >
                      {project.community}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#374151',
                      }}
                    >
                      {project.abelJob || '—'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontSize: '14px',
                        color: '#6B7280',
                      }}
                    >
                      {new Date(project.lastSync).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span
                        title={project.errorMessage || ''}
                        style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          fontSize: '12px',
                          fontWeight: '500',
                          backgroundColor:
                            STATUS_BADGE_COLORS[project.status]?.bg ||
                            '#F3F4F6',
                          color:
                            STATUS_BADGE_COLORS[project.status]?.text ||
                            '#6B7280',
                        }}
                      >
                        {project.status ? project.status.charAt(0).toUpperCase() +
                          project.status.slice(1) : 'Unknown'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upcoming Milestones */}
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
          Upcoming Schedule Milestones (Next 14 Days)
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '16px',
          }}
        >
          {milestones.length === 0 ? (
            <div
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: '12px',
                padding: '32px 16px',
                textAlign: 'center',
                color: '#9CA3AF',
                fontSize: '14px',
                gridColumn: '1 / -1',
              }}
            >
              No upcoming milestones in the next 14 days
            </div>
          ) : (
            milestones.map((milestone) => (
              <div
                key={milestone.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  borderLeft: `4px solid ${
                    milestone.alertType === 'T-24'
                      ? '#EF4444'
                      : milestone.alertType === 'T-48'
                        ? '#F59E0B'
                        : '#0284C7'
                  }`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                  }}
                >
                  <h4
                    style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#111827',
                      margin: 0,
                      flex: 1,
                    }}
                  >
                    {milestone.btProjectName}
                  </h4>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: '600',
                      backgroundColor:
                        ALERT_BADGE_COLORS[milestone.alertType]?.bg ||
                        '#F3F4F6',
                      color:
                        ALERT_BADGE_COLORS[milestone.alertType]?.text ||
                        '#6B7280',
                      marginLeft: '8px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {milestone.alertType}
                  </span>
                </div>
                <p style={{ fontSize: '13px', color: '#6B7280', margin: '0 0 8px 0' }}>
                  {milestone.description}
                </p>
                <p
                  style={{
                    fontSize: '12px',
                    color: '#9CA3AF',
                    margin: 0,
                  }}
                >
                  Due in {milestone.daysUntil} day{milestone.daysUntil !== 1 ? 's' : ''}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            color: '#FFFFFF',
            fontSize: '14px',
            fontWeight: '500',
            backgroundColor: toastType === 'success' ? '#10B981' : '#EF4444',
            zIndex: 50,
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from {
            transform: translateX(400px);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  )
}
