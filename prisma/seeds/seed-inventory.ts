import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const prisma = new PrismaClient();

interface StockLevelData {
  sku: string;
  product: string;
  location?: string;
  quantity: number;
  type: 'stock_level' | string;
}

interface InventoryRecord {
  data: StockLevelData;
  [key: string]: unknown;
}

async function seedInventory() {
  console.log('Starting inventory seed...');

  // Read products_inventory.jsonl
  const filePath = resolve(__dirname, '../../brain_export/products_inventory.jsonl');
  let records: InventoryRecord[] = [];

  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    records = fileContent
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (error) {
    console.error(`Error reading file: ${filePath}`, error);
    process.exit(1);
  }

  // Filter to stock_level entries only
  const stockLevelRecords = records.filter((r) => r.data?.type === 'stock_level');
  console.log(
    `Found ${stockLevelRecords.length} stock_level records (out of ${records.length} total)`
  );

  let seeded = 0;
  let inStock = 0;
  let outOfStock = 0;
  let skipped = 0;
  const batchSize = 100;

  // Process in batches
  for (let i = 0; i < stockLevelRecords.length; i += batchSize) {
    const batch = stockLevelRecords.slice(i, i + batchSize);

    for (const record of batch) {
      const stockData = record.data as StockLevelData;
      const sku = stockData.sku;
      const quantity = Math.floor(stockData.quantity);

      // Look up product by SKU
      const product = await prisma.product.findUnique({
        where: { sku },
        select: { id: true, category: true, cost: true },
      });

      if (!product) {
        console.warn(`  ⚠️ Product not found for SKU: ${sku}`);
        skipped++;
        continue;
      }

      // Determine status
      const status = quantity > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK';

      // Upsert inventory item
      await prisma.inventoryItem.upsert({
        where: { productId: product.id },
        update: {
          sku,
          productName: stockData.product,
          category: product.category,
          onHand: quantity,
          committed: 0,
          onOrder: 0,
          available: quantity,
          location: stockData.location || 'MAIN_WAREHOUSE',
          warehouseZone: null,
          unitCost: product.cost || 0,
          status,
          reorderPoint: 5,
          safetyStock: 5,
        },
        create: {
          productId: product.id,
          sku,
          productName: stockData.product,
          category: product.category,
          onHand: quantity,
          committed: 0,
          onOrder: 0,
          available: quantity,
          location: stockData.location || 'MAIN_WAREHOUSE',
          warehouseZone: null,
          unitCost: product.cost || 0,
          status,
          reorderPoint: 5,
          safetyStock: 5,
        },
      });

      seeded++;
      if (status === 'IN_STOCK') {
        inStock++;
      } else {
        outOfStock++;
      }
    }

    const processed = Math.min(i + batchSize, stockLevelRecords.length);
    console.log(`  Processed ${processed}/${stockLevelRecords.length} records...`);
  }

  console.log(
    `\n✓ Seeded ${seeded} inventory items (${inStock} in stock, ${outOfStock} out of stock), ${skipped} skipped (product not found)`
  );

  await prisma.$disconnect();
}

seedInventory().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
