'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface RouteStop {
  id: string;
  jobId: string;
  deliveryNumber: string;
  jobNumber: string;
  builder: string;
  address: string;
  itemCount: number;
  routeOrder: number;
  status: string;
}

function RouteViewInner() {
  const searchParams = useSearchParams();
  const [route, setRoute] = useState<RouteStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [crewId, setCrewId] = useState('');

  useEffect(() => {
    setCrewId(localStorage.getItem('selectedCrewId') || '');
  }, []);

  useEffect(() => {
    const fetchRoute = async () => {
      if (!crewId) return;

      try {
        const response = await fetch(
          `/api/crew/route?crewId=${crewId}&date=${date}`
        );
        if (response.ok) {
          const data = await response.json();
          setRoute(data);
        }
      } catch (error) {
        console.error('Failed to fetch route:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRoute();
  }, [crewId, date]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
      case 'PENDING':
        return 'bg-yellow-100 border-yellow-300 text-yellow-900';
      case 'IN_PROGRESS':
      case 'IN_TRANSIT':
        return 'bg-blue-100 border-blue-300 text-blue-900';
      case 'COMPLETE':
      case 'COMPLETED':
        return 'bg-green-100 border-green-300 text-green-900';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-900';
    }
  };

  const completedStops = route.filter((s) => s.status === 'COMPLETE' || s.status === 'COMPLETED').length;

  return (
    <div className="p-4 space-y-4">
      {/* Back Button */}
      <Link
        href="/crew"
        className="inline-flex items-center text-[#3E2A1E] hover:text-[#0D2438] font-medium text-sm mb-2"
      >
        ← Back to Today
      </Link>

      {/* Header */}
      <div className="bg-gradient-to-r from-[#3E2A1E] to-[#0D2438] text-white rounded-lg p-4">
        <h2 className="text-sm text-blue-200 mb-1">Today's Delivery Route</h2>
        <p className="text-2xl font-bold">
          {new Date(date).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </p>
        <p className="text-sm text-blue-100 mt-2">
          {completedStops} of {route.length} stops complete
        </p>
      </div>

      {/* Progress Bar */}
      {route.length > 0 && (
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="flex justify-between text-xs text-gray-600 mb-2">
            <span>Progress</span>
            <span>{Math.round((completedStops / route.length) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${(completedStops / route.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Route Stops */}
      {loading ? (
        <div className="text-center py-8">
          <p className="text-gray-500">Loading route...</p>
        </div>
      ) : route.length === 0 ? (
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
          <p className="text-gray-600 font-medium">No deliveries scheduled</p>
          <p className="text-gray-500 text-sm mt-1">Check back later</p>
        </div>
      ) : (
        <div className="space-y-3">
          {route
            .sort((a, b) => a.routeOrder - b.routeOrder)
            .map((stop, index) => (
              <Link
                key={stop.id}
                href={`/crew/delivery/${stop.jobId}`}
                className={`block rounded-lg p-4 border-2 transition-all hover:shadow-md ${getStatusColor(
                  stop.status
                )}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 bg-white rounded-full font-bold text-lg border-2 border-current">
                      {stop.routeOrder || index + 1}
                    </div>
                    <div>
                      <p className="font-bold text-lg">{stop.jobNumber}</p>
                      <p className="text-sm text-gray-600">{stop.deliveryNumber}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-white border border-current">
                    {stop.status}
                  </span>
                </div>

                <p className="font-semibold text-gray-900 mb-2">{stop.builder}</p>

                <div className="space-y-1 text-sm mb-3">
                  <p className="text-gray-700">📍 {stop.address}</p>
                  <p className="text-gray-600">
                    📦 {stop.itemCount} item{stop.itemCount !== 1 ? 's' : ''}
                  </p>
                </div>

                <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-3 rounded text-sm transition-colors">
                  View Details
                </button>
              </Link>
            ))}
        </div>
      )}

      {/* Route Summary */}
      {route.length > 0 && (
        <div className="bg-blue-50 border border-blue-300 rounded-lg p-4 text-sm">
          <p className="text-blue-900">
            <strong>Route Summary:</strong> {route.length} stop
            {route.length !== 1 ? 's' : ''} today
          </p>
          <p className="text-blue-900 text-xs mt-2">
            Total items: {route.reduce((sum, s) => sum + s.itemCount, 0)}
          </p>
        </div>
      )}
    </div>
  );
}

export default function RouteViewPage() {
  return (
    <Suspense fallback={<div className="p-4 text-center"><p className="text-gray-500">Loading route...</p></div>}>
      <RouteViewInner />
    </Suspense>
  );
}
