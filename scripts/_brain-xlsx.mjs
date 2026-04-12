// Shared xlsx + path helpers for Phase-2 brain wiring.
// Keep tiny and runtime-safe. Depends only on 'xlsx' and node stdlib.
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
export const SCRIPTS_DIR = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
export const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');

/**
 * Read an xlsx sheet and return { headers, rows } where rows are plain objects.
 * Skips blank rows. Accepts explicit `headerRow` (0-indexed) for files where the
 * real header is not on row 0 (common in "titled" reports).
 */
export function readXlsxSheet(filePath, sheetName, headerRow = 0) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error(`Sheet not found: ${sheetName || wb.SheetNames[0]}`);
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const hdrRow = matrix[headerRow] || [];
  const headers = hdrRow.map((h, i) => (h == null ? `col_${i}` : String(h).trim()));
  const rows = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const arr = matrix[r] || [];
    if (arr.every(v => v == null || v === '')) continue;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = arr[i] == null ? '' : arr[i]; });
    rows.push(obj);
  }
  return { headers, rows, rawMatrix: matrix };
}

export function listSheets(filePath) {
  const wb = XLSX.readFile(filePath, { bookSheets: true });
  return wb.SheetNames;
}

export function parseMoney(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseDateSafe(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function normalizeBuilderName(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // Hyphen sends values like "Brookfield Residential Properties - Dallas Divisio"
  if (/brookfield/i.test(s)) return 'Brookfield Residential';
  if (/pulte/i.test(s)) return 'Pulte Homes';
  if (/toll/i.test(s)) return 'Toll Brothers';
  if (/bloomfield/i.test(s)) return 'Bloomfield Homes';
  if (/taylor\s*morrison/i.test(s)) return 'Taylor Morrison';
  return s.replace(/\s+-\s+.*$/, '').trim();
}

export function bar(title) {
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + title);
  console.log('═'.repeat(60));
}

export function fileExistsOrDie(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`\n❌ Required file missing: ${label}`);
    console.error(`   Expected at: ${p}\n`);
    process.exit(1);
  }
}
