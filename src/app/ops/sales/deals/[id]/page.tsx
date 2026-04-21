'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import {
  Phone,
  Mail,
  MapPin,
  Edit2,
  Calendar,
  ArrowRight,
  Send,
  FileText,
  Plus,
  Check,
  X,
  ChevronDown,
  Clock,
  FileCheck,
  AlertCircle,
} from 'lucide-react';

interface Deal {
  id: string;
  dealNumber: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  source: string;
  contactEmail?: string;
  contactPhone?: string;
  stage: 'PROSPECT' | 'DISCOVERY' | 'WALKTHROUGH' | 'BID_SUBMITTED' | 'BID_REVIEW' | 'NEGOTIATION' | 'WON' | 'LOST' | 'ONBOARDED';
  probability: number;
  dealValue: number;
  expectedCloseDate: string;
  createdAt: string;
  owner: {
    id: string;
    name: string;
    firstName?: string;
    lastName?: string;
    avatar?: string;
  };
  activities: DealActivity[];
  contracts: Contract[];
  documentRequests: DocumentRequest[];
}

interface DealActivity {
  id: string;
  type: 'CALL' | 'EMAIL' | 'MEETING' | 'SITE_VISIT' | 'NOTE' | 'STAGE_CHANGE' | 'BID_SENT' | 'CONTRACT_SENT';
  subject: string;
  notes: string;
  outcome: string;
  followUpDate?: string;
  followUpDone: boolean;
  createdAt: string;
  staffName: string;
}

interface Contract {
  id: string;
  contractNumber: string;
  title: string;
  type: string;
  status: 'DRAFT' | 'SENT' | 'SIGNED' | 'COMPLETED';
  startDate: string;
  endDate: string;
}

interface DocumentRequest {
  id: string;
  documentType: string;
  title: string;
  status: 'PENDING' | 'RECEIVED' | 'OVERDUE';
  dueDate: string;
  receivedDate?: string;
}

const stageConfig: Record<Deal['stage'], { label: string; color: string; probability: number }> = {
  PROSPECT: { label: 'Prospect', color: 'bg-gray-100 text-gray-800', probability: 10 },
  DISCOVERY: { label: 'Discovery', color: 'bg-blue-100 text-blue-800', probability: 20 },
  WALKTHROUGH: { label: 'Walkthrough', color: 'bg-indigo-100 text-indigo-800', probability: 35 },
  BID_SUBMITTED: { label: 'Bid Submitted', color: 'bg-orange-100 text-orange-800', probability: 50 },
  BID_REVIEW: { label: 'Bid Review', color: 'bg-orange-100 text-orange-800', probability: 60 },
  NEGOTIATION: { label: 'Negotiation', color: 'bg-yellow-100 text-yellow-800', probability: 75 },
  WON: { label: 'Won', color: 'bg-green-100 text-green-800', probability: 100 },
  LOST: { label: 'Lost', color: 'bg-red-100 text-red-800', probability: 0 },
  ONBOARDED: { label: 'Onboarded', color: 'bg-emerald-100 text-emerald-800', probability: 100 },
};

const activityIcons: Record<string, React.ReactNode> = {
  CALL: <Phone className="w-5 h-5" />,
  EMAIL: <Mail className="w-5 h-5" />,
  MEETING: <Calendar className="w-5 h-5" />,
  SITE_VISIT: <MapPin className="w-5 h-5" />,
  TEXT: <Mail className="w-5 h-5" />,
  NOTE: <FileText className="w-5 h-5" />,
  STAGE_CHANGE: <ArrowRight className="w-5 h-5" />,
  BID_SENT: <Send className="w-5 h-5" />,
  BID_REVISED: <Send className="w-5 h-5" />,
  CONTRACT_SENT: <FileCheck className="w-5 h-5" />,
  CONTRACT_SIGNED: <FileCheck className="w-5 h-5" />,
  DOCUMENT_REQUESTED: <FileText className="w-5 h-5" />,
  DOCUMENT_RECEIVED: <FileText className="w-5 h-5" />,
  FOLLOW_UP: <Calendar className="w-5 h-5" />,
};

