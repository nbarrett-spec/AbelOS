'use client'

import { useState, useEffect } from 'react'

interface ApiDocument {
  name: string
  path: string
  type: string
  size: number
  department: string
  tags: string[]
}

interface Department {
  name: string
  description: string
  documents: ApiDocument[]
}

interface ApiResponse {
  departments: Department[]
  totalDocuments: number
  byType: Record<string, number>
}

export default function DocumentsPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedType, setSelectedType] = useState('All')
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/ops/documents')
        if (!response.ok) {
          throw new Error('Failed to fetch documents')
        }
        const json = await response.json()
        setData(json)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchDocuments()
  }, [])

  const getFileIcon = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'xlsx':
        return '📊'
      case 'docx':
        return '📝'
      case 'pdf':
        return '📕'
      case 'pptx':
        return '📽️'
      case 'csv':
        return '📋'
      default:
        return '📄'
    }
  }

  const getTypeColor = (type: string): { bg: string; text: string } => {
    const normalizedType = type.toLowerCase()
    switch (normalizedType) {
      case 'xlsx':
        return { bg: '#e8f5e9', text: '#2e7d32' }
      case 'docx':
        return { bg: '#e3f2fd', text: '#1565c0' }
      case 'pdf':
        return { bg: '#ffebee', text: '#c62828' }
      case 'pptx':
        return { bg: '#f3e5f5', text: '#6a1b9a' }
      case 'csv':
        return { bg: '#fff3e0', text: '#e65100' }
      default:
        return { bg: '#f5f5f5', text: '#424242' }
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) {
      return `${bytes} bytes`
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }
  }

  const toggleDepartment = (deptName: string) => {
    const newExpanded = new Set(expandedDepartments)
    if (newExpanded.has(deptName)) {
      newExpanded.delete(deptName)
    } else {
      newExpanded.add(deptName)
    }
    setExpandedDepartments(newExpanded)
  }

  const getFilteredDocuments = (): { department: string; description: string; docs: ApiDocument[] }[] => {
    if (!data) return []

    const searchLower = search.toLowerCase()
    const typeFilter = selectedType.toLowerCase() === 'all' ? null : selectedType.toLowerCase()

    return data.departments
      .map(dept => ({
        department: dept.name,
        description: dept.description,
        docs: dept.documents.filter(doc => {
          const matchesSearch =
            doc.name.toLowerCase().includes(searchLower) ||
            doc.tags.some(tag => tag.toLowerCase().includes(searchLower))
          const matchesType = !typeFilter || doc.type.toLowerCase() === typeFilter
          return matchesSearch && matchesType
        }),
      }))
      .filter(dept => dept.docs.length > 0)
  }

  const getTypeFilterCounts = (): Record<string, number> => {
    if (!data) return {}
    const counts: Record<string, number> = { All: data.totalDocuments }
    Object.entries(data.byType).forEach(([type, count]) => {
      counts[type.charAt(0).toUpperCase() + type.slice(1)] = count
    })
    return counts
  }

  const typeFilterCounts = getFilteredDocuments().length > 0 ? getTypeFilterCounts() : {}
  const filteredDepts = getFilteredDocuments()

  return (
    <div style={{ padding: '32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#3E2A1E', margin: 0 }}>
            Document Center
          </h1>
          {data && (
            <div style={{ fontSize: '14px', color: '#666', fontWeight: 500 }}>
              {data.totalDocuments} document{data.totalDocuments !== 1 ? 's' : ''}
            </div>
          )}
        </div>
        <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '24px' }}>
          Browse departmental documents and resources
        </p>

        {/* Search */}
        <input
          type="text"
          placeholder="Search documents by name or tags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            boxSizing: 'border-box',
            marginBottom: '24px',
          }}
        />
      </div>

      {/* Filter Tabs */}
      {data && data.totalDocuments > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {['All', 'Spreadsheet', 'Document', 'PDF', 'Presentation'].map(type => {
            let apiType = type.toLowerCase()
            if (type === 'Spreadsheet') apiType = 'xlsx'
            else if (type === 'Document') apiType = 'docx'
            else if (type === 'PDF') apiType = 'pdf'
            else if (type === 'Presentation') apiType = 'pptx'

            const count =
              type === 'All'
                ? data.totalDocuments
                : data.byType[apiType] || 0

            if (type !== 'All' && count === 0) return null

            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: selectedType === type ? `2px solid #C9822B` : '1px solid #d1d5db',
                  backgroundColor: selectedType === type ? '#fff9f0' : 'white',
                  color: selectedType === type ? '#C9822B' : '#6b7280',
                  fontWeight: selectedType === type ? 600 : 500,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {type} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af' }}>
          <p style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</p>
          <p style={{ fontSize: '16px', fontWeight: 500 }}>Loading documents...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 32px', color: '#991b1b' }}>
          <p style={{ fontSize: '24px', marginBottom: '12px' }}>⚠️</p>
          <p style={{ fontSize: '16px', fontWeight: 500 }}>Error loading documents</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && data && (filteredDepts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 32px', color: '#9ca3af' }}>
          <p style={{ fontSize: '48px', marginBottom: '12px' }}>📭</p>
          <p style={{ fontSize: '16px', fontWeight: 500, marginBottom: '4px' }}>No documents found</p>
          <p style={{ fontSize: '14px' }}>
            {data.totalDocuments === 0
              ? 'No documents are available yet'
              : 'Try adjusting your search or filter criteria'}
          </p>
        </div>
      ) : (
        /* Departments with Accordion */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {filteredDepts.map(dept => (
            <div
              key={dept.department}
              style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                border: '1px solid #e5e7eb',
                overflow: 'hidden',
              }}
            >
              {/* Department Header */}
              <div
                onClick={() => toggleDepartment(dept.department)}
                style={{
                  padding: '16px',
                  backgroundColor: '#f9fafb',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: expandedDepartments.has(dept.department)
                    ? `2px solid #3E2A1E`
                    : 'none',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#f9fafb'
                }}
              >
                <div style={{ flex: 1 }}>
                  <h3
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      color: '#3E2A1E',
                      margin: '0 0 4px 0',
                    }}
                  >
                    {dept.department}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#6b7280', margin: '0' }}>
                    {dept.description} • {dept.docs.length} document
                    {dept.docs.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div
                  style={{
                    fontSize: '20px',
                    transition: 'transform 0.2s',
                    transform: expandedDepartments.has(dept.department)
                      ? 'rotate(180deg)'
                      : 'rotate(0deg)',
                    marginLeft: '16px',
                  }}
                >
                  ▼
                </div>
              </div>

              {/* Department Documents */}
              {expandedDepartments.has(dept.department) && (
                <div style={{ padding: '0' }}>
                  {dept.docs.map((doc, idx) => {
                    const typeColor = getTypeColor(doc.type)
                    return (
                      <div
                        key={`${doc.path}-${idx}`}
                        style={{
                          padding: '12px 16px',
                          borderTop: idx > 0 ? '1px solid #f3f4f6' : 'none',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#f9fafb'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'white'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              marginBottom: '6px',
                            }}
                          >
                            <span style={{ fontSize: '18px' }}>
                              {getFileIcon(doc.type)}
                            </span>
                            <span
                              style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: '#1f2937',
                                wordBreak: 'break-word',
                              }}
                            >
                              {doc.name}
                            </span>
                          </div>
                          {doc.tags.length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                gap: '6px',
                                flexWrap: 'wrap',
                              }}
                            >
                              {doc.tags.map(tag => (
                                <span
                                  key={tag}
                                  style={{
                                    display: 'inline-block',
                                    fontSize: '11px',
                                    backgroundColor: '#f3f4f6',
                                    color: '#6b7280',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                  }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'center',
                            marginLeft: '16px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '4px 10px',
                              backgroundColor: typeColor.bg,
                              color: typeColor.text,
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            {doc.type.toUpperCase()}
                          </span>
                          <span
                            style={{
                              fontSize: '12px',
                              color: '#6b7280',
                            }}
                          >
                            {formatFileSize(doc.size)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
