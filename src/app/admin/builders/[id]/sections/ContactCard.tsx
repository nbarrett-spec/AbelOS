// Primary Contact card for the builder detail Overview tab.
//
// Server-rendered. Props are already-resolved DB rows so this component does
// no data fetching — keeps the hot path in page.tsx.
//
// The "primary" contact selection in page.tsx prefers BuilderContact rows
// with isPrimary=true, falls back to the first by createdAt. Last-comms date
// comes from the most recent CommunicationLog for this builder (or null).
//
// "Send email" is a plain mailto: anchor — no client JS required. We only
// render it when we actually have an email address so the button isn't a
// dead link.
//
// Blueprint palette only (var(--brand), var(--fg-muted), etc.) — all colors
// resolve to Blueprint CSS variables defined in globals.css.

import { Card, CardBody, StatusDot } from '@/components/ui'

export interface PrimaryContact {
  id: string
  firstName: string
  lastName: string
  title: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  isPrimary: boolean
}

export interface ContactCardProps {
  /** Selected primary contact. null = no contacts on file. */
  contact: PrimaryContact | null
  /** ISO timestamp of last CommunicationLog entry for this builder, if any. */
  lastCommunicationAt: Date | null
  /** Fallback — used if no BuilderContact rows exist. */
  fallbackName: string
  fallbackEmail: string | null
  fallbackPhone: string | null
  /** Pre-filled mailto subject so PMs can fire off a note in one click. */
  mailtoSubject?: string
}

function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return raw
}

// StatusDot tones: 'active' | 'success' | 'alert' | 'info' | 'offline' | 'live'
function fmtRelativeDays(
  d: Date | null
): { label: string; tone: 'success' | 'info' | 'alert' | 'offline' } {
  if (!d) return { label: 'No logged comms', tone: 'offline' }
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days <= 1) return { label: days <= 0 ? 'Today' : '1 day ago', tone: 'success' }
  if (days <= 7) return { label: `${days} days ago`, tone: 'success' }
  if (days <= 30) return { label: `${days} days ago`, tone: 'info' }
  return { label: `${days} days ago`, tone: 'alert' }
}

export default function ContactCard({
  contact,
  lastCommunicationAt,
  fallbackName,
  fallbackEmail,
  fallbackPhone,
  mailtoSubject,
}: ContactCardProps) {
  // Pick the best we have. If there's a real BuilderContact row use it;
  // otherwise synthesize one from the Builder.contactName / .email / .phone
  // columns so the card always shows *something*.
  const name = contact
    ? `${contact.firstName} ${contact.lastName}`.trim()
    : fallbackName
  const title = contact?.title || null
  const email = contact?.email || fallbackEmail
  const phone = contact?.mobile || contact?.phone || fallbackPhone
  const isPrimary = contact?.isPrimary ?? false

  const comms = fmtRelativeDays(lastCommunicationAt)

  const mailtoHref = email
    ? `mailto:${encodeURIComponent(email)}${
        mailtoSubject ? `?subject=${encodeURIComponent(mailtoSubject)}` : ''
      }`
    : null

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-muted">
              Primary contact
            </div>
            <div className="text-lg font-semibold text-fg mt-1">{name}</div>
            {title && (
              <div className="text-sm text-fg-muted">{title}</div>
            )}
          </div>
          {isPrimary && (
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md font-semibold"
              style={{
                background: 'color-mix(in srgb, var(--brand) 12%, transparent)',
                color: 'var(--brand)',
              }}
            >
              Primary
            </span>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-muted">
              Phone
            </div>
            <div className="text-fg">{fmtPhone(phone)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-fg-muted">
              Email
            </div>
            {email ? (
              <a
                href={`mailto:${encodeURIComponent(email)}`}
                className="text-brand hover:underline break-all"
              >
                {email}
              </a>
            ) : (
              <div className="text-fg-muted">—</div>
            )}
          </div>

          <div className="pt-2 mt-2 border-t border-border flex items-center gap-2">
            <StatusDot tone={comms.tone} />
            <div className="text-xs">
              <span className="text-fg-muted">Last communication: </span>
              <span className="text-fg font-medium">{comms.label}</span>
            </div>
          </div>

          {mailtoHref && (
            <a
              href={mailtoHref}
              className="btn-primary w-full justify-center inline-flex items-center mt-2"
            >
              Send email
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
