'use client';

import { useState, useEffect } from 'react';
import { RequestDocumentModal } from '../components/RequestDocumentModal';

interface Document {
  id: string;
  type: string;
  title: string;
  company: string;
  status: string;
  dueDate: string;
  receivedDate?: string;
  requestedBy: string;
  dealId?: string;
  builderId?: string;
}

const DOCUMENT_TYPES: Record<string, string> = {
  COI: 'Certificate of Insurance',
  W9: 'W-9 Form',
  CREDIT_APPLICATION: 'Credit Application',
  BUSINESS_LICENSE: 'Business License',
  TAX_EXEMPT_CERT: 'Tax Exempt Certificate',
  BOND: 'Bond',
  REFERENCES: 'References',
  FINANCIAL_STATEMENT: 'Financial Statement',
  OTHER: 'Other',
};

const DOCUMENT_ICONS: Record<string, string> = {
  COI: '🛡️',
  W9: '📄',
  CREDIT_APPLICATION: '💳',
  BUSINESS_LICENSE: '📋',
  TAX_EXEMPT_CERT: '📜',
  BOND: '🔒',
  REFERENCES: '👥',
  FINANCIAL_STATEMENT: '📊',
  OTHER: '📎',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  SENT: 'bg-blue-100 text-blue-800',
  RECEIVED: 'bg-green-100 text-green-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

const STATUS_NAMES: Record<string, string> = {
  PENDING: 'Pending',
  SENT: 'Sent',
  RECEIVED: 'Received',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/ops/sales/documents');
      if (response.ok) {
        const json = await response.json();
        const data = Array.isArray(json) ? json : (json.documents || []);
        setDocuments(data);
        applyFilters(data, statusFilter, typeFilter, searchTerm);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (
    data: Document[],
    status: string,
    type: string,
    search: string
  ) => {
    let filtered = data;

    if (status !== 'All') {
      filtered = filtered.filter((d) => d.status === status);
    }

    if (type !== 'All') {
      filtered = filtered.filter((d) => d.type === type);
    }

    if (search) {
      filtered = filtered.filter(
        (d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          d.company.toLowerCase().includes(search.toLowerCase()) ||
          d.requestedBy.toLowerCase().includes(search.toLowerCase())
      );
    }

    setFilteredDocuments(filtered);
  };

  const handleStatusFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const status = e.target.value;
    setStatusFilter(status);
    applyFilters(documents, status, typeFilter, searchTerm);
  };

  const handleTypeFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value;
    setTypeFilter(type);
    applyFilters(documents, statusFilter, type, searchTerm);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const search = e.target.value;
    setSearchTerm(search);
    applyFilters(documents, statusFilter, typeFilter, search);
  };

  const getStats = () => {
    const pending = documents.filter((d) => d.status === 'PENDING').length;
    const sent = documents.filter((d) => d.status === 'SENT').length;
    const received = documents.filter((d) => d.status === 'RECEIVED').length;
    const overdue = documents.filter(
      (d) =>
        (d.status === 'PENDING' || d.status === 'SENT') &&
        new Date(d.dueDate) < new Date()
    ).length;

    return { pending, sent, received, overdue };
  };

  const isOverdue = (doc: Document): boolean => {
    return (
      (doc.status === 'PENDING' || doc.status === 'SENT') &&
      new Date(doc.dueDate) < new Date()
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading documents...</div>
      </div>
    );
  }

  const stats = getStats();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Document Requests</h1>
            <p className="text-blue-100 mt-2">Track and manage document requests</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-[#C6A24E] hover:bg-[#d46711] text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            + Request Document
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-yellow-50 rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Pending</p>
            <p className="text-3xl font-bold text-yellow-600">{stats.pending}</p>
            <p className="text-gray-400 text-xs mt-2">Awaiting response</p>
          </div>

          <div className="bg-blue-50 rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Sent</p>
            <p className="text-3xl font-bold text-blue-600">{stats.sent}</p>
            <p className="text-gray-400 text-xs mt-2">Request in progress</p>
          </div>

          <div className="bg-green-50 rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Received</p>
            <p className="text-3xl font-bold text-green-600">{stats.received}</p>
            <p className="text-gray-400 text-xs mt-2">Submitted documents</p>
          </div>

          <div className="bg-red-50 rounded-lg shadow-sm border border-gray-200 p-6">
            <p className="text-gray-600 text-sm font-medium mb-2">Overdue</p>
            <p className="text-3xl font-bold text-red-600">{stats.overdue}</p>
            <p className="text-gray-400 text-xs mt-2">Past due date</p>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6 grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={handleStatusFilterChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            >
              <option value="All">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="SENT">Sent</option>
              <option value="RECEIVED">Received</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Document Type
            </label>
            <select
              value={typeFilter}
              onChange={handleTypeFilterChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            >
              <option value="All">All Types</option>
              {Object.entries(DOCUMENT_TYPES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              placeholder="Title, company, or staff..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>
        </div>

        {/* Documents Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {filteredDocuments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No documents found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Company
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Due Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Received Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Requested By
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {DOCUMENT_ICONS[doc.type] || '📎'}
                          </span>
                          <span className="text-sm text-gray-600">
                            {doc.type}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900">{doc.title}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900">{doc.company}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-800'}`}>
                          {STATUS_NAMES[doc.status] || doc.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className={`text-sm ${isOverdue(doc) ? 'text-red-600 font-semibold' : 'text-gray-900'}`}>
                          {new Date(doc.dueDate).toLocaleDateString()}
                          {isOverdue(doc) && ' (Overdue)'}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {doc.receivedDate
                            ? new Date(doc.receivedDate).toLocaleDateString()
                            : '—'}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">{doc.requestedBy}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button className="text-[#C6A24E] hover:text-[#d46711] text-sm font-medium">
                            Update
                          </button>
                          <button className="text-[#1e3a5f] hover:text-[#153250] text-sm font-medium">
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <RequestDocumentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false);
          fetchDocuments();
        }}
      />
    </div>
  );
}
