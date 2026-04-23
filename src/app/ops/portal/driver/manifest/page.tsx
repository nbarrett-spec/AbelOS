import { redirect } from 'next/navigation'

// The driver portal shares the print manifest with dispatch — no reason to
// maintain two copies. Link from /ops/portal/driver/manifest to the canonical
// page so deep links keep working.
export default function DriverManifestRedirect() {
  redirect('/ops/delivery/manifest')
}
