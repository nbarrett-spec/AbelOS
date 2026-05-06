import { neon } from '@neondatabase/serverless'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const SCRIPTS_DIR = path.dirname(__filename)
const ROOT = path.resolve(SCRIPTS_DIR, '..')
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}
const sql = neon(process.env.DATABASE_URL)
const rows = await sql`
  SELECT sku, name, category FROM "Product"
  WHERE active = true
  ORDER BY random()
  LIMIT 30
`
for (const r of rows) console.log(`${r.sku}\t${r.category}\t${r.name}`)
