'use client';

import { useEffect, useState } from 'react';

// Types
interface PORecommendation {
  id: string;
  vendorId: string;
  vendorName: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitCost: number;
  }>;
  estimatedTotal: number;
  suggestedOrderDate: string;
  urgency: 'IMMEDIATE' | 'STANDARD' | 'FLEXIBLE';
  creditUsagePercent: number;
  creditLimit: number;
  currentUsage: number;
  projectedUsage: number;
  recommendedDeliveryDate: string;
  neededForManufacturingDate: string;
}

interface ReceivedOrder {
  id: string;
  orderNumber: string;
  builderId: string;
  builderName: string;
  items: Array<{ name: string; quantity: number; available: number }>;
  total: number;
  status: 'RECEIVED';
  inventoryStatus: 'ALL_AVAILABLE' | 'SOME_SHORT';
  shortItems?: string[];
}

interface CreditAlert {
  vendorId: string;
  vendorName: string;
  creditLimit: number;
  currentUsage: number;
  projected30DayUsage: number;
  utilizationPercent: number;
  status: 'WARNING' | 'CRITICAL' | 'HEALTHY';
}

interface ActivityLogEntry {
  id: string;
  timestamp: string;
  actionType: 'PO_CREATED' | 'ORDER_CONFIRMED' | 'AUTO_ACTION';
  details: string;
}

// Constants
const ABEL_NAVY = '#1B4F72';
const ABEL_ORANGE = '#E67E22';
const LIGHT_GRAY = '#F5F5F5';
const BORDER_COLOR = '#DDDDDD';

