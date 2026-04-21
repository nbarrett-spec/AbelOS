'use client';

import { useState } from 'react';

interface RequestDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const DOCUMENT_TYPES = [
  { value: 'COI', label: 'Certificate of Insurance' },
  { value: 'W9', label: 'W-9 Form' },
  { value: 'CREDIT_APPLICATION', label: 'Credit Application' },
  { value: 'BUSINESS_LICENSE', label: 'Business License' },
  { value: 'TAX_EXEMPT_CERT', label: 'Tax Exempt Certificate' },
  { value: 'BOND', label: 'Bond' },
  { value: 'REFERENCES', label: 'References' },
  { value: 'FINANCIAL_STATEMENT', label: 'Financial Statement' },
  { value: 'OTHER', label: 'Other' },
];

const TYPE_AUTO_TITLES: Record<string, string> = {
  COI: 'Certificate of Insurance',
  W9: 'W-9 Tax Form',
  CREDIT_APPLICATION: 'Credit Application Form',
  BUSINESS_LICENSE: 'Business License',
  TAX_EXEMPT_CERT: 'Tax Exempt Certificate',
  BOND: 'Surety Bond',
  REFERENCES: 'Business References',
  FINANCIAL_STATEMENT: 'Financial Statement',
  OTHER: 'Document',
};

export function RequestDocumentModal({
  isOpen,
  onClose,
  onSuccess,
}: RequestDocumentModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    type: 'COI',
    title: TYPE_AUTO_TITLES['COI'],
    description: '',
    dealId: '',
    builderId: '',
    company: '',
    dueDate: '',
    notes: '',
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    // Auto-fill title when type changes
    if (name === 'type') {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
        title: TYPE_AUTO_TITLES[value] || '',
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.type.trim()) {
      setError('Document type is required');
      return;
    }

    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }

    if (!formData.company.trim()) {
      setError('Company name is required');
      return;
    }

    if (!formData.dueDate) {
      setError('Due date is required');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/ops/sales/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          status: 'PENDING',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to request document');
      }

      // Reset form
      setFormData({
        type: 'COI',
        title: TYPE_AUTO_TITLES['COI'],
        description: '',
        dealId: '',
        builderId: '',
        company: '',
        dueDate: '',
        notes: '',
      });

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#1e3a5f] text-white px-6 py-4 flex items-center justify-between border-b">
          <h2 className="text-lg font-bold">Request Document</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-white hover:text-gray-200 text-2xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {/* Document Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Document Type *
            </label>
            <select
              name="type"
              value={formData.type}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              placeholder="Document title"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>

          {/* Company */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company *
            </label>
            <input
              type="text"
              name="company"
              value={formData.company}
              onChange={handleInputChange}
              placeholder="Company name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>

          {/* Deal ID / Builder ID */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Deal ID
              </label>
              <input
                type="text"
                name="dealId"
                value={formData.dealId}
                onChange={handleInputChange}
                placeholder="Deal ID (optional)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Builder ID
              </label>
              <input
                type="text"
                name="builderId"
                value={formData.builderId}
                onChange={handleInputChange}
                placeholder="Builder ID (optional)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
              />
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Due Date *
            </label>
            <input
              type="date"
              name="dueDate"
              value={formData.dueDate}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Provide any additional context or requirements..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              placeholder="Internal notes..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C6A24E]"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-[#C6A24E] hover:bg-[#d46711] text-white rounded-lg font-medium disabled:opacity-50"
            >
              {loading ? 'Requesting...' : 'Request Document'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
