'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface ScheduleItem {
  id: string;
  jobId: string;
  title: string;
  jobNumber: string;
  builderName: string;
  address: string;
  scheduledTime: string;
  status: string;
  type: 'DELIVERY' | 'INSTALLATION';
  community?: string;
  lotBlock?: string;
}

interface Crew {
  id: string;
  name: string;
  crewType: string;
}

function CrewHomeInner() {
  const searchParams = useSearchParams();
  const [crews, setCrews] = useState<Crew[]>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<string>('');
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    // Fetch crews
    const fetchCrews = async () => {
      try {
        const response = await fetch('/api/crew/crews');
        if (response.ok) {
          const data = await response.json();
          setCrews(data);
          // Set crew from URL or localStorage
          const crewId = searchParams.get('crewId') || localStorage.getItem('selectedCrewId');
          if (crewId && data.some((c: Crew) => c.id === crewId)) {
            setSelectedCrewId(crewId);
            localStorage.setItem('selectedCrewId', crewId);
          } else if (data.length > 0) {
            setSelectedCrewId(data[0].id);
            localStorage.setItem('selectedCrewId', data[0].id);
          }
        }
      } catch (error) {
        console.error('Failed to fetch crews:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCrews();
  }, [searchParams]);

  useEffect(() => {
    // Fetch schedule for selected crew
    if (!selectedCrewId) return;

    const fetchSchedule = async () => {
      try {
        const response = await fetch(
          `/api/crew/schedule?crewId=${selectedCrewId}&date=${date}`
        );
        if (response.ok) {
          const data = await response.json();
          setSchedule(data);
        }
      } catch (error) {
        console.error('Failed to fetch schedule:', error);
      }
    };

    fetchSchedule();
  }, [selectedCrewId, date]);

  const updateItemStatus = async (item: ScheduleItem, newStatus: string) => {
    const endpoint = item.type === 'DELIVERY'
      ? `/api/crew/delivery/${item.id}`
      : `/api/crew/install/${item.id}`;
    const timestamp: any = {};
    if (newStatus === 'IN_TRANSIT') timestamp.departedAt = new Date().toISOString();
    if (newStatus === 'ARRIVED') timestamp.arrivedAt = new Date().toISOString();
    if (newStatus === 'COMPLETE') timestamp.completedAt = new Date().toISOString();
    if (newStatus === 'IN_PROGRESS') timestamp.startedAt = new Date().toISOString();
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...timestamp }),
      });
      if (res.ok) {
        setSchedule(prev => prev.map(s =>
          s.id === item.id ? { ...s, status: newStatus } : s
        ));
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const getStatusColor = (status: string, type: string) => {
    if (type === 'DELIVERY') {
      return 'bg-blue-100 text-blue-900 border-blue-300';
    }
    if (type === 'INSTALLATION') {
      return 'bg-green-100 text-green-900 border-green-300';
    }
    return 'bg-gray-100 text-gray-900 border-gray-300';
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
      case 'TENTATIVE':
        return 'bg-yellow-100 text-yellow-800';
      case 'IN_PROGRESS':
      case 'IN_TRANSIT':
        return 'bg-blue-100 text-blue-800';
      case 'COMPLETE':
      case 'COMPLETED':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Crew Selector */}
      <div className="bg-white rounded-lg p-4 shadow-sm">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Your Crew
        </label>
        <select
          value={selectedCrewId}
          onChange={(e) => {
            setSelectedCrewId(e.target.value);
            localStorage.setItem('selectedCrewId', e.target.value);
          }}
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E67E22]"
        >
          <option value="">Select a crew...</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name} ({crew.crewType})
            </option>
          ))}
        </select>
      </div>

      {/* Date Display */}
      <div className="bg-gradient-to-r from-[#1B4F72] to-[#0D2438] text-white rounded-lg p-4">
        <h2 className="text-sm text-blue-200 mb-1">Today's Schedule</h2>
        <p className="text-xl font-bold">
          {new Date(date).toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </p>
        <p className="text-sm text-blue-100 mt-1">
          {schedule.length} assignments
        </p>
      </div>

      {/* Schedule Cards */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500">Loading schedule...</p>
        </div>
      ) : schedule.length === 0 ? (
        <div className="bg-white rounded-lg p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto text-gray-400 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4"
            />
          </svg>
          <p className="text-gray-600 font-medium">No assignments today</p>
          <p className="text-gray-500 text-sm mt-1">Check back later or select a different crew</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedule.map((item) => (
            <Link
              key={item.id}
              href={
                item.type === 'DELIVERY'
                  ? `/crew/delivery/${item.jobId}`
                  : `/crew/install/${item.jobId}`
              }
              className={`block rounded-lg p-4 border-2 transition-all hover:shadow-md ${getStatusColor(
                item.status,
                item.type
              )}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase">
                    {item.type === 'DELIVERY' ? '📦 Delivery' : '🔧 Install'}
                  </p>
                  <p className="text-lg font-bold mt-1">{item.jobNumber}</p>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${getStatusBadgeColor(item.status)}`}>
                  {item.status.replace('_', ' ')}
                </span>
              </div>

              <p className="font-semibold text-base mb-2">{item.builderName}</p>

              <div className="space-y-1 text-sm mb-3">
                <p className="text-gray-700">
                  📍 {item.address}
                </p>
                {item.community && (
                  <p className="text-gray-600 text-xs">
                    {item.community}
                    {item.lotBlock && ` • ${item.lotBlock}`}
                  </p>
                )}
                <p className="text-gray-600">
                  🕐 {item.scheduledTime || 'Time TBD'}
                </p>
              </div>

              <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
                {item.type === 'DELIVERY' && (
                  <>
                    <button
                      onClick={(e) => { e.preventDefault(); updateItemStatus(item, 'IN_TRANSIT'); }}
                      disabled={item.status !== 'SCHEDULED' && item.status !== 'LOADING'}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold py-2 px-3 rounded text-sm transition-colors"
                    >
                      Start
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); updateItemStatus(item, 'ARRIVED'); }}
                      disabled={item.status !== 'IN_TRANSIT'}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold py-2 px-3 rounded text-sm transition-colors"
                    >
                      Arrive
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); updateItemStatus(item, 'COMPLETE'); }}
                      disabled={item.status !== 'ARRIVED' && item.status !== 'UNLOADING'}
                      className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-semibold py-2 px-3 rounded text-sm transition-colors"
                    >
                      Complete
                    </button>
                  </>
                )}
                {item.type === 'INSTALLATION' && (
                  <>
                    <button
                      onClick={(e) => { e.preventDefault(); updateItemStatus(item, 'IN_PROGRESS'); }}
                      disabled={item.status !== 'SCHEDULED'}
                      className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-semibold py-2 px-3 rounded text-sm transition-colors"
                    >
                      Start
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); updateItemStatus(item, 'COMPLETE'); }}
                      disabled={item.status !== 'IN_PROGRESS'}
                      className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-semibold py-2 px-3 rounded text-sm transition-colors"
                    >
                      Complete
                    </button>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Helper Text */}
      <div className="bg-orange-50 border border-[#E67E22] rounded-lg p-4 text-sm">
        <p className="text-orange-900">
          💡 <strong>Tip:</strong> Tap any card to view full details and complete the workflow.
        </p>
      </div>
    </div>
  );
}

export default function CrewHomePage() {
  return (
    <Suspense fallback={<div className="p-4 text-center"><p className="text-gray-500">Loading...</p></div>}>
      <CrewHomeInner />
    </Suspense>
  );
}