export default function AIOrderCommandCenter() {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [recommendations, setRecommendations] = useState<PORecommendation[]>([]);
  const [receivedOrders, setReceivedOrders] = useState<ReceivedOrder[]>([]);
  const [creditAlerts, setCreditAlerts] = useState<CreditAlert[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Load initial data and AI preference
  useEffect(() => {
    const savedAiState = localStorage.getItem('ai-auto-processing');
    if (savedAiState) setAiEnabled(JSON.parse(savedAiState));
    fetchAllData();
  }, []);

  // Save AI preference to localStorage
  useEffect(() => {
    localStorage.setItem('ai-auto-processing', JSON.stringify(aiEnabled));
  }, [aiEnabled]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [poRes, ordersRes, creditsRes, logRes] = await Promise.all([
        fetch('/api/ops/ai-orders'),
        fetch('/api/ops/received-orders'),
        fetch('/api/ops/credit-alerts'),
        fetch('/api/ops/activity-log'),
      ]);

      if (poRes.ok) setRecommendations(await poRes.json());
      if (ordersRes.ok) setReceivedOrders(await ordersRes.json());
      if (creditsRes.ok) setCreditAlerts(await creditsRes.json());
      if (logRes.ok) setActivityLog(await logRes.json());
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

  const createPO = async (recommendationId: string, vendorName: string) => {
    setLoadingAction(`po-${recommendationId}`);
    try {
      const res = await fetch('/api/ops/ai-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_po', recommendationId }),
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

  const confirmOrder = async (orderId: string, partial: boolean = false) => {
    setLoadingAction(`order-${orderId}`);
    try {
      const res = await fetch('/api/ops/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', orderId, partial }),
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
    try {
      const res = await fetch('/api/ops/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_all_available' }),
      });
      if (res.ok) {
        showToast('success', 'All available orders confirmed');
        await fetchAllData();
      } else {
        showToast('error', 'Failed to confirm orders');
      }
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

  const pendingOrdersCount = receivedOrders.filter(
    (o) => o.status === 'RECEIVED'
  ).length;
  const autoConfirmableCount = receivedOrders.filter(
    (o) => o.inventoryStatus === 'ALL_AVAILABLE'
  ).length;
  const creditWarningsCount = creditAlerts.filter(
    (c) => c.status !== 'HEALTHY'
  ).length;

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
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
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
                          {item.name} ({item.quantity}x)
                        </span>
                        <span style={{ fontWeight: 500 }}>
                          ${(item.quantity * item.unitCost).toFixed(2)}
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
                      <strong>{new Date(rec.suggestedOrderDate).toLocaleDateString()}</strong> →
                      Arrives{' '}
                      <strong>{new Date(rec.recommendedDeliveryDate).toLocaleDateString()}</strong>{' '}
                      → Needed{' '}
                      <strong>{new Date(rec.neededForManufacturingDate).toLocaleDateString()}</strong>
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
                      <span>Usage: ${rec.currentUsage.toFixed(2)}</span>
                      <span>Limit: ${rec.creditLimit.toFixed(2)}</span>
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
                          width: `${Math.min(
                            (rec.currentUsage / rec.creditLimit) * 100,
                            100
                          )}%`,
                          height: '100%',
                          backgroundColor: getCreditStatusColor(rec.creditUsagePercent),
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
                      <span>Current: {rec.creditUsagePercent.toFixed(0)}%</span>
                      <span>After PO: {((rec.projectedUsage / rec.creditLimit) * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div style={{ padding: '16px' }}>
                    <button
                      onClick={() => createPO(rec.id, rec.vendorName)}
                      disabled={loadingAction === `po-${rec.id}`}
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
                          loadingAction === `po-${rec.id}` ? 'not-allowed' : 'pointer',
                        opacity: loadingAction === `po-${rec.id}` ? 0.7 : 1,
                      }}
                    >
                      {loadingAction === `po-${rec.id}` ? 'Creating...' : 'Create PO'}
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
                      Items
                    </th>
                    <th
                      style={{
                        padding: '12px 16px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: ABEL_NAVY,
                      }}
                    >
                      Total
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
                      key={order.id}
                      style={{
                        borderBottom: `1px solid ${BORDER_COLOR}`,
                        backgroundColor: order.inventoryStatus === 'ALL_AVAILABLE' ? '#F0F8FF' : '#FAFAFA',
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
                        {order.items.length} item{order.items.length !== 1 ? 's' : ''}
                      </td>
                      <td
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontWeight: 600,
                        }}
                      >
                        ${order.total.toFixed(2)}
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
                            backgroundColor:
                              order.inventoryStatus === 'ALL_AVAILABLE'
                                ? '#D4EDDA'
                                : '#FFF3CD',
                            color:
                              order.inventoryStatus === 'ALL_AVAILABLE'
                                ? '#155724'
                                : '#856404',
                          }}
                        >
                          {order.inventoryStatus === 'ALL_AVAILABLE'
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
                          onClick={() =>
                            confirmOrder(order.id, order.inventoryStatus === 'SOME_SHORT')
                          }
                          disabled={loadingAction === `order-${order.id}`}
                          style={{
                            padding: '6px 12px',
                            backgroundColor:
                              order.inventoryStatus === 'ALL_AVAILABLE'
                                ? '#27AE60'
                                : ABEL_ORANGE,
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor:
                              loadingAction === `order-${order.id}` ? 'not-allowed' : 'pointer',
                            opacity: loadingAction === `order-${order.id}` ? 0.7 : 1,
                          }}
                        >
                          {loadingAction === `order-${order.id}`
                            ? 'Processing...'
                            : order.inventoryStatus === 'ALL_AVAILABLE'
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
              {creditAlerts.map((alert) => (
                <div
                  key={alert.vendorId}
                  style={{
                    border: `2px solid ${getCreditStatusColor(alert.utilizationPercent)}`,
                    borderRadius: '8px',
                    padding: '20px',
                    backgroundColor:
                      alert.status === 'CRITICAL'
                        ? '#FADBD8'
                        : alert.status === 'WARNING'
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
                        {alert.status}
                      </p>
                    </div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 700,
                        color: getCreditStatusColor(alert.utilizationPercent),
                      }}
                    >
                      {alert.utilizationPercent.toFixed(0)}%
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
                      Current: ${alert.currentUsage.toFixed(2)} of $
                      {alert.creditLimit.toFixed(2)}
                    </p>
                    <p style={{ margin: '0 0 12px 0', color: '#666' }}>
                      30-day Projected: ${alert.projected30DayUsage.toFixed(2)}
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
                        width: `${Math.min(alert.utilizationPercent, 100)}%`,
                        height: '100%',
                        backgroundColor: getCreditStatusColor(alert.utilizationPercent),
                      }}
                    />
                  </div>
                </div>
              ))}
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

          {loading ? (
            <div
              style={{
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                height: '150px',
                animation: 'pulse 2s infinite',
              }}
            />
          ) : activityLog.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 20px',
                backgroundColor: LIGHT_GRAY,
                borderRadius: '8px',
                color: '#999',
              }}
            >
              <p style={{ fontSize: '16px', margin: 0 }}>No activity yet</p>
            </div>
          ) : (
            <div
              style={{
                backgroundColor: '#FAFAFA',
                border: `1px solid ${BORDER_COLOR}`,
                borderRadius: '8px',
                overflow: 'hidden',
              }}
            >
              {activityLog.slice(0, 10).map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    padding: '16px',
                    borderBottom: `1px solid ${BORDER_COLOR}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'start',
                  }}
                >
                  <div>
                    <p
                      style={{
                        margin: '0 0 4px 0',
                        fontSize: '14px',
                        fontWeight: 500,
                        color: ABEL_NAVY,
                      }}
                    >
                      {entry.actionType.replace(/_/g, ' ')}
                    </p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                      {entry.details}
                    </p>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '12px',
                      color: '#999',
                      whiteSpace: 'nowrap',
                      marginLeft: '16px',
                    }}
                  >
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
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
