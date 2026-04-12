// Import ECI Bolt export JSON chunks into Bolt* tables.
// Reads from /Abel Lumber/bolt-*.json files written by the bolt-wo-importer.html scrape.
//
// Sources:
//   bolt-wo-0..49.json       → BoltWorkOrder  (~4,919 rows)
//   bolt-jobs-0..3.json      → BoltJob        (~787 rows)
//   bolt-communities.json    → BoltCommunity  (127)
//   bolt-customers.json      → BoltCustomer   (64, cells-shaped)
//   bolt-crews.json          → BoltCrew       (29, cells-shaped)
//   bolt-floorplans.json     → BoltFloorplan  (113, cells-shaped)
//   bolt-employees.json      → BoltEmployee   (37)
//
// Idempotent: uses boltId as upsert key on every table. Safe to re-run.
// Usage: node scripts/import-bolt-wos.mjs
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parseDateSafe, bar, ABEL_FOLDER } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();
const SRC = ABEL_FOLDER;

function loadJson(name) {
  const fp = path.join(SRC, name);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); }
  catch (e) { console.warn(`   parse fail ${name}: ${e.message}`); return null; }
}

function loadSeries(prefix, max = 60) {
  const out = [];
  for (let i = 0; i < max; i++) {
    const data = loadJson(`${prefix}-${i}.json`);
    if (!data) continue;
    const arr = Array.isArray(data) ? data : (data.workOrders || data.jobs || data.data || []);
    if (Array.isArray(arr)) out.push(...arr);
  }
  return out;
}

// Some bolt scrape files store `{ boltId, cells: [...] }` — positional columns.
function unwrapCells(obj) {
  if (!obj || !obj.cells) return obj;
  return obj;
}

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltWorkOrder" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "woNumber"   TEXT,
      "jobAddress" TEXT,
      "type"       TEXT,
      "schedule"   TIMESTAMPTZ,
      "scheduleRaw" TEXT,
      "stage"      TEXT,
      "assignedTo" TEXT,
      "orderers"   TEXT,
      "po"         TEXT,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_boltwo_stage" ON "BoltWorkOrder" ("stage")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_boltwo_addr" ON "BoltWorkOrder" ("jobAddress")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltJob" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "address"    TEXT,
      "zip"        TEXT,
      "floorplan"  TEXT,
      "community"  TEXT,
      "city"       TEXT,
      "jobType"    TEXT,
      "startDate"  TIMESTAMPTZ,
      "closeDate"  TIMESTAMPTZ,
      "startRaw"   TEXT,
      "closeRaw"   TEXT,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_boltjob_addr" ON "BoltJob" ("address")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_boltjob_comm" ON "BoltJob" ("community")`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltCommunity" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "name"       TEXT,
      "city"       TEXT,
      "customer"   TEXT,
      "supervisor" TEXT,
      "active"     TEXT,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltCustomer" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "name"       TEXT,
      "status"     TEXT,
      "rawCells"   JSONB,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltCrew" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "name"       TEXT,
      "isActive"   TEXT,
      "crewType"   TEXT,
      "rawCells"   JSONB,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltFloorplan" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "name"       TEXT,
      "community"  TEXT,
      "customer"   TEXT,
      "city"       TEXT,
      "revisionDate" TIMESTAMPTZ,
      "rawCells"   JSONB,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoltEmployee" (
      "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltId"     TEXT UNIQUE,
      "name"       TEXT,
      "email"      TEXT,
      "role"       TEXT,
      "rawCells"   JSONB,
      "createdAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function importWorkOrders() {
  // Prefer consolidated chunks (bolt-chunk-N) only if bolt-wo-N missing.
  let wos = loadSeries('bolt-wo', 60);
  if (!wos.length) {
    // Fallback: extract from bolt-chunk-*
    for (let i = 0; i < 20; i++) {
      const d = loadJson(`bolt-chunk-${i}.json`);
      if (d?.workOrders) wos.push(...d.workOrders);
    }
  }
  console.log(`   found ${wos.length} work orders`);
  let wrote = 0;
  for (const w of wos) {
    const boltId = (w.boltId || w.number || '').toString().trim();
    if (!boltId) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoltWorkOrder" (
           "id","boltId","woNumber","jobAddress","type","schedule","scheduleRaw",
           "stage","assignedTo","orderers","po"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT ("boltId") DO UPDATE SET
           "stage" = EXCLUDED."stage",
           "schedule" = EXCLUDED."schedule",
           "scheduleRaw" = EXCLUDED."scheduleRaw",
           "assignedTo" = EXCLUDED."assignedTo",
           "po" = EXCLUDED."po",
           "updatedAt" = CURRENT_TIMESTAMP`,
        boltId, w.number || null, w.job || null, w.type || null,
        parseDateSafe(w.schedule), w.schedule || null,
        w.stage || null, w.assignedTo || null, w.orderers || null, w.po || null,
      );
      wrote++;
    } catch (e) { if (wrote < 3) console.warn(`   wo skip: ${e.message?.slice(0,120)}`); }
  }
  return { read: wos.length, wrote };
}

