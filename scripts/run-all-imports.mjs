#!/usr/bin/env node
/**
 * Abel Lumber Platform — Master Data Import Script
 *
 * Run this on your local machine after `npx prisma db push`:
 *   node scripts/run-all-imports.mjs
 *
 * It will:
 *   1. Seed 16 real Abel employees into Staff
 *   2. Import 38 real builders from the Box export
 *   3. Import 3,282 products from InFlow
 *   4. Import 65 vendors from InFlow
 *   5. Import customers from InFlow
 *   6. Print a database summary
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const prisma = new PrismaClient();

// ─── PATHS (adjust if your folder structure differs) ──────────────
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');
const BOX_PATH = path.join(ABEL_FOLDER, 'Abel Door & Trim_ DFW Box Export', 'Abel Door & Trim_ DFW');
const INFLOW_PATH = path.join(ABEL_FOLDER, 'In Flow Exports');

// ─── HELPERS ────────────────────────────────────────────────────────
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
  const lines = content.split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = cols[idx]?.trim() || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function findFile(dir, pattern) {
  try {
    const files = fs.readdirSync(dir);
    return files.find(f => f.toLowerCase().includes(pattern.toLowerCase()) && f.endsWith('.csv'));
  } catch { return null; }
}

function parseProductAttributes(name) {
  const n = (name || '').toUpperCase();
  return {
    doorSize: n.match(/(\d{4})/)?.[1] || null,
    handing: n.match(/\b(LH|RH|LHIS|RHIS)\b/)?.[1] || null,
    coreType: n.includes('HOLLOW') ? 'Hollow' : n.includes('SOLID') ? 'Solid' : null,
    panelStyle: n.match(/(\d)-PANEL/)?.[0] || (n.includes('SHAKER') ? 'Shaker' : n.includes('FLAT') ? 'Flat' : null),
    jambSize: n.match(/(\d-\d\/\d{1,2})/)?.[1] || null,
    hardwareFinish: n.includes(' SN ') || n.includes('SATIN NICKEL') ? 'SN' : n.includes(' BLK ') || n.includes('MATTE BLACK') ? 'BLK' : n.includes(' ORB ') ? 'ORB' : null,
    material: n.includes('PINE') ? 'Pine' : n.includes('MDF') ? 'MDF' : n.includes('PRIMED') ? 'Primed' : n.includes('FIBERGLASS') ? 'Fiberglass' : null,
    subcategory: n.includes('BIFOLD') ? 'Bifold' : n.includes('PRE-HUNG') || n.includes('PREHUNG') ? 'Pre-Hung' : n.includes('SLAB') ? 'Slab' : null,
  };
}

function mapCategory(inflowCat, name) {
  const c = (inflowCat || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (c.includes('service') || c === 'service') return 'Service';
  if (c.includes('interior door') || (c.includes('door') && !c.includes('exterior') && !c.includes('hardware'))) return 'Interior Door';
  if (c.includes('exterior door') || n.includes('fiberglass') || n.includes('entry door')) return 'Exterior Door';
  if (c.includes('hardware') || n.includes('lever') || n.includes('deadbolt') || n.includes('hinge') || n.includes('door stop')) return 'Hardware';
  if (c.includes('trim') || c.includes('moulding') || c.includes('molding') || n.includes('casing') || n.includes('baseboard') || n.includes('crown')) return 'Trim';
  if (c.includes('closet') || n.includes('shelf') || n.includes('closet rod')) return 'Closet Component';
  if (c.includes('window') || n.includes('window stool') || n.includes('apron')) return 'Window Trim';
  if (c.includes('jamb') || c.includes('frame')) return 'Interior Door';
  return 'Miscellaneous';
}

// ═══════════════════════════════════════════════════════════════════
// 1. SEED EMPLOYEES
// ═══════════════════════════════════════════════════════════════════
async function seedEmployees() {
  console.log('\n🧑‍💼 SEEDING 16 ABEL EMPLOYEES...');
  const hash = await bcrypt.hash('abel2026', 10);

  const employees = [
    { firstName: 'Josh', lastName: 'Barrett', email: 'j.barrett@abellumber.com', role: 'ADMIN', department: 'EXECUTIVE', title: 'CEO' },
    { firstName: 'Clint', lastName: 'Vinson', email: 'c.vinson@abellumber.com', role: 'MANAGER', department: 'OPERATIONS', title: 'COO / Operations Manager' },
    { firstName: 'Nathaniel', lastName: 'Barrett', email: 'n.barrett@abellumber.com', role: 'ADMIN', department: 'EXECUTIVE', title: 'CFO' },
    { firstName: 'Scott', lastName: 'Johnson', email: 's.johnson@abellumber.com', role: 'MANAGER', department: 'OPERATIONS', title: 'General Manager' },
    { firstName: 'Lisa', lastName: 'Carreon', email: 'l.carreon@abellumber.com', role: 'ESTIMATOR', department: 'ESTIMATING', title: 'Senior Estimator' },
    { firstName: 'Matthew', lastName: 'Sams', email: 'm.sams@abellumber.com', role: 'PROJECT_MANAGER', department: 'OPERATIONS', title: 'Project Manager' },
    { firstName: 'Benjamin', lastName: 'Wilson', email: 'b.wilson@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Lead' },
    { firstName: 'Gunner', lastName: 'Hacker', email: 'g.hacker@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Manufacturing Tech' },
    { firstName: 'Kevin', lastName: 'Blankenship', email: 'k.blankenship@abellumber.com', role: 'WAREHOUSE_TECH', department: 'WAREHOUSE', title: 'Warehouse Tech' },
    { firstName: 'Christopher', lastName: 'Poppert', email: 'c.poppert@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Driver' },
    { firstName: 'Jacob', lastName: 'Brown', email: 'j.brown@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Door Line Tech' },
    { firstName: 'Noah', lastName: 'Ridge', email: 'n.ridge@abellumber.com', role: 'WAREHOUSE_TECH', department: 'WAREHOUSE', title: 'Warehouse Associate' },
    { firstName: 'Braden', lastName: 'Sadler', email: 'b.sadler@abellumber.com', role: 'WAREHOUSE_TECH', department: 'MANUFACTURING', title: 'Manufacturing Associate' },
    { firstName: 'Dakota', lastName: 'Dyer', email: 'd.dyer@abellumber.com', role: 'INSTALLER', department: 'INSTALLATION', title: 'Install Crew' },
    { firstName: 'Thomas', lastName: 'Gabriel', email: 't.gabriel@abellumber.com', role: 'DRIVER', department: 'DELIVERY', title: 'Delivery Driver' },
    { firstName: 'Sean', lastName: 'Phillips', email: 's.phillips@abellumber.com', role: 'INSTALLER', department: 'INSTALLATION', title: 'Install Lead' },
  ];

  // First clean up any test accounts
  try {
    await prisma.staff.deleteMany({
      where: { email: { in: ['admin@abel-ops.com', 'pm@abel-ops.com', 'warehouse@abel-ops.com'] } },
    });
  } catch (e) { /* ignore */ }

  let count = 0;
  for (const emp of employees) {
    try {
      await prisma.staff.upsert({
        where: { email: emp.email },
        create: { ...emp, passwordHash: hash, active: true },
        update: { firstName: emp.firstName, lastName: emp.lastName, role: emp.role, department: emp.department, title: emp.title, active: true },
      });
      count++;
      process.stdout.write(`  ✅ ${emp.firstName} ${emp.lastName} (${emp.title})\n`);
    } catch (e) {
      console.error(`  ❌ ${emp.firstName} ${emp.lastName}: ${e.message}`);
    }
  }
  console.log(`  📊 ${count}/16 employees seeded\n`);
  return count;
}

