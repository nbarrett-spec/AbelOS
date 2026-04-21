'use client'

import { useState, useEffect } from 'react'

interface StaffProfile {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  roles?: string[]
  department: string
  title: string | null
  phone?: string
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  PROJECT_MANAGER: 'Project Manager',
  ESTIMATOR: 'Estimator',
  SALES_REP: 'Sales Representative',
  PURCHASING: 'Purchasing',
  WAREHOUSE_LEAD: 'Warehouse Lead',
  WAREHOUSE_TECH: 'Warehouse Technician',
  DRIVER: 'Driver',
  INSTALLER: 'Installer',
  QC_INSPECTOR: 'QC Inspector',
  ACCOUNTING: 'Accounting',
  VIEWER: 'Viewer',
}

const DEPT_LABELS: Record<string, string> = {
  EXECUTIVE: 'Executive',
  SALES: 'Sales',
  ESTIMATING: 'Estimating',
  OPERATIONS: 'Operations',
  MANUFACTURING: 'Manufacturing',
  WAREHOUSE: 'Warehouse',
  DELIVERY: 'Delivery',
  INSTALLATION: 'Installation',
  ACCOUNTING: 'Accounting',
  PURCHASING: 'Purchasing',
}

export default function StaffProfilePage() {
  const [profile, setProfile] = useState<StaffProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  // Profile form
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Password form
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    fetch('/api/ops/auth/me')
      .then(r => r.json())
      .then(data => {
        if (data.staff) {
          setProfile(data.staff)
          setFirstName(data.staff.firstName || '')
          setLastName(data.staff.lastName || '')
          setPhone(data.staff.phone || '')
          setTitle(data.staff.title || '')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      const res = await fetch('/api/ops/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone, title }),
      })
      if (res.ok) {
        showToast('Profile updated successfully')
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to update profile')
      }
    } catch {
      showToast('Failed to update profile')
    }
    setSavingProfile(false)
  }

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      showToast('Password must be at least 8 characters')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/ops/auth/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (res.ok) {
        showToast('Password changed successfully')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed to change password')
      }
    } catch {
      showToast('Failed to change password')
    }
    setSavingPassword(false)
  }

  const profileChanged = profile && (
    firstName !== (profile.firstName || '') ||
    lastName !== (profile.lastName || '') ||
    phone !== (profile.phone || '') ||
    title !== (profile.title || '')
  )

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-3 border-[#0f2a3e] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-[#0f2a3e] text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      <h1 className="text-2xl font-bold text-[#1B2A4A] mb-1">My Profile</h1>
      <p className="text-gray-500 text-sm mb-6">Manage your account and security settings</p>

      {/* Account Info (read-only) */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-[#1B2A4A] mb-4">Account Information</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Email</label>
            <p className="font-medium">{profile?.email}</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Department</label>
            <p className="font-medium">{DEPT_LABELS[profile?.department || ''] || profile?.department}</p>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-gray-500 uppercase tracking-wide">
              {(profile?.roles?.length || 0) > 1 ? 'Roles' : 'Role'}
            </label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(profile?.roles?.length ? profile.roles : [profile?.role].filter(Boolean)).map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#0f2a3e]/10 text-[#0f2a3e]"
                >
                  {ROLE_LABELS[r || ''] || r}
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Staff ID</label>
            <p className="font-mono text-xs text-gray-400">{profile?.id}</p>
          </div>
        </div>
      </div>

      {/* Editable Profile */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[#1B2A4A]">Profile Details</h2>
          {profileChanged && (
            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="bg-[#C6A24E] text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-[#A8882A] transition disabled:opacity-50"
            >
              {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="(940) 555-1234"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Senior Estimator"
            />
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold text-[#1B2A4A] mb-4">Change Password</h2>
        <div className="space-y-4 max-w-sm">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Min 8 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
            )}
          </div>
          <button
            onClick={changePassword}
            disabled={savingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword}
            className="bg-[#0f2a3e] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#153d5a] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {savingPassword ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
