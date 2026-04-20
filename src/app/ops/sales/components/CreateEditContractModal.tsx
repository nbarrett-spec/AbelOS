'use client';

import { useState, useEffect } from 'react';

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  type: string;
  dealId?: string;
  builderId?: string;
  relatedCompany: string;
  status: string;
  paymentTerms: string;
  startDate: string;
  endDate: string;
  creditLimit?: number;
  estimatedAnnualVolume?: number;
  discountPercent?: number;
  terms?: string;
  specialClauses?: string;
}

interface CreateEditContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  contract?: Contract | null;
}

const CONTRACT_TYPES = [
  { value: 'SUPPLY_AGREEMENT', label: 'Supply Agreement' },
  { value: 'MASTER_SERVICE', label: 'Master Service' },
  { value: 'LABOR_AGREEMENT', label: 'Labor Agreement' },
  { value: 'VENDOR_AGREEMENT', label: 'Vendor Agreement' },
  { value: 'EQUIPMENT_LEASE', label: 'Equipment Lease' },
  { value: 'OTHER', label: 'Other' },
];

const PAYMENT_TERMS = [
  { value: 'PAY_AT_ORDER', label: 'Pay at Order' },
  { value: 'PAY_ON_DELIVERY', label: 'Pay on Delivery' },
  { value: 'NET_15', label: 'Net 15' },
  { value: 'NET_30', label: 'Net 30' },
  { value: 'NET_60', label: 'Net 60' },
];

const STATUSES = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'SIGNED', label: 'Signed' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRED', label: 'Expired' },
];

export function CreateEditContractModal({
  isOpen,
  onClose,
  onSuccess,
  contract,
}: CreateEditContractModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    type: 'SUPPLY_AGREEMENT',
    dealId: '',
    builderId: '',
    relatedCompany: '',
    status: 'DRAFT',
    paymentTerms: 'NET_30',
    creditLimit: '',
    estimatedAnnualVolume: '',
    discountPercent: '',
    terms: '',
    specialClauses: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    if (contract) {
      setFormData({
        title: contract.title,
        type: contract.type,
        dealId: contract.dealId || '',
        builderId: contract.builderId || '',
        relatedCompany: contract.relatedCompany,
        status: contract.status,
        paymentTerms: contract.paymentTerms,
        creditLimit: contract.creditLimit?.toString() || '',
        estimatedAnnualVolume: contract.estimatedAnnualVolume?.toString() || '',
        discountPercent: contract.discountPercent?.toString() || '',
        terms: contract.terms || '',
        specialClauses: contract.specialClauses || '',
        startDate: contract.startDate?.split('T')[0] || '',
        endDate: contract.endDate?.split('T')[0] || '',
      });
    } else {
      setFormData({
        title: '',
        type: 'SUPPLY_AGREEMENT',
        dealId: '',
        builderId: '',
        relatedCompany: '',
        status: 'DRAFT',
        paymentTerms: 'NET_30',
        creditLimit: '',
        estimatedAnnualVolume: '',
        discountPercent: '',
        terms: '',
        specialClauses: '',
        startDate: '',
        endDate: '',
      });
    }
  }, [contract, isOpen]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }

    if (!formData.relatedCompany.trim()) {
      setError('Company name is required');
      return;
    }

    if (!formData.startDate) {
      setError('Start date is required');
      return;
    }

    if (!formData.endDate) {
      setError('End date is required');
      return;
    }

    try {
      setLoading(true);
      const payload = {
        ...formData,
        creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) : undefined,
        estimatedAnnualVolume: formData.estimatedAnnualVolume
          ? parseFloat(formData.estimatedAnnualVolume)
          : undefined,
        discountPercent: formData.discountPercent
          ? parseFloat(formData.discountPercent)
          : undefined,
      };

      const method = contract ? 'PUT' : 'POST';
      const url = contract
        ? `/api/ops/sales/contracts/${contract.id}`
        : '/api/ops/sales/contracts';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save contract');
      }

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
          <h2 className="text-lg font-bold">
            {contract ? 'Edit Contract' : 'Create New Contract'}
          </h2>
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
              placeholder="Contract title"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          {/* Type and Related Company */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                name="type"
                value={formData.type}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              >
                {CONTRACT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Related Company *
              </label>
              <input
                type="text"
                name="relatedCompany"
                value={formData.relatedCompany}
                onChange={handleInputChange}
                placeholder="Company name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
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
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>
          </div>

          {/* Payment Terms */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Terms
              </label>
              <select
                name="paymentTerms"
                value={formData.paymentTerms}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              >
                {PAYMENT_TERMS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Credit Limit, Annual Volume, Discount */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Credit Limit ($)
              </label>
              <input
                type="number"
                name="creditLimit"
                value={formData.creditLimit}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Est. Annual Volume ($)
              </label>
              <input
                type="number"
                name="estimatedAnnualVolume"
                value={formData.estimatedAnnualVolume}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discount (%)
              </label>
              <input
                type="number"
                name="discountPercent"
                value={formData.discountPercent}
                onChange={handleInputChange}
                placeholder="0.00"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date *
              </label>
              <input
                type="date"
                name="startDate"
                value={formData.startDate}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date *
              </label>
              <input
                type="date"
                name="endDate"
                value={formData.endDate}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
              />
            </div>
          </div>

          {/* Terms */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Terms
            </label>
            <textarea
              name="terms"
              value={formData.terms}
              onChange={handleInputChange}
              placeholder="Enter contract terms..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
            />
          </div>

          {/* Special Clauses */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Special Clauses
            </label>
            <textarea
              name="specialClauses"
              value={formData.specialClauses}
              onChange={handleInputChange}
              placeholder="Enter any special clauses..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#C9822B]"
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
              className="flex-1 px-4 py-2 bg-[#C9822B] hover:bg-[#d46711] text-white rounded-lg font-medium disabled:opacity-50"
            >
              {loading ? 'Saving...' : contract ? 'Update Contract' : 'Create Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
