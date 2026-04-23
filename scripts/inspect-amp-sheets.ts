import * as XLSX from 'xlsx'
import * as path from 'node:path'

const FILE = path.resolve(__dirname, '..', '..', 'AMP_Material_Planning_Abel_and_Company_2026-02-25.xlsx')
const wb = XLSX.readFile(FILE)

console.log(`Sheet names (${wb.SheetNames.length}): ${wb.SheetNames.join(', ')}\n`)

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: null })
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  console.log(`=== Sheet: "${name}" ===`)
  console.log(`  Range: ${ws['!ref']}  (cols: ${range.e.c - range.s.c + 1}, data rows: ${rows.length})`)
  if (rows.length > 0) {
    const headers = Object.keys(rows[0])
    console.log(`  Headers (${headers.length}): ${headers.join(' | ')}`)
    console.log(`  First 3 rows:`)
    for (const r of rows.slice(0, 3)) {
      console.log(`    ${JSON.stringify(r).slice(0, 400)}`)
    }
  } else {
    // Try non-JSON view for sheets with irregular shape
    const arrs = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null })
    console.log(`  (no keyed rows; ${arrs.length} array rows)`)
    for (const r of arrs.slice(0, 5)) {
      console.log(`    ${JSON.stringify(r).slice(0, 400)}`)
    }
  }
  console.log()
}
