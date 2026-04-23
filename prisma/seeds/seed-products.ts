import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as readline from 'readline';

const prisma = new PrismaClient();

interface ProductData {
  sku: string;
  name: string;
  category: string;
  price: string | number;
  cost: string | number;
  margin_pct: number;
  active: boolean;
  vendor?: string;
}

interface ParsedAttributes {
  doorSize?: string;
  handing?: string;
  coreType?: string;
  panelStyle?: string;
  jambSize?: string;
  material?: string;
  fireRating?: string;
  hardwareFinish?: string;
}

function parseFloat_safe(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
}

function mapCategory(category: string): string {
  // Map legacy category names to normalized forms
  if (category === 'SERVICE') return 'Service';
  return category;
}

function calculateMinMargin(marginPct: number): number {
  // margin_pct is already in percentage form (e.g., 50 for 50%)
  // Convert to decimal and apply floor of 0.25
  if (marginPct <= 0) return 0.25;
  const decimal = marginPct / 100;
  return Math.min(decimal, 0.25) === 0.25 ? 0.25 : decimal;
}

function parseProductAttributes(name: string): ParsedAttributes {
  const attrs: ParsedAttributes = {};

  // doorSize: match patterns like "2068", "2868", "3068", "2080", "2480", etc.
  // Look for 4-digit numbers that follow the pattern of typical door heights
  const doorSizeMatch = name.match(/\b(20\d{2}|28\d{2}|30\d{2}|32\d{2}|36\d{2})\b/);
  if (doorSizeMatch) {
    attrs.doorSize = doorSizeMatch[1];
  }

  // handing: match "LH", "RH", "LHIS", "RHIS" as whole words (case-insensitive)
  const handingMatch = name.match(/\b(LH|RH|LHIS|RHIS)\b/i);
  if (handingMatch) {
    attrs.handing = handingMatch[1].toUpperCase();
  }

  // coreType: "HC" or "H/C" → "Hollow", "SC" or "S/C" → "Solid"
  const coreMatch = name.match(/\b(H\/C|HC|S\/C|SC)\b/i);
  if (coreMatch) {
    const core = coreMatch[1].toUpperCase().replace('/', '');
    attrs.coreType = core === 'HC' ? 'Hollow' : core === 'SC' ? 'Solid' : undefined;
  }

  // panelStyle: "6 Panel", "2 Panel", "1 Panel", "5 Panel", "Shaker", "Flat"
  const panelMatch = name.match(/\b(6\s?Panel|2\s?Panel|1\s?Panel|5\s?Panel|Shaker|Flat)\b/i);
  if (panelMatch) {
    const panel = panelMatch[1].toLowerCase().replace(/\s+/g, ' ');
    if (panel.includes('panel')) {
      attrs.panelStyle = panel.charAt(0).toUpperCase() + panel.slice(1);
    } else {
      attrs.panelStyle = panelMatch[1];
    }
  }

  // jambSize: match "4-5/8", "4-9/16", "6-9/16"
  const jambMatch = name.match(/\b(\d+-\d+\/\d+)\b/);
  if (jambMatch) {
    attrs.jambSize = jambMatch[1];
  }

  // material: "MDF", "Pine", "FJ" (finger-joint), "Primed", "Oak", "Poplar"
  const materialPatterns = ['MDF', 'Pine', 'FJ', 'Primed', 'Oak', 'Poplar'];
  for (const mat of materialPatterns) {
    if (new RegExp(`\\b${mat}\\b`, 'i').test(name)) {
      attrs.material = mat;
      break; // Take first match
    }
  }

  // fireRating: "20 MIN" or "20MIN" → "20min", "45 MIN" → "45min"
  const fireMatch = name.match(/\b(\d+)\s?MIN(S)?\b/i);
  if (fireMatch) {
    attrs.fireRating = `${fireMatch[1]}min`;
  }

  // hardwareFinish: " SN " or "SN " → "SN", " BLK " → "BLK", " ORB " → "ORB"
  const finishMatch = name.match(/\b(SN|BLK|ORB)\b/i);
  if (finishMatch) {
    attrs.hardwareFinish = finishMatch[1].toUpperCase();
  }

  return attrs;
}

async function seedProducts() {
  console.log('Starting product seed...');

  const filePath = '/sessions/charming-compassionate-bell/brain_export/products.jsonl';
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let totalProcessed = 0;
  let totalWithAttributes = 0;
  let batch: Array<{
    sku: string;
    data: any;
  }> = [];
  const BATCH_SIZE = 100;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      const productData: ProductData = entry.data;

      if (!productData.sku || !productData.name) {
        console.warn('Skipping entry with missing sku or name:', entry.id);
        continue;
      }

      // Parse attributes from product name
      const attributes = parseProductAttributes(productData.name);
      const hasAttributes = Object.keys(attributes).length > 0;

      const cost = parseFloat_safe(productData.cost);
      const basePrice = parseFloat_safe(productData.price);
      const minMargin = calculateMinMargin(productData.margin_pct);

      batch.push({
        sku: productData.sku,
        data: {
          sku: productData.sku,
          name: productData.name,
          displayName: productData.name,
          category: mapCategory(productData.category),
          cost,
          basePrice,
          minMargin,
          active: productData.active ?? true,
          doorSize: attributes.doorSize,
          handing: attributes.handing,
          coreType: attributes.coreType,
          panelStyle: attributes.panelStyle,
          jambSize: attributes.jambSize,
          material: attributes.material,
          fireRating: attributes.fireRating,
          hardwareFinish: attributes.hardwareFinish,
        },
      });

      if (hasAttributes) {
        totalWithAttributes++;
      }

      if (batch.length >= BATCH_SIZE) {
        await processBatch(batch);
        totalProcessed += batch.length;
        console.log(`Processed ${totalProcessed} products...`);
        batch = [];
      }
    } catch (error) {
      console.error('Error parsing line:', error, 'Line:', line.substring(0, 100));
    }
  }

  // Process remaining batch
  if (batch.length > 0) {
    await processBatch(batch);
    totalProcessed += batch.length;
  }

  console.log(
    `✓ Seeded ${totalProcessed} products (${totalWithAttributes} with door attributes parsed)`
  );
  await prisma.$disconnect();
}

async function processBatch(
  batch: Array<{
    sku: string;
    data: any;
  }>
) {
  const operations = batch.map((item) =>
    prisma.product.upsert({
      where: { sku: item.sku },
      update: item.data,
      create: item.data,
    })
  );

  await Promise.all(operations);
}

seedProducts()
  .catch((error) => {
    console.error('Seed error:', error);
    process.exit(1);
  });
