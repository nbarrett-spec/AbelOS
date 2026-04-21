'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface InstallationDetail {
  id: string;
  jobId: string;
  installNumber: string;
  status: string;
  scopeNotes?: string;
  job: {
    jobNumber: string;
    builderName: string;
    builderContact?: string;
    community?: string;
    lotBlock?: string;
    jobAddress?: string;
  };
  startedAt?: string;
  completedAt?: string;
  passedQC: boolean;
  punchItems?: string;
  notes?: string;
  beforePhotos: string[];
  afterPhotos: string[];
}

export default function InstallationDetailPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [installation, setInstallation] = useState<InstallationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState('');
  const [punchItems, setPunchItems] = useState('');
  const [passedQC, setPassedQC] = useState(false);

  useEffect(() => {
    const fetchInstallation = async () => {
      try {
        const response = await fetch(`/api/crew/install/${jobId}`);
        if (response.ok) {
          const data = await response.json();
          setInstallation(data);
          setNotes(data.notes || '');
          setPunchItems(data.punchItems || '');
          setPassedQC(data.passedQC || false);
        }
      } catch (error) {
        console.error('Failed to fetch installation:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInstallation();
  }, [jobId]);

  const updateStatus = async (newStatus: string) => {
    if (!installation) return;

    setUpdating(true);
    try {
      const response = await fetch(`/api/crew/install/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          notes,
          punchItems,
          passedQC,
          ...(newStatus === 'IN_PROGRESS' && { startedAt: new Date().toISOString() }),
          ...(newStatus === 'COMPLETE' && { completedAt: new Date().toISOString() }),
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setInstallation(updated);
      }
    } catch (error) {
      console.error('Failed to update installation:', error);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading installation details...</p>
      </div>
    );
  }

  if (!installation) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <p className="text-red-800">Installation not found</p>
        </div>
      </div>
    );
  }

  const statusSteps = [
    { key: 'SCHEDULED', label: 'Scheduled', icon: '📋' },
    { key: 'IN_PROGRESS', label: 'In Progress', icon: '🔧' },
    { key: 'COMPLETE', label: 'Complete', icon: '✅' },
  ];

  const currentStepIndex = statusSteps.findIndex((s) => s.key === installation.status);

  return (
    <div className="p-4 space-y-4">
      {/* Back Button */}
      <Link
        href="/crew"
        className="inline-flex items-center text-[#0f2a3e] hover:text-[#0D2438] font-medium text-sm mb-2"
      >
        ← Back
      </Link>

      {/* Header */}
      <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-lg p-4 border-2 border-green-200">
        <p className="text-sm text-green-700 font-semibold uppercase">Installation</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{installation.installNumber}</h1>
        <p className="text-gray-700 mt-2 font-semibold">{installation.job.jobNumber}</p>
      </div>

      {/* Job Info */}
      <div className="bg-white rounded-lg p-4 space-y-3 border border-gray-200">
        <div>
          <p className="text-sm text-gray-600">Builder</p>
          <p className="text-lg font-semibold text-gray-900">{installation.job.builderName}</p>
        </div>
        {installation.job.jobAddress && (
          <div>
            <p className="text-sm text-gray-600">Address</p>
            <p className="text-gray-900 font-medium">{installation.job.jobAddress}</p>
          </div>
        )}
        {installation.job.community && (
          <div>
            <p className="text-sm text-gray-600">Community</p>
            <p className="text-gray-900">
              {installation.job.community}
              {installation.job.lotBlock && ` • ${installation.job.lotBlock}`}
            </p>
          </div>
        )}
        {installation.job.builderContact && (
          <div>
            <p className="text-sm text-gray-600">Contact</p>
            <p className="text-gray-900">{installation.job.builderContact}</p>
          </div>
        )}
      </div>

      {/* Scope */}
      {installation.scopeNotes && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <h3 className="font-bold text-amber-900 mb-2">Scope of Work</h3>
          <p className="text-amber-900">{installation.scopeNotes}</p>
        </div>
      )}

      {/* Progress Steps */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <h3 className="font-bold text-gray-900 mb-4">Installation Workflow</h3>
        <div className="space-y-3">
          {statusSteps.map((step, index) => (
            <button
              key={step.key}
              onClick={() => updateStatus(step.key)}
              disabled={updating || index > currentStepIndex + 1}
              className={`w-full text-left p-3 rounded-lg border-2 font-medium transition-all ${
                index <= currentStepIndex
                  ? 'bg-green-100 border-green-500 text-green-900'
                  : index === currentStepIndex + 1
                  ? 'bg-yellow-50 border-yellow-500 text-yellow-900 hover:bg-yellow-100 cursor-pointer'
                  : 'bg-gray-50 border-gray-300 text-gray-400 cursor-not-allowed'
              }`}
            >
              <span className="text-xl mr-2">{step.icon}</span>
              {step.label}
              {index <= currentStepIndex && <span className="float-right">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* QC Self-Check */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <h3 className="font-bold text-gray-900 mb-3">Quality Check</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={passedQC}
              onChange={(e) => setPassedQC(e.target.checked)}
              className="w-6 h-6 text-green-600 border-gray-300 rounded focus:ring-green-500"
            />
            <span className="ml-2 text-gray-900 font-medium">Installation passes QC</span>
          </label>
        </div>
        {passedQC && (
          <p className="text-green-700 text-sm mt-2 bg-green-50 p-2 rounded">
            ✓ Quality check approved
          </p>
        )}
      </div>

      {/* Punch List */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Punch List Items (if any issues)
        </label>
        <textarea
          value={punchItems}
          onChange={(e) => setPunchItems(e.target.value)}
          placeholder="List any punch items or touch-ups needed..."
          rows={3}
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Notes */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          General Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes about the installation..."
          rows={3}
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={() => updateStatus('COMPLETE')}
          disabled={updating || installation.status === 'COMPLETE' || !passedQC}
          className={`w-full font-bold py-4 px-4 rounded-lg text-lg transition-colors ${
            installation.status === 'COMPLETE'
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : !passedQC
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {installation.status === 'COMPLETE'
            ? '✅ Installation Complete'
            : !passedQC
            ? 'Pass QC to Complete'
            : 'Mark as Complete'}
        </button>
        <button
          onClick={() => setNotes('')}
          className="w-full bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-3 px-4 rounded-lg transition-colors"
        >
          Clear Notes
        </button>
      </div>

      {/* Status Info */}
      <div className="bg-green-50 border border-green-300 rounded-lg p-4 text-sm">
        <p className="text-green-900">
          <strong>Current Status:</strong> {installation.status.replace('_', ' ')}
        </p>
        {installation.startedAt && (
          <p className="text-green-900 text-xs mt-2">
            Started: {new Date(installation.startedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
