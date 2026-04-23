#!/usr/bin/env node
/**
 * Reconcile Abel OS DB against CSV ground truth.
 * Compares: total SO revenue in CSV vs DB. 2026 YTD by builder.
 */
import fs from 'fs';

function parseCSVLine(line) {
  const result = []; let current=''; let inQuotes=false;
  for (let i=0;i<(line||'').length;i++) {
    const ch=line[i];
    if (ch==='"'){ if(inQuotes && line[i+1]==='"'){current+='"';i++;} else inQuotes=!inQuotes; }
    else if(ch===',' && !inQuotes){result.push(current);current='';}
    else current+=ch;
  }
  result.push(current); return result;
}
function readCSV(filePath){
  let content=fs.readFileSync(filePath,'utf-8');
  if(content.charCodeAt(0)===0xFEFF) content=content.slice(1);
  const lines=[]; let cur=''; let inQ=false;
  for(const raw of content.split('\n')){
    if(!cur && !raw.trim()) continue;
    cur = cur ? cur+'\n'+raw : raw;
    for(let i=(cur.length-raw.length-(cur.length>raw.length?1:0));i<cur.length;i++){ if(i<0)i=0; if(cur[i]==='"') inQ=!inQ; }
    if(!inQ){ if(cur.trim()) lines.push(cur); cur=''; }
  }
  if(cur.trim()) lines.push(cur);
  const headers=parseCSVLine(lines[0]);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const v=parseCSVLine(lines[i]);
    if(v.length<headers.length/2) continue;
    const r={}; headers.forEach((h,idx)=>{r[h.trim()]=(v[idx]||'').trim();});
    rows.push(r);
  }
  return rows;
}

const CSV = 'C:/Users/natha/Downloads/inFlow_SalesOrder (20).csv';
const rows = readCSV(CSV);
console.log(`\n── CSV: ${CSV.split('/').pop()} ──`);
console.log(`Line-item rows: ${rows.length}`);

// Unique SOs by OrderNumber with first-row snapshot
const sos = new Map();
for (const r of rows) {
  const n = r['OrderNumber'];
  if (!n || !n.startsWith('SO-')) continue;
  if (!sos.has(n)) sos.set(n, {
    date: r['OrderDate'],
    customer: r['Customer'],
    cancelled: r['IsCancelled'],
    rows: [],
  });
  sos.get(n).rows.push(r);
}
console.log(`Unique SOs: ${sos.size}`);

// Compute each SO's subtotal (sum of line items) + tax + freight
function money(v){ return parseFloat(String(v||'').replace(/[^0-9.-]/g,''))||0; }

const soTotals = [];
for (const [num,s] of sos) {
  if (s.cancelled === 'True') continue;
  let sub=0;
  for (const row of s.rows) {
    const raw = money(row['ProductSubtotal']);
    const qty = Math.max(1, Math.round(parseFloat(row['ProductQuantity']||'1')||1));
    const up = money(row['ProductUnitPrice']);
    sub += raw !== 0 ? raw : qty*up;
  }
  const taxRate = parseFloat(s.rows[0]['Tax1Rate']||'0')||0;
  const freight = money(s.rows[0]['Freight']);
  const total = sub + sub*(taxRate/100) + freight;
  soTotals.push({
    num, customer: s.customer,
    date: s.date ? new Date(s.date) : null,
    total,
  });
}

// Total revenue (non-cancelled)
const totalRev = soTotals.reduce((a,o)=>a+o.total,0);
console.log(`\n💰 CSV total non-cancelled SO value: $${totalRev.toLocaleString('en-US',{maximumFractionDigits:0})}`);

// By year
const byYear = {};
for (const o of soTotals) {
  const y = o.date?.getFullYear() ?? '?';
  byYear[y] = (byYear[y]||0) + o.total;
}
console.log('\n📅 CSV revenue by year:');
for (const [y,v] of Object.entries(byYear).sort()) {
  console.log(`  ${y}: $${Math.round(v).toLocaleString()}`);
}

// 2026 YTD by customer
console.log('\n🏢 CSV 2026 YTD (Jan-Apr) revenue by customer (top 20):');
const ytd = {};
for (const o of soTotals) {
  if (!o.date) continue;
  if (o.date.getFullYear() !== 2026) continue;
  if (o.date.getMonth() > 3) continue; // Jan=0..Apr=3
  const c = o.customer || 'UNKNOWN';
  ytd[c] = (ytd[c]||0) + o.total;
}
const top = Object.entries(ytd).sort((a,b)=>b[1]-a[1]).slice(0,20);
const ytdTotal = Object.values(ytd).reduce((a,v)=>a+v,0);
for (const [c,v] of top) console.log(`  ${c.padEnd(45)} $${Math.round(v).toLocaleString()}`);
console.log(`  ${'─'.repeat(45)}  ${'─'.repeat(15)}`);
console.log(`  ${'TOTAL 2026 YTD (Jan-Apr)'.padEnd(45)} $${Math.round(ytdTotal).toLocaleString()}`);

// Now DB side
console.log('\n── DB comparison ──');
const {readFileSync} = await import('fs');
const envContent = readFileSync('C:/Users/natha/OneDrive/Abel Lumber/abel-builder-platform/.env','utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const dbTotal = await sql.query(`
  SELECT ROUND(SUM(total)::numeric,0) AS rev, COUNT(*)::int AS n
  FROM "Order" WHERE status::text != 'CANCELLED'
`);
console.log(`DB total non-cancelled: $${Number(dbTotal[0].rev).toLocaleString()} (${dbTotal[0].n} orders)`);

const dbYtd = await sql.query(`
  SELECT b."companyName", ROUND(SUM(o.total)::numeric,0) AS rev
  FROM "Order" o JOIN "Builder" b ON b.id = o."builderId"
  WHERE o.status::text != 'CANCELLED'
    AND NOT o."isForecast"
    AND o."orderDate" >= '2026-01-01' AND o."orderDate" < '2026-05-01'
  GROUP BY b."companyName" ORDER BY SUM(o.total) DESC LIMIT 20
`);
console.log('\n🏢 DB 2026 YTD (Jan-Apr) by builder (top 20):');
for (const r of dbYtd) {
  console.log(`  ${(r.companyName||'').padEnd(45)} $${Number(r.rev).toLocaleString()}`);
}
const dbYtdTotal = await sql.query(`
  SELECT ROUND(SUM(total)::numeric,0) AS rev
  FROM "Order" WHERE status::text != 'CANCELLED'
    AND NOT "isForecast"
    AND "orderDate" >= '2026-01-01' AND "orderDate" < '2026-05-01'
`);
console.log(`\nDB 2026 YTD total: $${Number(dbYtdTotal[0].rev).toLocaleString()}`);

const gap = ytdTotal - Number(dbYtdTotal[0].rev);
console.log(`\n⚠️  GAP (CSV – DB): $${Math.round(gap).toLocaleString()}`);
