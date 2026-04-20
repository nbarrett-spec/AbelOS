#!/usr/bin/env node
import fs from 'fs';

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
  return { headers, rows };
}

const { rows } = readCSV('C:/Users/natha/Downloads/inFlow_PurchaseOrder (11).csv');
console.log(`Line-item rows: ${rows.length}`);

const pos = new Map();
for (const r of rows) {
  const num = r['OrderNumber'];
  if (!num || !num.startsWith('PO-')) continue;
  if (!pos.has(num)) pos.set(num, {
    date: r['OrderDate'], vendor: r['Vendor'], total: r['ProductSubtotal'],
    status: r['InventoryStatus'], cancelled: r['IsCancelled'],
  });
}

console.log(`Unique POs: ${pos.size}`);

const byYear = {};
for (const [, o] of pos) {
  const y = o.date?.match(/\d{4}/)?.[0] || 'NO_DATE';
  byYear[y] = (byYear[y]||0)+1;
}
console.log('POs by year:', byYear);

const byVendor = {};
for (const [, o] of pos) byVendor[o.vendor||'?'] = (byVendor[o.vendor||'?']||0)+1;
const topVendors = Object.entries(byVendor).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('\nTop 10 vendors:');
for (const [v,n] of topVendors) console.log(`  ${v.padEnd(40)} ${n}`);

const cancelledCount = [...pos.values()].filter(o => o.cancelled === 'True' || o.cancelled === 'true').length;
console.log(`\nCancelled POs: ${cancelledCount}`);

const dated = [...pos.entries()].map(([n,o])=>({n,...o})).filter(o=>o.date).sort((a,b)=>new Date(a.date)-new Date(b.date));
console.log(`\nEarliest PO: ${dated[0]?.n}  ${dated[0]?.date}  ${dated[0]?.vendor}`);
console.log(`Latest PO:   ${dated[dated.length-1]?.n}  ${dated[dated.length-1]?.date}  ${dated[dated.length-1]?.vendor}`);
