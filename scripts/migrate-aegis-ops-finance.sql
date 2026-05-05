-- AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05)
-- Additive-only migration for FIX-3 (Vendor Payments), FIX-4 (Journal
-- Entries + Chart of Accounts), FIX-5 (DocumentVault.journalEntryId),
-- and the developer-tooling ApiKey table.
--
-- Idempotent — safe to apply on a populated prod-main DB. Existing
-- code paths keep working because:
--   • No drops, no NOT NULL adds without defaults.
--   • Vendor / PurchaseOrder / DocumentVault are touched ONLY by adding
--     a single nullable column or by adding indexes.
--   • Existing ABEL_MCP_API_KEY env-var path still authorizes /api/mcp
--     even before any ApiKey rows exist.

-- ───────────────────────────────────────────────────────────────────
-- Enums (FIX-4)
-- ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────
-- VendorPayment (FIX-3)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VendorPayment" (
  "id"              TEXT PRIMARY KEY,
  "vendorId"        TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "amount"          DOUBLE PRECISION NOT NULL,
  "method"          TEXT NOT NULL,
  "checkNumber"     TEXT,
  "reference"       TEXT,
  "memo"            TEXT,
  "paidAt"          TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_vendor_payment_vendor"
  ON "VendorPayment" ("vendorId");
CREATE INDEX IF NOT EXISTS "idx_vendor_payment_po"
  ON "VendorPayment" ("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "idx_vendor_payment_paid_at"
  ON "VendorPayment" ("paidAt" DESC);
CREATE INDEX IF NOT EXISTS "idx_vendor_payment_method"
  ON "VendorPayment" ("method");

-- ───────────────────────────────────────────────────────────────────
-- ChartOfAccount (FIX-4)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChartOfAccount" (
  "id"          TEXT PRIMARY KEY,
  "code"        TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL,
  "type"        "AccountType" NOT NULL,
  "subType"     TEXT,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "parentId"    TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "ChartOfAccount_parent_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ChartOfAccount" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_coa_type"     ON "ChartOfAccount" ("type");
CREATE INDEX IF NOT EXISTS "idx_coa_parent"   ON "ChartOfAccount" ("parentId");
CREATE INDEX IF NOT EXISTS "idx_coa_active"   ON "ChartOfAccount" ("isActive");

-- ───────────────────────────────────────────────────────────────────
-- JournalEntry (FIX-4)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JournalEntry" (
  "id"           TEXT PRIMARY KEY,
  "entryNumber"  TEXT NOT NULL UNIQUE,
  "date"         TIMESTAMP NOT NULL,
  "description"  TEXT NOT NULL,
  "reference"    TEXT,
  "status"       "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById"  TEXT,
  "approvedById" TEXT,
  "approvedAt"   TIMESTAMP,
  "reversalOf"   TEXT,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_je_date"         ON "JournalEntry" ("date" DESC);
CREATE INDEX IF NOT EXISTS "idx_je_status"       ON "JournalEntry" ("status");
CREATE INDEX IF NOT EXISTS "idx_je_entry_number" ON "JournalEntry" ("entryNumber");
CREATE INDEX IF NOT EXISTS "idx_je_reversal_of"  ON "JournalEntry" ("reversalOf");

-- ───────────────────────────────────────────────────────────────────
-- JournalEntryLine (FIX-4)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JournalEntryLine" (
  "id"             TEXT PRIMARY KEY,
  "journalEntryId" TEXT NOT NULL,
  "accountId"      TEXT NOT NULL,
  "debit"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "credit"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "memo"           TEXT,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "JournalEntryLine_entry_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "JournalEntryLine_account_fkey"
    FOREIGN KEY ("accountId") REFERENCES "ChartOfAccount" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_jel_entry"   ON "JournalEntryLine" ("journalEntryId");
CREATE INDEX IF NOT EXISTS "idx_jel_account" ON "JournalEntryLine" ("accountId");

-- ───────────────────────────────────────────────────────────────────
-- DocumentVault.journalEntryId (FIX-5)
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "DocumentVault"
  ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT;

CREATE INDEX IF NOT EXISTS "idx_vault_journal_entry"
  ON "DocumentVault" ("journalEntryId");

-- ───────────────────────────────────────────────────────────────────
-- ApiKey (developer tooling — self-serve key generation)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "scope"       TEXT NOT NULL DEFAULT 'mcp',
  "prefix"      TEXT NOT NULL,
  "hashedKey"   TEXT NOT NULL UNIQUE,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "revokedAt"   TIMESTAMP,
  "revokedById" TEXT,
  "lastUsedAt"  TIMESTAMP,
  "notes"       TEXT
);

