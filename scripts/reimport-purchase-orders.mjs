#!/usr/bin/env node
/**
 * Abel Lumber — Purchase Order reimport from InFlow CSV export
 *
 * Source: C:/Users/natha/Downloads/inFlow_PurchaseOrder (11).csv
 * Covers: Dec 31 2025 → Apr 20 2026 (910 unique POs; older POs not in InFlow)
 *
 * Behaviour:
 *   - Upserts by poNumber (idempotent)
 *   - Sets orderedAt = InFlow OrderDate
 *   - Sets source = 'INFLOW' so it can be distinguished from legacy seed
 *   - Resolves vendor by case-insensitive name match; prefers the vendor with
 *     the most existing POs when duplicates exist (vendor dedup is out of scope
 *     for this script — flagged separately).
 *   - Does NOT delete the 2321 existing LEGACY_SEED POs; they stay until a
 *     deliberate cleanup is authorized.
 *
 * Usage:
 *   node scripts/reimport-purchase-orders.mjs --dry-run
 *   node scripts/reimport-purchase-orders.mjs
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const PO_CSV = 'C:/Users/natha/Downloads/inFlow_PurchaseOrder (11).csv';
// Nate Barrett — attributed as createdBy for all imported POs (system import user)
const IMPORT_STAFF_ID = 'cmn0bsdf800005yk9sizrwc22';

// ─── CSV parsing (shared pattern with SO reimport) ─────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < (line || '').length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function readCSV(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const logicalLines = [];
  let currentLine = '';
  let inQuotes = false;
  for (const rawLine of content.split('\n')) {
    if (!currentLine && !rawLine.trim()) continue;
    currentLine = currentLine ? currentLine + '\n' + rawLine : rawLine;
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
  return { rows };
}

function parseMoney(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[^0-9.-]/g, '')) || 0;
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// InFlow InventoryStatus → POStatus
function mapPOStatus(invStatus, isCancelled) {
  if (isCancelled === 'True') return 'CANCELLED';
  const s = (invStatus || '').toLowerCase();
  if (s === 'fulfilled') return 'RECEIVED';
  if (s.includes('partial')) return 'PARTIALLY_RECEIVED';
  if (s === 'started' || s === 'unfulfilled') return 'SENT_TO_VENDOR';
  return 'SENT_TO_VENDOR';
}

// ─── MAIN ───────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('  ABEL OS — INFLOW PURCHASE ORDER REIMPORT');
  console.log('═'.repeat(70));
  if (DRY_RUN) console.log('  *** DRY RUN — no changes will be written ***\n');

  console.log('\n📄 Reading CSV...');
  const { rows } = readCSV(PO_CSV);
  console.log(`   Line-item rows: ${rows.length}`);

  // Group by OrderNumber
  const poGroups = new Map();
  for (const row of rows) {
    const num = row['OrderNumber']?.trim();
    if (!num || !num.startsWith('PO-')) continue;
    if (!poGroups.has(num)) poGroups.set(num, []);
    poGroups.get(num).push(row);
  }
  console.log(`   Unique POs: ${poGroups.size}`);

  // Load vendors with PO counts — dedup preference
  console.log('\n🔍 Loading vendor lookup (picking canonical for duplicates)...');
  const vendorRows = await prisma.$queryRawUnsafe(`
    SELECT v.id, v.name, COUNT(po.id)::int AS po_count
    FROM "Vendor" v
    LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v.id
    GROUP BY v.id, v.name
  `);
  // For each name (case-insensitive), pick vendor with most POs
  const vendorMap = new Map(); // nameLower -> id
  const nameGroups = new Map(); // nameLower -> [{id, name, po_count}]
  for (const v of vendorRows) {
    const key = v.name.toLowerCase().trim();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push(v);
  }
  for (const [key, vs] of nameGroups) {
    vs.sort((a, b) => b.po_count - a.po_count);
    vendorMap.set(key, vs[0].id);
  }
  console.log(`   ${vendorRows.length} vendors (${nameGroups.size} unique names)`);

  // Process POs
  console.log('\n📦 Processing POs...\n');
  let created = 0, updated = 0, skipped = 0, errors = [];
  let vendorsCreated = 0;
  let i = 0;

  for (const [poNum, poRows] of poGroups) {
    i++;
    try {
      const first = poRows[0];
      const vendorName = first['Vendor']?.trim();
      if (!vendorName) { skipped++; continue; }

      const isCancelled = first['IsCancelled'] === 'True';

      // Resolve vendor
      let vendorId = vendorMap.get(vendorName.toLowerCase().trim());

      if (!vendorId) {
        if (DRY_RUN) {
          // Track that we'd need to create it
          vendorMap.set(vendorName.toLowerCase().trim(), 'DRY_RUN_NEW');
          vendorsCreated++;
        } else {
          // Create vendor
          const code = vendorName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || 'VENDOR' + Math.random().toString(36).slice(2, 8).toUpperCase();
          const uniqueCode = code + '_' + Math.random().toString(36).slice(2, 5).toUpperCase();
          try {
            const v = await prisma.vendor.create({
              data: { name: vendorName, code: uniqueCode, active: true },
            });
            vendorId = v.id;
            vendorMap.set(vendorName.toLowerCase().trim(), vendorId);
            vendorsCreated++;
          } catch (e) {
            errors.push(`${poNum}: vendor create failed: ${e.message?.substring(0, 100)}`);
            skipped++;
            continue;
          }
        }
      }

      const orderDate = parseDate(first['OrderDate']);
      const dueDate = parseDate(first['DueDate']);
      const datePaid = parseDate(first['DatePaid']);
      const freight = parseMoney(first['Freight']);
      const status = mapPOStatus(first['InventoryStatus'], first['IsCancelled']);

      // Build line items (description-only; no FK to Product for now — safer)
      let subtotal = 0;
      const lineItems = [];
      for (const row of poRows) {
        const productName = row['ProductName']?.trim();
        const productSku = row['ProductSKU']?.trim();
        if (!productName && !productSku) continue;
        const qty = Math.max(1, Math.round(parseFloat(row['ProductQuantity'] || '1') || 1));
        const unitPrice = parseMoney(row['ProductUnitPrice']);
        const raw = parseMoney(row['ProductSubtotal']);
        const lineTotal = raw !== 0 ? raw : qty * unitPrice;
        subtotal += lineTotal;
        lineItems.push({
          vendorSku: productSku || 'UNSPECIFIED',
          description: productName || productSku || 'Unknown item',
          quantity: qty,
          unitCost: unitPrice,
          lineTotal,
        });
      }

      const total = subtotal + freight;

      if (DRY_RUN) { created++; continue; }

      if (vendorId === 'DRY_RUN_NEW') { skipped++; continue; }

      // Upsert by poNumber
      const existing = await prisma.purchaseOrder.findUnique({ where: { poNumber: poNum } });

      if (existing) {
        await prisma.purchaseOrder.update({
          where: { id: existing.id },
          data: {
            vendorId,
            status,
            subtotal,
            shippingCost: freight,
            total,
            orderedAt: orderDate || existing.orderedAt,
            source: 'INFLOW',
            notes: first['OrderRemarks']?.trim() || existing.notes,
          },
        });
        updated++;
      } else {
        try {
          await prisma.purchaseOrder.create({
            data: {
              poNumber: poNum,
              vendorId,
              createdById: IMPORT_STAFF_ID,
              status,
              subtotal,
              shippingCost: freight,
              total,
              orderedAt: orderDate,
              source: 'INFLOW',
              notes: first['OrderRemarks']?.trim() || null,
              createdAt: orderDate || new Date(),
              items: {
                create: lineItems.map(li => ({
                  vendorSku: li.vendorSku,
                  description: li.description,
                  quantity: li.quantity,
                  unitCost: li.unitCost,
                  lineTotal: li.lineTotal,
                })),
              },
            },
          });
          created++;
        } catch (e) {
          errors.push(`${poNum}: ${e.message?.substring(0, 150)}`);
        }
      }

      if (i % 100 === 0) console.log(`   ... ${i}/${poGroups.size} (${created} created, ${updated} updated)`);
    } catch (e) {
      errors.push(`${poNum}: ${e.message?.substring(0, 120)}`);
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('  RESULTS');
  console.log('─'.repeat(70));
  console.log(`  POs created:      ${created}`);
  console.log(`  POs updated:      ${updated}`);
  console.log(`  POs skipped:      ${skipped}`);
  console.log(`  Vendors created:  ${vendorsCreated}`);
  if (errors.length > 0) {
    console.log(`\n  ⚠️  Errors: ${errors.length}`);
    errors.slice(0, 10).forEach(e => console.log(`     ${e}`));
    if (errors.length > 10) console.log(`     ... and ${errors.length - 10} more`);
  }

  // DB-wide verification
  if (!DRY_RUN) {
    const verify = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE source = 'INFLOW')::int AS inflow,
        COUNT(*) FILTER (WHERE source = 'LEGACY_SEED')::int AS legacy,
        COUNT(*) FILTER (WHERE "orderedAt" IS NOT NULL)::int AS with_date,
        MIN("orderedAt")::text AS min_date,
        MAX("orderedAt")::text AS max_date
      FROM "PurchaseOrder"
    `);
    console.log(`\n  📊 DB PurchaseOrder state:`);
    console.log(`     Total:         ${verify[0].total}`);
    console.log(`     INFLOW:        ${verify[0].inflow}`);
    console.log(`     LEGACY_SEED:   ${verify[0].legacy}`);
    console.log(`     With date:     ${verify[0].with_date}`);
    console.log(`     Date range:    ${verify[0].min_date?.substring(0,10)} → ${verify[0].max_date?.substring(0,10)}`);
  }

  console.log('═'.repeat(70) + '\n');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
