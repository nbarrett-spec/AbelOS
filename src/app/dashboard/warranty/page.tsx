'use client';

import { useEffect, useState } from 'react';
// Navbar provided by dashboard/layout.tsx
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';

interface WarrantyClaim {
  id: string;
  claimNumber: string;
  type: 'PRODUCT' | 'MATERIAL' | 'INSTALLATION';
  subject: string;
  description: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'INSPECTION_SCHEDULED' | 'APPROVED' | 'IN_PROGRESS' | 'RESOLVED' | 'DENIED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  productName?: string;
  productSku?: string;
  installDate?: string;
  issueDate?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  siteAddress?: string;
  siteCity?: string;
  siteState?: string;
  siteZip?: string;
  createdAt: string;
  resolutionDetails?: string;
}

interface WarrantyPolicy {
  id: string;
  name: string;
  type: string;
  durationMonths: number;
  description: string;
  active: boolean;
}

export default function WarrantyPage() {
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [policies, setPolicies] = useState<WarrantyPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPolicies, setShowPolicies] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<WarrantyClaim | null>(null);
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showNewClaimForm, setShowNewClaimForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const [formData, setFormData] = useState({
    type: 'PRODUCT' as const,
    subject: '',
    description: '',
    productName: '',
    productSku: '',
    installDate: '',
    issueDate: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    siteAddress: '',
    siteCity: '',
    siteState: '',
    siteZip: '',
  });

  // Fetch warranty data on mount
  useEffect(() => {
    fetchWarrantyData();
  }, []);

  const fetchWarrantyData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/builders/warranty', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch warranty data');
      }

      const data = await response.json();
      setClaims(data.claims || []);
      setPolicies(data.policies || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching warranty data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitClaim = async () => {
    // Validate required fields
    if (!formData.subject.trim() || !formData.description.trim()) {
      showToast('Please fill in Subject and Description', 'error');
      return;
    }
    // Validate optional format fields
    if (formData.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contactEmail)) {
      showToast('Please enter a valid email address', 'error');
      return;
    }
    if (formData.contactPhone && !/^(\+1)?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(formData.contactPhone)) {
      showToast('Please enter a valid phone number (e.g., 555-123-4567)', 'error');
      return;
    }
    if (formData.siteZip && !/^\d{5}(-\d{4})?$/.test(formData.siteZip)) {
      showToast('Please enter a valid ZIP code (e.g., 75001)', 'error');
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch('/api/builders/warranty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to submit claim');
      }

      setFormData({
        type: 'PRODUCT',
        subject: '',
        description: '',
        productName: '',
        productSku: '',
        installDate: '',
        issueDate: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        siteAddress: '',
        siteCity: '',
        siteState: '',
        siteZip: '',
      });
      setShowNewClaimForm(false);
      await fetchWarrantyData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to submit claim', 'error');
      console.error('Error submitting claim:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'PRODUCT':
        return '📦';
      case 'MATERIAL':
        return '🪵';
      case 'INSTALLATION':
        return '🔧';
      default:
        return '•';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUBMITTED':
        return 'bg-blue-100 text-blue-800 border border-blue-300';
      case 'UNDER_REVIEW':
        return 'bg-yellow-100 text-yellow-800 border border-yellow-300';
      case 'INSPECTION_SCHEDULED':
        return 'bg-purple-100 text-purple-800 border border-purple-300';
      case 'APPROVED':
        return 'bg-green-100 text-green-800 border border-green-300';
      case 'IN_PROGRESS':
        return 'bg-orange-100 text-orange-800 border border-orange-300';
      case 'RESOLVED':
        return 'bg-emerald-100 text-emerald-800 border border-emerald-300';
      case 'DENIED':
        return 'bg-red-100 text-red-800 border border-red-300';
      case 'CLOSED':
        return 'bg-gray-100 text-gray-800 border border-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 border border-gray-300';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'LOW':
        return 'text-green-600';
      case 'MEDIUM':
        return 'text-orange-600';
      case 'HIGH':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const openCount = claims.filter(
    (c) => ['SUBMITTED', 'UNDER_REVIEW', 'INSPECTION_SCHEDULED', 'APPROVED', 'IN_PROGRESS'].includes(c.status)
  ).length;

  const resolvedCount = claims.filter((c) => ['RESOLVED', 'CLOSED'].includes(c.status)).length;

  const activePolicies = policies.filter((p) => p.active);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div>
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
            toastType === 'error' ? 'bg-red-600' : 'bg-[#3E2A1E]'
          }`}>
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Warranty Claims</h1>
            <p className="text-gray-600 mt-2">Manage your warranty policies and file new claims</p>
          </div>
          <button
            onClick={() => setShowNewClaimForm(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            <Plus size={20} />
            File New Claim
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Stats Bar */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
              <p className="text-gray-600 text-sm font-semibold uppercase">Total Claims</p>
              <p className="text-4xl font-bold text-gray-900 mt-2">{claims.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500">
              <p className="text-gray-600 text-sm font-semibold uppercase">Open Claims</p>
              <p className="text-4xl font-bold text-gray-900 mt-2">{openCount}</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-emerald-500">
              <p className="text-gray-600 text-sm font-semibold uppercase">Resolved</p>
              <p className="text-4xl font-bold text-gray-900 mt-2">{resolvedCount}</p>
            </div>
          </div>
        )}

        {/* Active Policies Section */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <button
            onClick={() => setShowPolicies(!showPolicies)}
            className="flex items-center justify-between w-full text-left"
          >
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Warranty Policies</h2>
              <p className="text-gray-600 text-sm mt-1">{activePolicies.length} active policies</p>
            </div>
            {showPolicies ? <ChevronUp size={24} className="text-gray-600" /> : <ChevronDown size={24} className="text-gray-600" />}
          </button>

          {showPolicies && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
              {activePolicies.length > 0 ? (
                activePolicies.map((policy) => (
                  <div key={policy.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{policy.name}</h3>
                        <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full mt-2">
                          {policy.type}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-3">{policy.description}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-3">Duration: {policy.durationMonths} months</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-600 col-span-full">No active policies</p>
              )}
            </div>
          )}
        </div>

        {/* Claims List or Empty State */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-r-transparent"></div>
            <p className="text-gray-600 mt-4">Loading warranty data...</p>
          </div>
        ) : claims.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">No Warranty Claims Yet</h3>
            <p className="text-gray-600 mb-6">Start by filing a new claim for any warranty-related issues.</p>
            <button
              onClick={() => setShowNewClaimForm(true)}
              className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              <Plus size={20} />
              File New Claim
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-100 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Claim #</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Type</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Subject</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Status</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Priority</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Date</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-900">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {claims.map((claim) => (
                    <tr key={claim.id} className="hover:bg-gray-50 transition-colors cursor-pointer">
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900">{claim.claimNumber}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className="text-xl">{getTypeIcon(claim.type)}</span>
                        <span className="text-gray-700 ml-2">{claim.type}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{claim.subject}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getStatusColor(claim.status)}`}>
                          {claim.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className={`px-6 py-4 text-sm font-semibold ${getPriorityColor(claim.priority)}`}>
                        {claim.priority}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatDate(claim.createdAt)}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedClaim(claim)}
                          className="text-orange-600 hover:text-orange-700 font-semibold text-sm"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Claim Detail Modal */}
      {selectedClaim && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Claim Details</h2>
              <button onClick={() => setSelectedClaim(null)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Claim Header */}
              <div className="grid grid-cols-2 gap-4 pb-6 border-b border-gray-200">
                <div>
                  <p className="text-sm text-gray-600">Claim Number</p>
                  <p className="text-lg font-semibold text-gray-900">{selectedClaim.claimNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <span className={`text-sm font-semibold px-3 py-1 rounded-full inline-block ${getStatusColor(selectedClaim.status)}`}>
                    {selectedClaim.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Type</p>
                  <p className="text-lg font-semibold text-gray-900">
                    <span className="text-xl">{getTypeIcon(selectedClaim.type)}</span> {selectedClaim.type}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Priority</p>
                  <p className={`text-lg font-semibold ${getPriorityColor(selectedClaim.priority)}`}>{selectedClaim.priority}</p>
                </div>
              </div>

              {/* Claim Details */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Claim Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Subject</p>
                    <p className="text-gray-900 font-semibold">{selectedClaim.subject}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Date Submitted</p>
                    <p className="text-gray-900 font-semibold">{formatDate(selectedClaim.createdAt)}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-sm text-gray-600">Description</p>
                  <p className="text-gray-900 mt-2 whitespace-pre-wrap">{selectedClaim.description}</p>
                </div>
              </div>

              {/* Product Information */}
              {(selectedClaim.productName || selectedClaim.productSku || selectedClaim.installDate || selectedClaim.issueDate) && (
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Product Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedClaim.productName && (
                      <div>
                        <p className="text-sm text-gray-600">Product Name</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.productName}</p>
                      </div>
                    )}
                    {selectedClaim.productSku && (
                      <div>
                        <p className="text-sm text-gray-600">Product SKU</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.productSku}</p>
                      </div>
                    )}
                    {selectedClaim.installDate && (
                      <div>
                        <p className="text-sm text-gray-600">Install Date</p>
                        <p className="text-gray-900 font-semibold">{formatDate(selectedClaim.installDate)}</p>
                      </div>
                    )}
                    {selectedClaim.issueDate && (
                      <div>
                        <p className="text-sm text-gray-600">Issue Date</p>
                        <p className="text-gray-900 font-semibold">{formatDate(selectedClaim.issueDate)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Contact Information */}
              {(selectedClaim.contactName || selectedClaim.contactEmail || selectedClaim.contactPhone) && (
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedClaim.contactName && (
                      <div>
                        <p className="text-sm text-gray-600">Contact Name</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.contactName}</p>
                      </div>
                    )}
                    {selectedClaim.contactEmail && (
                      <div>
                        <p className="text-sm text-gray-600">Email</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.contactEmail}</p>
                      </div>
                    )}
                    {selectedClaim.contactPhone && (
                      <div>
                        <p className="text-sm text-gray-600">Phone</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.contactPhone}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Site Information */}
              {(selectedClaim.siteAddress || selectedClaim.siteCity || selectedClaim.siteState || selectedClaim.siteZip) && (
                <div className="border-t border-gray-200 pt-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Site Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedClaim.siteAddress && (
                      <div>
                        <p className="text-sm text-gray-600">Address</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.siteAddress}</p>
                      </div>
                    )}
                    {selectedClaim.siteCity && (
                      <div>
                        <p className="text-sm text-gray-600">City</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.siteCity}</p>
                      </div>
                    )}
                    {selectedClaim.siteState && (
                      <div>
                        <p className="text-sm text-gray-600">State</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.siteState}</p>
                      </div>
                    )}
                    {selectedClaim.siteZip && (
                      <div>
                        <p className="text-sm text-gray-600">ZIP Code</p>
                        <p className="text-gray-900 font-semibold">{selectedClaim.siteZip}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Resolution Details */}
              {selectedClaim.resolutionDetails && (
                <div className="border-t border-gray-200 pt-6 bg-green-50 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-green-900 mb-2">Resolution Details</h3>
                  <p className="text-green-800 whitespace-pre-wrap">{selectedClaim.resolutionDetails}</p>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-gray-100 border-t border-gray-200 px-6 py-4">
              <button
                onClick={() => setSelectedClaim(null)}
                className="w-full bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Claim Form Modal */}
      {showNewClaimForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">File New Warranty Claim</h2>
              <button onClick={() => setShowNewClaimForm(false)} className="text-gray-500 hover:text-gray-700">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Type Select */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Claim Type <span className="text-red-600">*</span>
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                >
                  <option value="PRODUCT">Product Issue</option>
                  <option value="MATERIAL">Material Issue</option>
                  <option value="INSTALLATION">Installation Issue</option>
                </select>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Subject <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Brief summary of the issue"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Description <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Detailed description of the issue"
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Product Information */}
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Product Information (Optional)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    value={formData.productName}
                    onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                    placeholder="Product Name"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    type="text"
                    value={formData.productSku}
                    onChange={(e) => setFormData({ ...formData, productSku: e.target.value })}
                    placeholder="Product SKU"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    type="date"
                    value={formData.installDate}
                    onChange={(e) => setFormData({ ...formData, installDate: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    type="date"
                    value={formData.issueDate}
                    onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Contact Information */}
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Contact Information (Optional)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="text"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    placeholder="Contact Name"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    type="email"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    placeholder="Email Address"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    type="tel"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    placeholder="Phone Number"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Site Information */}
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Site Information (Optional)</h3>
                <div className="grid grid-cols-1 gap-4">
                  <input
                    type="text"
                    value={formData.siteAddress}
                    onChange={(e) => setFormData({ ...formData, siteAddress: e.target.value })}
                    placeholder="Street Address"
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <input
                      type="text"
                      value={formData.siteCity}
                      onChange={(e) => setFormData({ ...formData, siteCity: e.target.value })}
                      placeholder="City"
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <input
                      type="text"
                      value={formData.siteState}
                      onChange={(e) => setFormData({ ...formData, siteState: e.target.value })}
                      placeholder="State"
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <input
                      type="text"
                      value={formData.siteZip}
                      onChange={(e) => setFormData({ ...formData, siteZip: e.target.value })}
                      placeholder="ZIP"
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-gray-100 border-t border-gray-200 px-6 py-4 flex gap-3">
              <button
                onClick={() => setShowNewClaimForm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitClaim}
                disabled={submitting}
                className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-lg font-semibold transition-colors"
              >
                {submitting ? 'Submitting...' : 'File Claim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