// ═══════════════════════════════════════════════════════════════════
// 2. IMPORT BUILDERS FROM BOX
// ═══════════════════════════════════════════════════════════════════
async function importBuilders() {
  console.log('\n🏗️  IMPORTING BUILDERS FROM BOX EXPORT...');
  const customersDir = path.join(BOX_PATH, 'Customers');
  const excelPath = path.join(customersDir, 'Current Customer Community List.xlsx');
  const hash = await bcrypt.hash('abel2026', 10);

  if (!fs.existsSync(customersDir)) {
    console.log('  ⚠️  Box export Customers folder not found at:', customersDir);
    console.log('  Skipping builder import. Adjust ABEL_FOLDER path if needed.');
    return 0;
  }

  // Collect all builder folders
  const folderBuilders = new Set();
  const entries = fs.readdirSync(customersDir);
  for (const entry of entries) {
    const fullPath = path.join(customersDir, entry);
    try { if (fs.statSync(fullPath).isDirectory()) folderBuilders.add(entry); } catch { }
  }

  // Read Excel for contact details
  const sheetData = new Map();
  if (fs.existsSync(excelPath)) {
    try {
      const wb = XLSX.readFile(excelPath);
      for (const sheetName of wb.SheetNames) {
        if (sheetName === 'TEMPLATE') continue;
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || !row[2]) continue;
          sheetData.set(sheetName, {
            contactName: String(row[2] || '').trim(),
            phone: String(row[3] || '').trim(),
            email: String(row[4] || '').trim(),
            city: String(row[0] || '').trim(),
          });
          break;
        }
      }
    } catch (e) {
      console.error('  ⚠️  Could not read Excel:', e.message);
    }
  }

  // Sheet name → folder name mapping
  const sheetToFolder = {
    'Pulte': 'Pulte Homes DFW', 'Toll Brothers': 'Toll Brothers DFW', 'Brookfield': 'Brookfield Homes',
    'Mill Creek': 'Mill Creek Residential DFW', 'Truth': 'Truth Construction', 'FigTree': 'Fig Tree Homes',
  };

  const majorBuilders = ['Pulte Homes DFW', 'Brookfield Homes', 'Toll Brothers DFW', 'Taylor Morrison', 'David Weekly Homes DFW', 'Grand Homes', 'First Texas Homes'];
  const allBuilders = new Map();

  // From sheets
  for (const [sheetName, data] of sheetData) {
    const companyName = sheetToFolder[sheetName] || sheetName;
    allBuilders.set(companyName, data);
    folderBuilders.delete(companyName);
  }

  // From folders only
  for (const folder of folderBuilders) {
    if (folder.endsWith('.xlsx') || folder.endsWith('.csv')) continue;
    allBuilders.set(folder, { contactName: '', email: '', phone: '', city: '' });
  }

  let created = 0, errors = 0;
  for (const [companyName, data] of allBuilders) {
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    const email = data.email || `contact@${slug}.com`;
    const paymentTerm = majorBuilders.includes(companyName) ? 'NET_15' : 'NET_30';

    try {
      await prisma.builder.upsert({
        where: { email },
        create: {
          companyName,
          contactName: data.contactName || companyName,
          email,
          passwordHash: hash,
          phone: data.phone || null,
          city: data.city || null,
          state: 'TX',
          status: 'ACTIVE',
          paymentTerm,
          accountBalance: 0,
        },
        update: {
          companyName,
          contactName: data.contactName || companyName,
          status: 'ACTIVE',
        },
      });
      created++;
      process.stdout.write(`  ✅ ${companyName}\n`);
    } catch (e) {
      errors++;
      console.error(`  ❌ ${companyName}: ${e.message.substring(0, 100)}`);
    }
  }
  console.log(`  📊 ${created} builders imported, ${errors} errors\n`);
  return created;
}

