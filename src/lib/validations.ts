/**
 * Zod Validation Schemas for Abel Lumber Platform
 *
 * Comprehensive validation schemas for all critical API inputs.
 * Each validation returns { success: true, data: T } or { success: false, error: string }
 */

import { z } from "zod";
import { isValidTransition } from "@/lib/state-machines";

// ─── COMMON SCHEMAS ──────────────────────────────────────────────────────

const StringIdSchema = z.string().min(1, "ID cannot be empty").trim();

const PositiveInt = z
  .number()
  .int("Must be an integer")
  .positive("Must be a positive number");

const PositiveNumber = z
  .number()
  .positive("Must be a positive number");

const ISODateString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/,
    "Invalid ISO date format"
  );

const OptionalISODateString = ISODateString.optional();

// ─── QUOTE VALIDATION ────────────────────────────────────────────────────

const QuoteItemSchema = z.object({
  productId: StringIdSchema,
  description: z.string().min(1, "Description cannot be empty").trim(),
  quantity: PositiveInt,
  unitPrice: PositiveNumber,
  location: z.string().optional(),
});

export const CreateQuoteSchema = z.object({
  builderId: StringIdSchema,
  projectId: StringIdSchema,
  items: z
    .array(QuoteItemSchema)
    .min(1, "At least one item is required"),
  notes: z.string().optional(),
});

export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>;

export function validateQuoteCreation(
  data: unknown
): { success: true; data: CreateQuoteInput } | { success: false; error: string } {
  try {
    const result = CreateQuoteSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid quote data" };
  }
}

// ─── ORDER VALIDATION ────────────────────────────────────────────────────

const PaymentTermSchema = z.enum(
  ["PAY_AT_ORDER", "PAY_ON_DELIVERY", "NET_15", "NET_30"],
  {
    errorMap: () => ({
      message:
        "Payment term must be one of: PAY_AT_ORDER, PAY_ON_DELIVERY, NET_15, NET_30",
    }),
  }
);

const OrderItemSchema = z.object({
  productId: StringIdSchema,
  description: z.string().min(1, "Description cannot be empty").trim(),
  quantity: PositiveInt,
  unitPrice: PositiveNumber,
});

