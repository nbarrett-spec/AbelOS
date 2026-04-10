// Payment term multipliers applied to base price
export const PAYMENT_TERM_MULTIPLIERS = {
  PAY_AT_ORDER: 0.97,     // 3% discount
  PAY_ON_DELIVERY: 1.0,   // Standard
  NET_15: 1.01,           // 1% premium
  NET_30: 1.025,          // 2.5% premium
} as const

export const PAYMENT_TERM_LABELS = {
  PAY_AT_ORDER: 'Pay at Order (3% off)',
  PAY_ON_DELIVERY: 'Pay on Delivery',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
} as const

export const PROJECT_STATUS_LABELS = {
  DRAFT: 'Draft',
  BLUEPRINT_UPLOADED: 'Blueprint Uploaded',
  TAKEOFF_PENDING: 'AI Processing',
  TAKEOFF_COMPLETE: 'Takeoff Ready',
  QUOTE_GENERATED: 'Quote Ready',
  QUOTE_APPROVED: 'Quote Approved',
  ORDERED: 'Ordered',
  IN_PROGRESS: 'In Progress',
  DELIVERED: 'Delivered',
  COMPLETE: 'Complete',
} as const

export const MIN_MARGIN = 0.25  // 25% floor
export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
export const ALLOWED_BLUEPRINT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
]

export const QUOTE_PREFIX = 'ABL'
export const ORDER_PREFIX = 'ORD'
