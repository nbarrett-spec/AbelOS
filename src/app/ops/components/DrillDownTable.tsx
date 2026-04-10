'use client'

import { useRouter } from 'next/navigation'

interface ColumnConfig {
  key: string
  label: string
  format?: 'currency' | 'date' | 'number' | 'status' | 'text'
  drillDown?: {
    type: 'po' | 'order' | 'invoice' | 'job' | 'vendor' | 'builder' | 'quote' | 'delivery' | 'return'
    idField: string
  }
  width?: string
}

interface DrillDownTableProps {
  columns: ColumnConfig[]
  data: any[]
  loading?: boolean
  emptyMessage?: string
  onSort?: (key: string) => void
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

const BRAND_COLORS = {
  navy: '#1B4F72',
  orange: '#E67E22',
  lightGray: '#F5F5F5',
  darkGray: '#333333',
  borderGray: '#CCCCCC',
}

const getDrillDownRoute = (type: string, id: string | number): string => {
  const drillDownMap: Record<string, string> = {
    po: `/ops/purchasing?id=${id}`,
    order: `/ops/orders?id=${id}`,
    invoice: `/ops/invoices?id=${id}`,
    job: `/ops/jobs?id=${id}`,
    vendor: `/ops/vendors?id=${id}`,
    builder: `/ops/accounts?id=${id}`,
    quote: `/ops/quotes?id=${id}`,
    delivery: `/ops/delivery?id=${id}`,
    return: `/ops/returns?id=${id}`,
  }
  return drillDownMap[type] || '#'
}

const formatCellValue = (value: any, format?: string): string => {
  if (value === null || value === undefined) return ''

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(Number(value))

    case 'date':
      if (value instanceof Date) {
        return value.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      }
      return new Date(value).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })

    case 'number':
      return new Intl.NumberFormat('en-US').format(Number(value))

    case 'status':
      return String(value).charAt(0).toUpperCase() + String(value).slice(1).toLowerCase()

    case 'text':
    default:
      return String(value)
  }
}

const getStatusBadgeColor = (status: string): { bg: string; text: string } => {
  const statusLower = String(status).toLowerCase()

  const statusMap: Record<string, { bg: string; text: string }> = {
    pending: { bg: '#FFF3CD', text: '#856404' },
    completed: { bg: '#D4EDDA', text: '#155724' },
    active: { bg: '#D4EDDA', text: '#155724' },
    inactive: { bg: '#E2E3E5', text: '#383D41' },
    cancelled: { bg: '#F8D7DA', text: '#721C24' },
    failed: { bg: '#F8D7DA', text: '#721C24' },
    draft: { bg: '#E2E3E5', text: '#383D41' },
    shipped: { bg: '#D1ECF1', text: '#0C5460' },
    delivered: { bg: '#D4EDDA', text: '#155724' },
    processing: { bg: '#FFF3CD', text: '#856404' },
  }

  return statusMap[statusLower] || { bg: '#E2E3E5', text: '#383D41' }
}

const LoadingSkeleton = ({ columns, rows = 5 }: { columns: ColumnConfig[]; rows?: number }) => {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        backgroundColor: 'white',
      }}
    >
      <thead>
        <tr style={{ backgroundColor: BRAND_COLORS.navy, color: 'white' }}>
          {columns.map((col) => (
            <th
              key={col.key}
              style={{
                padding: '12px 16px',
                textAlign: 'left',
                fontWeight: '600',
                fontSize: '14px',
                width: col.width || 'auto',
                borderBottom: `1px solid ${BRAND_COLORS.borderGray}`,
              }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <tr
            key={rowIdx}
            style={{
              backgroundColor: rowIdx % 2 === 0 ? 'white' : BRAND_COLORS.lightGray,
              borderBottom: `1px solid ${BRAND_COLORS.borderGray}`,
            }}
          >
            {columns.map((col) => (
              <td
                key={`${rowIdx}-${col.key}`}
                style={{
                  padding: '12px 16px',
                  fontSize: '14px',
                }}
              >
                <div
                  style={{
                    height: '16px',
                    backgroundColor: '#E0E0E0',
                    borderRadius: '4px',
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </table>
  )
}

export default function DrillDownTable({
  columns,
  data,
  loading = false,
  emptyMessage = 'No data available',
  onSort,
  sortBy,
  sortDir = 'asc',
}: DrillDownTableProps) {
  const router = useRouter()

  const handleRowClick = (row: any, column: ColumnConfig) => {
    if (!column.drillDown) return

    const idValue = row[column.drillDown.idField]
    if (!idValue) return

    const route = getDrillDownRoute(column.drillDown.type, idValue)
    router.push(route)
  }

  const handleSort = (key: string) => {
    if (onSort) {
      onSort(key)
    }
  }

  if (loading) {
    return <LoadingSkeleton columns={columns} />
  }

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          backgroundColor: 'white',
          border: `1px solid ${BRAND_COLORS.borderGray}`,
          borderRadius: '4px',
        }}
      >
        <p
          style={{
            fontSize: '14px',
            color: '#666666',
            margin: '0',
          }}
        >
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto', backgroundColor: 'white', borderRadius: '4px' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          backgroundColor: 'white',
        }}
      >
        <thead>
          <tr style={{ backgroundColor: BRAND_COLORS.navy, color: 'white' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: '600',
                  fontSize: '14px',
                  width: col.width || 'auto',
                  borderBottom: `2px solid ${BRAND_COLORS.orange}`,
                  cursor: onSort ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
                onMouseEnter={(e) => {
                  if (onSort) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = BRAND_COLORS.navy
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{col.label}</span>
                  {onSort && sortBy === col.key && (
                    <span style={{ marginLeft: '8px', fontSize: '12px' }}>
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              style={{
                backgroundColor: rowIdx % 2 === 0 ? 'white' : BRAND_COLORS.lightGray,
                borderBottom: `1px solid ${BRAND_COLORS.borderGray}`,
                transition: 'background-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(230, 126, 34, 0.05)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  rowIdx % 2 === 0 ? 'white' : BRAND_COLORS.lightGray
              }}
            >
              {columns.map((col) => {
                const cellValue = row[col.key]
                const hasDrillDown = !!col.drillDown
                const isDrillDownCell = hasDrillDown && row[col.drillDown!.idField]

                return (
                  <td
                    key={`${rowIdx}-${col.key}`}
                    onClick={() => handleRowClick(row, col)}
                    style={{
                      padding: '12px 16px',
                      fontSize: '14px',
                      color: isDrillDownCell ? BRAND_COLORS.navy : BRAND_COLORS.darkGray,
                      cursor: isDrillDownCell ? 'pointer' : 'default',
                      textDecoration: isDrillDownCell ? 'underline' : 'none',
                      transition: 'all 0.2s ease',
                      fontWeight: isDrillDownCell ? '500' : 'normal',
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLTableCellElement>) => {
                      if (isDrillDownCell) {
                        const el = e.currentTarget as HTMLElement
                        el.style.textDecoration = 'underline'
                        el.style.color = BRAND_COLORS.orange
                      }
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLTableCellElement>) => {
                      if (isDrillDownCell) {
                        const el = e.currentTarget as HTMLElement
                        el.style.textDecoration = 'underline'
                        el.style.color = BRAND_COLORS.navy
                      }
                    }}
                  >
                    {col.format === 'status' ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '500',
                          ...getStatusBadgeColor(cellValue),
                        }}
                      >
                        {formatCellValue(cellValue, col.format)}
                      </span>
                    ) : (
                      formatCellValue(cellValue, col.format)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
