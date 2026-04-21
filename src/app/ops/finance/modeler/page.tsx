'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Card, KPICard, Button, Badge } from '@/components/ui'

/**
 * "What would it take to make $1M net this quarter?" modeler.
 *
 * Inputs:
 *   - Quarter baseline revenue (pulled from YTD / 4 as default)
 *   - Quarter baseline GM% (pulled from YTD)
 *   - Quarter fixed operating expense (user editable; default $300k)
 *   - Revenue growth % (slider)
 *   - Margin change points (slider, ±10 pts)
 *   - Expense reduction % (slider)
 *
 * Output:
 *   - Projected revenue
 *   - Projected GM$
 *   - Projected net
 *   - Delta vs $1M target
 *
 * Scenarios save to localStorage.
 */

interface SavedScenario {
  id: string
  name: string
  revGrowth: number
  marginDelta: number
  expenseCut: number
  baselineRev: number
  baselineGmPct: number
  baselineOpex: number
  createdAt: string
}

const TARGET = 1_000_000

export default function ScenarioModeler() {
  const [baselineRev, setBaselineRev] = useState(1_250_000)
  const [baselineGmPct, setBaselineGmPct] = useState(0.22)
  const [baselineOpex, setBaselineOpex] = useState(300_000)
  const [revGrowth, setRevGrowth] = useState(15)
  const [marginDelta, setMarginDelta] = useState(2)
  const [expenseCut, setExpenseCut] = useState(5)
  const [scenarios, setScenarios] = useState<SavedScenario[]>([])
  const [scenarioName, setScenarioName] = useState('')

  useEffect(() => {
    fetch('/api/ops/finance/gross-margin')
      .then((r) => r.json())
      .then((d) => {
        const quarterRev = (d?.totals?.revenue || 0) / 4 || baselineRev
        setBaselineRev(Math.max(quarterRev, 100_000))
        if (d?.totals?.gmPct != null) setBaselineGmPct(d.totals.gmPct || 0.22)
      })
      .catch(() => {})
    const raw = localStorage.getItem('abel_finance_scenarios')
    if (raw) {
      try {
        setScenarios(JSON.parse(raw))
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const projected = useMemo(() => {
    const newRev = baselineRev * (1 + revGrowth / 100)
    const newGmPct = Math.min(1, Math.max(0, baselineGmPct + marginDelta / 100))
    const newGmDollar = newRev * newGmPct
    const newOpex = baselineOpex * (1 - expenseCut / 100)
    const net = newGmDollar - newOpex
    const deltaToTarget = net - TARGET
    return {
      rev: newRev,
      gmPct: newGmPct,
      gmDollar: newGmDollar,
      opex: newOpex,
      net,
      deltaToTarget,
      onTarget: net >= TARGET,
    }
  }, [baselineRev, baselineGmPct, baselineOpex, revGrowth, marginDelta, expenseCut])

  function saveScenario() {
    if (!scenarioName.trim()) return
    const s: SavedScenario = {
      id: crypto.randomUUID(),
      name: scenarioName.trim(),
      revGrowth,
      marginDelta,
      expenseCut,
      baselineRev,
      baselineGmPct,
      baselineOpex,
      createdAt: new Date().toISOString(),
    }
    const next = [s, ...scenarios].slice(0, 10)
    setScenarios(next)
    localStorage.setItem('abel_finance_scenarios', JSON.stringify(next))
    setScenarioName('')
  }

  function loadScenario(s: SavedScenario) {
    setRevGrowth(s.revGrowth)
    setMarginDelta(s.marginDelta)
    setExpenseCut(s.expenseCut)
    setBaselineRev(s.baselineRev)
    setBaselineGmPct(s.baselineGmPct)
    setBaselineOpex(s.baselineOpex)
  }

  function deleteScenario(id: string) {
    const next = scenarios.filter((s) => s.id !== id)
    setScenarios(next)
    localStorage.setItem('abel_finance_scenarios', JSON.stringify(next))
  }

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="max-w-[1400px] mx-auto p-6 space-y-5">
        <PageHeader
          eyebrow="Finance"
          title="$1M Quarter Modeler"
          description='Drag the levers. Watch the net. "What would it take to make $1M net this quarter?"'
          crumbs={[
            { label: 'Ops', href: '/ops' },
            { label: 'Finance', href: '/ops/finance' },
            { label: 'Modeler' },
          ]}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard
            title="Projected Revenue"
            value={`$${Math.round(projected.rev).toLocaleString()}`}
            delta={`${revGrowth > 0 ? '+' : ''}${revGrowth}%`}
            accent="brand"
          />
          <KPICard
            title="Projected GM"
            value={`${(projected.gmPct * 100).toFixed(1)}%`}
            subtitle={`$${Math.round(projected.gmDollar).toLocaleString()}`}
            accent="accent"
          />
          <KPICard
            title="Projected Net"
            value={`$${Math.round(projected.net).toLocaleString()}`}
            subtitle="after OPEX"
            accent={projected.onTarget ? 'positive' : 'negative'}
          />
          <KPICard
            title="vs $1M Target"
            value={`${projected.deltaToTarget >= 0 ? '+' : ''}$${Math.round(
              projected.deltaToTarget
            ).toLocaleString()}`}
            accent={projected.onTarget ? 'positive' : 'negative'}
            badge={projected.onTarget ? <Badge variant="success" size="xs">ON TARGET</Badge> : <Badge variant="danger" size="xs">GAP</Badge>}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card padding="md">
            <h3 className="text-sm font-semibold text-fg mb-3">Levers</h3>
            <div className="space-y-5">
              <Slider
                label="Revenue growth"
                value={revGrowth}
                min={-20}
                max={75}
                step={1}
                suffix="%"
                onChange={setRevGrowth}
                tone="brand"
              />
              <Slider
                label="Margin change"
                value={marginDelta}
                min={-10}
                max={10}
                step={0.5}
                suffix=" pts"
                onChange={setMarginDelta}
                tone="accent"
              />
              <Slider
                label="Expense reduction"
                value={expenseCut}
                min={-25}
                max={50}
                step={1}
                suffix="%"
                onChange={setExpenseCut}
                tone="positive"
              />
            </div>
          </Card>

          <Card padding="md">
            <h3 className="text-sm font-semibold text-fg mb-3">Baseline assumptions</h3>
            <div className="space-y-3 text-sm">
              <LabeledNumber
                label="Baseline quarterly revenue"
                value={baselineRev}
                onChange={setBaselineRev}
                step={10_000}
              />
              <LabeledNumber
                label="Baseline GM %"
                value={Math.round(baselineGmPct * 1000) / 10}
                onChange={(n) => setBaselineGmPct(n / 100)}
                step={0.5}
                suffix="%"
              />
              <LabeledNumber
                label="Baseline quarterly OPEX"
                value={baselineOpex}
                onChange={setBaselineOpex}
                step={10_000}
              />
            </div>
            <p className="text-[11px] text-fg-subtle mt-4">
              Defaults pre-populated from YTD revenue ÷ 4 and YTD gross margin. OPEX is
              a starting estimate — override with actual.
            </p>
          </Card>
        </div>

        <Card padding="md">
          <h3 className="text-sm font-semibold text-fg mb-3">Save scenario</h3>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1 text-sm"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder="Name this scenario (e.g. 'Pulte + Boise price hold')"
            />
            <Button size="sm" variant="primary" onClick={saveScenario} disabled={!scenarioName.trim()}>
              Save
            </Button>
          </div>
          {scenarios.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {scenarios.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-fg truncate">{s.name}</div>
                    <div className="text-[11px] text-fg-subtle">
                      rev {s.revGrowth >= 0 ? '+' : ''}
                      {s.revGrowth}% · mgn {s.marginDelta >= 0 ? '+' : ''}
                      {s.marginDelta} pts · opex {s.expenseCut >= 0 ? '-' : '+'}
                      {Math.abs(s.expenseCut)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="text-[11px] text-accent-fg hover:underline"
                      onClick={() => loadScenario(s)}
                    >
                      Load
                    </button>
                    <button
                      className="text-[11px] text-data-negative hover:underline"
                      onClick={() => deleteScenario(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  tone,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (n: number) => void
  tone?: 'brand' | 'accent' | 'positive'
}) {
  const toneColor =
    tone === 'brand' ? 'bg-brand' : tone === 'accent' ? 'bg-accent' : 'bg-data-positive'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-fg-muted uppercase tracking-wider">{label}</label>
        <span className={`text-sm font-numeric font-semibold`}>
          {value >= 0 && value !== 0 ? '+' : ''}
          {value}
          {suffix || ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-surface-muted rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${
            ((value - min) / (max - min)) * 100
          }%, var(--surface-muted) ${((value - min) / (max - min)) * 100}%, var(--surface-muted) 100%)`,
        }}
      />
      <div className="flex justify-between text-[10px] text-fg-subtle mt-0.5">
        <span>
          {min}
          {suffix || ''}
        </span>
        <span>
          {max}
          {suffix || ''}
        </span>
      </div>
    </div>
  )
}

function LabeledNumber({
  label,
  value,
  onChange,
  step,
  suffix,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-xs text-fg-muted">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="input w-36 text-sm text-right font-numeric"
        />
        {suffix && <span className="text-xs text-fg-muted">{suffix}</span>}
      </div>
    </div>
  )
}
