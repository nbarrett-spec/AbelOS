// ──────────────────────────────────────────────────────────────────────────
// Integration Framework — Shared Types
// ──────────────────────────────────────────────────────────────────────────

export type IntegrationProvider = 'INFLOW' | 'ECI_BOLT' | 'GMAIL' | 'HYPHEN' | 'BUILDERTREND'

export interface IntegrationConfig {
  provider: IntegrationProvider
  apiKey?: string
  apiSecret?: string
  accessToken?: string
  refreshToken?: string
  tokenExpiresAt?: Date
  baseUrl?: string
  companyId?: string
  webhookSecret?: string
  syncEnabled: boolean
  syncInterval: number
  metadata?: Record<string, any>
}

export interface SyncResult {
  provider: IntegrationProvider
  syncType: string
  direction: 'PULL' | 'PUSH' | 'BIDIRECTIONAL'
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  recordsProcessed: number
  recordsCreated: number
  recordsUpdated: number
  recordsSkipped: number
  recordsFailed: number
  errorMessage?: string
  errorDetails?: any
  startedAt: Date
  completedAt: Date
  durationMs: number
}

// ─── InFlow Types ──────────────────────────────────────────────────────

export interface InflowProduct {
  // InFlow Cloud API returns 'productId' (UUID string), NOT 'id'
  productId: string
  id?: number // legacy fallback — not present in current API
  name: string
  sku: string
  barcode?: string
  categoryId?: string
  category?: string
  subcategory?: string
  description?: string
  itemType?: string // 'stockedProduct', 'service', 'assembly', etc.
  // Pricing — NOT on the /products listing endpoint; keep optional
  cost?: number
  price?: number
  isActive: boolean
  // Stock levels — NOT on the /products listing endpoint; keep optional
  quantityOnHand?: number
  quantityOnOrder?: number
  quantityCommitted?: number
  reorderPoint?: number
  reorderQuantity?: number
  location?: string
  lastModifiedDateTime?: string
  lastModified?: string
  lastVendorId?: string
  standardUomName?: string
  purchasingUom?: { name: string; conversionRatio?: any }
  salesUom?: { name: string; conversionRatio?: any }
}

export interface InflowPurchaseOrder {
  id: number
  poNumber: string
  vendorName: string
  status: string
  subtotal: number
  total: number
  orderDate: string
  expectedDate?: string
  items: InflowPOItem[]
}

export interface InflowPOItem {
  productId: number
  productName: string
  sku: string
  quantity: number
  unitCost: number
  lineTotal: number
  receivedQuantity: number
}

// ─── ECI Bolt Types ────────────────────────────────────────────────────

export interface BoltCustomer {
  customerId: string
  name: string
  code: string
  contactName?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  paymentTerms?: string
  creditLimit?: number
  balance?: number
}

export interface BoltOrder {
  orderId: string
  orderNumber: string
  customerId: string
  poNumber?: string
  status: string
  subtotal: number
  tax: number
  total: number
  orderDate: string
  shipDate?: string
  items: BoltOrderItem[]
}

export interface BoltOrderItem {
  itemId: string
  sku: string
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

export interface BoltInvoice {
  invoiceId: string
  invoiceNumber: string
  customerId: string
  orderId?: string
  subtotal: number
  tax: number
  total: number
  amountPaid: number
  balance: number
  status: string
  dueDate: string
}

// ─── Hyphen Types ──────────────────────────────────────────────────────

export interface HyphenScheduleUpdate {
  eventId: string
  projectId: string
  communityName: string
  lotBlock: string
  builderName: string
  activityType: string // "DOOR_HANG", "TRIM_INSTALL", "DELIVERY"
  scheduledDate: string
  status: string
  notes?: string
}

export interface HyphenPurchaseOrder {
  poId: string
  poNumber: string
  projectId: string
  communityName: string
  lotBlock: string
  items: HyphenPOItem[]
  requestedDate: string
  status: string
}

export interface HyphenPOItem {
  sku: string
  description: string
  quantity: number
  unitPrice: number
}

export interface HyphenPaymentNotification {
  paymentId: string
  invoiceNumber: string
  amount: number
  paymentDate: string
  method: string
  reference?: string
}

// ─── Gmail Types ───────────────────────────────────────────────────────

export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  from: string
  to: string[]
  cc: string[]
  subject: string
  body: string
  bodyHtml?: string
  date: string
  hasAttachments: boolean
  attachments: GmailAttachment[]
}

export interface GmailAttachment {
  attachmentId: string
  filename: string
  mimeType: string
  size: number
}

export interface GmailWatchResponse {
  historyId: string
  expiration: string // Unix timestamp in ms
}

// ─── BuilderTrend Types ────────────────────────────────────────────────────

export interface BuilderTrendProject {
  id: string
  name: string
  number?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  community?: string
  lot?: string
  block?: string
  builderName?: string
  builderContact?: string
  status: string
  startDate?: string
  endDate?: string
}

export interface BuilderTrendScheduleItem {
  id: string
  projectId: string
  title: string
  description?: string
  type: string // e.g., "Material Delivery", "Door Installation", "Trim Work"
  scheduledDate: string
  scheduledTime?: string
  dueDate?: string
  status: string
  notes?: string
  assignedTo?: string
  customFields?: Record<string, any>
}

export interface BuilderTrendMaterialSelection {
  id: string
  projectId: string
  itemId?: string
  category: string // e.g., "Doors", "Trim", "Hardware"
  productName: string
  productCode?: string
  specification: string
  quantity?: number
  unit?: string
  notes?: string
  selectedAt?: string
  selectedBy?: string
}
