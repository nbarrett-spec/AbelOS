'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, DollarSign, Users, Package, Clock } from 'lucide-react';

const NAVY = '#1B4F72';
const ORANGE = '#E67E22';
const GREEN = '#10B981';
const RED = '#EF4444';

interface FinancialScore {
  overall: number;
  cashFlow: number;
  collection: number;
  procurement: number;
  margin: number;
  working: number;
}

interface CashFlowItem {
  label: string;
  amount: number;
  type: 'balance' | 'inflow' | 'outflow';
}

interface OptimizationAction {
  id: string;
  category: 'COLLECTION' | 'PROCUREMENT' | 'PRICING' | 'TERMS' | 'CONSOLIDATION';
  description: string;
  estimatedImpact: number;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'PENDING' | 'APPROVED' | 'IMPLEMENTED';
  details?: string;
}

interface Builder {
  id: string;
  name: string;
  revenueTTM: number;
  outstanding: number;
  avgDaysToPay: number;
  onTimeRate: number;
  creditRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendedTerms: string;
}

interface ProductMargin {
  productId: string;
  name: string;
  current: number;
  target: number;
  contribution: number;
}

interface OptimizationLog {
  date: string;
  action: string;
  category: string;
  estimated: number;
  actual: number | null;
  implementer: string;
}

const formatUSD = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);

const categoryIcons = {
  COLLECTION: '💰',
  PROCUREMENT: '📦',
  PRICING: '💹',
  TERMS: '📋',
  CONSOLIDATION: '🔗',
};

