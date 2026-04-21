'use client'

import { useEffect, useState } from 'react'

interface ProductProfitScore {
  productId: string
  name: string
  sku: string
  category: string
  basePrice: number
  cost: number
  marginPct: number
  compositeScore: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  marginScore: number
  marginGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  revenueScore: number
  revenueGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  volumeScore: number
  volumeGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  trendScore: number
  trendGrade: 'A' | 'B' | 'C' | 'D' | 'F'
  unitsSold90d: number
  revenue90d: number
  trendDirection: 'UP' | 'FLAT' | 'DOWN'
  onHand: number
  flags: string[]
}

interface ProfitabilitySummary {
  totalProducts: number
  avgMargin: number
  negativeMarginCount: number
  deadStockCount: number
  gradeDistribution: Record<string, number>
  totalRevenue90d: number
}

const GRADE_COLORS: Record<string, string> = {
  A: 'bg-success-100 text-success-700 border border-success-300',
  B: 'bg-blue-100 text-blue-700 border border-blue-300',
  C: 'bg-warning-100 text-warning-700 border border-warning-300',
  D: 'bg-orange-100 text-orange-700 border border-orange-300',
  F: 'bg-danger-100 text-danger-700 border border-danger-300',
}

const FLAG_COLORS: Record<string, string> = {
  NEGATIVE_MARGIN: 'bg-danger-100 text-danger-700',
  LOW_MARGIN: 'bg-warning-100 text-warning-700',
  DEAD_STOCK: 'bg-orange-100 text-orange-700',
  DECLINING: 'bg-orange-100 text-orange-700',
  HIGH_PERFORMER: 'bg-success-100 text-success-700',
  STOCKOUT_RISK: 'bg-warning-100 text-warning-700',
}