export default function DealDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.id as string;

  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [activeTab, setActiveTab] = useState<'activities' | 'contracts' | 'documents'>('activities');
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [newActivity, setNewActivity] = useState({
    type: 'CALL',
    subject: '',
    notes: '',
    outcome: '',
    followUpDate: '',
  });
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  useEffect(() => {
    fetchDeal();
  }, [dealId]);

  const fetchDeal = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/ops/sales/deals/${dealId}`);
      if (!response.ok) throw new Error('Failed to fetch deal');
      const data = await response.json();
      setDeal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const calculateDaysInPipeline = (createdAt: string): number => {
    const created = new Date(createdAt);
    const now = new Date();
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  };

  const formatDateTime = (dateString: string | null | undefined): string => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d);
  };

  const getProbabilityColor = (probability: number): string => {
    if (probability < 30) return 'text-red-600 bg-red-50';
    if (probability < 60) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  const handleStageChange = async (newStage: Deal['stage']) => {
    // Auto-set probability based on stage
    const stageProbabilities: Record<string, number> = {
      PROSPECT: 10, DISCOVERY: 20, WALKTHROUGH: 35, BID_SUBMITTED: 50,
      BID_REVIEW: 60, NEGOTIATION: 75, WON: 100, LOST: 0, ONBOARDED: 100,
    };
    const payload: any = { stage: newStage, probability: stageProbabilities[newStage] ?? deal?.probability };
    if (newStage === 'WON') payload.actualCloseDate = new Date().toISOString();
    if (newStage === 'LOST') payload.lostDate = new Date().toISOString();

    try {
      const response = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Failed to update stage');
      await fetchDeal();
      setShowStageDropdown(false);
    } catch (err) {
      showToast('Error updating stage: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
  };

  const handleAssignToMe = async () => {
    try {
      const meRes = await fetch('/api/ops/auth/me');
      if (!meRes.ok) return;
      const meData = await meRes.json();
      const myId = meData.staff?.id || meData.id;
      if (!myId) return;

      const response = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: myId }),
      });
      if (!response.ok) throw new Error('Failed to assign deal');
      await fetchDeal();
    } catch (err) {
      showToast('Error assigning deal: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
  };

  const handleMarkWon = () => handleStageChange('WON');
  const handleMarkLost = () => handleStageChange('LOST');

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`/api/ops/sales/deals/${dealId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newActivity,
          followUpDate: newActivity.followUpDate || undefined,
        }),
      });
      if (!response.ok) throw new Error('Failed to add activity');
      const updatedDeal = await response.json();
      setDeal(updatedDeal);
      setShowAddActivity(false);
      setNewActivity({
        type: 'CALL',
        subject: '',
        notes: '',
        outcome: '',
        followUpDate: '',
      });
    } catch (err) {
      showToast('Error adding activity: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
  };

  const handleEditField = async (field: string, value: string) => {
    try {
      const response = await fetch(`/api/ops/sales/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) throw new Error('Failed to update field');
      const updated = await response.json();
      setDeal(updated);
      setEditingField(null);
    } catch (err) {
      showToast('Error updating field: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
  };

  const handleMarkFollowUpDone = async (activityId: string) => {
    try {
      const response = await fetch(`/api/ops/sales/deals/${dealId}/activities/${activityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followUpDone: true }),
      });
      if (!response.ok) throw new Error('Failed to update follow-up');
      const updatedDeal = await response.json();
      setDeal(updatedDeal);
    } catch (err) {
      showToast('Error updating follow-up: ' + (err instanceof Error ? err.message : 'Unknown error'), 'error');
    }
  };

  const quickActionHandler = (activityType: DealActivity['type']) => {
    setNewActivity({ ...newActivity, type: activityType as any });
    setShowAddActivity(true);
  };

  const upcomingFollowUps = deal?.activities
    ?.filter(
      (a) =>
        a.followUpDate &&
        new Date(a.followUpDate) > new Date() &&
        !a.followUpDone
    )
    ?.sort((a, b) => new Date(a.followUpDate!).getTime() - new Date(b.followUpDate!).getTime());

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading deal details...</div>
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">Error: {error || 'Deal not found'}</div>
      </div>
    );
  }

  const daysInPipeline = calculateDaysInPipeline(deal.createdAt);
  const stageInfo = stageConfig[deal.stage] || { label: deal.stage, color: 'bg-gray-100 text-gray-800', probability: 0 };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toastType === 'error' ? 'bg-red-600' : 'bg-[#0f2a3e]'
        }`}>
          {toast}
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <div className="mb-6 text-sm text-gray-500">
          Sales Dashboard / Deals / <span className="text-gray-900 font-medium">{deal.companyName}</span>
        </div>

        {/* Header Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{deal.companyName}</h1>
              <div className="space-y-1 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" /> {deal.contactPhone || '—'}
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" /> {deal.contactEmail || '—'}
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-3">Deal #{deal.dealNumber}</div>
            </div>

            <div className="flex flex-col items-end gap-3">
              <div className={`px-4 py-2 rounded-full font-medium ${stageInfo.color}`}>
                {stageInfo.label}
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                {deal.stage !== 'WON' && deal.stage !== 'LOST' && (
                  <>
                    <button onClick={handleMarkWon} className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1 text-sm font-medium">
                      <Check className="w-4 h-4" /> Mark Won
                    </button>
                    <button onClick={handleMarkLost} className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-1 text-sm font-medium">
                      <X className="w-4 h-4" /> Mark Lost
                    </button>
                  </>
                )}
                <button onClick={handleAssignToMe} className="px-3 py-2 bg-[#C6A24E] text-white rounded-lg hover:bg-[#d46711] flex items-center gap-1 text-sm font-medium">
                  Assign to Me
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowStageDropdown(!showStageDropdown)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2"
                  >
                    <ChevronDown className="w-4 h-4" /> Change Stage
                  </button>
                  {showStageDropdown && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                      {Object.entries(stageConfig).map(([key, config]) => (
                        <button
                          key={key}
                          onClick={() => handleStageChange(key as Deal['stage'])}
                          className="block w-full text-left px-4 py-2 hover:bg-gray-50 border-b last:border-b-0"
                        >
                          {config.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Deal Value</div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(deal.dealValue)}</div>
          </div>
          <div className={`bg-white rounded-lg shadow-sm p-4 ${getProbabilityColor(deal.probability)}`}>
            <div className="text-xs uppercase tracking-wide mb-1">Win Probability</div>
            <div className="text-2xl font-bold">{deal.probability}%</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Expected Close</div>
            <div className="text-2xl font-bold text-gray-900">{formatDate(deal.expectedCloseDate)}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Days in Pipeline</div>
            <div className="text-2xl font-bold text-gray-900">{daysInPipeline}</div>
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-3 gap-6">
          {/* Left Column (60%) */}
          <div className="col-span-2 space-y-6">
            {/* Add Activity Section */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-gray-900">Activity Timeline</h2>
                {!showAddActivity && (
                  <button
                    onClick={() => setShowAddActivity(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                  >
                    <Plus className="w-4 h-4" /> Add Activity
                  </button>
                )}
              </div>

              {showAddActivity && (
                <form onSubmit={handleAddActivity} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                      <select
                        value={newActivity.type}
                        onChange={(e) => setNewActivity({ ...newActivity, type: e.target.value as any })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {Object.keys(activityIcons).map((type) => (
                          <option key={type} value={type}>
                            {type.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                      <input
                        type="text"
                        value={newActivity.subject}
                        onChange={(e) => setNewActivity({ ...newActivity, subject: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                      <textarea
                        value={newActivity.notes}
                        onChange={(e) => setNewActivity({ ...newActivity, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={3}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Outcome</label>
                      <input
                        type="text"
                        value={newActivity.outcome}
                        onChange={(e) => setNewActivity({ ...newActivity, outcome: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Follow-up Date (Optional)</label>
                      <input
                        type="date"
                        value={newActivity.followUpDate}
                        onChange={(e) => setNewActivity({ ...newActivity, followUpDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        Add Activity
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddActivity(false)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Activities List */}
              <div className="space-y-4">
                {deal.activities && deal.activities.length > 0 ? (
                  [...deal.activities].reverse().map((activity) => (
                    <div key={activity.id} className="flex gap-4 pb-4 border-b last:border-b-0">
                      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        {activityIcons[activity.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900">{activity.subject}</div>
                        {activity.notes && <div className="text-sm text-gray-600 mt-1">{activity.notes}</div>}
                        {activity.outcome && <div className="text-sm text-gray-600">Outcome: {activity.outcome}</div>}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span>{formatDateTime(activity.createdAt)}</span>
                          <span>by {activity.staffName}</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">No activities yet</div>
                )}
              </div>
            </div>

            {/* Tabs for Contracts and Documents */}
            <div className="bg-white rounded-lg shadow-sm">
              <div className="border-b border-gray-200">
                <div className="flex gap-8 px-6">
                  <button
                    onClick={() => setActiveTab('activities')}
                    className={`py-4 font-medium border-b-2 transition-colors ${
                      activeTab === 'activities'
                        ? 'text-blue-600 border-blue-600'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    Activities
                  </button>
                  <button
                    onClick={() => setActiveTab('contracts')}
                    className={`py-4 font-medium border-b-2 transition-colors ${
                      activeTab === 'contracts'
                        ? 'text-blue-600 border-blue-600'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    Contracts
                  </button>
                  <button
                    onClick={() => setActiveTab('documents')}
                    className={`py-4 font-medium border-b-2 transition-colors ${
                      activeTab === 'documents'
                        ? 'text-blue-600 border-blue-600'
                        : 'text-gray-600 border-transparent hover:text-gray-900'
                    }`}
                  >
                    Documents
                  </button>
                </div>
              </div>

              <div className="p-6">
                {activeTab === 'contracts' && (
                  <div>
                    <div className="mb-4">
                      <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                        <Plus className="w-4 h-4" /> Create Contract
                      </button>
                    </div>
                    {deal.contracts && deal.contracts.length > 0 ? (
                      <div className="space-y-3">
                        {deal.contracts.map((contract) => (
                          <div key={contract.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div>
                              <div className="font-medium text-gray-900">{contract.title}</div>
                              <div className="text-sm text-gray-600">
                                Contract #{contract.contractNumber} • {contract.type}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                {formatDate(contract.startDate)} - {formatDate(contract.endDate)}
                              </div>
                            </div>
                            <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                              {contract.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">No contracts yet</div>
                    )}
                  </div>
                )}

                {activeTab === 'documents' && (
                  <div>
                    <div className="mb-4">
                      <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                        <Plus className="w-4 h-4" /> Request Document
                      </button>
                    </div>
                    {deal.documentRequests && deal.documentRequests.length > 0 ? (
                      <div className="space-y-3">
                        {deal.documentRequests.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                            <div>
                              <div className="font-medium text-gray-900">{doc.title}</div>
                              <div className="text-sm text-gray-600">{doc.documentType}</div>
                              <div className="text-xs text-gray-500 mt-1">
                                Due: {formatDate(doc.dueDate)}
                                {doc.receivedDate && ` • Received: ${formatDate(doc.receivedDate)}`}
                              </div>
                            </div>
                            <div
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                doc.status === 'RECEIVED'
                                  ? 'bg-green-100 text-green-800'
                                  : doc.status === 'OVERDUE'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}
                            >
                              {doc.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">No document requests yet</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column (40%) */}
          <div className="space-y-6">
            {/* Deal Information Card */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Deal Information</h3>
              <div className="space-y-3">
                {[
                  { label: 'Company Name', value: deal.companyName, field: 'companyName' },
                  { label: 'Contact Name', value: deal.contactName, field: 'contactName' },
                  { label: 'Email', value: deal.contactEmail, field: 'contactEmail' },
                  { label: 'Phone', value: deal.contactPhone, field: 'contactPhone' },
                  { label: 'Address', value: deal.address, field: 'address' },
                  { label: 'Source', value: deal.source, field: 'source' },
                  { label: 'Stage', value: stageInfo.label, field: 'stage' },
                  { label: 'Probability', value: `${deal.probability}%`, field: 'probability' },
                  { label: 'Deal Value', value: formatCurrency(deal.dealValue), field: 'dealValue' },
                  { label: 'Expected Close', value: formatDate(deal.expectedCloseDate), field: 'expectedCloseDate' },
                  { label: 'Created Date', value: formatDate(deal.createdAt), field: 'createdAt' },
                ].map((item) => (
                  <div key={item.field} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">{item.label}</span>
                    <span className="text-sm font-medium text-gray-900">{item.value}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                  <span className="text-sm text-gray-600">Owner</span>
                  <div className="flex items-center gap-2">
                    {deal.owner.avatar && (
                      <Image src={deal.owner.avatar} alt={`${deal.owner.firstName} ${deal.owner.lastName}`} width={24} height={24} className="w-6 h-6 rounded-full" />
                    )}
                    <span className="text-sm font-medium text-gray-900">{deal.owner.firstName} {deal.owner.lastName}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={() => quickActionHandler('CALL')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
                >
                  <Phone className="w-4 h-4" /> Log Call
                </button>
                <button
                  onClick={() => quickActionHandler('EMAIL')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
                >
                  <Mail className="w-4 h-4" /> Send Email
                </button>
                <button
                  onClick={() => quickActionHandler('MEETING')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
                >
                  <Calendar className="w-4 h-4" /> Schedule Meeting
                </button>
                <button
                  onClick={() => quickActionHandler('NOTE')}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-2 text-sm"
                >
                  <FileText className="w-4 h-4" /> Add Note
                </button>
              </div>
            </div>

            {/* Follow-ups Card */}
            {upcomingFollowUps && upcomingFollowUps.length > 0 && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Upcoming Follow-ups</h3>
                <div className="space-y-3">
                  {upcomingFollowUps.map((followUp) => (
                    <div key={followUp.id} className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                      <button
                        onClick={() => handleMarkFollowUpDone(followUp.id)}
                        className="flex-shrink-0 w-5 h-5 rounded border-2 border-blue-300 hover:bg-blue-200 flex items-center justify-center"
                      >
                        {followUp.followUpDone && <Check className="w-3 h-3 text-blue-600" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{followUp.subject}</div>
                        <div className="text-xs text-gray-600">
                          {formatDate(followUp.followUpDate!)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
