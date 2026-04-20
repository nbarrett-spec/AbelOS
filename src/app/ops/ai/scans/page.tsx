'use client'

import { useEffect, useState } from 'react'

interface Scan {
  scanId: string
  name: string
  description: string
  category: string
  schedule: string
  lastRun: string | null
  status: string
  findingsCount: number
  nextRun: string
}

interface Finding {
  id: string
  title: string
  status: string
  severity: string
  entity: string
  timestamp: string
  details: string
}

export default function ScanControlPanel() {
  const [scans, setScans] = useState<Scan[]>([])
  const [expandedScan, setExpandedScan] = useState<string | null>(null)
  const [findings, setFindings] = useState<Record<string, Finding[]>>({})
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState<string | null>(null)

  useEffect(() => {
    fetchScans()
    const interval = setInterval(fetchScans, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  const fetchScans = async () => {
    try {
      const res = await fetch('/api/ops/ai/scans?action=list')
      const data = await res.json()
      setScans(data.scans || [])
      setLoading(false)
    } catch (error) {
      console.error('Failed to fetch scans:', error)
      setLoading(false)
    }
  }

  const fetchFindings = async (scanId: string) => {
    try {
      const res = await fetch(`/api/ops/ai/scans?action=results&scan=${scanId}`)
      const data = await res.json()
      setFindings((prev) => ({ ...prev, [scanId]: data.findings || [] }))
    } catch (error) {
      console.error('Failed to fetch findings:', error)
    }
  }

  const triggerScan = async (scanId: string) => {
    setTriggering(scanId)
    try {
      const res = await fetch('/api/ops/ai/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan: scanId })
      })
      if (res.ok) {
        fetchScans()
      }
    } catch (error) {
      console.error('Failed to trigger scan:', error)
    } finally {
      setTriggering(null)
    }
  }

  const toggleExpand = (scanId: string) => {
    if (expandedScan === scanId) {
      setExpandedScan(null)
    } else {
      setExpandedScan(scanId)
      fetchFindings(scanId)
    }
  }

  // Calculate stats
  const activeScanCount = scans.filter((s) => s.status === 'RUNNING').length
  const last24hFindings = scans.reduce((sum, s) => sum + s.findingsCount, 0)
  const errorCount = scans.filter((s) => s.status === 'ERROR').length

  // Get status indicator class
  const getStatusColor = (status: string) => {
    if (status === 'RUNNING') return 'bg-abel-amber'
    if (status === 'ERROR') return 'bg-red-500'
    return 'bg-abel-green'
  }

  const getSeverityBadge = (severity: string) => {
    const colors = {
      CRITICAL: 'bg-red-100 text-red-800',
      HIGH: 'bg-orange-100 text-orange-800',
      MEDIUM: 'bg-yellow-100 text-yellow-800',
      LOW: 'bg-blue-100 text-blue-800'
    }
    return colors[severity as keyof typeof colors] || colors.LOW
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-abel-walnut border-t-abel-amber"></div>
          <p className="mt-4 text-abel-walnut font-medium">Loading NUC Scan Control Panel...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-abel-walnut to-abel-amber px-6 py-8 text-white">
        <h1 className="text-4xl font-bold">NUC Scan Control Panel</h1>
        <p className="mt-2 text-abel-amber text-lg">11 autonomous intelligence scanners</p>
      </div>

      {/* Status Bar */}
      <div className="px-6 py-6 bg-white border-b border-gray-200">
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-abel-amber/10 to-abel-amber/5 rounded-lg p-4 border border-abel-amber/20">
            <p className="text-sm text-gray-600 font-medium">Active Scans</p>
            <p className="text-3xl font-bold text-abel-amber mt-1">{activeScanCount}</p>
          </div>
          <div className="bg-gradient-to-br from-abel-green/10 to-abel-green/5 rounded-lg p-4 border border-abel-green/20">
            <p className="text-sm text-gray-600 font-medium">Last 24h Findings</p>
            <p className="text-3xl font-bold text-abel-green mt-1">{last24hFindings}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-100 to-blue-50 rounded-lg p-4 border border-blue-200">
            <p className="text-sm text-gray-600 font-medium">Scheduled Today</p>
            <p className="text-3xl font-bold text-blue-600 mt-1">{scans.length}</p>
          </div>
          <div className={`bg-gradient-to-br ${errorCount > 0 ? 'from-red-100 to-red-50' : 'from-gray-100 to-gray-50'} rounded-lg p-4 border ${errorCount > 0 ? 'border-red-200' : 'border-gray-200'}`}>
            <p className="text-sm text-gray-600 font-medium">Errors</p>
            <p className={`text-3xl font-bold mt-1 ${errorCount > 0 ? 'text-red-600' : 'text-gray-400'}`}>{errorCount}</p>
          </div>
        </div>
      </div>

      {/* Scan Grid */}
      <div className="px-6 py-8">
        <div className="grid grid-cols-3 gap-6">
          {scans.map((scan) => (
            <div key={scan.scanId} className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
              {/* Card Header */}
              <div className="p-6 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-bold text-abel-walnut flex-1">{scan.name}</h3>
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(scan.status)}`} title={`Status: ${scan.status}`}></div>
                </div>
                <p className="text-sm text-gray-600 mb-4">{scan.description}</p>

                {/* Status & Meta */}
                <div className="space-y-2 mb-4 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Category:</span>
                    <span className="font-medium text-gray-700">{scan.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Schedule:</span>
                    <span className="font-medium text-gray-700">{scan.schedule}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last Run:</span>
                    <span className="font-medium text-gray-700">{scan.lastRun || 'Never'}</span>
                  </div>
                </div>

                {/* Findings Badge */}
                <div className="mb-4">
                  <span className="inline-block bg-abel-amber/15 text-abel-amber px-3 py-1 rounded-full text-xs font-semibold">
                    {scan.findingsCount} finding{scan.findingsCount !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Action Button */}
                <button
                  onClick={() => triggerScan(scan.scanId)}
                  disabled={triggering === scan.scanId}
                  className="w-full bg-abel-walnut hover:bg-abel-walnut/90 disabled:bg-gray-300 text-white font-semibold py-2 px-4 rounded transition-colors text-sm"
                >
                  {triggering === scan.scanId ? 'Running...' : 'Run Now'}
                </button>
              </div>

              {/* Expandable Findings Section */}
              <button
                onClick={() => toggleExpand(scan.scanId)}
                className="w-full px-6 py-3 text-left text-sm font-medium text-abel-amber border-t border-gray-200 hover:bg-gray-50 transition-colors flex items-center justify-between"
              >
                <span>Recent Findings</span>
                <span className={`transition-transform ${expandedScan === scan.scanId ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {expandedScan === scan.scanId && (
                <div className="bg-gray-50 border-t border-gray-200 max-h-80 overflow-y-auto">
                  {findings[scan.scanId] && findings[scan.scanId].length > 0 ? (
                    <div className="divide-y divide-gray-200">
                      {findings[scan.scanId].map((finding) => (
                        <div key={finding.id} className="p-4 hover:bg-gray-100 transition-colors">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="font-medium text-sm text-gray-900">{finding.title}</p>
                              <p className="text-xs text-gray-500 mt-1">{finding.entity}</p>
                              <p className="text-xs text-gray-600 mt-2 leading-relaxed">{finding.details}</p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-semibold whitespace-nowrap ${getSeverityBadge(finding.severity)}`}>
                              {finding.severity}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-3">{finding.timestamp}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-sm text-gray-500">No findings yet. Run the scan to generate findings.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
