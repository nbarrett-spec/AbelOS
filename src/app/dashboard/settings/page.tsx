'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

interface BuilderProfile {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface NotificationPreferences {
  orderUpdates: boolean;
  quoteReady: boolean;
  deliveryAlerts: boolean;
  warrantyUpdates: boolean;
  promotions: boolean;
  invoiceAlerts: boolean;
  weeklyDigest: boolean;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
  id: number;
}

export default function SettingsPage() {
  // State for profile data
  const [profile, setProfile] = useState<BuilderProfile | null>(null);
  const [profileFormData, setProfileFormData] = useState<Partial<BuilderProfile>>({});
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);

  // State for password change
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // State for notification preferences
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    orderUpdates: true,
    quoteReady: true,
    deliveryAlerts: true,
    warrantyUpdates: true,
    promotions: false,
    invoiceAlerts: true,
    weeklyDigest: false,
  });
  const [preferencesSaving, setPreferencesSaving] = useState(false);

  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Fetch profile data on mount
  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setProfileLoading(true);
      const [profileRes, prefsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/auth/preferences'),
      ]);

      if (profileRes.ok) {
        const data = await profileRes.json();
        setProfile(data);
        setProfileFormData(data);
      }

      if (prefsRes.ok) {
        const prefsData = await prefsRes.json();
        setPreferences(prev => ({ ...prev, ...prefsData }));
      }
    } catch (error) {
      showToast('Failed to load profile', 'error');
    } finally {
      setProfileLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { message, type, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  };

  // Profile form handlers
  const handleProfileChange = (field: keyof BuilderProfile, value: string) => {
    setProfileFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSaveProfile = async () => {
    if (!profile) return;

    try {
      setProfileSaving(true);

      // Only send changed fields
      const changedFields: Partial<BuilderProfile> = {};
      (Object.keys(profileFormData) as Array<keyof BuilderProfile>).forEach((key) => {
        if (profileFormData[key] !== profile[key]) {
          changedFields[key] = profileFormData[key];
        }
      });

      if (Object.keys(changedFields).length === 0) {
        showToast('No changes to save', 'error');
        return;
      }

      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changedFields),
      });

      if (!response.ok) throw new Error('Failed to save profile');

      const updatedProfile = await response.json();
      setProfile(updatedProfile);
      setProfileFormData(updatedProfile);
      showToast('Profile updated successfully', 'success');
    } catch (error) {
      showToast('Failed to update profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  // Password form handlers
  const handlePasswordChange = (
    field: keyof typeof passwordForm,
    value: string
  ) => {
    setPasswordForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setPasswordError('');
  };

  const validatePassword = (): boolean => {
    if (passwordForm.newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return false;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match');
      return false;
    }
    if (!passwordForm.currentPassword) {
      setPasswordError('Current password is required');
      return false;
    }
    return true;
  };

  const handleSavePassword = async () => {
    if (!validatePassword()) return;

    try {
      setPasswordSaving(true);

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to change password');
      }

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      showToast('Password changed successfully', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to change password',
        'error'
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  // Notification preferences handlers
  const handlePreferenceChange = (key: keyof NotificationPreferences) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSavePreferences = async () => {
    try {
      setPreferencesSaving(true);

      const response = await fetch('/api/auth/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) throw new Error('Failed to save preferences');

      showToast('Notification preferences updated successfully', 'success');
    } catch (error) {
      showToast('Failed to update notification preferences', 'error');
    } finally {
      setPreferencesSaving(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto mb-4"></div>
          <p className="text-fg-muted">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* Header */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-fg-muted hover:text-fg transition"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-fg">
                Your settings
              </h1>
              <p className="text-fg-muted mt-1">
                Profile, security, and notification preferences.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-3 rounded-lg text-white font-medium shadow-lg ${
              toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Section 1: Company Profile */}
          <div className="bg-surface rounded-lg shadow-sm border border-border">
            <div className="px-6 py-4 border-b border-border bg-gradient-to-r from-brand to-brand-hover">
              <h2 className="text-xl font-bold text-white">Company Profile</h2>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Company Name */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={profileFormData.companyName || ''}
                    onChange={(e) =>
                      handleProfileChange('companyName', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* Contact Name */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={profileFormData.contactName || ''}
                    onChange={(e) =>
                      handleProfileChange('contactName', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* Contact Email */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={profileFormData.contactEmail || ''}
                    onChange={(e) =>
                      handleProfileChange('contactEmail', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={profileFormData.contactPhone || ''}
                    onChange={(e) =>
                      handleProfileChange('contactPhone', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* Address */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Address
                  </label>
                  <input
                    type="text"
                    value={profileFormData.address || ''}
                    onChange={(e) =>
                      handleProfileChange('address', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* City */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    City
                  </label>
                  <input
                    type="text"
                    value={profileFormData.city || ''}
                    onChange={(e) =>
                      handleProfileChange('city', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* State */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    State
                  </label>
                  <input
                    type="text"
                    value={profileFormData.state || ''}
                    onChange={(e) =>
                      handleProfileChange('state', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* ZIP */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    value={profileFormData.zip || ''}
                    onChange={(e) =>
                      handleProfileChange('zip', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  className="px-6 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {profileSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Change Password */}
          <div className="bg-surface rounded-lg shadow-sm border border-border">
            <div className="px-6 py-4 border-b border-border bg-gradient-to-r from-brand to-brand-hover">
              <h2 className="text-xl font-bold text-white">Change Password</h2>
            </div>

            <div className="p-6">
              <div className="space-y-6 max-w-md">
                {/* Current Password */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(e) =>
                      handlePasswordChange('currentPassword', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* New Password */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    New Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) =>
                      handlePasswordChange('newPassword', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                  <p className="text-xs text-fg-muted mt-1">
                    Minimum 8 characters
                  </p>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm font-medium text-fg-muted mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) =>
                      handlePasswordChange('confirmPassword', e.target.value)
                    }
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent outline-none transition"
                  />
                </div>

                {/* Error Message */}
                {passwordError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{passwordError}</p>
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSavePassword}
                  disabled={passwordSaving}
                  className="px-6 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {passwordSaving ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Notification Preferences */}
          <div className="bg-surface rounded-lg shadow-sm border border-border">
            <div className="px-6 py-4 border-b border-border bg-gradient-to-r from-brand to-brand-hover">
              <h2 className="text-xl font-bold text-white">
                Notification Preferences
              </h2>
            </div>

            <div className="p-6">
              <div className="space-y-4">
                {/* Order Updates */}
                <div className="flex items-center justify-between py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Order Updates
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Receive notifications about your order status
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('orderUpdates')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.orderUpdates ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.orderUpdates ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Quote Ready */}
                <div className="flex items-center justify-between py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Quote Ready
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Notify me when my quotes are ready for review
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('quoteReady')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.quoteReady ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.quoteReady ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Delivery Alerts */}
                <div className="flex items-center justify-between py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Delivery Alerts
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Get notified about shipment and delivery updates
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('deliveryAlerts')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.deliveryAlerts ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.deliveryAlerts ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Warranty Updates */}
                <div className="flex items-center justify-between py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Warranty Updates
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Receive warranty information and coverage alerts
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('warrantyUpdates')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.warrantyUpdates ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.warrantyUpdates ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Invoice Alerts */}
                <div className="flex items-center justify-between py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Invoice Alerts
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Get notified about new invoices and payment reminders
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('invoiceAlerts')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.invoiceAlerts ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.invoiceAlerts ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Promotions */}
                <div className="flex items-center justify-between py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Promotions & Special Offers
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Receive information about new products and special deals
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('promotions')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.promotions ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.promotions ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Weekly Digest */}
                <div className="flex items-center justify-between py-4">
                  <div>
                    <h3 className="text-sm font-medium text-fg">
                      Weekly Digest
                    </h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Receive a weekly email summary of your account activity
                    </p>
                  </div>
                  <button
                    onClick={() => handlePreferenceChange('weeklyDigest')}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      preferences.weeklyDigest ? 'bg-accent' : 'bg-surface-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                        preferences.weeklyDigest ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSavePreferences}
                  disabled={preferencesSaving}
                  className="px-6 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {preferencesSaving ? 'Saving...' : 'Save Preferences'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
