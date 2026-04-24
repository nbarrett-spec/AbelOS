'use client'

import { useState, useEffect } from 'react'
import { Files } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'

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

  const getTypeBadgeClass = (type: string): string => {
    const normalizedType = type.toLowerCase()
    switch (normalizedType) {
      case 'xlsx':
        return 'bg-data-positive-bg text-data-positive-fg'
      case 'docx':
        return 'bg-data-info-bg text-data-info-fg'
      case 'pdf':
        return 'bg-data-negative-bg text-data-negative-fg'
      case 'pptx':
        return 'bg-signal-subtle text-accent-fg'
      case 'csv':
        return 'bg-data-warning-bg text-data-warning-fg'
      default:
        return 'bg-surface-muted text-fg-muted'
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

  const filteredDepts = getFilteredDocuments()

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <PageHeader
        title="Document Center"
        description="Browse departmental documents and resources"
        actions={
          data ? (
            <div className="text-sm text-fg-muted font-medium">
              {data.totalDocuments} document{data.totalDocuments !== 1 ? 's' : ''}
            </div>
          ) : undefined
        }
      />

      {/* Search */}
      <input
        type="text"
        placeholder="Search documents by name or tags..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-4 py-3 rounded-lg border border-border bg-surface text-fg text-sm shadow-elev-1 box-border mb-6"
      />

      {/* Filter Tabs */}
      {data && data.totalDocuments > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
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

            const isActive = selectedType === type
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-4 py-2.5 rounded-lg text-sm cursor-pointer transition-all ${
                  isActive
                    ? 'border-2 border-signal bg-signal-subtle text-signal font-semibold'
                    : 'border border-border bg-surface text-fg-muted font-medium hover:bg-row-hover'
                }`}
              >
                {type} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-16 px-8 text-fg-subtle">
          <p className="text-2xl mb-3">⏳</p>
          <p className="text-base font-medium">Loading documents...</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="text-center py-16 px-8 text-data-negative-fg">
          <p className="text-2xl mb-3">⚠️</p>
          <p className="text-base font-medium">Error loading documents</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && data && (filteredDepts.length === 0 ? (
        <EmptyState
          icon={<Files className="w-10 h-10 text-fg-subtle" />}
          title="No documents found"
          description={
            data.totalDocuments === 0
              ? 'No documents are available yet'
              : 'Try adjusting your search or filter criteria'
          }
          size="full"
        />
      ) : (
        /* Departments with Accordion */
        <div className="flex flex-col gap-4">
          {filteredDepts.map(dept => {
            const isOpen = expandedDepartments.has(dept.department)
            return (
              <div
                key={dept.department}
                className="bg-surface rounded-lg border border-border overflow-hidden"
              >
                {/* Department Header */}
                <div
                  onClick={() => toggleDepartment(dept.department)}
                  className={`p-4 bg-surface-muted cursor-pointer flex justify-between items-center transition-all hover:bg-row-hover ${
                    isOpen ? 'border-b-2 border-signal' : ''
                  }`}
                >
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-fg m-0 mb-1">
                      {dept.department}
                    </h3>
                    <p className="text-xs text-fg-muted m-0">
                      {dept.description} • {dept.docs.length} document
                      {dept.docs.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div
                    className="text-xl ml-4 text-fg-muted"
                    style={{
                      transition: 'transform 0.2s',
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  >
                    ▼
                  </div>
                </div>

                {/* Department Documents */}
                {isOpen && (
                  <div>
                    {dept.docs.map((doc, idx) => {
                      return (
                        <div
                          key={`${doc.path}-${idx}`}
                          className={`px-4 py-3 flex justify-between items-center transition-colors hover:bg-row-hover ${
                            idx > 0 ? 'border-t border-border' : ''
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-lg">
                                {getFileIcon(doc.type)}
                              </span>
                              <span className="text-sm font-semibold text-fg break-words">
                                {doc.name}
                              </span>
                            </div>
                            {doc.tags.length > 0 && (
                              <div className="flex gap-1.5 flex-wrap">
                                {doc.tags.map(tag => (
                                  <span
                                    key={tag}
                                    className="inline-block text-[11px] bg-surface-muted text-fg-muted px-2 py-0.5 rounded"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-3 items-center ml-4 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-1 rounded text-[11px] font-semibold ${getTypeBadgeClass(doc.type)}`}
                            >
                              {doc.type.toUpperCase()}
                            </span>
                            <span className="text-xs text-fg-muted">
                              {formatFileSize(doc.size)}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
