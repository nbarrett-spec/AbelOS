import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const prisma = new PrismaClient();

interface VendorData {
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  active: boolean;
  lead_time_days?: string;
}

interface VendorLine {
  data: VendorData;
}

// Generate vendor code from name
// Examples: "Boise Cascade" → "BC", "DW Distribution" → "DWD", "Central Hardwoods" → "CH"
function generateCode(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  let code = words.map((w) => w[0].toUpperCase()).join('');

  // Max 4 chars
  if (code.length > 4) {
    code = code.substring(0, 4);
  }

  return code;
}

async function seedVendors() {
  console.log('Starting vendor seed...');

  const vendorsFile = path.join(
    __dirname,
    '../../..',
    'brain_export',
    'vendors.jsonl'
  );

  const fileStream = fs.createReadStream(vendorsFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const codeMap = new Map<string, number>(); // Track code usage for conflict resolution
  let vendorCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry: VendorLine = JSON.parse(line);
      const { data } = entry;

      // Generate base code
      let code = generateCode(data.name);
      const baseCode = code;

      // Handle conflicts: append number if code already used
      if (codeMap.has(code)) {
        let counter = 1;
        while (codeMap.has(`${baseCode}${counter}`)) {
          counter++;
        }
        code = `${baseCode}${counter}`;
      }
      codeMap.set(code, 1);

      // Build address
      const address =
        data.city && data.state
          ? `${data.city} ${data.state}`
          : data.city || data.state || null;

      // Parse lead time
      const avgLeadDays =
        data.lead_time_days && data.lead_time_days.trim()
          ? parseInt(data.lead_time_days, 10)
          : null;

      // Upsert vendor by code (idempotent)
      await prisma.vendor.upsert({
        where: { code },
        update: {
          name: data.name,
          contactName: data.contact || null,
          email: data.email || null,
          phone: data.phone || null,
          address: address,
          active: data.active,
          avgLeadDays: avgLeadDays,
        },
        create: {
          code,
          name: data.name,
          contactName: data.contact || null,
          email: data.email || null,
          phone: data.phone || null,
          address: address,
          active: data.active,
          avgLeadDays: avgLeadDays,
        },
      });

      vendorCount++;
    } catch (error) {
      console.error('Error processing vendor line:', line, error);
    }
  }

  console.log(`Seeded ${vendorCount} vendors`);
  await prisma.$disconnect();
}

seedVendors().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
