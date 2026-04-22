'use client';

import { useEffect, useState } from 'react';

// Types — matched to /api/ops/ai-orders response schema
interface PORecommendation {
  vendorId: string;
  vendorName: string;
  items: Array<{
    productId: string;
    productName: string;
    requiredQty: number;
    availableQty: number;
    shortfall: number;
    vendorSku: string;
    unitCost: number;
  }>;
  estimatedTotal: number;
  suggestedOrderDate: string;
  urgency: 'IMMEDIATE' | 'STANDARD' | 'FLEXIBLE';
  creditImpact: {
    limit: number;
    used: number;
    available: number;
    afterPO: number;
  };
}

interface SORecommendation {
  orderId: string;
  orderNumber: string;
  builderName: string;
  status: string;
  allItemsAvailable: boolean;
  shortItems: Array<{
    productId: string;
    productName: string;
    required: number;
    available: number;
    shortfall: number;
  }>;
}

interface CreditAlert {
  vendorId: string;
  vendorName: string;
  limit: number;
  used: number;
  available: number;
  utilization: number;
  projectedUtilization: number;
}

interface DashboardSummary {
  pendingOrders: number;
  poRecommendations: number;
  autoConfirmable: number;
  creditWarnings: number;
}

// Constants
const ABEL_NAVY = '#0f2a3e';
const ABEL_ORANGE = '#C6A24E';
const LIGHT_GRAY = '#F5F5F5';
const BORDER_COLOR = '#DDDDDD';

