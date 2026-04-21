'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface CrewMemberInfo {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
}

interface CrewInfo {
  id: string;
  name: string;
  crewType: string;
  members: CrewMemberInfo[];
  vehiclePlate?: string;
}

export default function ProfilePage() {
  const [crew, setCrew] = useState<CrewInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCrewId, setSelectedCrewId] = useState('');

  useEffect(() => {
    const crewId = localStorage.getItem('selectedCrewId');
    if (crewId) {
      setSelectedCrewId(crewId);
      fetchCrewInfo(crewId);
    }
  }, []);

  const fetchCrewInfo = async (crewId: string) => {
    try {
      const response = await fetch(`/api/crew/crews/${crewId}`);
      if (response.ok) {
        const data = await response.json();
        setCrew(data);
      }
    } catch (error) {
      console.error('Failed to fetch crew info:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0f2a3e] to-[#0D2438] text-white rounded-lg p-4">
        <p className="text-sm text-blue-200 mb-1">My Profile</p>
        <h1 className="text-2xl font-bold">Field Operations</h1>
      </div>

      {/* Crew Info */}
      {crew ? (
        <div className="bg-white rounded-lg p-4 border border-gray-200 space-y-4">
          <div>
            <p className="text-sm text-gray-600 uppercase">Crew Name</p>
            <p className="text-2xl font-bold text-gray-900">{crew.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 uppercase">Crew Type</p>
              <p className="font-semibold text-gray-900 mt-1">
                {crew.crewType.replace(/_/g, ' ')}
              </p>
            </div>
            {crew.vehiclePlate && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600 uppercase">Vehicle</p>
                <p className="font-semibold text-gray-900 mt-1">{crew.vehiclePlate}</p>
              </div>
            )}
          </div>

          {/* Crew Members */}
          <div className="border-t pt-4">
            <h3 className="font-bold text-gray-900 mb-3">Crew Members</h3>
            {crew.members.length === 0 ? (
              <p className="text-gray-500 text-sm">No members assigned</p>
            ) : (
              <div className="space-y-2">
                {crew.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center justify-center w-10 h-10 bg-[#C6A24E] text-white rounded-full font-bold text-sm">
                      {member.name.charAt(0)}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-600">{member.role}</p>
                      {member.email && (
                        <p className="text-xs text-gray-500 mt-1">{member.email}</p>
                      )}
                      {member.phone && (
                        <p className="text-xs text-gray-500">{member.phone}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <p className="text-gray-600">Select a crew from the home page</p>
        </div>
      )}

      {/* Quick Links */}
      <div className="bg-white rounded-lg p-4 border border-gray-200 space-y-2">
        <h3 className="font-bold text-gray-900 mb-2">Quick Links</h3>
        <Link
          href="/crew"
          className="block w-full px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-lg transition-colors text-center"
        >
          📋 Today's Schedule
        </Link>
        <Link
          href="/crew/route"
          className="block w-full px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium rounded-lg transition-colors text-center"
        >
          🗺️ Route View
        </Link>
      </div>

      {/* Support Info */}
      <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 space-y-2">
        <h3 className="font-bold text-amber-900">Need Help?</h3>
        <p className="text-sm text-amber-900">
          Contact your dispatch coordinator or field manager for assistance with assignments.
        </p>
        <p className="text-xs text-amber-700">
          Version 1.0 • Abel Lumber Field Crew Portal
        </p>
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 px-4 rounded-lg transition-colors text-lg"
      >
        Logout
      </button>
    </div>
  );
}