export default function FinancialOptimizationPage() {
  const [loading, setLoading] = useState(true);
  const [financialScore, setFinancialScore] = useState<FinancialScore | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowItem[]>([]);
  const [actions, setActions] = useState<OptimizationAction[]>([]);
  const [builders, setBuilders] = useState<Builder[]>([]);
  const [margins, setMargins] = useState<ProductMargin[]>([]);
  const [optimizationLog, setOptimizationLog] = useState<OptimizationLog[]>([]);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [cashFlowRes, costTrendsRes, vendorRes] = await Promise.all([
          fetch('/api/ops/procurement-intelligence/cash-flow').catch(() => null),
          fetch('/api/ops/procurement-intelligence/cost-trends').catch(() => null),
          fetch('/api/ops/procurement-intelligence/vendor-scoring').catch(() => null),
        ]);

        // Process cash flow data
        if (cashFlowRes?.ok) {
          const data = await cashFlowRes.json();
          const items: CashFlowItem[] = [
            { label: 'Starting Balance', amount: data.startingBalance || 250000, type: 'balance' },
            { label: 'Customer Payments', amount: data.customerPayments || 180000, type: 'inflow' },
            { label: 'Invoices Expected', amount: data.expectedInvoices || 95000, type: 'inflow' },
            { label: 'Vendor Payments', amount: data.vendorPayments || 120000, type: 'outflow' },
            { label: 'Payroll & Overhead', amount: data.payroll || 85000, type: 'outflow' },
            { label: 'PO Commitments', amount: data.poCommitments || 45000, type: 'outflow' },
          ];
          const endBalance = items.reduce((sum, item) => {
            if (item.type === 'inflow') return sum + item.amount;
            if (item.type === 'outflow') return sum - item.amount;
            return sum;
          }, items[0].amount);
          items.push({ label: 'Projected End Balance', amount: endBalance, type: 'balance' });
          setCashFlow(items);

          // Calculate financial score
          setFinancialScore({
            overall: 74,
            cashFlow: 78,
            collection: 68,
            procurement: 76,
            margin: 71,
            working: 70,
          });
        }

        // Mock optimization actions
        setActions([
          {
            id: '1',
            category: 'COLLECTION',
            description: 'Accelerate payment collection from Builder Tech Solutions',
            estimatedImpact: 15000,
            effort: 'LOW',
            status: 'PENDING',
            details: 'Offer 2% discount for payment within 10 days instead of 30. High impact, low friction.',
          },
          {
            id: '2',
            category: 'PROCUREMENT',
            description: 'Consolidate vendor accounts with Regional Distributors',
            estimatedImpact: 22000,
            effort: 'MEDIUM',
            status: 'PENDING',
            details: 'Combine volume across 3 accounts to unlock 8% consolidated discount.',
          },
          {
            id: '3',
            category: 'PRICING',
            description: 'Increase pricing on high-demand lumber grades',
            estimatedImpact: 18000,
            effort: 'MEDIUM',
            status: 'APPROVED',
            details: '3-5% price increase on premium grades with low elasticity.',
          },
          {
            id: '4',
            category: 'TERMS',
            description: 'Renegotiate payment terms with top 5 vendors',
            estimatedImpact: 12000,
            effort: 'HIGH',
            status: 'PENDING',
            details: 'Extend payment terms from net 30 to net 45 for improved cash flow.',
          },
        ]);

        // Mock builder data
        setBuilders([
          {
            id: 'b1',
            name: 'Builder Tech Solutions',
            revenueTTM: 450000,
            outstanding: 67500,
            avgDaysToPay: 38,
            onTimeRate: 0.85,
            creditRisk: 'LOW',
            recommendedTerms: 'Net 30 (2/10)',
          },
          {
            id: 'b2',
            name: 'Elite Construction Group',
            revenueTTM: 380000,
            outstanding: 45200,
            avgDaysToPay: 42,
            onTimeRate: 0.78,
            creditRisk: 'MEDIUM',
            recommendedTerms: 'Net 20',
          },
          {
            id: 'b3',
            name: 'Metropolitan Builders',
            revenueTTM: 320000,
            outstanding: 28900,
            avgDaysToPay: 28,
            onTimeRate: 0.95,
            creditRisk: 'LOW',
            recommendedTerms: 'Net 45',
          },
          {
            id: 'b4',
            name: 'Premier Construction LLC',
            revenueTTM: 215000,
            outstanding: 52100,
            avgDaysToPay: 58,
            onTimeRate: 0.62,
            creditRisk: 'HIGH',
            recommendedTerms: 'Net 15 (COD)',
          },
        ]);

        // Mock margin data
        setMargins([
          { productId: 'p1', name: 'Pressure-Treated Lumber', current: 22, target: 25, contribution: 35000 },
          { productId: 'p2', name: 'Cedar Decking', current: 18, target: 20, contribution: 28000 },
          { productId: 'p3', name: 'Composite Materials', current: 28, target: 30, contribution: 45000 },
          { productId: 'p4', name: 'Fasteners & Hardware', current: 35, target: 35, contribution: 52000 },
          { productId: 'p5', name: 'Plywood Sheets', current: 12, target: 15, contribution: 18000 },
        ]);

        // Mock optimization log
        setOptimizationLog([
          {
            date: '2024-03-20',
            action: 'Implemented early payment discount for ABC Builders',
            category: 'COLLECTION',
            estimated: 8000,
            actual: 8500,
            implementer: 'Sarah Johnson',
          },
          {
            date: '2024-03-15',
            action: 'Negotiated volume discount with Vendor A',
            category: 'PROCUREMENT',
            estimated: 12000,
            actual: 11800,
            implementer: 'Mike Chen',
          },
        ]);

        setLoading(false);
      } catch (err) {
        console.error('Error fetching financial data:', err);
        setError('Failed to load financial data. Using sample data.');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleImplementAction = (actionId: string) => {
    setActions((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, status: 'IMPLEMENTED' } : a))
    );
    // Toast notification would go here
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading financial data...</div>
      </div>
    );
  }

  const maxCashFlowAmount = Math.max(...cashFlow.map((c) => Math.abs(c.amount)));

  return (
    <div style={{ backgroundColor: '#F9FAFB', minHeight: '100vh', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: NAVY, margin: 0 }}>
            Financial Optimization Dashboard
          </h1>
          <p style={{ color: '#666', marginTop: '8px' }}>Maximize operational efficiency and profitability</p>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#FEF2F2',
              border: `1px solid ${RED}`,
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '20px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
            }}
          >
            <AlertCircle size={20} color={RED} />
            <span style={{ color: RED }}>{error}</span>
          </div>
        )}

        {/* Financial Health Score */}
        <div
          style={{
            backgroundColor: NAVY,
            color: 'white',
            padding: '32px',
            borderRadius: '12px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '48px',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '8px' }}>Financial Optimization Score</div>
            <div style={{ fontSize: '64px', fontWeight: 'bold', marginBottom: '16px' }}>
              {financialScore?.overall || 74}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              <div>Cash Flow: {financialScore?.cashFlow || 78}/100</div>
              <div>Collection: {financialScore?.collection || 68}/100</div>
              <div>Procurement: {financialScore?.procurement || 76}/100</div>
              <div>Margin Optimization: {financialScore?.margin || 71}/100</div>
            </div>
          </div>
          <div style={{ flex: 0 }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="55" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
              <circle
                cx="60"
                cy="60"
                r="55"
                fill="none"
                stroke={ORANGE}
                strokeWidth="3"
                strokeDasharray={`${(financialScore?.overall || 74) * 3.456} 345.6`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
              <text x="60" y="68" textAnchor="middle" fill="white" fontSize="24" fontWeight="bold">
                {financialScore?.overall || 74}%
              </text>
            </svg>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
          {/* Cash Flow Waterfall */}
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, marginTop: 0, marginBottom: '20px' }}>
              Cash Flow Waterfall (This Month)
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {cashFlow.map((item, idx) => {
                const percentage = (Math.abs(item.amount) / maxCashFlowAmount) * 100;
                let barColor = '#E5E7EB';
                if (item.type === 'inflow') barColor = GREEN;
                else if (item.type === 'outflow') barColor = RED;
                else barColor = NAVY;

                return (
                  <div key={idx}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                      <span style={{ color: '#374151' }}>{item.label}</span>
                      <span style={{ fontWeight: '600', color: NAVY }}>{formatUSD(item.amount)}</span>
                    </div>
                    <div style={{ height: '20px', backgroundColor: '#F3F4F6', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${percentage}%`,
                          backgroundColor: barColor,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Margin Analysis */}
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, marginTop: 0, marginBottom: '20px' }}>
              Margin Analysis (Current vs Target)
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {margins.slice(0, 3).map((product) => (
                <div key={product.productId}>
                  <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '4px', color: '#1F2937' }}>
                    {product.name}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ flex: 1, display: 'flex', gap: '4px' }}>
                      <div
                        style={{
                          flex: product.current / product.target,
                          height: '8px',
                          backgroundColor: ORANGE,
                          borderRadius: '2px',
                        }}
                      />
                      <div
                        style={{
                          flex: (product.target - product.current) / product.target,
                          height: '8px',
                          backgroundColor: '#E5E7EB',
                          borderRadius: '2px',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '12px', color: '#6B7280', minWidth: '45px' }}>
                      {product.current}% / {product.target}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Optimization Actions Queue */}
        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, marginTop: 0, marginBottom: '20px' }}>
            Optimization Actions Queue
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {actions.map((action) => (
              <div
                key={action.id}
                style={{
                  border: `1px solid ${action.status === 'PENDING' ? '#E5E7EB' : '#D1FAE5'}`,
                  borderRadius: '8px',
                  padding: '16px',
                  backgroundColor: action.status === 'IMPLEMENTED' ? '#F0FDF4' : 'white',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '18px' }}>{categoryIcons[action.category]}</span>
                      <span style={{ fontWeight: '600', color: '#1F2937' }}>{action.description}</span>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          backgroundColor: action.status === 'PENDING' ? '#FEF3C7' : '#D1FAE5',
                          color: action.status === 'PENDING' ? '#92400E' : '#065F46',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: '600',
                        }}
                      >
                        {action.status}
                      </span>
                    </div>
                    {expandedAction === action.id && action.details && (
                      <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px', paddingLeft: '28px' }}>
                        {action.details}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '24px', fontSize: '13px', paddingLeft: '28px' }}>
                      <div>
                        <span style={{ color: '#6B7280' }}>Impact:</span>
                        <span style={{ fontWeight: '600', color: GREEN, marginLeft: '6px' }}>{formatUSD(action.estimatedImpact)}</span>
                      </div>
                      <div>
                        <span style={{ color: '#6B7280' }}>Effort:</span>
                        <span style={{ fontWeight: '600', marginLeft: '6px', color: '#374151' }}>{action.effort}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                    {action.status === 'PENDING' && (
                      <button
                        onClick={() => handleImplementAction(action.id)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: ORANGE,
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Implement
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#F3F4F6',
                        color: NAVY,
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      {expandedAction === action.id ? 'Hide' : 'Details'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Builder Payment Intelligence */}
        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, marginTop: 0, marginBottom: '20px' }}>
            Builder Payment Intelligence
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Builder</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: '600', color: NAVY }}>TTM Revenue</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Outstanding</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Avg Days</th>
                  <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: '600', color: NAVY }}>On-Time %</th>
                  <th style={{ textAlign: 'center', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Risk</th>
                  <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Terms</th>
                </tr>
              </thead>
              <tbody>
                {builders.map((builder, idx) => (
                  <tr key={builder.id} style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                    <td style={{ padding: '12px 8px', color: '#1F2937' }}>{builder.name}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#1F2937' }}>{formatUSD(builder.revenueTTM)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#1F2937' }}>{formatUSD(builder.outstanding)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#1F2937' }}>{builder.avgDaysToPay}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right', color: '#1F2937' }}>{(builder.onTimeRate * 100).toFixed(0)}%</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '600',
                          backgroundColor: builder.creditRisk === 'LOW' ? '#D1FAE5' : builder.creditRisk === 'MEDIUM' ? '#FEF3C7' : '#FEE2E2',
                          color: builder.creditRisk === 'LOW' ? '#065F46' : builder.creditRisk === 'MEDIUM' ? '#92400E' : '#991B1B',
                        }}
                      >
                        {builder.creditRisk}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', color: '#6B7280' }}>{builder.recommendedTerms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Optimization Log */}
        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: NAVY, marginTop: 0, marginBottom: '20px' }}>
            Profit Optimization Log
          </h2>
          {optimizationLog.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${NAVY}` }}>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Date</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Action</th>
                    <th style={{ textAlign: 'center', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Category</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Estimated</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Actual</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontWeight: '600', color: NAVY }}>Implementer</th>
                  </tr>
                </thead>
                <tbody>
                  {optimizationLog.map((log, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: idx % 2 === 0 ? '#F9FAFB' : 'white' }}>
                      <td style={{ padding: '12px 8px', color: '#6B7280' }}>{log.date}</td>
                      <td style={{ padding: '12px 8px', color: '#1F2937' }}>{log.action}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center', color: '#1F2937' }}>{log.category}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', color: GREEN, fontWeight: '600' }}>{formatUSD(log.estimated)}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'right', color: GREEN, fontWeight: '600' }}>
                        {log.actual ? formatUSD(log.actual) : '—'}
                      </td>
                      <td style={{ padding: '12px 8px', color: '#6B7280' }}>{log.implementer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px', color: '#9CA3AF' }}>
              No optimization actions have been implemented yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
