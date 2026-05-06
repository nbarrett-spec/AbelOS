'use client'

// BuilderEditButton — small client island that mounts the EditSlideOver from
// the server-rendered builder detail page. Caller passes the current builder
// row and the page reloads on success so server queries (AR, jobs, contacts)
// re-run against the persisted state. We intentionally don't try to patch the
// in-memory tree — the page is server-rendered and a refresh is the simplest
// correct path for the admin/owner audience this view is for.

import { useState } from 'react'
import { Edit2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import EditSlideOver, {
  type FieldDef,
} from '@/components/ops/EditSlideOver'

export interface BuilderEditValues {
  id: string
  companyName: string
  contactName: string
  email: string
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  licenseNumber: string | null
  paymentTerm: string
  creditLimit: number | null
  taxExempt: boolean
  status: string
}

const FIELDS: FieldDef[] = [
  { key: 'companyName', label: 'Company Name', type: 'text', required: true, colSpan: 2 },
  { key: 'contactName', label: 'Contact Name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'phone', label: 'Phone', type: 'tel', nullableString: true },
  { key: 'licenseNumber', label: 'License #', type: 'text', nullableString: true },
  { key: 'address', label: 'Address', type: 'text', nullableString: true, colSpan: 2 },
  { key: 'city', label: 'City', type: 'text', nullableString: true },
  { key: 'state', label: 'State', type: 'text', nullableString: true, placeholder: 'TX' },
  { key: 'zip', label: 'ZIP', type: 'text', nullableString: true },
  {
    key: 'paymentTerm',
    label: 'Payment Term',
    type: 'select',
    required: true,
    options: [
      { value: 'PAY_AT_ORDER', label: 'Pay at Order' },
      { value: 'PAY_ON_DELIVERY', label: 'Pay on Delivery' },
      { value: 'NET_15', label: 'Net 15' },
      { value: 'NET_30', label: 'Net 30' },
    ],
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: [
      { value: 'PENDING', label: 'Pending' },
      { value: 'ACTIVE', label: 'Active' },
      { value: 'SUSPENDED', label: 'Suspended' },
      { value: 'CLOSED', label: 'Closed' },
    ],
  },
  { key: 'creditLimit', label: 'Credit Limit ($)', type: 'number' },
  { key: 'taxExempt', label: 'Tax exempt', type: 'checkbox' },
]

export default function BuilderEditButton({ builder }: { builder: BuilderEditValues }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<Edit2 className="w-3.5 h-3.5" />}
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
      <EditSlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Builder"
        subtitle={builder.companyName}
        fields={FIELDS}
        initialValues={builder}
        endpoint={`/api/admin/builders/${builder.id}`}
        method="PATCH"
        onSuccess={() => {
          setOpen(false)
          // Server-rendered page — round-trip refresh re-runs all queries.
          router.refresh()
        }}
      />
    </>
  )
}
