'use client';

import { useState, useEffect } from 'react';
import { CreateEditContractModal } from '../components/CreateEditContractModal';

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
}

const CONTRACT_TYPE_NAMES: Record<string, string> = {
  SUPPLY_AGREEMENT: 'Supply Agreement',
  MASTER_SERVICE: 'Master Service',
  LABOR_AGREEMENT: 'Labor Agreement',
  VENDOR_AGREEMENT: 'Vendor Agreement',
  EQUIPMENT_LEASE: 'Equipment Lease',
  OTHER: 'Other',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  SENT: 'bg-blue-100 text-blue-800',
  SIGNED: 'bg-green-100 text-green-800',
  ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-red-100 text-red-800',
};

const STATUS_NAMES: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  SIGNED: 'Signed',
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
};

const PAYMENT_TERMS_NAMES: Record<string, string> = {
  PAY_AT_ORDER: 'Pay at Order',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_60: 'Net 60',
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [filteredContracts, setFilteredContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/ops/sales/contracts');
      if (response.ok) {
        const data = await response.json();
        const raw = Array.isArray(data) ? data : (data.contracts || []);
        // Map API field names to our interface
        const contractList = raw.map((c: any) => ({
          ...c,
          startDate: c.startDate || c.effectiveDate || '',
          endDate: c.endDate || c.expirationDate || '',
          relatedCompany: c.relatedCompany || c.organization?.name || c.title?.split(' - ')[0] || '—',
          paymentTerms: c.paymentTerms || c.paymentTerm || '',
          type: c.type || 'SUPPLY_AGREEMENT',
        }));
        setContracts(contractList);
        applyFilters(contractList, statusFilter, searchTerm);
      }
    } catch (error) {
      console.error('Failed to fetch contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (data: Contract[], status: string, search: string) => {
    let filtered = data;

    if (status !== 'All') {
      filtered = filtered.filter((c) => c.status === status);
    }

    if (search) {
      filtered = filtered.filter(
        (c) =>
          c.contractNumber.toLowerCase().includes(search.toLowerCase()) ||
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.relatedCompany.toLowerCase().includes(search.toLowerCase())
      );
    }

    setFilteredContracts(filtered);
  };

  const handleStatusFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const status = e.target.value;
    setStatusFilter(status);
    applyFilters(contracts, status, searchTerm);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const search = e.target.value;
    setSearchTerm(search);
    applyFilters(contracts, statusFilter, search);
  };

  const handleNewContract = () => {
    setEditingContract(null);
    setIsModalOpen(true);
  };

  const handleEditContract = (contract: Contract) => {
    setEditingContract(contract);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingContract(null);
  };

  const handleModalSuccess = () => {
    handleModalClose();
    fetchContracts();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading contracts...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1e3a5f] text-white px-8 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Contract Management</h1>
            <p className="text-blue-100 mt-2">Manage and track all contracts</p>
          </div>
          <button
            onClick={handleNewContract}
            className="bg-[#e67e22] hover:bg-[#d46711] text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            + New Contract
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Filter Bar */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6 flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={handleStatusFilterChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#e67e22]"
            >
              <option value="All">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="SIGNED">Signed</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              placeholder="Contract #, Title, or Company..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#e67e22]"
            />
          </div>
        </div>

        {/* Contracts Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {filteredContracts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No contracts found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Contract #
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Related Company
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Payment Terms
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Start Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      End Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-900">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredContracts.map((contract) => (
                    <tr key={contract.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => handleEditContract(contract)}
                          className="text-[#e67e22] hover:text-[#d46711] font-medium"
                        >
                          {contract.contractNumber}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900">{contract.title}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs font-medium">
                          {CONTRACT_TYPE_NAMES[contract.type] || contract.type}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-900">{contract.relatedCompany}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[contract.status] || 'bg-gray-100 text-gray-800'}`}>
                          {STATUS_NAMES[contract.status] || contract.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {PAYMENT_TERMS_NAMES[contract.paymentTerms] || contract.paymentTerms}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {new Date(contract.startDate).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <p className="text-sm text-gray-900">
                          {new Date(contract.endDate).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditContract(contract)}
                            className="text-[#e67e22] hover:text-[#d46711] text-sm font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleEditContract(contract)}
                            className="text-[#1e3a5f] hover:text-[#153250] text-sm font-medium"
                          >
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
      <CreateEditContractModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSuccess={handleModalSuccess}
        contract={editingContract}
      />
    </div>
  );
}
