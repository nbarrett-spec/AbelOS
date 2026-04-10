'use client';

import { useState, useEffect, useCallback } from 'react';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

interface KPIData {
  pipelineValue: number;
  activeDealsCount: number;
  winRate: number;
  avgDealSize: number;
  revenueThisMonth: number;
}

interface Lead {
  id: string;
  companyName: string;
  email: string;
  phone: string;
  leadScore: number;
  lastOrderDate?: string;
  clv?: number;
  status: string;
}

interface Deal {
  id: string;
  dealNumber: string;
  companyName: string;
  dealValue: number;
  stage: string;
  probability: number;
  expectedCloseDate: string;
  createdAt: string;
  ownerId?: string;
  owner?: {
    firstName: string;
    lastName: string;
  };
}

interface Quote {
  id: string;
  builderName: string;
  total: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  daysSinceSent?: number;
}

interface Activity {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  dealId?: string;
  dealNumber?: string;
  companyName?: string;
  staffName?: string;
}

interface ChurnRiskLead {
  id: string;
  companyName: string;
  email: string;
  lastOrderDate?: string;
  totalSpend: number;
  riskScore: number;
  daysSinceLastOrder?: number;
}

interface OutreachStats {
  prospectsTouched: number;
  responseRate: number;
  meetingsScheduled: number;
}

interface ApiResponse {
  deals?: Deal[];
  leads?: Lead[];
  quotes?: Quote[];
  activities?: Activity[];
  stats?: any;
}

// ============================================================================
// COLOR & STYLING CONSTANTS
// ============================================================================

const COLORS = {
  navy: '#1B4F72',
  orange: '#E67E22',
  white: '#FFFFFF',
  lightGray: '#F9FAFB',
  borderGray: '#E5E7EB',
  darkGray: '#6B7280',
  lightText: '#9CA3AF',
  danger: '#DC2626',
  warning: '#F59E0B',
  success: '#10B981',
  info: '#3B82F6',
};

const stageColors: Record<string, string> = {
  PROSPECT: '#EEF2F5',
  DISCOVERY: '#E3F2FD',
  WALKTHROUGH: '#F3E5F5',
  BID_SUBMITTED: '#FFF3E0',
  BID_REVIEW: '#FFE8D6',
  NEGOTIATION: '#F0F4FF',
  WON: '#E8F5E9',
  LOST: '#FFEBEE',
  ONBOARDED: '#E0F2F1',
};

const stageBorderColors: Record<string, string> = {
  PROSPECT: '#BDBDBD',
  DISCOVERY: '#90CAF9',
  WALKTHROUGH: '#CE93D8',
  BID_SUBMITTED: '#FFB74D',
  BID_REVIEW: '#FFAB91',
  NEGOTIATION: '#9FA8DA',
  WON: '#81C784',
  LOST: '#EF5350',
  ONBOARDED: '#80CBC4',
};

