#!/usr/bin/env node
/**
 * Abel Lumber — Full Sales Order Reimport from InFlow CSV Exports
 *
 * PROBLEM: Only 443 orders ($866K) were imported from a partial Q1 2026 export.
 * The complete InFlow data has 3,500+ orders totaling $6.7M+ (non-cancelled).
 *
 * This script:
 *   1. Reads the master InFlow SO export (file 3 — all-time, May 2024 – Mar 2026)
 *   2. Merges in newer March 2026 data (file 4 — latest export)
 *   3. Auto-creates Builder records for any unmatched InFlow customers
 *   4. Upserts all orders by orderNumber (idempotent — safe to re-run)
 *   5. Creates OrderItems linked to products by SKU
 *   6. Maps statuses correctly: InventoryStatus → OrderStatus, PaymentStatus → PaymentStatus
 *
 * Usage:
 *   node scripts/reimport-all-sales-orders.mjs              # full run
 *   node scripts/reimport-all-sales-orders.mjs --dry-run    # preview only
 *
 * Requires: DATABASE_URL env var set (or .env file in project root)
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// ─── CSV PATHS ──────────────────────────────────────────────────────
// Master export: comprehensive all-time InFlow SO data
// (file 20 supersedes files 3 and 4 — it contains everything through today)
const MASTER_CSV = 'C:/Users/natha/Downloads/inFlow_SalesOrder (20).csv';
// Legacy files kept as fallback only (used only if master missing)
const LATEST_CSV = path.join(ABEL_FOLDER, 'Downlods', 'Downloads', 'inFlow_SalesOrder (4).csv');

// ─── CSV PARSER ─────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < (line || '').length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function readCSV(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

  // Handle multi-line quoted fields
  const logicalLines = [];
  let currentLine = '';
  let inQuotes = false;

  for (const rawLine of content.split('\n')) {
    if (!currentLine && !rawLine.trim()) continue;
    currentLine = currentLine ? currentLine + '\n' + rawLine : rawLine;

    // Count quotes to track if we're inside a quoted field
    for (let i = (currentLine.length - rawLine.length - (currentLine.length > rawLine.length ? 1 : 0)); i < currentLine.length; i++) {
      if (i < 0) i = 0;
      if (currentLine[i] === '"') inQuotes = !inQuotes;
    }

    if (!inQuotes) {
      if (currentLine.trim()) logicalLines.push(currentLine);
      currentLine = '';
    }
  }
  if (currentLine.trim()) logicalLines.push(currentLine);

  const headers = parseCSVLine(logicalLines[0]);
  const rows = [];
  for (let i = 1; i < logicalLines.length; i++) {
    const values = parseCSVLine(logicalLines[i]);
    if (values.length < headers.length / 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

function parseMoney(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
}

function parseDate(val) {
  if (!val || !val.trim()) return null;
  try {
    const d = new Date(val.trim());
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function generateEmailSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') + '@builder.abellumber.com';
}

function mapPaymentTerm(term) {
  if (!term) return 'NET_15';
  const t = term.toLowerCase().trim();
  if (t.includes('pay at order') || t.includes('cod')) return 'PAY_AT_ORDER';
  if (t.includes('delivery')) return 'PAY_ON_DELIVERY';
  if (t.includes('due on receipt')) return 'PAY_ON_DELIVERY';
  if (t.includes('net 30')) return 'NET_30';
  if (t.includes('net 15')) return 'NET_15';
  return 'NET_15';
}

// ─── STATUS MAPPING ─────────────────────────────────────────────────
function mapOrderStatus(invStatus, isCancelled) {
  if (isCancelled === 'True') return 'CANCELLED';
  const s = (invStatus || '').toLowerCase();
  if (s === 'fulfilled') return 'DELIVERED';
  if (s.includes('partial')) return 'IN_PRODUCTION';
  if (s === 'started') return 'CONFIRMED';
  if (s === 'unfulfilled') return 'RECEIVED';
  if (s === 'quote') return 'RECEIVED'; // Include quotes as pending orders
  return 'RECEIVED';
}

function mapPaymentStatus(payStatus, isQuote) {
  if (isQuote === 'True') return 'PENDING';
  const p = (payStatus || '').toLowerCase();
  if (p === 'paid') return 'PAID';
  if (p === 'invoiced') return 'INVOICED';
  if (p.includes('partial')) return 'INVOICED';
  if (p === 'owing' || p === 'overdue') return 'OVERDUE';
  return 'PENDING';
}

// ─── MAIN ───────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  ABEL OS — FULL INFLOW SALES ORDER REIMPORT');
  console.log('═'.repeat(70));
  if (DRY_RUN) console.log('  *** DRY RUN — no changes will be written ***\n');

  // ── Step 1: Read and merge CSV files ──────────────────────────────
  console.log('\n📄 Reading CSV exports...');

  if (!fs.existsSync(MASTER_CSV)) {
    console.error(`❌ Master CSV not found: ${MASTER_CSV}`);
    process.exit(1);
  }

  const master = readCSV(MASTER_CSV);
  console.log(`   Master (file 3): ${master.rows.length} line-item rows`);

  let latestRows = [];
  if (fs.existsSync(LATEST_CSV)) {
    const latest = readCSV(LATEST_CSV);
    latestRows = latest.rows;
    console.log(`   Latest (file 4): ${latest.rows.length} line-item rows`);
  }

  // Group all rows by OrderNumber, preferring latest data
  const orderGroups = new Map();

  // Load master first
  for (const row of master.rows) {
    const orderNum = row['OrderNumber']?.trim();
    if (!orderNum) continue;
    // Only include SO-XXXXX format orders (skip PLAN entries, etc.)
    if (!orderNum.startsWith('SO-')) continue;
    if (!orderGroups.has(orderNum)) orderGroups.set(orderNum, []);
    orderGroups.get(orderNum).push(row);
  }

  // Overlay latest export (updates existing, adds new)
  let latestNewOrders = 0;
  for (const row of latestRows) {
    const orderNum = row['OrderNumber']?.trim();
    if (!orderNum || !orderNum.startsWith('SO-')) continue;
    if (!orderGroups.has(orderNum)) {
      latestNewOrders++;
      orderGroups.set(orderNum, []);
    } else {
      // Replace with newer data
      orderGroups.set(orderNum, []);
    }
    orderGroups.get(orderNum).push(row);
  }

  console.log(`   Merged: ${orderGroups.size} unique SO orders`);
  if (latestNewOrders > 0) console.log(`   ${latestNewOrders} new orders from latest export`);

  // ── Step 2: Load lookup tables ────────────────────────────────────
  console.log('\n🔍 Loading lookup tables...');

  const builders = await prisma.builder.findMany({ select: { id: true, companyName: true } });
  const builderMap = new Map();
  for (const b of builders) {
    builderMap.set(b.companyName.toLowerCase().trim(), b.id);
  }
  console.log(`   ${builders.length} builders in DB`);

  const products = await prisma.product.findMany({ select: { id: true, sku: true } });
  const skuMap = new Map();
  for (const p of products) {
    if (p.sku) skuMap.set(p.sku.toUpperCase().trim(), p.id);
  }
  console.log(`   ${products.length} products in DB`);

  // Default staff for order creation
  const systemStaff = await prisma.staff.findFirst({ where: { email: 'n.barrett@abellumber.com' } })
    || await prisma.staff.findFirst();

  // ── Step 3: Process orders ────────────────────────────────────────
  console.log('\n📦 Processing orders...');

  let created = 0, updated = 0, skipped = 0, builderCreated = 0, itemsCreated = 0;
  const errors = [];
  const newBuilders = new Set();

  // Hash for new builder passwords
  const passwordHash = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex');

  let processed = 0;
  const total = orderGroups.size;

  for (const [orderNum, orderRows] of orderGroups) {
    processed++;
    if (processed % 200 === 0) {
      console.log(`   ... ${processed}/${total} (${created} created, ${updated} updated)`);
    }

    try {
      const firstRow = orderRows[0];
      const customerName = firstRow['Customer']?.trim();
      const isCancelled = firstRow['IsCancelled']?.trim();

      // Skip cancelled orders
      if (isCancelled === 'True') { skipped++; continue; }

      // Find or create builder
      let builderId;
      if (customerName) {
        // Exact match
        builderId = builderMap.get(customerName.toLowerCase().trim());

        // Partial match
        if (!builderId) {
          const custLower = customerName.toLowerCase().trim();
          for (const [name, id] of builderMap) {
            if (name.includes(custLower) || custLower.includes(name)) {
              builderId = id;
              break;
            }
          }
        }

        // Auto-create builder if not found
        if (!builderId && !DRY_RUN) {
          const loginEmail = generateEmailSlug(customerName);
          const phone = firstRow['Phone']?.trim() || null;

          try {
            const newBuilder = await prisma.builder.create({
              data: {
                companyName: customerName,
                email: loginEmail,
                passwordHash,
                contactName: firstRow['ContactName']?.trim() || customerName,
                phone,
                status: 'ACTIVE',
                paymentTerm: mapPaymentTerm(firstRow['PaymentTerms']?.trim()),
              },
            });
            builderId = newBuilder.id;
            builderMap.set(customerName.toLowerCase().trim(), builderId);
            builderCreated++;
            newBuilders.add(customerName);
          } catch (e) {
            // Might already exist (race condition or unique constraint)
            const existingArr = await prisma.$queryRawUnsafe(
              `SELECT id FROM "Builder" WHERE LOWER("companyName") = LOWER($1) LIMIT 1`,
              customerName
            );
            const existing = existingArr[0];
            if (existing) {
              builderId = existing.id;
              builderMap.set(customerName.toLowerCase().trim(), builderId);
            } else {
              errors.push(`${orderNum}: Failed to create builder "${customerName}": ${e.message}`);
              skipped++;
              continue;
            }
          }
        } else if (!builderId && DRY_RUN) {
          newBuilders.add(customerName);
          skipped++;
          continue;
        }
      }

      if (!builderId) {
        errors.push(`${orderNum}: No customer name`);
        skipped++;
        continue;
      }

      // Map statuses
      const orderStatus = mapOrderStatus(firstRow['InventoryStatus']?.trim(), isCancelled);
      const paymentStatus = mapPaymentStatus(firstRow['PaymentStatus']?.trim(), firstRow['IsQuote']?.trim());

      // Parse dates
      const orderDate = parseDate(firstRow['OrderDate']) || new Date();
      const invoicedDate = parseDate(firstRow['InvoicedDate']);
      const dueDate = parseDate(firstRow['DueDate']);
      const datePaid = parseDate(firstRow['DatePaid']);

      // Parse amount paid
      const amountPaid = parseMoney(firstRow['AmountPaid']);

      // Build line items
      const lineItems = [];
      let subtotal = 0;

      for (const row of orderRows) {
        const productSku = row['ProductSKU']?.trim();
        const productName = row['ProductName']?.trim();
        if (!productName && !productSku) continue;

        const qty = Math.round(parseFloat(row['ProductQuantity'] || '1') || 1);
        const unitPrice = parseMoney(row['ProductUnitPrice']);
        const rawSubtotal = parseMoney(row['ProductSubtotal']);
        const lineTotal = rawSubtotal !== 0 ? rawSubtotal : qty * unitPrice;

        const productId = productSku ? (skuMap.get(productSku.toUpperCase().trim()) || null) : null;

        lineItems.push({
          productId: productId || undefined,
          description: productName || productSku || 'Unknown item',
          quantity: qty,
          unitPrice,
          lineTotal,
        });

        subtotal += lineTotal;
      }

      if (lineItems.length === 0) { skipped++; continue; }

      // Calculate tax and total
      const taxRate = parseFloat(firstRow['Tax1Rate'] || '0') || 0;
      const taxAmount = subtotal * (taxRate / 100);
      const freight = parseMoney(firstRow['Freight']);
      const total = subtotal + taxAmount + freight;

      if (DRY_RUN) {
        created++;
        continue;
      }

      // Check if order exists
      const existing = await prisma.order.findUnique({ where: { orderNumber: orderNum } });

      if (existing) {
        // Clamp deliveryDate to never precede orderDate
        let updatedDelivery = orderStatus === 'DELIVERED' ? (invoicedDate || orderDate) : existing.deliveryDate;
        if (updatedDelivery && orderDate && updatedDelivery < orderDate) updatedDelivery = orderDate;
        const isForecast = orderDate > new Date();

        // Update existing: refresh status, payment info, amounts, and dates
        await prisma.order.update({
          where: { id: existing.id },
          data: {
            status: orderStatus,
            paymentStatus,
            subtotal,
            taxAmount,
            shippingCost: freight,
            total,
            paidAt: datePaid || undefined,
            dueDate: dueDate || undefined,
            paymentTerm: mapPaymentTerm(firstRow['PaymentTerms']?.trim()),
            deliveryDate: updatedDelivery,
            deliveryNotes: firstRow['ShippingAddressRemarks']?.trim() || firstRow['Delivery Location']?.trim() || existing.deliveryNotes,
            orderDate,
            isForecast,
          },
        });
        updated++;
      } else {
        // Create new order with items
        const validItems = lineItems.filter(item => item.productId);
        // Also include items without productId — use description-only
        const allItems = lineItems.map(item => ({
          ...item,
          productId: item.productId || undefined,
        }));

        // Only create items that have productId (FK constraint)
        const creatableItems = validItems;

        // Clamp deliveryDate to never precede orderDate (data-entry order issue)
        let rawDelivery = orderStatus === 'DELIVERED' ? (invoicedDate || orderDate) : undefined;
        if (rawDelivery && orderDate && rawDelivery < orderDate) rawDelivery = orderDate;
        const isForecast = orderDate > new Date();

        try {
          await prisma.order.create({
            data: {
              builderId,
              orderNumber: orderNum,
              poNumber: firstRow['PONumber']?.trim() || null,
              subtotal,
              taxAmount,
              shippingCost: freight,
              total,
              paymentTerm: mapPaymentTerm(firstRow['PaymentTerms']?.trim()),
              paymentStatus,
              paidAt: datePaid || undefined,
              dueDate: dueDate || undefined,
              status: orderStatus,
              deliveryDate: rawDelivery,
              deliveryNotes: firstRow['ShippingAddressRemarks']?.trim() || firstRow['Delivery Location']?.trim() || null,
              items: {
                create: creatableItems,
              },
              createdAt: orderDate,
              orderDate,
              isForecast,
            },
          });
          created++;
          itemsCreated += creatableItems.length;
        } catch (e) {
          errors.push(`${orderNum}: ${e.message?.substring(0, 120)}`);
        }
      }
    } catch (err) {
      errors.push(`${orderNum}: ${err.message?.substring(0, 120)}`);
    }
  }

  // ── Step 4: Summary ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(70));
  console.log('  RESULTS');
  console.log('─'.repeat(70));
  console.log(`  Orders created:    ${created}`);
  console.log(`  Orders updated:    ${updated}`);
  console.log(`  Orders skipped:    ${skipped} (cancelled or no data)`);
  console.log(`  Line items:        ${itemsCreated}`);
  console.log(`  Builders created:  ${builderCreated}`);
  if (newBuilders.size > 0) {
    console.log(`  New builders:`);
    for (const name of newBuilders) {
      console.log(`    → ${name}`);
    }
  }
  if (errors.length > 0) {
    console.log(`\n  ⚠️  ${errors.length} errors:`);
    for (const e of errors.slice(0, 20)) {
      console.log(`    ${e}`);
    }
    if (errors.length > 20) console.log(`    ... and ${errors.length - 20} more`);
  }

  // Final DB stats
  const orderCount = await prisma.order.count();
  const nonCancelledRev = await prisma.$queryRawUnsafe(
    'SELECT COALESCE(SUM(total)::float8, 0) as total FROM "Order" WHERE status::text != \'CANCELLED\''
  );
  console.log(`\n  📊 DB now has ${orderCount} orders, $${Number(nonCancelledRev[0]?.total || 0).toLocaleString()} total revenue`);
  console.log('═'.repeat(70) + '\n');

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