export default function ProductProfitabilityPage() {
  const [products, setProducts] = useState<ProductProfitScore[]>([])
  const [summary, setSummary] = useState<ProfitabilitySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [gradeFilter, setGradeFilter] = useState('ALL')
  const [flagFilter, setFlagFilter] = useState('ALL')
  const [sortBy, setSortBy] = useState('compositeScore')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])

  // Load data
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const resp = await fetch('/api/ops/products/profitability')
        const data = await resp.json()

        setProducts(data.products || [])
        setSummary(data.summary || null)

        // Extract unique categories
        const cats = Array.from(
          new Set((data.products || []).map((p: ProductProfitScore) => p.category))
        ).sort() as string[]
        setCategories(cats)
      } catch (err) {
        console.error('Failed to load profitability data:', err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  // Filter and sort
  const filtered = products.filter(p => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !p.sku.toLowerCase().includes(searchQuery.toLowerCase())) return false
    if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false
    if (gradeFilter !== 'ALL' && p.grade !== gradeFilter) return false
    if (flagFilter !== 'ALL' && !p.flags.includes(flagFilter)) return false
    return true
  })

  filtered.sort((a, b) => {
    const aVal = (sortBy === 'compositeScore' ? a.compositeScore :
                 sortBy === 'marginPct' ? a.marginPct :
                 sortBy === 'revenue90d' ? a.revenue90d :
                 sortBy === 'unitsSold90d' ? a.unitsSold90d :
                 a.compositeScore)
    const bVal = (sortBy === 'compositeScore' ? b.compositeScore :
                 sortBy === 'marginPct' ? b.marginPct :
                 sortBy === 'revenue90d' ? b.revenue90d :
                 sortBy === 'unitsSold90d' ? b.unitsSold90d :
                 b.compositeScore)

    if (sortDir === 'asc') return (aVal as number) - (bVal as number)
    return (bVal as number) - (aVal as number)
  })

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(val)
  }

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="h-10 w-64 bg-gray-200 rounded animate-pulse mb-8"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-white rounded border border-gray-200 animate-pulse"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const negMarginFlag = summary && summary.negativeMarginCount > 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold text-brand">Product Profitability</h1>
          <p className="text-gray-600 mt-1">A-F grades across margin, revenue, volume, and trend</p>
        </div>
      </div>

      {/* Alert: Negative Margin Products */}
      {negMarginFlag && (
        <div className="bg-danger-50 border-l-4 border-danger-500 p-4 mx-6 mt-6">
          <div className="flex items-center gap-3">
            <div className="text-danger-700 font-bold text-lg">{summary.negativeMarginCount}</div>
            <div className="text-danger-700">
              {summary.negativeMarginCount === 1
                ? 'product with negative margin'
                : 'products with negative margins'} — reprice immediately
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Total Products
            </div>
            <div className="text-2xl font-bold text-brand mt-2">{summary.totalProducts}</div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Avg Margin
            </div>
            <div className={`text-2xl font-bold mt-2 ${summary.avgMargin > 25 ? 'text-success-600' : summary.avgMargin > 10 ? 'text-warning-600' : 'text-danger-600'}`}>
              {summary.avgMargin.toFixed(1)}%
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Negative Margin
            </div>
            <div className={`text-2xl font-bold mt-2 ${summary.negativeMarginCount > 0 ? 'text-danger-600' : 'text-gray-600'}`}>
              {summary.negativeMarginCount}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Dead Stock
            </div>
            <div className={`text-2xl font-bold mt-2 ${summary.deadStockCount > 0 ? 'text-warning-600' : 'text-gray-600'}`}>
              {summary.deadStockCount}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              90-Day Revenue
            </div>
            <div className="text-xl font-bold text-brand mt-2">
              {formatCurrency(summary.totalRevenue90d)}
            </div>
          </div>
        </div>
      )}

      {/* Grade Distribution Bar */}
      {summary && (
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
            <h3 className="text-sm font-semibold text-gray-700 uppercase mb-3">
              Grade Distribution
            </h3>
            <div className="flex gap-2 h-10">
              {(['A', 'B', 'C', 'D', 'F'] as const).map(grade => {
                const count = summary.gradeDistribution[grade] || 0
                const pct = summary.totalProducts > 0 ? (count / summary.totalProducts) * 100 : 0
                return (
                  <div
                    key={grade}
                    className={`flex-1 rounded flex items-center justify-center font-bold text-sm ${GRADE_COLORS[grade]}`}
                    title={`Grade ${grade}: ${count} products`}
                  >
                    {grade} ({count})
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-elevation-1">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">
                Search
              </label>
              <input
                type="text"
                placeholder="Name or SKU..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-signal"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-signal"
              >
                <option value="ALL">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">
                Grade
              </label>
              <select
                value={gradeFilter}
                onChange={e => setGradeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-signal"
              >
                <option value="ALL">All Grades</option>
                {(['A', 'B', 'C', 'D', 'F'] as const).map(g => (
                  <option key={g} value={g}>Grade {g}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">
                Flags
              </label>
              <select
                value={flagFilter}
                onChange={e => setFlagFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-signal"
              >
                <option value="ALL">All Products</option>
                <option value="NEGATIVE_MARGIN">Negative Margin</option>
                <option value="LOW_MARGIN">Low Margin (&lt;10%)</option>
                <option value="DEAD_STOCK">Dead Stock</option>
                <option value="DECLINING">Declining</option>
                <option value="HIGH_PERFORMER">High Performer</option>
                <option value="STOCKOUT_RISK">Stockout Risk</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">
                Results
              </label>
              <div className="text-2xl font-bold text-brand">
                {filtered.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="max-w-7xl mx-auto px-6 pb-12">
        <div className="bg-white rounded-lg border border-gray-200 shadow-elevation-1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-16">
                <tr className="divide-x divide-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">SKU</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Category</th>
                  <th className="px-4 py-3 text-center cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('compositeScore')}>
                    <div className="font-semibold text-gray-700">Grade</div>
                    {sortBy === 'compositeScore' && (
                      <div className="text-xs text-gray-500">{sortDir === 'desc' ? '↓' : '↑'}</div>
                    )}
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('marginPct')}>
                    <div className="font-semibold text-gray-700">Margin %</div>
                    {sortBy === 'marginPct' && (
                      <div className="text-xs text-gray-500">{sortDir === 'desc' ? '↓' : '↑'}</div>
                    )}
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('revenue90d')}>
                    <div className="font-semibold text-gray-700">90d Revenue</div>
                    {sortBy === 'revenue90d' && (
                      <div className="text-xs text-gray-500">{sortDir === 'desc' ? '↓' : '↑'}</div>
                    )}
                  </th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:bg-gray-100" onClick={() => toggleSort('unitsSold90d')}>
                    <div className="font-semibold text-gray-700">90d Units</div>
                    {sortBy === 'unitsSold90d' && (
                      <div className="text-xs text-gray-500">{sortDir === 'desc' ? '↓' : '↑'}</div>
                    )}
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Trend</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">On Hand</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((product, idx) => (
                  <tbody key={product.productId}>
                    <tr
                      onClick={() => setExpandedProduct(expandedProduct === product.productId ? null : product.productId)}
                      className="hover:bg-gray-50 cursor-pointer divide-x divide-gray-200"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{product.name}</td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{product.sku}</td>
                      <td className="px-4 py-3 text-gray-600">{product.category}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-3 py-1 rounded font-bold ${GRADE_COLORS[product.grade]}`}>
                          {product.grade}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${
                        product.marginPct < 0 ? 'text-danger-600' :
                        product.marginPct < 10 ? 'text-warning-600' :
                        product.marginPct >= 25 ? 'text-success-600' :
                        'text-gray-900'
                      }`}>
                        {product.marginPct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(product.revenue90d)}</td>
                      <td className="px-4 py-3 text-right">{product.unitsSold90d}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block font-bold ${
                          product.trendDirection === 'UP' ? 'text-success-600' :
                          product.trendDirection === 'DOWN' ? 'text-danger-600' :
                          'text-gray-600'
                        }`}>
                          {product.trendDirection === 'UP' ? '↑' : product.trendDirection === 'DOWN' ? '↓' : '→'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-900 font-semibold">
                        {product.onHand}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {product.flags.slice(0, 2).map(flag => (
                            <span
                              key={flag}
                              className={`px-2 py-1 rounded text-xs font-semibold ${FLAG_COLORS[flag] || 'bg-gray-100 text-gray-700'}`}
                            >
                              {flag === 'NEGATIVE_MARGIN' ? '⚠ Neg' :
                               flag === 'LOW_MARGIN' ? '⚠ Low' :
                               flag === 'DEAD_STOCK' ? '○ Dead' :
                               flag === 'DECLINING' ? '↓ Decl' :
                               flag === 'HIGH_PERFORMER' ? '★ Hi' :
                               flag === 'STOCKOUT_RISK' ? '⚠ Risk' :
                               flag}
                            </span>
                          ))}
                          {product.flags.length > 2 && (
                            <span className="text-xs text-gray-500 px-1">
                              +{product.flags.length - 2}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded Row — Score Breakdown */}
                    {expandedProduct === product.productId && (
                      <tr className="bg-gray-50">
                        <td colSpan={10} className="px-4 py-6">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Left: Score Breakdown */}
                            <div>
                              <h4 className="font-bold text-brand mb-4">Score Breakdown</h4>
                              <div className="space-y-3">
                                <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">Margin Score (40%)</span>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded text-sm font-bold ${GRADE_COLORS[product.marginGrade]}`}>
                                      {product.marginGrade}
                                    </span>
                                    <span className="font-semibold text-gray-900 min-w-12 text-right">
                                      {product.marginScore}/100
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">Revenue Contribution (25%)</span>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded text-sm font-bold ${GRADE_COLORS[product.revenueGrade]}`}>
                                      {product.revenueGrade}
                                    </span>
                                    <span className="font-semibold text-gray-900 min-w-12 text-right">
                                      {product.revenueScore}/100
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">Volume (20%)</span>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded text-sm font-bold ${GRADE_COLORS[product.volumeGrade]}`}>
                                      {product.volumeGrade}
                                    </span>
                                    <span className="font-semibold text-gray-900 min-w-12 text-right">
                                      {product.volumeScore}/100
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">Trend (15%)</span>
                                  <div className="flex items-center gap-2">
                                    <span className={`px-2 py-1 rounded text-sm font-bold ${GRADE_COLORS[product.trendGrade]}`}>
                                      {product.trendGrade}
                                    </span>
                                    <span className="font-semibold text-gray-900 min-w-12 text-right">
                                      {product.trendScore}/100
                                    </span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t-2 border-brand">
                                  <span className="font-bold text-brand">Composite Score</span>
                                  <span className={`px-3 py-1 rounded font-bold text-lg ${GRADE_COLORS[product.grade]}`}>
                                    {product.compositeScore}/100 {product.grade}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Right: Inventory & Suggested Action */}
                            <div>
                              <h4 className="font-bold text-brand mb-4">Inventory & Action</h4>
                              <div className="space-y-3 text-sm">
                                <div className="flex justify-between pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">On Hand</span>
                                  <span className="font-semibold">{product.onHand} units</span>
                                </div>
                                <div className="flex justify-between pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">Base Price</span>
                                  <span className="font-semibold">{formatCurrency(product.basePrice)}</span>
                                </div>
                                <div className="flex justify-between pb-2 border-b border-gray-300">
                                  <span className="text-gray-700">Cost</span>
                                  <span className="font-semibold">{formatCurrency(product.cost)}</span>
                                </div>
                                <div className="flex justify-between pb-4 border-b border-gray-300">
                                  <span className="text-gray-700">Margin</span>
                                  <span className={`font-semibold ${
                                    product.marginPct < 0 ? 'text-danger-600' :
                                    product.marginPct < 10 ? 'text-warning-600' :
                                    'text-success-600'
                                  }`}>
                                    {product.marginPct.toFixed(1)}%
                                  </span>
                                </div>

                                <div className="pt-4 bg-abel-cream rounded p-3">
                                  <h5 className="font-bold text-brand mb-2">Suggested Action</h5>
                                  <ul className="text-xs space-y-1 text-gray-700">
                                    {product.marginPct < 0 && (
                                      <li>• Reprice immediately — losing money on each sale</li>
                                    )}
                                    {product.marginPct > 0 && product.marginPct < 10 && (
                                      <li>• Increase price or reduce cost</li>
                                    )}
                                    {product.flags.includes('DEAD_STOCK') && product.marginPct < 0 && (
                                      <li>• Consider discontinuing this product</li>
                                    )}
                                    {product.flags.includes('DECLINING') && (
                                      <li>• Monitor closely — sales trending down</li>
                                    )}
                                    {product.flags.includes('HIGH_PERFORMER') && (
                                      <li>• Strong performer — increase stock/marketing</li>
                                    )}
                                    {product.flags.includes('STOCKOUT_RISK') && (
                                      <li>• Reorder to avoid stockout</li>
                                    )}
                                    {product.flags.length === 0 && (
                                      <li>• No action needed — steady performer</li>
                                    )}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p className="text-sm">No products match your filters.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
