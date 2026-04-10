'use client';

import React, { useEffect, useState } from 'react';

// Types
interface RecommendationData {
  frequentlyOrdered: Product[];
  buyAgain: Product[];
  frequentlyBoughtTogether: Product[];
  trendingInCategory: Product[];
}

interface ReorderForecastData {
  upcomingReorders: ReorderItem[];
  seasonalPatterns: SeasonalPattern[];
  reorderSummary: {
    overdueCount: number;
    dueSoonCount: number;
    estimatedMonthlySpend: number;
  };
}

interface PricingIntelligenceData {
  tierStatus: {
    currentTier: string;
    nextTier: string;
    percentToNextTier: number;
    currentSpend: number;
    nextTierThreshold: number;
  };
  savingsBreakdown: SavingsMonth[];
  categoryPricing: CategoryPrice[];
}

interface CostPredictorData {
  costByScopeType: ScopeTypeCost[];
  costByCategory: CategoryCost[];
  priceChangeTrends: PriceChangeTrend[];
}

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  image?: string;
}

interface ReorderItem {
  id: string;
  sku: string;
  name: string;
  daysUntilNeeded: number;
  status: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING';
  averageQuantity: number;
  lastOrderDate: string;
}

interface SeasonalPattern {
  month: string;
  peakScore: number;
}

interface SavingsMonth {
  month: string;
  savings: number;
}

interface CategoryPrice {
  category: string;
  priceChangePercent: number;
  priceChangeAmount: number;
}

interface ScopeTypeCost {
  scopeType: string;
  averageCost: number;
}

interface CategoryCost {
  category: string;
  averageCost: number;
}

interface PriceChangeTrend {
  category: string;
  percentChange: number;
}

// Color constants
const COLORS = {
  navy: '#1B4F72',
  orange: '#E67E22',
  darkBg: '#0F172A',
  cardBg: '#1E293B',
  text: '#F8FAFC',
  muted: '#94A3B8',
  red: '#DC2626',
  yellow: '#FBBF24',
  blue: '#3B82F6',
  green: '#10B981',
  border: '#334155',
};

// Skeleton loading component
const SkeletonLoader: React.FC<{ height?: string; width?: string }> = ({
  height = '20px',
  width = '100%'
}) => (
  <div
    style={{
      height,
      width,
      backgroundColor: COLORS.border,
      borderRadius: '8px',
      animation: 'pulse 2s infinite',
    }}
  />
);

