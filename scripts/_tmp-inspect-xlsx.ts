import * as XLSX from 'xlsx';
const f = 'C:/Users/natha/OneDrive/Abel Lumber/Abel_Lumber_Pulte_Takeoff_BOMs.xlsx';
const wb = XLSX.readFile(f, { cellDates: true });
const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets['All 118 Plans Mapped'], { header: 1, defval: null });
console.log('rows=' + rows.length);
for (const r of rows.slice(0, 30)) {
  const row = Array.isArray(r) ? r : [r];
  console.log(JSON.stringify(row.slice(0, 10)));
}
console.log('...\n--TAIL--');
for (const r of rows.slice(-10)) {
  const row = Array.isArray(r) ? r : [r];
  console.log(JSON.stringify(row.slice(0, 10)));
}