// ═══════════════════════════════════════════════════════════════════
// 3. IMPORT INFLOW PRODUCTS
// ═══════════════════════════════════════════════════════════════════
async function importProducts() {
  console.log('\n📦 IMPORTING INFLOW PRODUCTS...');
  if (!fs.existsSync(INFLOW_PATH)) {
    console.log('  ⚠️  InFlow exports folder not found at:', INFLOW_PATH);
    return 0;
  }

  const productFile = findFile(INFLOW_PATH, 'productdetail');
  if (!productFile) { console.log('  ⚠️  No product CSV found'); return 0; }

  const { headers, rows } = readCSV(path.join(INFLOW_PATH, productFile));
  console.log(`  📄 ${productFile}: ${rows.length} products`);

  let created = 0, skipped = 0;
  for (const row of rows) {
    const name = row['ProductName'] || row['Name'] || '';
    let sku = row['SKU'] || row['BarCode'] || '';
    const category = row['Category'] || '';
    const cost = parseFloat(row['Cost'] || '0') || 0;
    const price = parseFloat(row['DefaultUnitPrice'] || '0') || cost * 1.35;
    const isActive = (row['IsActive'] || 'True') !== 'False';
    const itemType = row['ItemType'] || '';

    if (!name || !sku) { skipped++; continue; }

    const attrs = parseProductAttributes(name);
    const platformCategory = mapCategory(category, name);

    try {
      await prisma.product.upsert({
        where: { sku },
        create: {
          sku, name,
          description: row['Description'] || null,
          category: platformCategory,
          subcategory: attrs.subcategory || null,
          cost, basePrice: price,
          doorSize: attrs.doorSize, handing: attrs.handing,
          coreType: attrs.coreType, panelStyle: attrs.panelStyle,
          jambSize: attrs.jambSize, hardwareFinish: attrs.hardwareFinish,
          material: attrs.material,
          active: isActive, inStock: true,
          inflowCategory: category,
        },
        update: {
          name, cost, basePrice: price,
          category: platformCategory,
          inflowCategory: category,
          active: isActive,
        },
      });
      created++;
    } catch (e) {
      if (!e.message.includes('Unique constraint')) skipped++;
    }

    if (created % 200 === 0 && created > 0) process.stdout.write(`  ... ${created} imported\n`);
  }

  console.log(`  ✅ ${created} products imported, ${skipped} skipped\n`);
  return created;
}

