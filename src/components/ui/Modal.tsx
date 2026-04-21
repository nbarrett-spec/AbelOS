'use client'

// ── Modal — deprecated alias for Dialog ──────────────────────────────────
// Retained so existing callers (imported from @/components/ui) keep working.
// New code should import { Dialog } from '@/components/ui'.
// API is source-compatible: same props shape.
// ─────────────────────────────────────────────────────────────────────────

export { default, Dialog } from './Dialog'
export type { DialogProps as ModalProps } from './Dialog'