// Stat Card Component
const StatCard: React.FC<{
  label: string;
  value: string | number;
  icon: string;
  loading?: boolean;
  color?: string;
}> = ({ label, value, icon, loading = false, color = COLORS.orange }) => (
  <div
    style={{
      backgroundColor: COLORS.cardBg,
      borderRadius: '12px',
      padding: '20px',
      border: `1px solid ${COLORS.border}`,
      transition: 'all 0.3s ease',
      cursor: 'pointer',
      position: 'relative',
      overflow: 'hidden',
    }}
    onMouseEnter={(e) => {
      const el = e.currentTarget as HTMLElement;
      el.style.borderColor = color;
      el.style.boxShadow = `0 0 20px ${color}40`;
      el.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={(e) => {
      const el = e.currentTarget as HTMLElement;
      el.style.borderColor = COLORS.border;
      el.style.boxShadow = 'none';
      el.style.transform = 'translateY(0)';
    }}
  >
    <div style={{ fontSize: '24px', marginBottom: '8px' }}>{icon}</div>
    {loading ? (
      <>
        <SkeletonLoader height="12px" width="60%" />
        <div style={{ marginTop: '8px' }}>
          <SkeletonLoader height="16px" width="80%" />
        </div>
      </>
    ) : (
      <>
        <div style={{ fontSize: '12px', color: COLORS.muted, marginBottom: '8px' }}>
          {label}
        </div>
        <div style={{ fontSize: '28px', fontWeight: '700', color: COLORS.text }}>
          {value}
        </div>
      </>
    )}
  </div>
);

// Reorder Alert Card Component
const ReorderAlertCard: React.FC<{ item: ReorderItem }> = ({ item }) => {
  const statusColor = {
    OVERDUE: COLORS.red,
    DUE_SOON: COLORS.yellow,
    UPCOMING: COLORS.blue,
  }[item.status];

  const statusLabel = {
    OVERDUE: 'OVERDUE',
    DUE_SOON: 'Due Soon',
    UPCOMING: 'Upcoming',
  }[item.status];

  return (
    <div
      style={{
        backgroundColor: COLORS.cardBg,
        borderRadius: '12px',
        padding: '16px',
        border: `1px solid ${COLORS.border}`,
        transition: 'all 0.3s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = statusColor;
        el.style.boxShadow = `0 0 20px ${statusColor}40`;
        el.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = COLORS.border;
        el.style.boxShadow = 'none';
        el.style.transform = 'translateY(0)';
      }}
    >
      <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <h4 style={{ margin: 0, color: COLORS.text, fontSize: '16px', fontWeight: '600' }}>
            {item.name}
          </h4>
          <p style={{ margin: '4px 0 0 0', color: COLORS.muted, fontSize: '12px' }}>
            SKU: {item.sku}
          </p>
        </div>
        <span
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
            padding: '4px 8px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: '600',
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <div style={{ color: COLORS.muted, fontSize: '11px', marginBottom: '4px' }}>
            Days {item.status === 'OVERDUE' ? 'Overdue' : 'Until Needed'}
          </div>
          <div style={{ color: COLORS.text, fontSize: '18px', fontWeight: '600' }}>
            {Math.abs(item.daysUntilNeeded)}
          </div>
        </div>
        <div>
          <div style={{ color: COLORS.muted, fontSize: '11px', marginBottom: '4px' }}>
            Avg Quantity
          </div>
          <div style={{ color: COLORS.text, fontSize: '18px', fontWeight: '600' }}>
            {item.averageQuantity}
          </div>
        </div>
      </div>
      <a
        href={`/quick-order?sku=${item.sku}`}
        style={{
          display: 'block',
          backgroundColor: COLORS.orange,
          color: '#000',
          padding: '10px',
          borderRadius: '8px',
          textAlign: 'center',
          textDecoration: 'none',
          fontSize: '13px',
          fontWeight: '600',
          transition: 'all 0.2s ease',
          border: 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = '0.9';
          el.style.transform = 'scale(1.02)';
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLElement;
          el.style.opacity = '1';
          el.style.transform = 'scale(1)';
        }}
      >
        Add to Cart
      </a>
    </div>
  );
};

// Product Card Component
const ProductCard: React.FC<{ product: Product; reason: string }> = ({ product, reason }) => (
  <div
    style={{
      backgroundColor: COLORS.cardBg,
      borderRadius: '12px',
      padding: '16px',
      border: `1px solid ${COLORS.border}`,
      transition: 'all 0.3s ease',
    }}
    onMouseEnter={(e) => {
      const el = e.currentTarget as HTMLElement;
      el.style.borderColor = COLORS.orange;
      el.style.boxShadow = `0 0 20px ${COLORS.orange}40`;
      el.style.transform = 'translateY(-2px)';
    }}
    onMouseLeave={(e) => {
      const el = e.currentTarget as HTMLElement;
      el.style.borderColor = COLORS.border;
      el.style.boxShadow = 'none';
      el.style.transform = 'translateY(0)';
    }}
  >
    <div style={{ marginBottom: '12px' }}>
      <div style={{ height: '80px', backgroundColor: COLORS.darkBg, borderRadius: '8px', marginBottom: '8px' }} />
      <h4 style={{ margin: '0 0 4px 0', color: COLORS.text, fontSize: '14px', fontWeight: '600' }}>
        {product.name}
      </h4>
      <p style={{ margin: 0, color: COLORS.muted, fontSize: '12px' }}>
        {product.category}
      </p>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '8px' }}>
      <div style={{ fontSize: '18px', fontWeight: '700', color: COLORS.orange }}>
        ${product.price.toFixed(2)}
      </div>
      <span
        style={{
          backgroundColor: `${COLORS.orange}20`,
          color: COLORS.orange,
          padding: '4px 8px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '600',
        }}
      >
        {reason}
      </span>
    </div>
  </div>
);

