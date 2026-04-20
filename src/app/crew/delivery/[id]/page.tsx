'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface DeliveryDetail {
  id: string;
  jobId: string;
  deliveryNumber: string;
  status: string;
  address: string;
  job: {
    jobNumber: string;
    builderName: string;
    builderContact?: string;
    community?: string;
    lotBlock?: string;
  };
  departedAt?: string;
  arrivedAt?: string;
  completedAt?: string;
  loadPhotos: string[];
  sitePhotos: string[];
  signedBy?: string;
  damageNotes?: string;
  notes?: string;
  materialPicks: {
    id: string;
    sku: string;
    description: string;
    quantity: number;
  }[];
}

export default function DeliveryDetailPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [notes, setNotes] = useState('');
  const [signedBy, setSignedBy] = useState('');
  const [uploading, setUploading] = useState(false);

  const handlePhotoUpload = async (type: 'load' | 'site', files: FileList) => {
    if (!delivery || files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('file', files[i]);
        formData.append('folder', `deliveries/${delivery.id}/${type}`);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          urls.push(data.url || data.path || URL.createObjectURL(files[i]));
        }
      }
      // Append to existing photos
      const existingPhotos = type === 'load' ? (delivery.loadPhotos || []) : (delivery.sitePhotos || []);
      const allPhotos = [...existingPhotos, ...urls];
      const patchField = type === 'load' ? 'loadPhotos' : 'sitePhotos';
      const patchRes = await fetch(`/api/crew/delivery/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [patchField]: allPhotos }),
      });
      if (patchRes.ok) {
        const updated = await patchRes.json();
        setDelivery(updated);
      }
    } catch (error) {
      console.error('Photo upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const fetchDelivery = async () => {
      try {
        const response = await fetch(`/api/crew/delivery/${jobId}`);
        if (response.ok) {
          const data = await response.json();
          setDelivery(data);
          setNotes(data.notes || '');
          setSignedBy(data.signedBy || '');
        }
      } catch (error) {
        console.error('Failed to fetch delivery:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDelivery();
  }, [jobId]);

  const updateStatus = async (newStatus: string, timestamp: boolean = true) => {
    if (!delivery) return;

    setUpdating(true);
    try {
      const response = await fetch(`/api/crew/delivery/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          notes,
          signedBy,
          ...(newStatus === 'IN_TRANSIT' && { departedAt: new Date().toISOString() }),
          ...(newStatus === 'ARRIVED' && { arrivedAt: new Date().toISOString() }),
          ...(newStatus === 'COMPLETE' && { completedAt: new Date().toISOString() }),
        }),
      });

      if (response.ok) {
        const updated = await response.json();
        setDelivery(updated);
      }
    } catch (error) {
      console.error('Failed to update delivery:', error);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading delivery details...</p>
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="p-4">
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <p className="text-red-800">Delivery not found</p>
        </div>
      </div>
    );
  }

  const statusSteps = [
    { key: 'SCHEDULED', label: 'Scheduled', icon: '📋' },
    { key: 'LOADING', label: 'Load Confirmed', icon: '✓' },
    { key: 'IN_TRANSIT', label: 'Departed', icon: '🚗' },
    { key: 'ARRIVED', label: 'Arrived', icon: '📍' },
    { key: 'UNLOADING', label: 'Unloading', icon: '📦' },
    { key: 'COMPLETE', label: 'Complete', icon: '✅' },
  ];

  const currentStepIndex = statusSteps.findIndex((s) => s.key === delivery.status);

  return (
    <div className="p-4 space-y-4">
      {/* Back Button */}
      <Link
        href="/crew"
        className="inline-flex items-center text-[#3E2A1E] hover:text-[#0D2438] font-medium text-sm mb-2"
      >
        ← Back
      </Link>

      {/* Header */}
      <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-4 border-2 border-blue-200">
        <p className="text-sm text-blue-700 font-semibold uppercase">Delivery</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">{delivery.deliveryNumber}</h1>
        <p className="text-gray-700 mt-2 font-semibold">{delivery.job.jobNumber}</p>
      </div>

      {/* Job Info */}
      <div className="bg-white rounded-lg p-4 space-y-3 border border-gray-200">
        <div>
          <p className="text-sm text-gray-600">Builder</p>
          <p className="text-lg font-semibold text-gray-900">{delivery.job.builderName}</p>
        </div>
        <div>
          <p className="text-sm text-gray-600">Address</p>
          <p className="text-gray-900 font-medium">{delivery.address}</p>
        </div>
        {delivery.job.community && (
          <div>
            <p className="text-sm text-gray-600">Community</p>
            <p className="text-gray-900">
              {delivery.job.community}
              {delivery.job.lotBlock && ` • ${delivery.job.lotBlock}`}
            </p>
          </div>
        )}
        {delivery.job.builderContact && (
          <div>
            <p className="text-sm text-gray-600">Contact</p>
            <p className="text-gray-900">{delivery.job.builderContact}</p>
          </div>
        )}
      </div>

      {/* Progress Steps */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <h3 className="font-bold text-gray-900 mb-4">Delivery Workflow</h3>
        <div className="space-y-3">
          {statusSteps.map((step, index) => (
            <button
              key={step.key}
              onClick={() => updateStatus(step.key)}
              disabled={updating || index > currentStepIndex + 1}
              className={`w-full text-left p-3 rounded-lg border-2 font-medium transition-all ${
                index <= currentStepIndex
                  ? 'bg-blue-100 border-blue-500 text-blue-900'
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

      {/* Materials/Items */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <h3 className="font-bold text-gray-900 mb-3">Items Being Delivered</h3>
        {delivery.materialPicks.length === 0 ? (
          <p className="text-gray-500 text-sm">No items recorded</p>
        ) : (
          <div className="space-y-2">
            {delivery.materialPicks.map((item) => (
              <div key={item.id} className="flex justify-between items-start p-2 bg-gray-50 rounded">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{item.description}</p>
                  <p className="text-xs text-gray-500">SKU: {item.sku}</p>
                </div>
                <span className="bg-blue-100 text-blue-800 text-sm font-semibold px-2 py-1 rounded">
                  Qty: {item.quantity}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Photo Upload */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <h3 className="font-bold text-gray-900 mb-3">Photos</h3>
        {uploading && <p className="text-sm text-blue-600 mb-2">Uploading...</p>}

        {/* Load Photos */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-600 mb-2">Load Photos (truck loaded)</label>
          {delivery.loadPhotos && delivery.loadPhotos.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {delivery.loadPhotos.map((url, i) => (
                <div key={i} className="w-20 h-20 bg-gray-100 rounded-lg border overflow-hidden">
                  <Image src={url} alt={`Load ${i + 1}`} width={80} height={80} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
          <label className="inline-flex items-center gap-2 cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold py-2.5 px-4 rounded-lg border border-blue-200 text-sm transition">
            📷 Add Load Photos
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files && handlePhotoUpload('load', e.target.files)}
            />
          </label>
        </div>

        {/* Site Photos */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-2">Site Photos (delivery location)</label>
          {delivery.sitePhotos && delivery.sitePhotos.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {delivery.sitePhotos.map((url, i) => (
                <div key={i} className="w-20 h-20 bg-gray-100 rounded-lg border overflow-hidden">
                  <Image src={url} alt={`Site ${i + 1}`} width={80} height={80} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
          <label className="inline-flex items-center gap-2 cursor-pointer bg-green-50 hover:bg-green-100 text-green-700 font-semibold py-2.5 px-4 rounded-lg border border-green-200 text-sm transition">
            📷 Add Site Photos
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files && handlePhotoUpload('site', e.target.files)}
            />
          </label>
        </div>
      </div>

      {/* Signed By */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Signed By
        </label>
        <input
          type="text"
          value={signedBy}
          onChange={(e) => setSignedBy(e.target.value)}
          placeholder="Recipient name"
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Notes */}
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Notes (Issues/Damage)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any issues or damage to report?"
          rows={3}
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={() => updateStatus('COMPLETE')}
          disabled={updating || delivery.status === 'COMPLETE'}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold py-4 px-4 rounded-lg text-lg transition-colors"
        >
          {delivery.status === 'COMPLETE' ? '✅ Completed' : 'Mark as Complete'}
        </button>
        <button
          onClick={() => setNotes('')}
          className="w-full bg-gray-200 hover:bg-gray-300 text-gray-900 font-bold py-3 px-4 rounded-lg transition-colors"
        >
          Clear Notes
        </button>
      </div>

      {/* Status Info */}
      <div className="bg-blue-50 border border-blue-300 rounded-lg p-4 text-sm">
        <p className="text-blue-900">
          <strong>Current Status:</strong> {delivery.status.replace('_', ' ')}
        </p>
        {delivery.departedAt && (
          <p className="text-blue-900 text-xs mt-2">
            Departed: {new Date(delivery.departedAt).toLocaleTimeString()}
          </p>
        )}
        {delivery.arrivedAt && (
          <p className="text-blue-900 text-xs">
            Arrived: {new Date(delivery.arrivedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}
