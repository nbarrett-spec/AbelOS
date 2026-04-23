import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as crypto from "crypto";

const prisma = new PrismaClient();

interface CustomerData {
  name: string;
  contact?: string;
  phone?: string;
  email?: string;
  payment_terms?: string;
  active?: boolean;
  bolt_id?: string;
  account_status?: string;
}

interface CustomerRecord {
  data: CustomerData;
}

// Production builders - hard-coded classification list
const PRODUCTION_BUILDERS = [
  "Pulte",
  "Brookfield",
  "Bloomfield",
  "Toll Brothers",
  "DR Horton",
  "Lennar",
  "KB Home",
  "Meritage",
  "Taylor Morrison",
  "Perry Homes",
  "Ashton Woods",
  "Highland Homes",
  "Grand Homes",
  "Trophy Signature",
  "Newport Homebuilders",
  "Stonehollow",
  "First Texas Homes",
  "Fig Tree Homes",
];

/**
 * Classify builder type based on name matching against production builders list
 */
function classifyBuilderType(
  companyName: string
): "PRODUCTION" | "CUSTOM" {
  const isProduction = PRODUCTION_BUILDERS.some((pb) =>
    companyName.toLowerCase().includes(pb.toLowerCase())
  );
  return isProduction ? "PRODUCTION" : "CUSTOM";
}

/**
 * Parse payment terms to enum value
 */
function parsePaymentTerm(
  paymentTerms?: string
): "PAY_AT_ORDER" | "PAY_ON_DELIVERY" | "NET_15" | "NET_30" {
  if (!paymentTerms || paymentTerms.trim() === "") {
    return "NET_15"; // default
  }

  const term = paymentTerms.toLowerCase().trim();

  if (term.includes("at order") || term.includes("at delivery")) {
    return "PAY_AT_ORDER";
  }
  if (
    term.includes("due on receipt") ||
    term.includes("upon receipt") ||
    term.includes("on delivery")
  ) {
    return "PAY_ON_DELIVERY";
  }
  if (term.includes("net 15")) {
    return "NET_15";
  }
  if (term.includes("net 30")) {
    return "NET_30";
  }

  return "NET_15"; // default
}

/**
 * Generate email if missing
 */
function generateEmail(
  email?: string,
  companyName?: string
): string {
  if (email && email.trim() !== "") {
    return email.trim();
  }

  if (!companyName || companyName.trim() === "") {
    return `builder.${crypto.randomBytes(4).toString("hex")}@placeholder.abellumber.com`;
  }

  const slugified = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, ".");
  return `${slugified}@placeholder.abellumber.com`;
}

/**
 * Generate a bcrypt-like placeholder password hash
 * (In production, real passwords set via invite flow)
 */
function generatePasswordHash(): string {
  // Bcrypt-like format placeholder: $2a$10$XXXX...
  const randomBytes = crypto.randomBytes(16).toString("base64");
  return `$2a$10$${randomBytes}placeholder`;
}

/**
 * Determine account status
 */
function determineStatus(
  active?: boolean,
  accountStatus?: string
): "PENDING" | "ACTIVE" | "CLOSED" {
  // If explicitly marked as LOST, set to CLOSED
  if (accountStatus && accountStatus.toUpperCase() === "LOST") {
    return "CLOSED";
  }

  // If marked as PROSPECT, set to PENDING
  if (accountStatus && accountStatus.toUpperCase() === "PROSPECT") {
    return "PENDING";
  }

  // If active flag is false, set to CLOSED
  if (active === false) {
    return "CLOSED";
  }

  // Default: if active is true or not specified, mark as ACTIVE
  // (they will be invited to set real password)
  return "ACTIVE";
}

/**
 * Main seed function
 */
async function main() {
  const brainExportDir =
    process.env.BRAIN_EXPORT_DIR ||
    resolve(__dirname, "../../brain_export");
  const customersPath = resolve(brainExportDir, "customers.jsonl");

  console.log(`Reading customers from: ${customersPath}`);

  let fileContent: string;
  try {
    fileContent = readFileSync(customersPath, "utf-8");
  } catch (error) {
    console.error(
      `Failed to read customers.jsonl: ${(error as Error).message}`
    );
    process.exit(1);
  }

  const lines = fileContent
    .split("\n")
    .filter((line) => line.trim().length > 0);

  let seededCount = 0;
  let productionCount = 0;
  let customCount = 0;
  let errorCount = 0;
  const errors: Array<{ index: number; error: string }> = [];

  console.log(`Processing ${lines.length} customer records...`);

  for (let i = 0; i < lines.length; i++) {
    try {
      const record: CustomerRecord = JSON.parse(lines[i]);
      const { data } = record;

      if (!data || !data.name || data.name.trim() === "") {
        errors.push({
          index: i + 1,
          error: "Missing or empty company name",
        });
        errorCount++;
        continue;
      }

      const companyName = data.name.trim();
      const contactName = data.contact?.trim() || "";
      const phone = data.phone?.trim() || null;
      const email = generateEmail(data.email, companyName);
      const paymentTerm = parsePaymentTerm(data.payment_terms);
      const status = determineStatus(data.active, data.account_status);
      const builderType = classifyBuilderType(companyName);
      const passwordHash = generatePasswordHash();

      // Upsert on email to be idempotent
      await prisma.builder.upsert({
        where: { email },
        update: {
          companyName,
          contactName,
          phone,
          paymentTerm,
          status,
          builderType,
          territory: "DFW",
          updatedAt: new Date(),
        },
        create: {
          companyName,
          contactName,
          email,
          passwordHash,
          phone,
          paymentTerm,
          status,
          builderType,
          territory: "DFW",
          emailVerified: status === "ACTIVE", // mark verified if active
        },
      });

      seededCount++;
      if (builderType === "PRODUCTION") {
        productionCount++;
      } else {
        customCount++;
      }

      if ((i + 1) % 25 === 0) {
        console.log(`  Processed ${i + 1}/${lines.length} records...`);
      }
    } catch (error) {
      const errorMsg =
        error instanceof SyntaxError
          ? `Invalid JSON: ${(error as Error).message}`
          : `${(error as Error).message}`;
      errors.push({
        index: i + 1,
        error: errorMsg,
      });
      errorCount++;
    }
  }

  console.log("\n--- Seed Complete ---");
  console.log(`Seeded ${seededCount} builders (${productionCount} production, ${customCount} custom)`);

  if (errorCount > 0) {
    console.log(`\nEncountered ${errorCount} errors:`);
    errors.slice(0, 10).forEach(({ index, error }) => {
      console.log(`  Line ${index}: ${error}`);
    });
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more`);
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Fatal error during seeding:", error);
  process.exit(1);
});
