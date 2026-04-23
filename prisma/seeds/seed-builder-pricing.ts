import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as readline from 'readline';

const prisma = new PrismaClient();

interface ProductData {
  sku: string;
  builder_prices?: Record<string, string>;
  cost?: string | number;
}

/**
 * Build a fuzzy builder name matcher
 * Maps builder keys (like "AGD", "PULTE") to actual Builder.companyName values
 */
function buildBuilderLookup(builders: Array<{ id: string; companyName: string }>): Map<string, string> {
  const lookup = new Map<string, string>();

  // For each builder, create multiple lookup keys:
  // 1. First word uppercase (e.g., "PULTE" from "Pulte")
  // 2. Full name uppercase (e.g., "PULTE HOMES" from "Pulte Homes")
  // 3. Exact uppercase (case-insensitive match later)

  for (const builder of builders) {
    const companyUpper = builder.companyName.toUpperCase();
    lookup.set(companyUpper, builder.id);

    // Also add first word variant
    const firstWord = builder.companyName.split(/\s+/)[0].toUpperCase();
    if (!lookup.has(firstWord)) {
      lookup.set(firstWord, builder.id);
    }
  }

  return lookup;
}

/**
 * Try to match a builder key (e.g., "AGD", "BROOKFIELD") to a Builder ID
 */
function findBuilderId(
  builderKey: string,
  builderLookup: Map<string, string>,
  builders: Array<{ id: string; companyName: string }>
): string | null {
  const keyUpper = builderKey.toUpperCase().trim();

  // Direct lookup first
  if (builderLookup.has(keyUpper)) {
    return builderLookup.get(keyUpper) || null;
  }

  // Fuzzy match: check if key is contained in any builder name
  for (const builder of builders) {
    const companyUpper = builder.companyName.toUpperCase();
    if (companyUpper.includes(keyUpper) || keyUpper.includes(companyUpper.split(/\s+/)[0])) {
      return builder.id;
    }
  }

  return null;
}

function parseFloat_safe(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Calculate margin as (customPrice - cost) / customPrice
 * Returns 0 if customPrice is 0
 */
function calculateMargin(customPrice: number, cost: number): number {
  if (customPrice === 0) return 0;
  return (customPrice - cost) / customPrice;
}

async function seedBuilderPricing() {
  console.log('Starting builder pricing seed...');

  // Load all builders into memory
  console.log('Loading builders from database...');
  const builders = await prisma.builder.findMany({
    select: { id: true, companyName: true },
  });
  console.log(`Loaded ${builders.length} builders`);

  const builderLookup = buildBuilderLookup(builders);

  const filePath = '/sessions/charming-compassionate-bell/brain_export/products.jsonl';
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let totalProcessed = 0;
  let totalCreated = 0;
  let totalBuilders = 0;
  let totalProducts = 0;
  let buildersSet = new Set<string>();
  let productsSet = new Set<string>();

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);
      const productData: ProductData = entry.data;

      totalProcessed++;

      if (!productData.sku || !productData.builder_prices) {
        if ((totalProcessed) % 500 === 0) {
          console.log(`  Processed ${totalProcessed} products...`);
        }
        continue;
      }

      const builderPrices = productData.builder_prices;
      if (Object.keys(builderPrices).length === 0) {
        if ((totalProcessed) % 500 === 0) {
          console.log(`  Processed ${totalProcessed} products...`);
        }
        continue;
      }

      // Look up product by SKU
      const product = await prisma.product.findUnique({
        where: { sku: productData.sku },
        select: { id: true, cost: true },
      });

      if (!product) {
        if ((totalProcessed) % 500 === 0) {
          console.log(`  Processed ${totalProcessed} products...`);
        }
        continue;
      }

      // Process each builder price
      for (const [builderKey, priceStr] of Object.entries(builderPrices)) {
        const customPrice = parseFloat_safe(priceStr);

        // Skip zero prices
        if (customPrice <= 0) {
          continue;
        }

        const builderId = findBuilderId(builderKey, builderLookup, builders);
        if (!builderId) {
          // Builder not found, skip
          continue;
        }

        const cost = parseFloat_safe(product.cost);
        const margin = calculateMargin(customPrice, cost);

        // Upsert on composite key [builderId, productId]
        await prisma.builderPricing.upsert({
          where: {
            builderId_productId: {
              builderId,
              productId: product.id,
            },
          },
          update: {
            customPrice,
            margin,
          },
          create: {
            builderId,
            productId: product.id,
            customPrice,
            margin,
          },
        });

        totalCreated++;
        buildersSet.add(builderId);
        productsSet.add(product.id);
      }

      if ((totalProcessed) % 500 === 0) {
        console.log(`  Processed ${totalProcessed} products...`);
      }
    } catch (error) {
      console.error('Error parsing line:', error, 'Line:', line.substring(0, 100));
    }
  }

  totalBuilders = buildersSet.size;
  totalProducts = productsSet.size;

  console.log('\n--- Seed Complete ---');
  console.log(
    `Created ${totalCreated} builder-pricing records across ${totalBuilders} builders and ${totalProducts} products`
  );

  await prisma.$disconnect();
}

seedBuilderPricing().catch((error) => {
  console.error('Seed error:', error);
  process.exit(1);
});