export const CreateOrderSchema = z.object({
  builderId: StringIdSchema,
  quoteId: z.string().optional(),
  items: z
    .array(OrderItemSchema)
    .min(1, "At least one item is required"),
  paymentTerm: PaymentTermSchema,
  deliveryDate: OptionalISODateString,
  deliveryNotes: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export function validateOrderCreation(
  data: unknown
): { success: true; data: CreateOrderInput } | { success: false; error: string } {
  try {
    const result = CreateOrderSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid order data" };
  }
}

// ─── JOB VALIDATION ──────────────────────────────────────────────────────

const JobNumberSchema = z
  .string()
  .regex(
    /^JOB-\d{4}-\d{4}$/,
    "Job number must match format JOB-YYYY-NNNN"
  );

const ScopeTypeSchema = z.enum(
  ["DOORS_ONLY", "TRIM_ONLY", "DOORS_AND_TRIM", "HARDWARE_ONLY", "FULL_PACKAGE", "CUSTOM"],
  {
    errorMap: () => ({
      message:
        "Scope type must be one of: DOORS_ONLY, TRIM_ONLY, DOORS_AND_TRIM, HARDWARE_ONLY, FULL_PACKAGE, CUSTOM",
    }),
  }
);

export const CreateJobSchema = z.object({
  jobNumber: JobNumberSchema,
  builderName: z.string().min(1, "Builder name cannot be empty").trim(),
  scopeType: ScopeTypeSchema,
  orderId: z.string().optional(),
  lotBlock: z.string().optional(),
  community: z.string().optional(),
  jobAddress: z.string().optional(),
  builderContact: z.string().optional(),
  scheduledDate: OptionalISODateString,
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;

export function validateJobCreation(
  data: unknown
): { success: true; data: CreateJobInput } | { success: false; error: string } {
  try {
    const result = CreateJobSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid job data" };
  }
}

// ─── INVOICE VALIDATION ──────────────────────────────────────────────────

const InvoiceItemSchema = z.object({
  description: z.string().min(1, "Description cannot be empty").trim(),
  quantity: PositiveInt,
  unitPrice: PositiveNumber,
});

export const CreateInvoiceSchema = z.object({
  builderId: StringIdSchema,
  jobId: z.string().optional(),
  orderId: z.string().optional(),
  items: z
    .array(InvoiceItemSchema)
    .min(1, "At least one item is required"),
  paymentTerm: PaymentTermSchema,
  notes: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

export function validateInvoiceCreation(
  data: unknown
): { success: true; data: CreateInvoiceInput } | { success: false; error: string } {
  try {
    const result = CreateInvoiceSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid invoice data" };
  }
}

// ─── STATUS UPDATE VALIDATION ────────────────────────────────────────────

type EntityType = "job" | "order" | "quote" | "invoice" | "delivery" | "installation" | "po";

export const StatusUpdateSchema = z.object({
  type: z.enum(["job", "order", "quote", "invoice", "delivery", "installation", "po"] as const),
  from: z.string().min(1, "Current status cannot be empty").trim(),
  to: z.string().min(1, "Target status cannot be empty").trim(),
});

export type StatusUpdateInput = z.infer<typeof StatusUpdateSchema>;

export function validateStatusUpdate(
  type: EntityType,
  from: string,
  to: string
): { success: true; data: { type: EntityType; from: string; to: string } } | { success: false; error: string } {
  try {
    // Validate the input shape
    StatusUpdateSchema.parse({ type, from, to });

    // Check if the transition is valid
    if (!isValidTransition(type, from, to)) {
      return {
        success: false,
        error: `Invalid transition from ${from} to ${to} for ${type}`,
      };
    }

    return { success: true, data: { type, from, to } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid status update data" };
  }
}

// ─── DELIVERY UPDATE VALIDATION ──────────────────────────────────────────

const DeliveryStatusSchema = z.enum(
  ["SCHEDULED", "LOADING", "IN_TRANSIT", "ARRIVED", "UNLOADING", "COMPLETE", "PARTIAL_DELIVERY", "REFUSED", "RESCHEDULED"],
  {
    errorMap: () => ({
      message:
        "Delivery status must be one of: SCHEDULED, LOADING, IN_TRANSIT, ARRIVED, UNLOADING, COMPLETE, PARTIAL_DELIVERY, REFUSED, RESCHEDULED",
    }),
  }
);

export const DeliveryUpdateSchema = z.object({
  status: DeliveryStatusSchema.optional(),
  notes: z.string().optional(),
  signedBy: z.string().optional(),
  damageNotes: z.string().optional(),
  departedAt: OptionalISODateString,
  arrivedAt: OptionalISODateString,
  completedAt: OptionalISODateString,
});

export type DeliveryUpdateInput = z.infer<typeof DeliveryUpdateSchema>;

export function validateDeliveryUpdate(
  data: unknown
): { success: true; data: DeliveryUpdateInput } | { success: false; error: string } {
  try {
    const result = DeliveryUpdateSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid delivery update data" };
  }
}

// ─── INSTALLATION UPDATE VALIDATION ─────────────────────────────────────

const InstallationStatusSchema = z.enum(
  ["SCHEDULED", "IN_PROGRESS", "COMPLETE", "PUNCH_LIST", "REWORK", "CANCELLED"],
  {
    errorMap: () => ({
      message:
        "Installation status must be one of: SCHEDULED, IN_PROGRESS, COMPLETE, PUNCH_LIST, REWORK, CANCELLED",
    }),
  }
);

export const InstallationUpdateSchema = z.object({
  status: InstallationStatusSchema.optional(),
  notes: z.string().optional(),
  punchItems: z.string().optional(),
  passedQC: z.boolean().optional(),
  startedAt: OptionalISODateString,
  completedAt: OptionalISODateString,
});

export type InstallationUpdateInput = z.infer<typeof InstallationUpdateSchema>;

export function validateInstallationUpdate(
  data: unknown
): { success: true; data: InstallationUpdateInput } | { success: false; error: string } {
  try {
    const result = InstallationUpdateSchema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.errors[0].message };
    }
    return { success: false, error: "Invalid installation update data" };
  }
}

// ─── EXPORTED VALIDATORS SUMMARY ─────────────────────────────────────────
/**
 * Complete list of exported validation functions:
 *
 * Quote Creation:
 * - validateQuoteCreation(data) -> { success, data | error }
 *
 * Order Creation:
 * - validateOrderCreation(data) -> { success, data | error }
 *
 * Job Creation:
 * - validateJobCreation(data) -> { success, data | error }
 *
 * Invoice Creation:
 * - validateInvoiceCreation(data) -> { success, data | error }
 *
 * Status Transitions:
 * - validateStatusUpdate(type, from, to) -> { success, data | error }
 *
 * Delivery Updates:
 * - validateDeliveryUpdate(data) -> { success, data | error }
 *
 * Installation Updates:
 * - validateInstallationUpdate(data) -> { success, data | error }
 */

// ─── AUTH & PROJECT SCHEMAS ─────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const signupSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  contactName: z.string().min(1, "Contact name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().optional().default(""),
  paymentTerm: z.string().optional().default("NET30"),
  licenseNumber: z.string().optional().default(""),
  taxId: z.string().optional().default(""),
  taxExempt: z.boolean().optional().default(false),
  address: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  zip: z.string().optional().default(""),
});

export type SignupInput = z.infer<typeof signupSchema>;

export const projectSchema = z.object({
  name: z.string().min(1, "Project name is required"),
  status: z.string().optional(),
  planName: z.string().optional(),
  jobAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  lotNumber: z.string().optional(),
  subdivision: z.string().optional(),
  sqFootage: z.number().int().positive().optional(),
});
