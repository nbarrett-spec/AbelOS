/**
 * Utility functions for the Field Crew Portal
 */

/**
 * Get status display color based on type and status
 */
export function getStatusColor(
  status: string,
  type?: 'DELIVERY' | 'INSTALLATION'
): string {
  if (type === 'DELIVERY') {
    return 'bg-blue-100 text-blue-900 border-blue-300';
  }
  if (type === 'INSTALLATION') {
    return 'bg-green-100 text-green-900 border-green-300';
  }
  return 'bg-gray-100 text-gray-900 border-gray-300';
}

/**
 * Get status badge color for different status values
 */
export function getStatusBadgeColor(status: string): string {
  switch (status) {
    case 'SCHEDULED':
    case 'TENTATIVE':
      return 'bg-yellow-100 text-yellow-800';
    case 'IN_PROGRESS':
    case 'IN_TRANSIT':
    case 'LOADING':
      return 'bg-blue-100 text-blue-800';
    case 'COMPLETE':
    case 'COMPLETED':
      return 'bg-green-100 text-green-800';
    case 'ARRIVED':
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Format time string for display
 */
export function formatScheduledTime(timeStr?: string): string {
  if (!timeStr) return 'Time TBD';
  // Handle formats like "9:00 AM", "Morning", "PM" directly
  return timeStr;
}

/**
 * Get emoji for delivery/installation type
 */
export function getTypeEmoji(type: string): string {
  switch (type) {
    case 'DELIVERY':
      return '📦';
    case 'INSTALLATION':
      return '🔧';
    case 'PICKUP':
      return '🔄';
    default:
      return '📋';
  }
}

/**
 * Get friendly status label
 */
export function getStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/**
 * Check if status progression is valid
 */
export function isValidStatusProgression(
  currentStatus: string,
  nextStatus: string,
  type: 'DELIVERY' | 'INSTALLATION'
): boolean {
  if (type === 'DELIVERY') {
    const validProgression: Record<string, string[]> = {
      'SCHEDULED': ['LOADING'],
      'LOADING': ['IN_TRANSIT'],
      'IN_TRANSIT': ['ARRIVED'],
      'ARRIVED': ['UNLOADING'],
      'UNLOADING': ['COMPLETE'],
      'COMPLETE': [],
    };
    return (validProgression[currentStatus] || []).includes(nextStatus);
  }

  if (type === 'INSTALLATION') {
    const validProgression: Record<string, string[]> = {
      'SCHEDULED': ['IN_PROGRESS'],
      'IN_PROGRESS': ['COMPLETE'],
      'COMPLETE': [],
    };
    return (validProgression[currentStatus] || []).includes(nextStatus);
  }

  return false;
}

/**
 * Calculate route progress percentage
 */
export function calculateRouteProgress(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(date: string | Date | null): string {
  if (!date) return 'Not yet';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date for display
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get crew type display label
 */
export function getCrewTypeLabel(crewType: string): string {
  switch (crewType) {
    case 'DELIVERY':
      return 'Delivery Crew';
    case 'INSTALLATION':
      return 'Installation Crew';
    case 'DELIVERY_AND_INSTALL':
      return 'Multi-Purpose Crew';
    default:
      return crewType;
  }
}

/**
 * Store selected crew ID in localStorage
 */
export function setSelectedCrew(crewId: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('selectedCrewId', crewId);
  }
}

/**
 * Get selected crew ID from localStorage
 */
export function getSelectedCrew(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('selectedCrewId');
  }
  return null;
}

/**
 * Clear selected crew from localStorage
 */
export function clearSelectedCrew(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('selectedCrewId');
  }
}

/**
 * Convert address to map URL (Google Maps)
 */
export function getMapUrl(address: string): string {
  const encoded = encodeURIComponent(address);
  return `https://maps.google.com/?q=${encoded}`;
}

/**
 * Convert phone number to tel: link
 */
export function getPhoneLink(phone?: string): string {
  if (!phone) return '#';
  return `tel:${phone.replace(/\D/g, '')}`;
}

/**
 * Validate required fields for delivery completion
 */
export function validateDeliveryCompletion(data: {
  notes?: string;
  signedBy?: string;
  damageNotes?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.signedBy || data.signedBy.trim() === '') {
    errors.push('Signature (recipient name) is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate required fields for installation completion
 */
export function validateInstallationCompletion(data: {
  passedQC: boolean;
  notes?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.passedQC) {
    errors.push('Installation must pass QC to complete');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
