#!/usr/bin/env node
/**
 * Abel Lumber — Import Historical Purchase Orders from InFlow
 *
 *   node scripts/import-purchase-orders.mjs
 *
 * Reads:    ../In Flow Exports/inFlow_PurchaseOrder (N).csv  (latest)
 * Requires: Vendors + Products + Staff already seeded (run-all-imports.mjs)
 *
 * Input is one row per line-item. We group by OrderNumber to build
 * PurchaseOrder header + children PurchaseOrderItem rows.
 *
 * Idempotent: upserts PurchaseOrder by poNumber, wipes + rebuilds items.
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import {
  INFLOW_PATH, readCSV, findFile,
  parseMoney, parseIntSafe, parseDate, vendorCodeFromName,
} from './_brain-helpers.mjs';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function mapStatus(inv, pay) {
  const i = (inv || '').toLowerCase();
  const p = (pay || '').toLowerCase();
  if (i.includes('fulfilled')) return 'RECEIVED';
  if (i.includes('partial')) return 'PARTIALLY_RECEIVED';
  if (i.includes('unfulfilled') && p.includes('paid')) return 'APPROVED';
  if (i.includes('unfulfilled')) return 'SENT_TO_VENDOR';
  if (i.includes('cancel')) return 'CANCELLED';
  return 'DRAFT';
}

async function main() {
  console.log('\n📦 IMPORTING HISTORICAL PURCHASE ORDERS');
  console.log('━'.repeat(60));

  const fname = findFile(INFLOW_PATH, 'inFlow_PurchaseOrder');
  if (!fname) { console.error('❌ No inFlow_PurchaseOrder CSV found in', INFLOW_PATH); process.exit(1); }
  const fullPath = path.join(INFLOW_PATH, fname);
  console.log(`📄 Reading ${fname}`);

  const { rows } = readCSV(fullPath);
  console.log(`   ${rows.length.toLocaleString()} line-item rows`);

  // ── Preload lookups ────────────────────────────────────────────
  const vendors = await prisma.vendor.findMany({ select: { id: true, code: true, name: true } });
  const vendorByCode = new Map(vendors.map(v => [v.code, v.id]));
  const vendorByName = new Map(vendors.map(v => [v.name.toUpperCase().trim(), v.id]));

  const products = await prisma.product.findMany({ select: { id: true, sku: true } });
  const productBySku = new Map(products.map(p => [(p.sku || '').toUpperCase().trim(), p.id]));

  const systemStaff = await prisma.staff.findUnique({ where: { email: 'n.barrett@abellumber.com' } })
    || await prisma.staff.findFirst();
  if (!systemStaff) { console.error('❌ No Staff found. Run run-all-imports.mjs first.'); process.exit(1); }

  // ── Group line items by OrderNumber ────────────────────────────
  const grouped = new Map();
  for (const r of rows) {
    const po = r.OrderNumber?.trim();
    if (!po) continue;
    if (!grouped.has(po)) grouped.set(po, { header: r, items: [] });
    grouped.get(po).items.push(r);
  }
  console.log(`   ${grouped.size.toLocaleString()} unique POs`);

  // ── Ingest ─────────────────────────────────────────────────────
  let okPO = 0, skippedNoVendor = 0, linesIn = 0, linesSkipped = 0, errors = 0;
  const unknownVendors = new Set();

  for (const [poNumber, { header, items }] of grouped) {
    const vendorName = (header.Vendor || '').trim();
    if (!vendorName) { skippedNoVendor++; continue; }

    let vendorId = vendorByName.get(vendorName.toUpperCase());
    if (!vendorId) vendorId = vendorByCode.get(vendorCodeFromName(vendorName));

    if (!vendorId) {
      // Auto-create missing vendor so no PO is lost
      if (DRY_RUN) { unknownVendors.add(vendorName); skippedNoVendor++; continue; }
      try {
        const newVendor = await prisma.vendor.upsert({
          where: { code: vendorCodeFromName(vendorName) },
          update: {},
          create: {
            code: vendorCodeFromName(vendorName),
            name: vendorName,
            contactName: header.ContactName || null,
            email: header.Email || null,
            phone: header.Phone || null,
            address: [header.VendorAddress1, header.VendorCity, header.VendorState, header.VendorPostalCode]
              .filter(Boolean).join(', ') || null,
            isActive: true,
          },
        });
        vendorId = newVendor.id;
        vendorByName.set(vendorName.toUpperCase(), vendorId);
        vendorByCode.set(newVendor.code, vendorId);
        unknownVendors.add(vendorName);
      } catch (e) {
        errors++; continue;
      }
    }

    // Assemble line items
    const itemPayload = [];
    let subtotal = 0;
    for (const it of items) {
      const qty = parseIntSafe(it.ProductQuantity);
      if (qty <= 0 && !it.ProductName && !it.ProductSKU) { linesSkipped++; continue; }
      const unit = parseMoney(it.ProductUnitPrice);
      const lineTotal = parseMoney(it.ProductSubtotal) || (qty * unit);
      const sku = (it.ProductSKU || '').trim();
      const productId = productBySku.get(sku.toUpperCase()) || null;
      itemPayload.push({
        productId,
        vendorSku: it.VendorProductCode || sku || 'UNKNOWN',
        description: it.ProductName || it.ProductDescription || sku || 'Line item',
        quantity: qty || 1,
        unitCost: unit,
        lineTotal,
      });
      subtotal += lineTotal;
      linesIn++;
    }
    if (itemPayload.length === 0) continue;

    const shipping = parseMoney(header.Freight);
    const total = subtotal + shipping;
    const status = mapStatus(header.InventoryStatus, header.PaymentStatus);

    if (DRY_RUN) { okPO++; continue; }

    try {
      const po = await prisma.purchaseOrder.upsert({
        where: { poNumber },
        update: {
          vendorId,
          status,
          subtotal,
          shippingCost: shipping,
          total,
          orderedAt: parseDate(header.OrderDate),
          expectedDate: parseDate(header.DueDate) || parseDate(header.RequestedShipDate),
          receivedAt: status === 'RECEIVED' ? parseDate(header.DueDate) : null,
          notes: header.OrderRemarks || null,
        },
        create: {
          poNumber,
          vendorId,
          createdById: systemStaff.id,
          status,
          subtotal,
          shippingCost: shipping,
          total,
          orderedAt: parseDate(header.OrderDate),
          expectedDate: parseDate(header.DueDate) || parseDate(header.RequestedShipDate),
          receivedAt: status === 'RECEIVED' ? parseDate(header.DueDate) : null,
          notes: header.OrderRemarks || null,
        },
      });
      // Replace items (idempotent reimport)
      await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: po.id } });
      await prisma.purchaseOrderItem.createMany({
        data: itemPayload.map(i => ({ ...i, purchaseOrderId: po.id })),
      });
      okPO++;
      if (okPO % 500 === 0) console.log(`   …${okPO.toLocaleString()} POs loaded`);
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`   ⚠️  ${poNumber}: ${e.message}`);
    }
  }

  console.log('\n✅ PURCHASE ORDER IMPORT COMPLETE');
  console.log(`   POs loaded:        ${okPO.toLocaleString()}`);
  console.log(`   Line items loaded: ${linesIn.toLocaleString()}`);
  console.log(`   Lines skipped:     ${linesSkipped.toLocaleString()}`);
  console.log(`   PO errors:         ${errors}`);
  console.log(`   Skipped (no vend): ${skippedNoVendor}`);
  if (unknownVendors.size) {
    console.log(`   New vendors auto-created: ${unknownVendors.size}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