const dealValueTierColors: Record<string, string> = {
  high: '#10B981',
  medium: '#F59E0B',
  low: '#6B7280',
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatCurrency(value: number): string {
  if (typeof value !== 'number') return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return 'N/A';
  }
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getDaysSince(dateString?: string): number {
  if (!dateString) return 999;
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function getScoreColor(score: number): string {
  if (score >= 75) return COLORS.success;
  if (score >= 50) return COLORS.warning;
  return COLORS.danger;
}

function getValueTier(value: number): string {
  if (value >= 50000) return 'high';
  if (value >= 10000) return 'medium';
  return 'low';
}

// ============================================================================
// COMPONENT: KPI CARD
// ============================================================================

interface KPICardProps {
  label: string;
  value: string;
  unit?: string;
  icon?: string;
  trend?: number;
  isLoading?: boolean;
}

function KPICard({
  label,
  value,
  unit,
  icon,
  trend,
  isLoading,
}: KPICardProps) {
  return (
    <div
      style={{
        flex: '1 1 calc(20% - 12px)',
        minWidth: '200px',
        backgroundColor: COLORS.white,
        border: `1px solid ${COLORS.borderGray}`,
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        transition: 'all 0.3s ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '12px',
        }}
      >
        <label
          style={{
            fontSize: '14px',
            fontWeight: '500',
            color: COLORS.darkGray,
            margin: '0',
          }}
        >
          {label}
        </label>
        {icon && (
          <span
            style={{
              fontSize: '20px',
              opacity: 0.6,
            }}
          >
            {icon}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <div
          style={{
            fontSize: '28px',
            fontWeight: '700',
            color: COLORS.navy,
            letterSpacing: '-0.5px',
          }}
        >
          {isLoading ? '—' : value}
        </div>
        {unit && (
          <span
            style={{
              fontSize: '14px',
              color: COLORS.lightText,
              fontWeight: '500',
            }}
          >
            {unit}
          </span>
        )}
      </div>
      {trend !== undefined && (
        <div
          style={{
            fontSize: '12px',
            color: trend > 0 ? COLORS.success : COLORS.danger,
            fontWeight: '600',
          }}
        >
          {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last month
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT: SECTION HEADER
// ============================================================================

interface SectionHeaderProps {
  title: string;
  count?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

function SectionHeader({ title, count, action }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px',
        borderBottom: `2px solid ${COLORS.borderGray}`,
        paddingBottom: '12px',
      }}
    >
      <h2
        style={{
          fontSize: '18px',
          fontWeight: '700',
          color: COLORS.navy,
          margin: '0',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {title}
        {count !== undefined && (
          <span
            style={{
              fontSize: '14px',
              fontWeight: '500',
              color: COLORS.lightText,
              backgroundColor: COLORS.lightGray,
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            {count}
          </span>
        )}
      </h2>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            padding: '8px 16px',
            backgroundColor: COLORS.navy,
            color: COLORS.white,
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.backgroundColor = COLORS.orange;
            el.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.backgroundColor = COLORS.navy;
            el.style.transform = 'translateY(0)';
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT: QUICK ACTION BUTTON
// ============================================================================

interface QuickActionButtonProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
  size?: 'sm' | 'md';
}

function QuickActionButton({
  label,
  variant = 'secondary',
  onClick,
  size = 'sm',
}: QuickActionButtonProps) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    primary: {
      bg: COLORS.navy,
      text: COLORS.white,
      border: COLORS.navy,
    },
    secondary: {
      bg: COLORS.lightGray,
      text: COLORS.navy,
      border: COLORS.borderGray,
    },
    danger: {
      bg: COLORS.danger,
      text: COLORS.white,
      border: COLORS.danger,
    },
  };

  const style = colors[variant];
  const fontSize = size === 'sm' ? '12px' : '13px';
  const padding = size === 'sm' ? '6px 12px' : '8px 16px';

  return (
    <button
      onClick={onClick}
      style={{
        padding,
        backgroundColor: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
        borderRadius: '6px',
        fontSize,
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.opacity = '0.9';
        el.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }}
    >
      {label}
    </button>
  );
}

// ============================================================================
// COMPONENT: HOT LEADS TABLE
// ============================================================================

function HotLeadsSection({ leads, isLoading }: { leads: Lead[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div
        style={{
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.borderGray}`,
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          color: COLORS.lightText,
        }}
      >
        Loading hot leads...
      </div>
    );
  }

  const hotLeads = leads.slice(0, 10);

  return (
    <div
      style={{
        backgroundColor: COLORS.white,
        border: `1px solid ${COLORS.borderGray}`,
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: COLORS.lightGray,
                borderBottom: `1px solid ${COLORS.borderGray}`,
              }}
            >
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                COMPANY
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                SCORE
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                LAST ORDER
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                CLV
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'center',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody>
            {hotLeads.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    color: COLORS.lightText,
                  }}
                >
                  No hot leads available
                </td>
              </tr>
            ) : (
              hotLeads.map((lead, idx) => (
                <tr
                  key={lead.id}
                  style={{
                    borderBottom: `1px solid ${COLORS.borderGray}`,
                    backgroundColor:
                      idx % 2 === 0 ? COLORS.white : COLORS.lightGray,
                    transition: 'background-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLTableRowElement;
                    el.style.backgroundColor = '#F3F4F6';
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLTableRowElement;
                    el.style.backgroundColor =
                      idx % 2 === 0 ? COLORS.white : COLORS.lightGray;
                  }}
                >
                  <td
                    style={{
                      padding: '12px 16px',
                      fontWeight: '600',
                      color: COLORS.navy,
                    }}
                  >
                    {lead.companyName}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <div
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: getScoreColor(lead.leadScore),
                        }}
                      />
                      <span
                        style={{
                          fontWeight: '600',
                          color: getScoreColor(lead.leadScore),
                        }}
                      >
                        {Math.round(lead.leadScore)}
                      </span>
                    </div>
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      color: COLORS.darkGray,
                    }}
                  >
                    {formatDate(lead.lastOrderDate)}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      fontWeight: '600',
                      color: COLORS.navy,
                    }}
                  >
                    {formatCurrency(lead.clv || 0)}
                  </td>
                  <td
                    style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: '6px',
                        justifyContent: 'center',
                      }}
                    >
                      <QuickActionButton
                        label="Call"
                        variant="secondary"
                        size="sm"
                        onClick={() => console.log('Call:', lead.companyName)}
                      />
                      <QuickActionButton
                        label="Email"
                        variant="secondary"
                        size="sm"
                        onClick={() => console.log('Email:', lead.email)}
                      />
                      <QuickActionButton
                        label="Deal"
                        variant="primary"
                        size="sm"
                        onClick={() => console.log('Create deal:', lead.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: PIPELINE KANBAN
// ============================================================================

function PipelineKanban({ deals, isLoading }: { deals: Deal[]; isLoading: boolean }) {
  const stages = [
    'PROSPECT',
    'DISCOVERY',
    'WALKTHROUGH',
    'BID_SUBMITTED',
    'BID_REVIEW',
    'NEGOTIATION',
    'WON',
  ];

  const stageTitles: Record<string, string> = {
    PROSPECT: 'Prospect',
    DISCOVERY: 'Discovery',
    WALKTHROUGH: 'Walkthrough',
    BID_SUBMITTED: 'Bid Submitted',
    BID_REVIEW: 'Bid Review',
    NEGOTIATION: 'Negotiation',
    WON: 'Won',
  };

  if (isLoading) {
    return (
      <div
        style={{
          backgroundColor: COLORS.lightGray,
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          color: COLORS.lightText,
        }}
      >
        Loading pipeline...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stages.length}, minmax(280px, 1fr))`,
        gap: '16px',
        overflowX: 'auto',
        paddingBottom: '8px',
      }}
    >
      {stages.map((stage) => {
        const stageDeals = deals.filter((d) => d.stage === stage);
        const stageValue = stageDeals.reduce((sum, d) => sum + d.dealValue, 0);

        return (
          <div key={stage}>
            <div
              style={{
                backgroundColor: stageColors[stage],
                border: `2px solid ${stageBorderColors[stage]}`,
                borderRadius: '12px',
                padding: '16px',
                minHeight: '600px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ marginBottom: '16px' }}>
                <h3
                  style={{
                    fontSize: '13px',
                    fontWeight: '700',
                    color: COLORS.navy,
                    margin: '0 0 8px 0',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {stageTitles[stage]}
                </h3>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                  }}
                >
                  <span
                    style={{
                      backgroundColor: COLORS.white,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: '600',
                      color: COLORS.navy,
                    }}
                  >
                    {stageDeals.length} deals
                  </span>
                  <span
                    style={{
                      backgroundColor: COLORS.white,
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: '600',
                      color: COLORS.orange,
                    }}
                  >
                    {formatCurrency(stageValue)}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  flex: 1,
                }}
              >
                {stageDeals.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      color: COLORS.lightText,
                      fontSize: '12px',
                      padding: '24px 0',
                      opacity: 0.5,
                    }}
                  >
                    No deals
                  </div>
                ) : (
                  stageDeals.map((deal) => {
                    const daysSinceCreated = getDaysSince(deal.createdAt);
                    const valueTier = getValueTier(deal.dealValue);

                    return (
                      <div
                        key={deal.id}
                        style={{
                          backgroundColor: COLORS.white,
                          border: `1px solid ${COLORS.borderGray}`,
                          borderRadius: '8px',
                          padding: '12px',
                          borderLeft: `4px solid ${dealValueTierColors[valueTier]}`,
                          transition: 'all 0.2s ease',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.boxShadow =
                            '0 4px 12px rgba(0,0,0,0.1)';
                          el.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          const el = e.currentTarget as HTMLElement;
                          el.style.boxShadow = 'none';
                          el.style.transform = 'translateY(0)';
                        }}
                      >
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: '700',
                            color: COLORS.navy,
                            marginBottom: '6px',
                          }}
                        >
                          {deal.companyName}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: COLORS.darkGray,
                            marginBottom: '8px',
                          }}
                        >
                          {formatCurrency(deal.dealValue)}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '11px',
                            color: COLORS.lightText,
                          }}
                        >
                          <span>{deal.probability}% probable</span>
                          <span>{daysSinceCreated}d in stage</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// COMPONENT: QUOTE FOLLOW-UP QUEUE
// ============================================================================

function QuoteFollowUpSection({
  quotes,
  isLoading,
}: {
  quotes: Quote[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div
        style={{
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.borderGray}`,
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          color: COLORS.lightText,
        }}
      >
        Loading quotes...
      </div>
    );
  }

  const sentQuotes = quotes
    .filter((q) => q.status === 'SENT')
    .sort((a, b) => getDaysSince(b.updatedAt) - getDaysSince(a.updatedAt))
    .slice(0, 8);

  return (
    <div
      style={{
        backgroundColor: COLORS.white,
        border: `1px solid ${COLORS.borderGray}`,
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '13px',
          }}
        >
          <thead>
            <tr
              style={{
                backgroundColor: COLORS.lightGray,
                borderBottom: `1px solid ${COLORS.borderGray}`,
              }}
            >
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                BUILDER
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                VALUE
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                DAYS SINCE SENT
              </th>
              <th
                style={{
                  padding: '12px 16px',
                  textAlign: 'center',
                  fontWeight: '600',
                  color: COLORS.navy,
                  fontSize: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody>
            {sentQuotes.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  style={{
                    padding: '24px 16px',
                    textAlign: 'center',
                    color: COLORS.lightText,
                  }}
                >
                  No quotes awaiting follow-up
                </td>
              </tr>
            ) : (
              sentQuotes.map((quote, idx) => {
                const daysSince = getDaysSince(quote.updatedAt);
                const isUrgent = daysSince > 14;

                return (
                  <tr
                    key={quote.id}
                    style={{
                      borderBottom: `1px solid ${COLORS.borderGray}`,
                      backgroundColor: isUrgent ? '#FEF3C7' : COLORS.white,
                      transition: 'background-color 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLTableRowElement;
                      el.style.backgroundColor = '#F3F4F6';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLTableRowElement;
                      el.style.backgroundColor = isUrgent
                        ? '#FEF3C7'
                        : COLORS.white;
                    }}
                  >
                    <td
                      style={{
                        padding: '12px 16px',
                        fontWeight: '600',
                        color: COLORS.navy,
                      }}
                    >
                      {quote.builderName}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        fontWeight: '600',
                        color: COLORS.orange,
                      }}
                    >
                      {formatCurrency(quote.total)}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        color: isUrgent ? COLORS.danger : COLORS.darkGray,
                        fontWeight: isUrgent ? '600' : '400',
                      }}
                    >
                      {daysSince} days {isUrgent && '⚠️'}
                    </td>
                    <td
                      style={{
                        padding: '12px 16px',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          justifyContent: 'center',
                        }}
                      >
                        <QuickActionButton
                          label="Follow Up"
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            console.log('Follow up:', quote.builderName)
                          }
                        />
                        <QuickActionButton
                          label="Won"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            console.log('Mark won:', quote.builderName)
                          }
                        />
                        <QuickActionButton
                          label="Lost"
                          variant="danger"
                          size="sm"
                          onClick={() =>
                            console.log('Mark lost:', quote.builderName)
                          }
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: AT-RISK ACCOUNTS
// ============================================================================

function AtRiskAccountsSection({
  accounts,
  isLoading,
}: {
  accounts: ChurnRiskLead[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div
        style={{
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.borderGray}`,
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          color: COLORS.lightText,
        }}
      >
        Loading at-risk accounts...
      </div>
    );
  }

  const riskAccounts = accounts.slice(0, 6);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '16px',
      }}
    >
      {riskAccounts.length === 0 ? (
        <div
          style={{
            backgroundColor: COLORS.white,
            border: `1px solid ${COLORS.borderGray}`,
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            color: COLORS.lightText,
            gridColumn: '1 / -1',
          }}
        >
          No at-risk accounts
        </div>
      ) : (
        riskAccounts.map((account) => (
          <div
            key={account.id}
            style={{
              backgroundColor: COLORS.white,
              border: `1px solid ${COLORS.borderGray}`,
              borderRadius: '12px',
              padding: '16px',
              borderTop: `4px solid ${
                account.riskScore > 75
                  ? COLORS.danger
                  : account.riskScore > 50
                    ? COLORS.warning
                    : COLORS.info
              }`,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '12px',
              }}
            >
              <div>
                <h3
                  style={{
                    fontSize: '14px',
                    fontWeight: '700',
                    color: COLORS.navy,
                    margin: '0 0 4px 0',
                  }}
                >
                  {account.companyName}
                </h3>
                <p
                  style={{
                    fontSize: '12px',
                    color: COLORS.lightText,
                    margin: '0',
                  }}
                >
                  {account.email}
                </p>
              </div>
              <div
                style={{
                  backgroundColor: getScoreColor(100 - account.riskScore),
                  color: COLORS.white,
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '700',
                }}
              >
                {Math.round(account.riskScore)}% risk
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                marginBottom: '12px',
                paddingTop: '12px',
                borderTop: `1px solid ${COLORS.borderGray}`,
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: '11px',
                    color: COLORS.lightText,
                    margin: '0 0 4px 0',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Days Since Order
                </p>
                <p
                  style={{
                    fontSize: '16px',
                    fontWeight: '700',
                    color: COLORS.navy,
                    margin: '0',
                  }}
                >
                  {account.daysSinceLastOrder || 'N/A'}
                </p>
              </div>
              <div>
                <p
                  style={{
                    fontSize: '11px',
                    color: COLORS.lightText,
                    margin: '0 0 4px 0',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  Lifetime Value
                </p>
                <p
                  style={{
                    fontSize: '16px',
                    fontWeight: '700',
                    color: COLORS.orange,
                    margin: '0',
                  }}
                >
                  {formatCurrency(account.totalSpend)}
                </p>
              </div>
            </div>

            <button
              onClick={() => console.log('Re-engage:', account.id)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: COLORS.navy,
                color: COLORS.white,
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.backgroundColor = COLORS.orange;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.backgroundColor = COLORS.navy;
              }}
            >
              Re-engage
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT: ACTIVITY FEED
// ============================================================================

function ActivityFeedSection({
  activities,
  isLoading,
}: {
  activities: Activity[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div
        style={{
          backgroundColor: COLORS.white,
          border: `1px solid ${COLORS.borderGray}`,
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center',
          color: COLORS.lightText,
        }}
      >
        Loading activities...
      </div>
    );
  }

  const recentActivities = activities.slice(0, 12);

  return (
    <div
      style={{
        backgroundColor: COLORS.white,
        border: `1px solid ${COLORS.borderGray}`,
        borderRadius: '12px',
        padding: '20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {recentActivities.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              color: COLORS.lightText,
              padding: '24px 0',
            }}
          >
            No recent activities
          </div>
        ) : (
          recentActivities.map((activity, idx) => (
            <div
              key={activity.id || idx}
              style={{
                display: 'flex',
                gap: '12px',
                paddingBottom: '12px',
                borderBottom:
                  idx < recentActivities.length - 1
                    ? `1px solid ${COLORS.borderGray}`
                    : 'none',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: COLORS.lightGray,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  flexShrink: 0,
                }}
              >
                {activity.type === 'CALL'
                  ? '📞'
                  : activity.type === 'EMAIL'
                    ? '📧'
                    : activity.type === 'MEETING'
                      ? '📅'
                      : activity.type === 'NOTE'
                        ? '📝'
                        : activity.type === 'BID'
                          ? '📋'
                          : activity.type === 'WON'
                            ? '🎉'
                            : activity.type === 'LOST'
                              ? '❌'
                              : '📌'}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: COLORS.navy,
                    marginBottom: '4px',
                  }}
                >
                  {activity.description}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: COLORS.lightText,
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <span>{activity.companyName || 'Activity'}</span>
                  {activity.dealNumber && (
                    <span>· {activity.dealNumber}</span>
                  )}
                  <span>·</span>
                  <span>{formatDate(activity.timestamp)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT: Sales Command Center
// ============================================================================

export default function SalesCommandCenter() {
  const [data, setData] = useState<{
    kpis: KPIData;
    leads: Lead[];
    deals: Deal[];
    quotes: Quote[];
    activities: Activity[];
    churnRisks: ChurnRiskLead[];
    outreach: OutreachStats;
  }>({
    kpis: {
      pipelineValue: 0,
      activeDealsCount: 0,
      winRate: 0,
      avgDealSize: 0,
      revenueThisMonth: 0,
    },
    leads: [],
    deals: [],
    quotes: [],
    activities: [],
    churnRisks: [],
    outreach: {
      prospectsTouched: 0,
      responseRate: 0,
      meetingsScheduled: 0,
    },
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ========================================================================
  // DATA FETCHING
  // ========================================================================

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [
        dealsRes,
        leadsRes,
        statsRes,
        churnRes,
        activitiesRes,
      ] = await Promise.all([
        fetch('/api/ops/sales/deals'),
        fetch('/api/ops/growth/leads?report=lead-scores'),
        fetch('/api/ops/sales/stats'),
        fetch('/api/ops/growth/leads?report=churn-risk'),
        fetch('/api/ops/activity-log?limit=20'),
      ]);

      // Parse all responses
      const dealsData = dealsRes.ok ? await dealsRes.json() : { deals: [] };
      const leadsData = leadsRes.ok ? await leadsRes.json() : { scores: [] };
      const statsData = statsRes.ok ? await statsRes.json() : { stats: {} };
      const churnData = churnRes.ok ? await churnRes.json() : { risks: [] };
      const activitiesData = activitiesRes.ok ? await activitiesRes.json() : { activities: [] };

      // Extract and transform deals
      const deals = (dealsData.deals || []).map((d: any) => ({
        id: d.id,
        dealNumber: d.dealNumber,
        companyName: d.companyName,
        dealValue: parseFloat(d.dealValue || 0),
        stage: d.stage,
        probability: d.probability || 50,
        expectedCloseDate: d.expectedCloseDate,
        createdAt: d.createdAt,
        ownerId: d.ownerId,
        owner: {
          firstName: d.firstName || 'Unknown',
          lastName: d.lastName || '',
        },
      }));

      // Extract and transform leads
      const leads = (leadsData.scores || [])
        .filter((l: any) => l.leadScore >= 60)
        .map((l: any) => ({
          id: l.id,
          companyName: l.companyName,
          email: l.email,
          phone: l.phone,
          leadScore: parseFloat(l.leadScore || 0),
          lastOrderDate: l.lastOrderDate,
          clv: parseFloat(l.totalSpend || 0),
          status: l.status,
        }))
        .sort((a: Lead, b: Lead) => b.leadScore - a.leadScore);

      // Extract and transform churn risks
      const churnRisks = (churnData.risks || []).map((c: any) => ({
        id: c.id,
        companyName: c.companyName,
        email: c.email,
        lastOrderDate: c.lastOrderDate,
        totalSpend: parseFloat(c.totalSpend || 0),
        riskScore: parseFloat(c.riskScore || 0),
        daysSinceLastOrder: c.daysSinceLastOrder,
      }));

      // Extract quotes from stats
      const quotes = (statsData.stats?.allQuotes || []).map((q: any) => ({
        id: q.id,
        builderName: q.builderName,
        total: parseFloat(q.total || 0),
        status: q.status,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
        daysSinceSent: getDaysSince(q.updatedAt),
      }));

      // Extract activities
      const activities = (activitiesData.activities || []).map((a: any) => ({
        id: a.id,
        type: a.type,
        description: a.description || a.type,
        timestamp: a.createdAt || a.timestamp,
        dealId: a.dealId,
        dealNumber: a.dealNumber,
        companyName: a.companyName,
        staffName: a.staffName,
      }));

      // Calculate KPIs
      const activeDealCount = deals.filter(
        (d: Deal) => !['WON', 'LOST'].includes(d.stage)
      ).length;
      const pipelineValue = deals
        .filter((d: Deal) => !['WON', 'LOST'].includes(d.stage))
        .reduce((sum: number, d: Deal) => sum + d.dealValue, 0);
      const wonDeals = deals.filter((d: Deal) => d.stage === 'WON').length;
      const lostDeals = deals.filter((d: Deal) => d.stage === 'LOST').length;
      const winRate =
        wonDeals + lostDeals > 0
          ? (wonDeals / (wonDeals + lostDeals)) * 100
          : 0;
      const avgDealSize =
        activeDealCount > 0 ? pipelineValue / activeDealCount : 0;

      // Revenue this month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const revenueThisMonth = deals
        .filter((d: Deal) => {
          const closeDate = new Date(d.expectedCloseDate);
          return closeDate >= monthStart && closeDate <= monthEnd && d.stage === 'WON';
        })
        .reduce((sum: number, d: Deal) => sum + d.dealValue, 0);

      const kpis: KPIData = {
        pipelineValue,
        activeDealsCount: activeDealCount,
        winRate,
        avgDealSize,
        revenueThisMonth,
      };

      // Outreach stats (placeholder)
      const outreach = {
        prospectsTouched: leads.length,
        responseRate: 42,
        meetingsScheduled: 12,
      };

      setData({
        kpis,
        leads,
        deals,
        quotes,
        activities,
        churnRisks,
        outreach,
      });
    } catch (err) {
      console.error('Error fetching command center data:', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, [fetchData]);

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div
      style={{
        backgroundColor: COLORS.lightGray,
        minHeight: '100vh',
        padding: '24px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      {/* ====== HEADER ====== */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
          paddingBottom: '24px',
          borderBottom: `2px solid ${COLORS.borderGray}`,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '32px',
              fontWeight: '800',
              color: COLORS.navy,
              margin: '0 0 8px 0',
              letterSpacing: '-0.5px',
            }}
          >
            Sales Command Center
          </h1>
          <p
            style={{
              fontSize: '14px',
              color: COLORS.darkGray,
              margin: '0',
            }}
          >
            {getGreeting()}! Here's your sales dashboard for{' '}
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          style={{
            padding: '10px 20px',
            backgroundColor: COLORS.orange,
            color: COLORS.white,
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            opacity: isLoading ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.transform = 'translateY(-2px)';
              el.style.boxShadow = '0 4px 12px rgba(230, 126, 34, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.transform = 'translateY(0)';
            el.style.boxShadow = 'none';
          }}
        >
          {isLoading ? '⟳ Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {/* ====== ERROR STATE ====== */}
      {error && (
        <div
          style={{
            backgroundColor: '#FEE2E2',
            border: `1px solid ${COLORS.danger}`,
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '24px',
            color: COLORS.danger,
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          {error}
        </div>
      )}

      {/* ====== KPI ROW ====== */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '32px',
          flexWrap: 'wrap',
        }}
      >
        <KPICard
          label="Pipeline Value"
          value={formatCurrency(data.kpis.pipelineValue)}
          icon="📊"
          isLoading={isLoading}
        />
        <KPICard
          label="Deals in Pipeline"
          value={String(data.kpis.activeDealsCount)}
          unit="deals"
          icon="🎯"
          isLoading={isLoading}
        />
        <KPICard
          label="Win Rate"
          value={formatPercent(data.kpis.winRate)}
          icon="🏆"
          isLoading={isLoading}
        />
        <KPICard
          label="Avg Deal Size"
          value={formatCurrency(data.kpis.avgDealSize)}
          icon="💰"
          isLoading={isLoading}
        />
        <KPICard
          label="Revenue This Month"
          value={formatCurrency(data.kpis.revenueThisMonth)}
          icon="💵"
          isLoading={isLoading}
        />
      </div>

      {/* ====== HOT LEADS ====== */}
      <section style={{ marginBottom: '32px' }}>
        <SectionHeader
          title="🔥 Hot Leads"
          count={data.leads.length}
          action={{
            label: 'View All',
            onClick: () => console.log('View all leads'),
          }}
        />
        <HotLeadsSection leads={data.leads} isLoading={isLoading} />
      </section>

      {/* ====== PIPELINE KANBAN ====== */}
      <section style={{ marginBottom: '32px' }}>
        <SectionHeader
          title="Pipeline Board"
          count={data.deals.length}
          action={{
            label: 'New Deal',
            onClick: () => console.log('Create new deal'),
          }}
        />
        <PipelineKanban deals={data.deals} isLoading={isLoading} />
      </section>

      {/* ====== QUOTE FOLLOW-UP ====== */}
      <section style={{ marginBottom: '32px' }}>
        <SectionHeader
          title="📋 Quote Follow-Up Queue"
          count={data.quotes.filter((q) => q.status === 'SENT').length}
          action={{
            label: 'View All Quotes',
            onClick: () => console.log('View all quotes'),
          }}
        />
        <QuoteFollowUpSection quotes={data.quotes} isLoading={isLoading} />
      </section>

      {/* ====== AT-RISK ACCOUNTS ====== */}
      <section style={{ marginBottom: '32px' }}>
        <SectionHeader
          title="⚠️ At-Risk Accounts"
          count={data.churnRisks.length}
          action={{
            label: 'View Churn Report',
            onClick: () => console.log('View churn report'),
          }}
        />
        <AtRiskAccountsSection
          accounts={data.churnRisks}
          isLoading={isLoading}
        />
      </section>

      {/* ====== TWO COLUMN: ACTIVITY FEED + OUTREACH STATS ====== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '24px',
          marginBottom: '32px',
        }}
      >
        {/* Activity Feed */}
        <section>
          <SectionHeader
            title="📜 Recent Activity Feed"
            count={data.activities.length}
          />
          <ActivityFeedSection
            activities={data.activities}
            isLoading={isLoading}
          />
        </section>

        {/* Outreach Stats */}
        <section>
          <SectionHeader title="📞 Outreach Stats" />
          <div
            style={{
              backgroundColor: COLORS.white,
              border: `1px solid ${COLORS.borderGray}`,
              borderRadius: '12px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: COLORS.lightText,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '8px',
                }}
              >
                Prospects Touched This Week
              </div>
              <div
                style={{
                  fontSize: '32px',
                  fontWeight: '800',
                  color: COLORS.navy,
                }}
              >
                {isLoading ? '—' : data.outreach.prospectsTouched}
              </div>
            </div>

            <div
              style={{
                paddingTop: '24px',
                borderTop: `1px solid ${COLORS.borderGray}`,
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: COLORS.lightText,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '8px',
                }}
              >
                Response Rate
              </div>
              <div
                style={{
                  fontSize: '32px',
                  fontWeight: '800',
                  color: COLORS.orange,
                }}
              >
                {isLoading ? '—' : formatPercent(data.outreach.responseRate)}
              </div>
            </div>

            <div
              style={{
                paddingTop: '24px',
                borderTop: `1px solid ${COLORS.borderGray}`,
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: COLORS.lightText,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '8px',
                }}
              >
                Meetings Scheduled
              </div>
              <div
                style={{
                  fontSize: '32px',
                  fontWeight: '800',
                  color: COLORS.success,
                }}
              >
                {isLoading ? '—' : data.outreach.meetingsScheduled}
              </div>
            </div>

            <button
              onClick={() => console.log('View outreach details')}
              style={{
                marginTop: '12px',
                padding: '12px 16px',
                backgroundColor: COLORS.navy,
                color: COLORS.white,
                border: 'none',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.backgroundColor = COLORS.orange;
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.backgroundColor = COLORS.navy;
              }}
            >
              View Detailed Report
            </button>
          </div>
        </section>
      </div>

      {/* ====== FOOTER ====== */}
      <div
        style={{
          textAlign: 'center',
          color: COLORS.lightText,
          fontSize: '12px',
          paddingTop: '24px',
          borderTop: `1px solid ${COLORS.borderGray}`,
        }}
      >
        Dashboard auto-refreshes every 5 minutes. Last updated:{' '}
        {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