async function importJobs() {
  const jobs = loadSeries('bolt-jobs', 20);
  let wrote = 0;
  for (const j of jobs) {
    const boltId = (j.boltId || '').toString().trim();
    if (!boltId) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoltJob" (
           "id","boltId","address","zip","floorplan","community","city","jobType",
           "startDate","closeDate","startRaw","closeRaw"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT ("boltId") DO UPDATE SET
           "closeDate" = EXCLUDED."closeDate",
           "closeRaw" = EXCLUDED."closeRaw",
           "updatedAt" = CURRENT_TIMESTAMP`,
        boltId, j.address || null, j.zip || null, j.floorplan || null,
        j.community || null, j.city || null, j.jobType || null,
        parseDateSafe(j.startDate), parseDateSafe(j.closeDate),
        j.startDate || null, j.closeDate || null,
      );
      wrote++;
    } catch (e) {}
  }
  return { read: jobs.length, wrote };
}

async function importCommunities() {
  const arr = loadJson('bolt-communities.json') || [];
  let wrote = 0;
  for (const c of arr) {
    const boltId = (c.boltId || '').toString().trim();
    if (!boltId) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoltCommunity" (
           "id","boltId","name","city","customer","supervisor","active"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6)
         ON CONFLICT ("boltId") DO UPDATE SET
           "name" = EXCLUDED."name",
           "supervisor" = EXCLUDED."supervisor",
           "active" = EXCLUDED."active",
           "updatedAt" = CURRENT_TIMESTAMP`,
        boltId, c.name || null, c.city || null, c.customer || null,
        c.supervisor || null, String(c.active ?? ''),
      );
      wrote++;
    } catch (e) {}
  }
  return { read: arr.length, wrote };
}