CREATE INDEX IF NOT EXISTS "idx_apikey_scope"      ON "ApiKey" ("scope");
CREATE INDEX IF NOT EXISTS "idx_apikey_hashed"     ON "ApiKey" ("hashedKey");
CREATE INDEX IF NOT EXISTS "idx_apikey_revoked_at" ON "ApiKey" ("revokedAt");
CREATE INDEX IF NOT EXISTS "idx_apikey_created"    ON "ApiKey" ("createdAt" DESC);

-- ───────────────────────────────────────────────────────────────────
-- Seed: starter Chart of Accounts for a building-materials supplier.
-- Idempotent — uses ON CONFLICT (code) DO NOTHING. Adjust codes to
-- your firm's preferred numbering scheme later via the UI.
-- ───────────────────────────────────────────────────────────────────
INSERT INTO "ChartOfAccount" ("id", "code", "name", "type", "subType", "createdAt", "updatedAt")
VALUES
  ('coa_seed_1000', '1000', 'Cash',                    'ASSET',     'Current Asset', NOW(), NOW()),
  ('coa_seed_1100', '1100', 'Accounts Receivable',     'ASSET',     'Current Asset', NOW(), NOW()),
  ('coa_seed_1200', '1200', 'Inventory',               'ASSET',     'Current Asset', NOW(), NOW()),
  ('coa_seed_1500', '1500', 'Equipment',               'ASSET',     'Fixed Asset',   NOW(), NOW()),
  ('coa_seed_2000', '2000', 'Accounts Payable',        'LIABILITY', 'Current Liability', NOW(), NOW()),
  ('coa_seed_2100', '2100', 'Accrued Liabilities',     'LIABILITY', 'Current Liability', NOW(), NOW()),
  ('coa_seed_3000', '3000', 'Owner Equity',            'EQUITY',    NULL, NOW(), NOW()),
  ('coa_seed_3100', '3100', 'Retained Earnings',       'EQUITY',    NULL, NOW(), NOW()),
  ('coa_seed_4010', '4010', 'Revenue - Doors',         'REVENUE',   'Operating Revenue', NOW(), NOW()),
  ('coa_seed_4020', '4020', 'Revenue - Trim',          'REVENUE',   'Operating Revenue', NOW(), NOW()),
  ('coa_seed_4030', '4030', 'Revenue - Hardware',      'REVENUE',   'Operating Revenue', NOW(), NOW()),
  ('coa_seed_4040', '4040', 'Revenue - Installation',  'REVENUE',   'Operating Revenue', NOW(), NOW()),
  ('coa_seed_5000', '5000', 'COGS - Materials',        'EXPENSE',   'Cost of Goods Sold', NOW(), NOW()),
  ('coa_seed_5010', '5010', 'COGS - Labor',            'EXPENSE',   'Cost of Goods Sold', NOW(), NOW()),
  ('coa_seed_5020', '5020', 'COGS - Freight',          'EXPENSE',   'Cost of Goods Sold', NOW(), NOW()),
  ('coa_seed_6000', '6000', 'Operating Expenses',      'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6100', '6100', 'Payroll',                 'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6200', '6200', 'Rent',                    'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6300', '6300', 'Utilities',               'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6400', '6400', 'Insurance',               'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6500', '6500', 'Office Supplies',         'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6600', '6600', 'Professional Fees',       'EXPENSE',   'Operating',     NOW(), NOW()),
  ('coa_seed_6700', '6700', 'Software & SaaS',         'EXPENSE',   'Operating',     NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