// ═══════════════════════════════════════════════════════════════════
// 4. IMPORT INFLOW VENDORS
// ═══════════════════════════════════════════════════════════════════
async function importVendors() {
  console.log('\n🏪 IMPORTING INFLOW VENDORS...');
  if (!fs.existsSync(INFLOW_PATH)) return 0;

  const vendorFile = findFile(INFLOW_PATH, 'vendor');
  if (!vendorFile) { console.log('  ⚠️  No vendor CSV found'); return 0; }

  const { rows } = readCSV(path.join(INFLOW_PATH, vendorFile));
  console.log(`  📄 ${vendorFile}: ${rows.length} vendors`);

  let created = 0;
  for (const row of rows) {
    const name = row['Name'] || '';
    if (!name) continue;

    const code = name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 12) || `V${created}`;

    try {
      await prisma.vendor.upsert({
        where: { code },
        create: {
          name, code,
          contactName: row['ContactName'] || null,
          email: row['Email'] || null,
          phone: row['Phone'] || null,
          address: [row['Address1'], row['City'], row['State'], row['PostalCode']].filter(Boolean).join(', ') || null,
          website: row['Website'] || null,
          active: (row['IsActive'] || 'True') !== 'False',
        },
        update: {
          name,
          contactName: row['ContactName'] || undefined,
          email: row['Email'] || undefined,
          phone: row['Phone'] || undefined,
          active: true,
        },
      });
      created++;
    } catch { }
  }
  console.log(`  ✅ ${created} vendors imported\n`);
  return created;
}

// ═══════════════════════════════════════════════════════════════════
// 5. IMPORT INFLOW CUSTOMERS (as additional Builders)
// ═══════════════════════════════════════════════════════════════════
async function importInflowCustomers() {
  console.log('\n👥 IMPORTING INFLOW CUSTOMERS...');
  if (!fs.existsSync(INFLOW_PATH)) return 0;

  const custFile = findFile(INFLOW_PATH, 'customer');
  if (!custFile) { console.log('  ⚠️  No customer CSV found'); return 0; }

  const { rows } = readCSV(path.join(INFLOW_PATH, custFile));
  console.log(`  📄 ${custFile}: ${rows.length} customers`);
  const hash = await bcrypt.hash('abel2026', 10);

  let created = 0;
  for (const row of rows) {
    const name = row['Name'] || row['CompanyName'] || '';
    if (!name) continue;

    const email = row['Email'] || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@inflow-customer.com`;

    try {
      await prisma.builder.upsert({
        where: { email },
        create: {
          companyName: name,
          contactName: row['ContactName'] || name,
          email,
          passwordHash: hash,
          phone: row['Phone'] || null,
          city: row['City'] || null,
          state: row['State'] || 'TX',
          status: 'ACTIVE',
          paymentTerm: 'NET_30',
          accountBalance: 0,
        },
        update: { companyName: name, status: 'ACTIVE' },
      });
      created++;
    } catch { }
  }
  console.log(`  ✅ ${created} InFlow customers imported\n`);
  return created;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ABEL LUMBER PLATFORM — MASTER DATA IMPORT');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Project: ${PROJECT_ROOT}`);
  console.log(`  Abel folder: ${ABEL_FOLDER}`);
  console.log(`  Box export: ${BOX_PATH}`);
  console.log(`  InFlow: ${INFLOW_PATH}`);
  console.log('═══════════════════════════════════════════════════\n');

  try {
    await prisma.$connect();
    console.log('✅ Database connected\n');

    await seedEmployees();
    await importBuilders();
    await importProducts();
    await importVendors();
    await importInflowCustomers();

    // Print summary
    const staffCount = await prisma.staff.count();
    const builderCount = await prisma.builder.count();
    const productCount = await prisma.product.count();
    const vendorCount = await prisma.vendor.count();

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ IMPORT COMPLETE — DATABASE TOTALS');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Staff:      ${staffCount}`);
    console.log(`  Builders:   ${builderCount}`);
    console.log(`  Products:   ${productCount}`);
    console.log(`  Vendors:    ${vendorCount}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('\n🎉 You can now start the dev server: npm run dev');
    console.log('   Then visit http://localhost:3000/ops\n');

  } catch (e) {
    console.error('\n❌ Fatal error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