export default function AIOrderCommandCenter() {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [recommendations, setRecommendations] = useState<PORecommendation[]>([]);
  const [receivedOrders, setReceivedOrders] = useState<SORecommendation[]>([]);
  const [creditAlerts, setCreditAlerts] = useState<CreditAlert[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>({ pendingOrders: 0, poRecommendations: 0, autoConfirmable: 0, creditWarnings: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load initial data and AI preference
  useEffect(() => {
    try {
      const savedAiState = window?.sessionStorage?.getItem?.('ai-auto-processing');
      if (savedAiState) setAiEnabled(JSON.parse(savedAiState));
    } catch {}
    fetchAllData();
  }, []);

  // Save AI preference
  useEffect(() => {
    try { window?.sessionStorage?.setItem?.('ai-auto-processing', JSON.stringify(aiEnabled)); } catch {}
  }, [aiEnabled]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      // Single endpoint returns everything: poRecommendations, soRecommendations, creditAlerts, summary
      const res = await fetch('/api/ops/ai-orders');
      if (res.ok) {
        const d = await res.json();
        setRecommendations(d.poRecommendations || []);
        setReceivedOrders(d.soRecommendations || []);
        setCreditAlerts(d.creditAlerts || []);
        setSummary(d.summary || { pendingOrders: 0, poRecommendations: 0, autoConfirmable: 0, creditWarnings: 0 });
      }
    } catch (error) {
      showToast('error', 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const createPO = async (recommendationIndex: number, vendorName: string) => {
    setLoadingAction(`po-${recommendationIndex}`);
    try {
      const res = await fetch('/api/ops/ai-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_po', recommendationIndex }),
      });
      if (res.ok) {
        showToast('success', `PO created for ${vendorName}`);
        await fetchAllData();
      } else {
        showToast('error', 'Failed to create PO');
      }
    } catch (error) {
      showToast('error', 'Error creating PO');
    } finally {
      setLoadingAction(null);
    }
  };

  const createAllPOs = async () => {
    setLoadingAction('create-all');
    try {
      const res = await fetch('/api/ops/ai-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_all_pos' }),
      });
      if (res.ok) {
        showToast('success', `${recommendations.length} POs created successfully`);
        await fetchAllData();
      } else {
        showToast('error', 'Failed to create all POs');
      }
    } catch (error) {
      showToast('error', 'Error creating POs');
    } finally {
      setLoadingAction(null);
    }
  };

  const confirmOrder = async (orderId: string) => {
    setLoadingAction(`order-${orderId}`);
    try {
      const res = await fetch('/api/ops/ai-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_order', orderId }),
      });
      if (res.ok) {
        showToast('success', 'Order confirmed successfully');
        await fetchAllData();
      } else {
        showToast('error', 'Failed to confirm order');
      }
    } catch (error) {
      showToast('error', 'Error confirming order');
    } finally {
      setLoadingAction(null);
    }
  };

  const confirmAllOrders = async () => {
    setLoadingAction('confirm-all');
    let confirmed = 0;
    try {
      const available = receivedOrders.filter((o) => o.allItemsAvailable);
      for (const order of available) {
        const res = await fetch('/api/ops/ai-orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirm_order', orderId: order.orderId }),
        });
        if (res.ok) confirmed++;
      }
      showToast('success', `${confirmed} orders confirmed`);
      await fetchAllData();
    } catch (error) {
      showToast('error', 'Error confirming orders');
    } finally {
      setLoadingAction(null);
    }
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'IMMEDIATE':
        return '#E74C3C';
      case 'STANDARD':
        return ABEL_ORANGE;
      case 'FLEXIBLE':
        return '#27AE60';
      default:
        return BORDER_COLOR;
    }
  };

  const getCreditStatusColor = (percent: number) => {
    if (percent >= 95) return '#E74C3C';
    if (percent >= 80) return ABEL_ORANGE;
    return '#27AE60';
  };

  const pendingOrdersCount = summary.pendingOrders;
  const autoConfirmableCount = summary.autoConfirmable;
  const creditWarningsCount = summary.creditWarnings;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFFFFF' }}>
      {/* Toast Notifications */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '16px 24px',
            borderRadius: '6px',
            backgroundColor: toast.type === 'success' ? '#27AE60' : '#E74C3C',
            color: 'white',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            fontWeight: 500,
          }}
        >
          {toast.message}
        </div>
      )}

      {/* AI Auto-Processing Banner */}
      {aiEnabled && (
        <div
          style={{
            backgroundColor: '#D5F4E6',
            borderLeft: `4px solid #27AE60`,
            padding: '12px 16px',
            fontSize: '14px',
            color: '#1E5631',
            fontWeight: 500,
          }}
        >
          ✓ AI is monitoring orders and will auto-generate POs when needed
        </div>
      )}

      {/* Main Container */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 20px' }}>
        {/* Header Section */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '32px',
            flexWrap: 'wrap',
            gap: '20px',
          }}
        >
          <div>
            <h1
              style={{
                fontSize: '32px',
                fontWeight: 700,
                color: ABEL_NAVY,
                margin: '0 0 4px 0',
              }}
            >
              AI Order Command Center
            </h1>
            <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
              Real-time monitoring and intelligent order automation
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              onClick={fetchAllData}
              disabled={loading}
              style={{
                padding: '10px 16px',
                borderRadius: '6px',
                border: `1px solid ${BORDER_COLOR}`,
                backgroundColor: '#F5F5F5',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                color: ABEL_NAVY,
              }}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                paddingLeft: '20px',
                borderLeft: `1px solid ${BORDER_COLOR}`,
              }}
            >
              <label style={{ fontSize: '14px', fontWeight: 500, color: '#333' }}>
                AI Auto-Processing
              </label>
              <button
                onClick={() => setAiEnabled(!aiEnabled)}
                style={{
                  width: '48px',
                  height: '28px',
                  borderRadius: '14px',
                  border: 'none',
                  backgroundColor: aiEnabled ? '#27AE60' : '#CCCCCC',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background-color 0.3s',
                }}
              >
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: 'white',
                    position: 'absolute',
                    top: '2px',
                    left: aiEnabled ? '22px' : '2px',
                    transition: 'left 0.3s',
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
            marginBottom: '40px',
          }}
        >
          {[
            {
              label: 'Pending Orders',
              value: pendingOrdersCount,
              bgColor: '#E8F4F8',
              borderColor: '#3498DB',
            },
            {
              label: 'PO Recommendations',
              value: recommendations.length,
              bgColor: '#FFF3E0',
              borderColor: ABEL_ORANGE,
            },
            {
              label: 'Auto-Confirmable',
              value: autoConfirmableCount,
              bgColor: '#E8F8F0',
              borderColor: '#27AE60',
            },
            {
              label: 'Credit Warnings',
              value: creditWarningsCount,
              bgColor: '#FADBD8',
              borderColor: '#E74C3C',
            },
          ].map((card, idx) => (
            <div
              key={idx}
              style={{
                backgroundColor: card.bgColor,
                borderLeft: `4px solid ${card.borderColor}`,
                padding: '20px',
                borderRadius: '8px',
                textAlign: 'center',
              }}
            >
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#666' }}>
                {card.label}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: '28px',
                  fontWeight: 700,
                  color: card.borderColor,
                }}
              >
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* PO Recommendations Section */}
        <div style={{ marginBottom: '40px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 600,
                color: ABEL_NAVY,
                margin: 0,
              }}
            >
              PO Recommendations
            </h2>
            {recommendations.length > 0 && (
              <button
                onClick={createAllPOs}
                disabled={loadingAction === 'create-all'}
                style={{
                  padding: '10px 24px',
                  backgroundColor: ABEL_NAVY,
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: loadingAction === 'create-all' ? 'not-allowed' : 'pointer',
                  opacity: loadingAction === 'create-all' ? 0.7 : 1,
                }}
              >
                {loadingAction === 'create-all' ? 'Creating...' : 'Create All POs'}
              </button>
            )}
          </div>

          {loading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: LIGHT_GRAY,
                    borderRadius: '8px',
                    padding: '20px',
                    height: '300px',
                    animation: 'pulse 2s infinite',
                  }}
                />
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                color: '#999',
              }}
            >
              <p style={{ fontSize: '16px', margin: 0 }}>
                No PO recommendations at this time
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {recommendations.map((rec, recIdx) => (
                <div
                  key={rec.vendorId}
                  style={{
                    border: `1px solid ${BORDER_COLOR}`,
                    borderRadius: '8px',
                    overflow: 'hidden',
                    backgroundColor: '#FAFAFA',
                  }}
                >
                  {/* Card Header */}
                  <div style={{ padding: '16px', borderBottom: `1px solid ${BORDER_COLOR}` }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'start',
                        marginBottom: '8px',
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            margin: '0 0 4px 0',
                            fontSize: '16px',
                            fontWeight: 600,
                            color: ABEL_NAVY,
                          }}
                        >
                          {rec.vendorName}
                        </h3>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '13px',
                            color: '#666',
                          }}
                        >
                          Est. Total: ${rec.estimatedTotal.toFixed(2)}
                        </p>
                      </div>
                      <div
                        style={{
                          backgroundColor: getUrgencyColor(rec.urgency),
                          color: 'white',
                          padding: '4px 12px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {rec.urgency}
                      </div>
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '12px',
                        color: '#999',
                      }}
                    >
                      Order by {new Date(rec.suggestedOrderDate).toLocaleDateString()}
                    </p>
                  </div>

                  {/* Items */}
                  <div style={{ padding: '16px', borderBottom: `1px solid ${BORDER_COLOR}` }}>
                    <p
                      style={{
                        margin: '0 0 12px 0',
                        fontSize: '12px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: '#666',
                      }}
                    >
                      Items
                    </p>
                    {rec.items.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '13px',
                          marginBottom: idx < rec.items.length - 1 ? '8px' : 0,
                          color: '#333',
                        }}
                      >
                        <span>
                          {item.productName} ({item.shortfall}x)
                        </span>
                        <span style={{ fontWeight: 500 }}>
                          ${(item.shortfall * item.unitCost).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Smart Timing */}
                  <div style={{ padding: '16px', borderBottom: `1px solid ${BORDER_COLOR}` }}>
                    <p
                      style={{
                        margin: '0 0 8px 0',
                        fontSize: '12px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: '#666',
                      }}
                    >
                      Smart Timing
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: '12px',
                        color: '#333',
                        lineHeight: '1.5',
                      }}
                    >
                      Order by{' '}
                      <strong>{new Date(rec.suggestedOrderDate).toLocaleDateString()}</strong>
                      {' · '}{rec.items.length} item{rec.items.length !== 1 ? 's' : ''} across{' '}
                      <strong>{rec.items.reduce((sum, i) => sum + i.shortfall, 0)}</strong> units
                    </p>
                  </div>

                  {/* Credit Impact */}
                  <div style={{ padding: '16px', borderBottom: `1px solid ${BORDER_COLOR}` }}>
                    <p
                      style={{
                        margin: '0 0 12px 0',
                        fontSize: '12px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: '#666',
                      }}
                    >
                      Credit Impact
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '12px',
                        marginBottom: '8px',
                        color: '#333',
                      }}
                    >
                      <span>Usage: ${rec.creditImpact.used.toFixed(2)}</span>
                      <span>Limit: ${rec.creditImpact.limit.toFixed(2)}</span>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: '8px',
                        backgroundColor: '#E8E8E8',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        marginBottom: '8px',
                      }}
                    >
                      <div
                        style={{
                          width: `${rec.creditImpact.limit > 0 ? Math.min((rec.creditImpact.used / rec.creditImpact.limit) * 100, 100) : 0}%`,
                          height: '100%',
                          backgroundColor: getCreditStatusColor(rec.creditImpact.limit > 0 ? (rec.creditImpact.used / rec.creditImpact.limit) * 100 : 0),
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        color: '#999',
                      }}
                    >
                      <span>Current: {rec.creditImpact.limit > 0 ? ((rec.creditImpact.used / rec.creditImpact.limit) * 100).toFixed(0) : 0}%</span>
                      <span>After PO: {rec.creditImpact.limit > 0 ? (((rec.creditImpact.used + rec.estimatedTotal) / rec.creditImpact.limit) * 100).toFixed(0) : 0}%</span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div style={{ padding: '16px' }}>
                    <button
                      onClick={() => createPO(recIdx, rec.vendorName)}
                      disabled={loadingAction === `po-${recIdx}`}
                      style={{
                        width: '100%',
                        padding: '12px',
                        backgroundColor: ABEL_ORANGE,
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor:
                          loadingAction === `po-${recIdx}` ? 'not-allowed' : 'pointer',
                        opacity: loadingAction === `po-${recIdx}` ? 0.7 : 1,
                      }}
                    >
                      {loadingAction === `po-${recIdx}` ? 'Creating...' : 'Create PO'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Order Confirmations Section */}
        <div style={{ marginBottom: '40px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}
          >
            <h2
              style={{
                fontSize: '20px',
                fontWeight: 600,
                color: ABEL_NAVY,
                margin: 0,
              }}
            >
              Order Confirmations
            </h2>
            {autoConfirmableCount > 0 && (
              <button
                onClick={confirmAllOrders}
                disabled={loadingAction === 'confirm-all'}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#27AE60',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: loadingAction === 'confirm-all' ? 'not-allowed' : 'pointer',
                  opacity: loadingAction === 'confirm-all' ? 0.7 : 1,
                }}
              >
                {loadingAction === 'confirm-all'
                  ? 'Confirming...'
                  : `Confirm All Available (${autoConfirmableCount})`}
              </button>
            )}
          </div>

          {loading ? (
            <div
              style={{
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                height: '200px',
                animation: 'pulse 2s infinite',
              }}
            />
          ) : receivedOrders.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                color: '#999',
              }}
            >
              <p style={{ fontSize: '16px', margin: 0 }}>No received orders</p>
            </div>
          ) : (
            <div
              style={{
                border: `1px solid ${BORDER_COLOR}`,
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '14px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: LIGHT_GRAY,
                      borderBottom: `1px solid ${BORDER_COLOR}`,
                    }}
                  >
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Order #
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Builder
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Short Items
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'left',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Status
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Inventory Status
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receivedOrders.map((order) => (
                    <tr
                      key={order.orderId}
                      style={{
                        borderBottom: `1px solid ${BORDER_COLOR}`,
                        backgroundColor: order.allItemsAvailable ? '#F0F8FF' : '#FAFAFA',
                      }}
                    >
                      <td style={{ padding: '12px 16px', fontWeight: 500 }}>
                        {order.orderNumber}
                      </td>
                      <td style={{ padding: '12px 16px' }}>{order.builderName}</td>
                      <td
                        style={{
                          padding: '12px 16px',
                          fontSize: '13px',
                          color: '#666',
                        }}
                      >
                        {order.shortItems.length > 0
                          ? `${order.shortItems.length} short`
                          : 'None'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: '13px', color: '#666' }}>{order.status}</span>
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          textAlign: 'center',
                        }}
                      >
                        <div
                          style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 500,
                            backgroundColor: order.allItemsAvailable
                              ? '#D4EDDA'
                              : '#FFF3CD',
                            color: order.allItemsAvailable
                              ? '#155724'
                              : '#856404',
                          }}
                        >
                          {order.allItemsAvailable
                            ? '✓ All Available'
                            : '⚠ Some Short'}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          textAlign: 'center',
                        }}
                      >
                        <button
                          onClick={() => confirmOrder(order.orderId)}
                          disabled={loadingAction === `order-${order.orderId}`}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: order.allItemsAvailable
                              ? '#27AE60'
                              : ABEL_ORANGE,
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor:
                              loadingAction === `order-${order.orderId}` ? 'not-allowed' : 'pointer',
                            opacity: loadingAction === `order-${order.orderId}` ? 0.7 : 1,
                          }}
                        >
                          {loadingAction === `order-${order.orderId}`
                            ? 'Processing...'
                            : order.allItemsAvailable
                            ? 'Confirm'
                            : 'Confirm (Partial)'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Credit Alerts Section */}
        <div style={{ marginBottom: '40px' }}>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: ABEL_NAVY,
              margin: '0 0 20px 0',
            }}
          >
            Vendor Credit Alerts
          </h2>

          {loading ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '16px',
              }}
            >
              {[1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: LIGHT_GRAY,
                    borderRadius: '8px',
                    padding: '20px',
                    height: '200px',
                    animation: 'pulse 2s infinite',
                  }}
                />
              ))}
            </div>
          ) : creditAlerts.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                color: '#999',
              }}
            >
              <p style={{ fontSize: '16px', margin: 0 }}>All vendor credits are healthy</p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '16px',
              }}
            >
              {creditAlerts.map((alert) => {
                const statusLabel = alert.utilization >= 95 ? 'CRITICAL' : alert.utilization >= 80 ? 'WARNING' : 'HEALTHY';
                const projected30Day = alert.limit > 0 ? (alert.projectedUtilization * alert.limit / 100) : 0;
                return (
                <div
                  key={alert.vendorId}
                  style={{
                    border: `2px solid ${getCreditStatusColor(alert.utilization)}`,
                    borderRadius: '8px',
                    padding: '20px',
                    backgroundColor:
                      statusLabel === 'CRITICAL'
                        ? '#FADBD8'
                        : statusLabel === 'WARNING'
                        ? '#FFF3E0'
                        : '#E8F8F0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'start',
                      marginBottom: '16px',
                    }}
                  >
                    <div>
                      <h3
                        style={{
                          margin: '0 0 4px 0',
                          fontSize: '16px',
                          fontWeight: 600,
                          color: ABEL_NAVY,
                        }}
                      >
                        {alert.vendorName}
                      </h3>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '12px',
                          color: '#666',
                        }}
                      >
                        {statusLabel}
                      </p>
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: getCreditStatusColor(alert.utilization),
                      }}
                    >
                      {alert.utilization.toFixed(0)}%
                    </div>
                  </div>

                  <div
                    style={{
                      marginBottom: '12px',
                      fontSize: '13px',
                      color: '#333',
                    }}
                  >
                    <p style={{ margin: '0 0 4px 0' }}>
                      Current: ${alert.used.toFixed(2)} of $
                      {alert.limit.toFixed(2)}
                    </p>
                    <p style={{ margin: '0 0 12px 0', color: '#666' }}>
                      30-day Projected: ${projected30Day.toFixed(2)}
                    </p>
                  </div>

                  <div
                    style={{
                      width: '100%',
                      height: '10px',
                      backgroundColor: '#E8E8E8',
                      borderRadius: '5px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(alert.utilization, 100)}%`,
                        height: '100%',
                        backgroundColor: getCreditStatusColor(alert.utilization),
                      }}
                    />
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Activity Log Section */}
        <div>
          <h2
            style={{
              fontSize: '20px',
              fontWeight: 600,
              color: ABEL_NAVY,
              margin: '0 0 20px 0',
            }}
          >
            Recent Activity
          </h2>

          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              backgroundColor: LIGHT_GRAY,
              borderRadius: '8px',
              color: '#999',
            }}
          >
            <p style={{ fontSize: '16px', margin: 0 }}>
              Activity log will populate as orders are created and confirmed
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
