// Shared helpers for brain-wiring import scripts.
// Keep this file tiny and dependency-free (besides fs/path).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
export const SCRIPTS_DIR = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
export const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');
export const INFLOW_PATH = path.join(ABEL_FOLDER, 'In Flow Exports');

export function parseCSVLine(line) {
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

// Proper RFC 4180 CSV parser — handles embedded newlines inside quoted
// fields, doubled "" escaping, CRLF, and BOM. Required for InFlow exports
// whose OrderRemarks / ProductDescription fields can span multiple lines.
export function parseCSVContent(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const len = content.length;
  let i = 0;
  while (i < len) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += ch; i++;
  }
  // Trailing record
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const matrix = parseCSVContent(content);
  if (!matrix.length) return { headers: [], rows: [] };
  const headers = matrix[0].map(h => String(h).replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let r = 1; r < matrix.length; r++) {
    const cols = matrix[r];
    if (!cols || cols.length === 0) continue;
    // Skip truly empty rows
    if (cols.every(c => c == null || String(c).trim() === '')) continue;
    const row = {};
    headers.forEach((h, idx) => {
      const v = cols[idx];
      row[h] = v == null ? '' : String(v).trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function findFile(dir, pattern) {
  try {
    const files = fs.readdirSync(dir);
    // Prefer highest-numbered export, e.g. "inFlow_PurchaseOrder (7).csv"
    const matches = files
      .filter(f => f.toLowerCase().includes(pattern.toLowerCase()) && f.endsWith('.csv'));
    matches.sort((a, b) => {
      const na = parseInt(a.match(/\((\d+)\)/)?.[1] || '0', 10);
      const nb = parseInt(b.match(/\((\d+)\)/)?.[1] || '0', 10);
      return nb - na;
    });
    return matches[0] || null;
  } catch { return null; }
}

export function parseMoney(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseIntSafe(v) {
  const n = parseInt(String(v ?? '').replace(/[,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseFloatSafe(v) {
  const n = parseFloat(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function vendorCodeFromName(name) {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'VENDOR';
}

export function mapPOStatus(inv, pay) {
  const i = (inv || '').toLowerCase();
  const p = (pay || '').toLowerCase();
  if (i.includes('fulfilled') && p.includes('paid')) return 'CLOSED';
  if (i.includes('fulfilled')) return 'RECEIVED';
  if (i.includes('partial')) return 'PARTIAL';
  if (p.includes('paid')) return 'PAID';
  return 'OPEN';
}
