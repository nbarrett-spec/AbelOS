import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const prisma = new PrismaClient();

interface ProductData {
  sku: string;
  vendor?: string;
  vendor_price?: string;
}

interface ProductLine {
  data: ProductData;
}

async function seedVendorProducts() {
  console.log('Starting vendor-product seed...');

  const productsFile = path.join(
    __dirname,
    '../../..',
    'brain_export',
    'products.jsonl'
  );

  const fileStream = fs.createReadStream(productsFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let productCount = 0;
  let batchBuffer: Array<{
    vendorId: string;
    productId: string;
    vendorSku: string;
    vendorCost: number | null;
  }> = [];
  const BATCH_SIZE = 100;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const entry: ProductLine = JSON.parse(line);
      const { data } = entry;

      // Skip if no vendor is set
      if (!data.vendor || !data.vendor.trim()) {
        continue;
      }

      const vendorName = data.vendor.trim();

      // Look up vendor (case-insensitive)
      const vendor = await prisma.vendor.findFirst({
        where: { name: { mode: 'insensitive', equals: vendorName } },
        select: { id: true },
      });

      if (!vendor) {
        console.warn(`Vendor not found: ${vendorName} (skipping SKU ${data.sku})`);
        continue;
      }

      // Look up product by SKU
      const product = await prisma.product.findFirst({
        where: { sku: data.sku },
        select: { id: true },
      });

      if (!product) {
        console.warn(`Product not found: SKU ${data.sku} (skipping)`);
        continue;
      }

      // Parse vendor cost
      const vendorCost =
        data.vendor_price && data.vendor_price.trim()
          ? parseFloat(data.vendor_price)
          : null;

      // Add to batch
      batchBuffer.push({
        vendorId: vendor.id,
        productId: product.id,
        vendorSku: data.sku,
        vendorCost: vendorCost,
      });

      // Flush batch if at limit
      if (batchBuffer.length >= BATCH_SIZE) {
        await flushBatch(batchBuffer);
        productCount += batchBuffer.length;
        batchBuffer = [];
      }
    } catch (error) {
      console.error('Error processing product line:', line, error);
    }
  }

  // Flush remaining batch
  if (batchBuffer.length > 0) {
    await flushBatch(batchBuffer);
    productCount += batchBuffer.length;
  }

  console.log(`Linked ${productCount} products to vendors`);
  await prisma.$disconnect();
}

async function flushBatch(
  batch: Array<{
    vendorId: string;
    productId: string;
    vendorSku: string;
    vendorCost: number | null;
  }>
) {
  for (const item of batch) {
    await prisma.vendorProduct.upsert({
      where: {
        vendorId_productId: {
          vendorId: item.vendorId,
          productId: item.productId,
        },
      },
      update: {
        vendorSku: item.vendorSku,
        vendorCost: item.vendorCost,
        preferred: true,
      },
      create: {
        vendorId: item.vendorId,
        productId: item.productId,
        vendorSku: item.vendorSku,
        vendorCost: item.vendorCost,
        preferred: true,
      },
    });
  }
}

seedVendorProducts().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