async function importCellBased(file, table, nameIdx = 0, statusIdx = 1) {
  const arr = loadJson(file) || [];
  let wrote = 0;
  for (const row of arr) {
    const boltId = (row.boltId || '').toString().trim();
    if (!boltId) continue;
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const name = (cells[nameIdx] || '').toString().trim();
    const status = (cells[statusIdx] || '').toString().trim();
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${table}" ("id","boltId","name","rawCells") VALUES
           (gen_random_uuid()::text,$1,$2,$3::jsonb)
         ON CONFLICT ("boltId") DO UPDATE SET
           "name" = EXCLUDED."name",
           "rawCells" = EXCLUDED."rawCells",
           "updatedAt" = CURRENT_TIMESTAMP`,
        boltId, name || null, JSON.stringify(cells),
      );
      // Light column backfill for known shapes
      if (table === 'BoltCustomer') {
        await prisma.$executeRawUnsafe(
          `UPDATE "BoltCustomer" SET "status"=$2 WHERE "boltId"=$1`, boltId, status || null,
        );
      }
      wrote++;
    } catch (e) { if (wrote < 2) console.warn(`   ${table} skip: ${e.message?.slice(0,120)}`); }
  }
  return { read: arr.length, wrote };
}

async function importFloorplans() {
  const arr = loadJson('bolt-floorplans.json') || [];
  let wrote = 0;
  for (const row of arr) {
    const boltId = (row.boltId || '').toString().trim();
    if (!boltId) continue;
    const c = Array.isArray(row.cells) ? row.cells : [];
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoltFloorplan" (
           "id","boltId","name","community","customer","city","revisionDate","rawCells"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7::jsonb)
         ON CONFLICT ("boltId") DO UPDATE SET
           "name" = EXCLUDED."name",
           "revisionDate" = EXCLUDED."revisionDate",
           "rawCells" = EXCLUDED."rawCells",
           "updatedAt" = CURRENT_TIMESTAMP`,
        boltId, c[0] || null, c[3] || null, c[4] || null, c[5] || null,
        parseDateSafe(c[6]), JSON.stringify(c),
      );
      wrote++;
    } catch (e) {}
  }
  return { read: arr.length, wrote };
}

async function importEmployees() {
  const arr = loadJson('bolt-employees.json') || [];
  let wrote = 0;
  for (const row of arr) {
    const boltId = (row.boltId || '').toString().trim();
    if (!boltId) continue;
    const c = Array.isArray(row.cells) ? row.cells : [];
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoltEmployee" ("id","boltId","name","email","role","rawCells")
         VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5::jsonb)
         ON CONFLICT ("boltId") DO UPDATE SET
           "name" = EXCLUDED."name",
           "rawCells" = EXCLUDED."rawCells",
           "updatedAt" = CURRENT_TIMESTAMP`,
        boltId, row.name || c[0] || null, row.email || null, row.role || c[1] || null,
        JSON.stringify(c.length ? c : row),
      );
      wrote++;
    } catch (e) {}
  }
  return { read: arr.length, wrote };
}

async function main() {
  bar('BOLT — FULL JSON INGEST');
  console.log(`→ source folder: ${SRC}`);
  await ensureTables();

  console.log('\n[1/7] Work Orders');
  const wo = await importWorkOrders();
  console.log(`     read ${wo.read}, wrote ${wo.wrote}`);

  console.log('[2/7] Jobs');
  const jb = await importJobs();
  console.log(`     read ${jb.read}, wrote ${jb.wrote}`);

  console.log('[3/7] Communities');
  const co = await importCommunities();
  console.log(`     read ${co.read}, wrote ${co.wrote}`);

  console.log('[4/7] Customers');
  const cu = await importCellBased('bolt-customers.json', 'BoltCustomer', 0, 1);
  console.log(`     read ${cu.read}, wrote ${cu.wrote}`);

  console.log('[5/7] Crews');
  const cr = await importCellBased('bolt-crews.json', 'BoltCrew', 0, 2);
  console.log(`     read ${cr.read}, wrote ${cr.wrote}`);

  console.log('[6/7] Floorplans');
  const fp = await importFloorplans();
  console.log(`     read ${fp.read}, wrote ${fp.wrote}`);

  console.log('[7/7] Employees');
  const em = await importEmployees();
  console.log(`     read ${em.read}, wrote ${em.wrote}`);

  console.log('\n✅ BOLT IMPORT COMPLETE');
  console.log(`   WorkOrders:  ${wo.wrote}`);
  console.log(`   Jobs:        ${jb.wrote}`);
  console.log(`   Communities: ${co.wrote}`);
  console.log(`   Customers:   ${cu.wrote}`);
  console.log(`   Crews:       ${cr.wrote}`);
  console.log(`   Floorplans:  ${fp.wrote}`);
  console.log(`   Employees:   ${em.wrote}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