// Main Page Component
export default function IntelligencePage() {
  const [recommendations, setRecommendations] = useState<RecommendationData | null>(null);
  const [reorderForecast, setReorderForecast] = useState<ReorderForecastData | null>(null);
  const [pricingIntel, setPricingIntel] = useState<PricingIntelligenceData | null>(null);
  const [costPredictor, setCostPredictor] = useState<CostPredictorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'buyAgain' | 'frequentlyBought' | 'trending'>('buyAgain');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [recRes, reorderRes, pricingRes, costRes] = await Promise.all([
          fetch('/api/builder/recommendations'),
          fetch('/api/builder/reorder-forecast'),
          fetch('/api/builder/pricing-intelligence'),
          fetch('/api/builder/cost-predictor'),
        ]);

        if (recRes.ok) setRecommendations(await recRes.json());
        if (reorderRes.ok) setReorderForecast(await reorderRes.json());
        if (pricingRes.ok) setPricingIntel(await pricingRes.json());
        if (costRes.ok) setCostPredictor(await costRes.json());
      } catch (error) {
        console.error('Error fetching intelligence data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Calculate YTD Savings
  const ytdSavings = pricingIntel?.savingsBreakdown.reduce((sum, m) => sum + m.savings, 0) || 0;

  // Count price alerts
  const priceAlerts = pricingIntel?.categoryPricing.filter((cp) => cp.priceChangePercent > 5).length || 0;

  // Count trending products not ordered
  const trendingNotOrdered = recommendations?.trendingInCategory.length || 0;

  return (
    <div style={{ backgroundColor: COLORS.darkBg, minHeight: '100vh', padding: '32px', color: COLORS.text }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        * { box-sizing: border-box; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '32px' }}>⚡</span>
          <h1 style={{ margin: 0, fontSize: '36px', fontWeight: '800', color: COLORS.text }}>
            Intelligence Center
          </h1>
        </div>
        <p style={{ margin: '8px 0 0 0', color: COLORS.muted, fontSize: '16px' }}>
          AI-powered insights for smarter building
        </p>
      </div>

      {/* Top Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '40px' }}>
        <StatCard
          label="Estimated Monthly Spend"
          value={`$${reorderForecast?.reorderSummary.estimatedMonthlySpend.toLocaleString() || '0'}`}
          icon="💰"
          loading={loading}
          color={COLORS.green}
        />
        <StatCard
          label="Items Due for Reorder"
          value={(reorderForecast?.reorderSummary.overdueCount || 0) + (reorderForecast?.reorderSummary.dueSoonCount || 0)}
          icon="📦"
          loading={loading}
          color={COLORS.red}
        />
        <StatCard
          label="YTD Savings"
          value={`$${ytdSavings.toLocaleString()}`}
          icon="💎"
          loading={loading}
          color={COLORS.orange}
        />
        <StatCard
          label="Trending Products"
          value={trendingNotOrdered}
          icon="🔥"
          loading={loading}
          color={COLORS.orange}
        />
        <StatCard
          label="Price Alerts"
          value={priceAlerts}
          icon="⚠️"
          loading={loading}
          color={COLORS.yellow}
        />
      </div>

      {/* Reorder Alerts Section */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: COLORS.text }}>
          Reorder Alerts
        </h2>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ backgroundColor: COLORS.cardBg, borderRadius: '12px', padding: '16px', border: `1px solid ${COLORS.border}` }}>
                <SkeletonLoader height="16px" width="70%" />
                <div style={{ marginTop: '12px' }}>
                  <SkeletonLoader height="12px" width="100%" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {reorderForecast?.upcomingReorders.map((item) => (
              <ReorderAlertCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* Smart Recommendations Section */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: COLORS.text }}>
          Smart Recommendations
        </h2>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: `1px solid ${COLORS.border}`, paddingBottom: '0' }}>
          {[
            { id: 'buyAgain' as const, label: 'Buy Again' },
            { id: 'frequentlyBought' as const, label: 'Frequently Bought Together' },
            { id: 'trending' as const, label: 'Trending' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '12px 16px',
                backgroundColor: 'transparent',
                border: 'none',
                color: activeTab === tab.id ? COLORS.orange : COLORS.muted,
                fontSize: '14px',
                fontWeight: activeTab === tab.id ? '700' : '600',
                cursor: 'pointer',
                borderBottom: activeTab === tab.id ? `2px solid ${COLORS.orange}` : '1px solid transparent',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                if (activeTab !== tab.id) el.style.color = COLORS.text;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                if (activeTab !== tab.id) el.style.color = COLORS.muted;
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{ backgroundColor: COLORS.cardBg, borderRadius: '12px', padding: '16px', border: `1px solid ${COLORS.border}` }}>
                <SkeletonLoader height="80px" width="100%" />
                <div style={{ marginTop: '12px' }}>
                  <SkeletonLoader height="12px" width="100%" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
            {activeTab === 'buyAgain' &&
              recommendations?.buyAgain.map((product) => (
                <ProductCard key={product.id} product={product} reason="Buy Again" />
              ))}
            {activeTab === 'frequentlyBought' &&
              recommendations?.frequentlyBoughtTogether.map((product) => (
                <ProductCard key={product.id} product={product} reason="Often Paired" />
              ))}
            {activeTab === 'trending' &&
              recommendations?.trendingInCategory.map((product) => (
                <ProductCard key={product.id} product={product} reason="Trending" />
              ))}
          </div>
        )}
      </section>

      {/* Pricing Intelligence Section */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: COLORS.text }}>
          Pricing Intelligence
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
          {/* Tier Progress */}
          <div style={{ backgroundColor: COLORS.cardBg, borderRadius: '12px', padding: '24px', border: `1px solid ${COLORS.border}` }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: COLORS.text }}>
              Tier Progress
            </h3>
            {loading ? (
              <SkeletonLoader />
            ) : (
              <>
                <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: COLORS.muted, fontSize: '13px' }}>
                    {pricingIntel?.tierStatus.currentTier}
                  </span>
                  <span style={{ color: COLORS.orange, fontSize: '13px', fontWeight: '600' }}>
                    {pricingIntel?.tierStatus.percentToNextTier}%
                  </span>
                </div>
                <div
                  style={{
                    height: '12px',
                    backgroundColor: COLORS.darkBg,
                    borderRadius: '6px',
                    overflow: 'hidden',
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pricingIntel?.tierStatus.percentToNextTier}%`,
                      background: `linear-gradient(90deg, ${COLORS.navy}, ${COLORS.orange})`,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <div style={{ marginTop: '12px', fontSize: '12px', color: COLORS.muted }}>
                  <div>
                    Current: ${(pricingIntel?.tierStatus.currentSpend || 0).toLocaleString()}
                  </div>
                  <div>
                    Next tier: ${(pricingIntel?.tierStatus.nextTierThreshold || 0).toLocaleString()}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Savings Chart */}
          <div style={{ backgroundColor: COLORS.cardBg, borderRadius: '12px', padding: '24px', border: `1px solid ${COLORS.border}` }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: COLORS.text }}>
              Monthly Savings Trend
            </h3>
            {loading ? (
              <SkeletonLoader />
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px' }}>
                {pricingIntel?.savingsBreakdown.map((month, idx) => {
                  const maxSavings = Math.max(...(pricingIntel?.savingsBreakdown.map((m) => m.savings) || [1]));
                  const height = (month.savings / maxSavings) * 100;
                  return (
                    <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                      <div
                        style={{
                          width: '100%',
                          height: `${height}%`,
                          backgroundColor: COLORS.orange,
                          borderRadius: '4px 4px 0 0',
                          transition: 'all 0.3s ease',
                          cursor: 'pointer',
                          opacity: 0.8,
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.opacity = '0.8';
                        }}
                        title={`${month.month}: $${month.savings}`}
                      />
                      <span style={{ fontSize: '10px', color: COLORS.muted }}>
                        {month.month.substring(0, 3)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Cost Estimator Section */}
      <section style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: COLORS.text }}>
          Cost Estimator Quick Look
        </h2>
        <div style={{ backgroundColor: COLORS.cardBg, borderRadius: '12px', padding: '24px', border: `1px solid ${COLORS.border}` }}>
          {loading ? (
            <>
              <SkeletonLoader />
              <div style={{ marginTop: '16px' }}>
                <SkeletonLoader />
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {costPredictor?.costByScopeType.map((scope, idx) => {
                const maxCost = Math.max(...(costPredictor?.costByScopeType.map((s) => s.averageCost) || [1]));
                const width = (scope.averageCost / maxCost) * 100;
                return (
                  <div key={idx}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: COLORS.text, fontSize: '13px', fontWeight: '500' }}>
                        {scope.scopeType}
                      </span>
                      <span style={{ color: COLORS.orange, fontSize: '13px', fontWeight: '600' }}>
                        ${scope.averageCost.toLocaleString()}
                      </span>
                    </div>
                    <div
                      style={{
                        height: '8px',
                        backgroundColor: COLORS.darkBg,
                        borderRadius: '4px',
                        overflow: 'hidden',
                        border: `1px solid ${COLORS.border}`,
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${width}%`,
                          background: `linear-gradient(90deg, ${COLORS.navy}, ${COLORS.orange})`,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Seasonal Patterns Section */}
      <section>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '20px', color: COLORS.text }}>
          Seasonal Patterns
        </h2>
        <div style={{ backgroundColor: COLORS.cardBg, borderRadius: '12px', padding: '24px', border: `1px solid ${COLORS.border}` }}>
          {loading ? (
            <SkeletonLoader />
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '140px' }}>
              {reorderForecast?.seasonalPatterns.map((pattern, idx) => {
                const maxScore = Math.max(...(reorderForecast?.seasonalPatterns.map((p) => p.peakScore) || [1]));
                const height = (pattern.peakScore / maxScore) * 100;
                return (
                  <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                    <div
                      style={{
                        width: '100%',
                        height: `${height}%`,
                        backgroundColor: COLORS.navy,
                        borderRadius: '4px 4px 0 0',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.backgroundColor = COLORS.orange;
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.backgroundColor = COLORS.navy;
                      }}
                      title={`${pattern.month}: Peak Score ${pattern.peakScore}`}
                    />
                    <span style={{ fontSize: '11px', color: COLORS.muted }}>
                      {pattern.month.substring(0, 3)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
