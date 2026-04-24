'use client'

import { useEffect, useState } from 'react'
import { Truck } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

interface Crew {
  id: string
  name: string
  size: number
  hourlyRate: number
}

interface RouteStop {
  id: string
  stopNumber: number
  address: string
  city: string
  zip: string
  estimatedArrival: string
  distanceFromPrevious: number
  fuelCost: number
  tollRoadName?: string
  tollCost: number
  alternativeRouteMinutes: number
  crewLaborCost: number
  recommendation: 'TAKE_TOLL' | 'SKIP_TOLL'
  netSavings: number
  deliveryId: string
}

interface RouteData {
  date: string
  crewId: string
  totalStops: number
  totalDistance: number
  estimatedFuelCost: number
  estimatedTollCost: number
  totalLaborHours: number
  costSavings: number
  stops: RouteStop[]
  recommendedFuelStop: {
    afterStop: number
    estimatedTankLevel: number
    nearestStations: string[]
  }
  currentFuelPrice: number
}

export default function RouteOptimizerPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [crews, setCrews] = useState<Crew[]>([])
  const [selectedCrew, setSelectedCrew] = useState<string>('')
  const [routeData, setRouteData] = useState<RouteData | null>(null)
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Settings state
  const [fuelPrice, setFuelPrice] = useState(3.45)
  const [truckMpg, setTruckMpg] = useState(8.5)
  const [crewHourlyRate, setCrewHourlyRate] = useState(35)
  const [hqAddress, setHqAddress] = useState('123 Abel Way, Portland, OR 97201')
  const [savingSettings, setSavingSettings] = useState(false)

  // Load crews on mount
  useEffect(() => {
    async function loadCrews() {
      try {
        const resp = await fetch('/api/ops/crews')
        const data = await resp.json()
        setCrews(data.crews || [])
        if (data.crews?.length > 0) {
          setSelectedCrew(data.crews[0].id)
        }
      } catch (err) {
        console.error('Failed to load crews:', err)
      }
    }
    loadCrews()
  }, [])

  // Load route data when date or crew changes
  useEffect(() => {
    if (!selectedCrew) return
    loadRoute()
  }, [date, selectedCrew])

  async function loadRoute() {
    setLoading(true)
    try {
      const resp = await fetch(
        `/api/ops/delivery/route-optimizer?date=${date}&crewId=${selectedCrew}`
      )
      const data = await resp.json()
      setRouteData(data || null)
    } catch (err) {
      console.error('Failed to load route:', err)
      setRouteData(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleOptimizeRoute() {
    setLoading(true)
    try {
      const resp = await fetch('/api/ops/delivery/route-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          crewId: selectedCrew,
          fuelPrice,
          truckMpg,
          crewHourlyRate,
        }),
      })
      const data = await resp.json()
      setRouteData(data || null)
    } catch (err) {
      console.error('Failed to optimize route:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    try {
      await fetch('/api/ops/delivery/route-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_settings',
          fuelPrice,
          truckMpg,
          crewHourlyRate,
          hqAddress,
        }),
      })
    } catch (err) {
      console.error('Failed to save settings:', err)
    } finally {
      setSavingSettings(false)
    }
  }

  if (loading && !routeData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
        <div style={{ animation: 'spin 1s linear infinite', width: '32px', height: '32px', border: '3px solid #0f2a3e', borderTop: '3px solid transparent', borderRadius: '50%' }} />
      </div>
    )
  }

  const summaryCards = [
    { label: 'Total Stops', value: routeData?.totalStops || 0 },
    { label: 'Total Distance', value: `${routeData?.totalDistance || 0} mi` },
    { label: 'Est. Fuel Cost', value: `$${(routeData?.estimatedFuelCost || 0).toFixed(2)}` },
    { label: 'Est. Toll Cost', value: `$${(routeData?.estimatedTollCost || 0).toFixed(2)}` },
    { label: 'Total Labor Hours', value: `${(routeData?.totalLaborHours || 0).toFixed(1)} hrs` },
    { label: 'Cost Savings', value: `$${(routeData?.costSavings || 0).toFixed(2)}`, highlight: true },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1B1B1B', marginBottom: '16px' }}>
          Delivery Route Optimizer
        </h1>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
          {/* Date Picker */}
          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#333' }}>
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: '8px',
                fontSize: '14px',
              }}
            />
          </div>

          {/* Crew Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#333' }}>
              Crew
            </label>
            <select
              value={selectedCrew}
              onChange={(e) => setSelectedCrew(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ddd',
                borderRadius: '8px',
                fontSize: '14px',
              }}
            >
              <option value="">Select a crew...</option>
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.name} ({crew.size} people)
                </option>
              ))}
            </select>
          </div>

          {/* Optimize Button */}
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={handleOptimizeRoute}
              disabled={!selectedCrew || loading}
              style={{
                width: '100%',
                padding: '10px 20px',
                backgroundColor: selectedCrew && !loading ? '#C6A24E' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: selectedCrew && !loading ? 'pointer' : 'default',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => {
                if (selectedCrew && !loading) {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#A8882A'
                }
              }}
              onMouseLeave={(e) => {
                if (selectedCrew && !loading) {
                  (e.target as HTMLButtonElement).style.backgroundColor = '#C6A24E'
                }
              }}
            >
              {loading ? 'Optimizing...' : 'Optimize Route'}
            </button>
          </div>
        </div>
      </div>

      {!routeData ? (
        <div className="bg-surface-muted border border-border rounded-lg p-12">
          <EmptyState
            icon={<Truck className="w-8 h-8 text-fg-subtle" />}
            title="No deliveries scheduled"
            description="No deliveries scheduled for this date — pick another date or assign stops to this crew."
          />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '32px' }}>
            {summaryCards.map((card) => (
              <div
                key={card.label}
                style={{
                  backgroundColor: card.highlight ? '#E8F8F5' : 'white',
                  border: card.highlight ? '2px solid #27AE60' : '1px solid #ddd',
                  borderRadius: '8px',
                  padding: '16px',
                }}
              >
                <p style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
                  {card.label}
                </p>
                <p style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: card.highlight ? '#27AE60' : '#0f2a3e',
                }}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {/* Route Stops Timeline */}
          <div style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1B1B1B' }}>
              Route Timeline
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', border: '1px solid #ddd' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f8f8', borderBottom: '2px solid #ddd' }}>
                    <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#333' }}>Stop</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#333' }}>Address</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>ETA</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Distance (mi)</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Fuel Cost</th>
                    <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Toll Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {routeData.stops.map((stop) => (
                    <tr key={stop.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '12px', fontSize: '14px', fontWeight: '600', color: '#0f2a3e' }}>
                        {stop.stopNumber}
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px', color: '#333' }}>
                        <a
                          href={`/ops/delivery/${stop.deliveryId}`}
                          style={{ color: '#0f2a3e', textDecoration: 'none', cursor: 'pointer' }}
                        >
                          {stop.address}
                          <br />
                          <span style={{ fontSize: '12px', color: '#666' }}>{stop.city}, {stop.zip}</span>
                        </a>
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px', color: '#333', textAlign: 'center' }}>
                        {stop.estimatedArrival}
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px', color: '#333', textAlign: 'center' }}>
                        {stop.distanceFromPrevious.toFixed(1)}
                      </td>
                      <td style={{ padding: '12px', fontSize: '14px', color: '#333', textAlign: 'center' }}>
                        ${stop.fuelCost.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '4px 12px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: '600',
                            backgroundColor: stop.recommendation === 'TAKE_TOLL' ? '#D5F4E6' : '#DBEAFE',
                            color: stop.recommendation === 'TAKE_TOLL' ? '#047857' : '#0369A1',
                          }}
                        >
                          {stop.recommendation === 'TAKE_TOLL' ? 'Take Toll' : 'Skip Toll'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fuel Planning Section */}
          <div style={{ marginBottom: '32px', backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '8px', padding: '20px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1B1B1B' }}>
              Fuel Planning
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
              <div>
                <p style={{ fontSize: '13px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Recommended Fuel Stop
                </p>
                <p style={{ fontSize: '16px', fontWeight: '600', color: '#0f2a3e', marginBottom: '4px' }}>
                  After Stop {routeData.recommendedFuelStop.afterStop}
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  Est. Tank Level: {routeData.recommendedFuelStop.estimatedTankLevel}%
                </p>
              </div>
              <div>
                <p style={{ fontSize: '13px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Nearest Stations
                </p>
                {routeData.recommendedFuelStop.nearestStations.map((station, idx) => (
                  <p key={idx} style={{ fontSize: '14px', color: '#333', marginBottom: '4px' }}>
                    • {station}
                  </p>
                ))}
              </div>
              <div>
                <p style={{ fontSize: '13px', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Fuel Price (Used in Calculations)
                </p>
                <p style={{ fontSize: '16px', fontWeight: '600', color: '#0f2a3e' }}>
                  ${routeData.currentFuelPrice.toFixed(2)}/gal
                </p>
              </div>
            </div>
          </div>

          {/* Toll Decision Breakdown */}
          {routeData.stops.some((s) => s.tollCost > 0) && (
            <div style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px', color: '#1B1B1B' }}>
                Toll Decision Breakdown
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', border: '1px solid #ddd' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f8f8', borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: '#333' }}>Road</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Toll Cost</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Alt. Route Time</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Labor Cost</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Net Savings</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontSize: '13px', fontWeight: '600', color: '#333' }}>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeData.stops
                      .filter((stop) => stop.tollCost > 0)
                      .map((stop) => (
                        <tr key={stop.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#333' }}>
                            {stop.tollRoadName || 'Toll Road'}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#333', textAlign: 'center' }}>
                            ${stop.tollCost.toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#333', textAlign: 'center' }}>
                            +{stop.alternativeRouteMinutes} min
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', color: '#333', textAlign: 'center' }}>
                            ${stop.crewLaborCost.toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', fontSize: '14px', fontWeight: '600', color: '#27AE60', textAlign: 'center' }}>
                            ${stop.netSavings.toFixed(2)}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '4px 12px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                backgroundColor: stop.recommendation === 'TAKE_TOLL' ? '#D5F4E6' : '#DBEAFE',
                                color: stop.recommendation === 'TAKE_TOLL' ? '#047857' : '#0369A1',
                              }}
                            >
                              {stop.recommendation === 'TAKE_TOLL' ? 'Take Toll' : 'Skip Toll'}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Settings Panel */}
          <div style={{ marginBottom: '32px' }}>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              style={{
                width: '100%',
                padding: '12px 16px',
                backgroundColor: '#f8f8f8',
                border: '1px solid #ddd',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#0f2a3e',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>Settings</span>
              <span>{settingsOpen ? '▼' : '▶'}</span>
            </button>

            {settingsOpen && (
              <div style={{
                marginTop: '16px',
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '20px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '20px',
              }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                    Fuel Price per Gallon ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={fuelPrice}
                    onChange={(e) => setFuelPrice(parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                    Truck MPG
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={truckMpg}
                    onChange={(e) => setTruckMpg(parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                    Crew Hourly Rate ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={crewHourlyRate}
                    onChange={(e) => setCrewHourlyRate(parseFloat(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>
                    HQ Address
                  </label>
                  <input
                    type="text"
                    value={hqAddress}
                    onChange={(e) => setHqAddress(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '14px',
                    }}
                  />
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <button
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      backgroundColor: savingSettings ? '#ccc' : '#0f2a3e',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: savingSettings ? 'default' : 'pointer',
                    }}
                  >
                    {savingSettings ? 'Saving...' : 'Save Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
