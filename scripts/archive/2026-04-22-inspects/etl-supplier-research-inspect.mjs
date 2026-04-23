import XLSX from 'xlsx'
import * as path from 'node:path'

const f = path.resolve(process.cwd(), '..', 'Abel_Supplier_Research_Non-China.xlsx')
const wb = XLSX.readFile(f)
const ws = wb.Sheets['Supplier Directory']
const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 })
for (let i = 0; i < rows.length; i++) {
  console.log(`r${i}:`, JSON.stringify(rows[i]))
}
