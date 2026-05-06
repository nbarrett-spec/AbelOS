/**
 * Backfill Job.jobAddress + .community from inFlow_SalesOrder CSV
 * by joining Aegis Order.orderNumber → inFlow OrderNumber.
 *
 * Source CSV has: OrderNumber, ShippingAddress1, ShippingCity, ShippingState,
 * ShippingPostalCode, "Delivery Location", Customer, OrderRemarks.
 *
 * Each Sales Order has multiple rows (one per product line) — we just take the
 * first row's address per OrderNumber.
 *
 * Usage:
 *   npx tsx scripts/backfill-jobs-from-inflow-orders.ts            # DRY-RUN
 *   npx tsx scripts/backfill-jobs-from-inflow-orders.ts --commit   # apply
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const COMMIT = process.argv.includes('--commit')
const prisma = new PrismaClient()

const WORKSPACE = path.resolve(__dirname, '..', '..')
const CSV_FILES = [
  'inFlow_SalesOrder (23).csv',
  'inFlow_SalesOrder (22).csv',
  'inFlow_SalesOrder (21).csv',
  'inFlow_SalesOrder (17).csv',
  'inFlow_SalesOrder (16).csv',
]

// ---- streaming CSV parser (file is 20MB, 60k lines) ----
function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { out.push(field); field = '' }
      else field += c
    }
  }
  out.push(field)
  return out
}

async function main() {
  console.log(`BACKFILL JOBS FROM INFLOW SALES ORDERS — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)

  function parseFile(filePath: string): string[][] {
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8')
    const cleaned = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
    const rows: string[][] = []
    let inQuotes = false
    let cur: string[] = []
    let field = ''
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i]
      if (inQuotes) {
        if (c === '"') {
          if (cleaned[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
        } else field += c
      } else {
        if (c === '"') inQuotes = true
        else if (c === ',') { cur.push(field); field = '' }
        else if (c === '\r') continue
        else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
        else field += c
      }
    }
    if (field || cur.length) { cur.push(field); rows.push(cur) }
    return rows
  }

  // Merge all files, dedup by header
  let header: string[] = []
  let allRows: string[][] = []
  for (const f of CSV_FILES) {
    const fp = path.join(WORKSPACE, f)
    const t0 = Date.now()
    const rows = parseFile(fp)
    if (rows.length === 0) { console.log(`  skipped ${f} (not found)`); continue }
    if (header.length === 0) header = rows[0]
    allRows.push(...rows.slice(1))
    console.log(`  ${f}: ${rows.length - 1} rows in ${Date.now() - t0}ms`)
  }
  const rawRows = [header, ...allRows]
  const idxOrderNum = header.indexOf('OrderNumber')
  const idxShipAddr = header.indexOf('ShippingAddress1')
  const idxShipCity = header.indexOf('ShippingCity')
  const idxShipState = header.indexOf('ShippingState')
  const idxShipZip = header.indexOf('ShippingPostalCode')
  const idxDelivLoc = header.indexOf('Delivery Location')
  const idxCustomer = header.indexOf('Customer')
  const idxRemarks = header.indexOf('OrderRemarks')

  console.log(`Total parsed: ${rawRows.length - 1} CSV rows`)

  // First row per OrderNumber
  type Addr = { addr: string; city: string; state: string; zip: string; delivLoc: string; customer: string; remarks: string }
  const byOrder = new Map<string, Addr>()
  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i]
    if (r.length < header.length) continue
    const on = (r[idxOrderNum] || '').trim()
    if (!on) continue
    if (byOrder.has(on)) continue
    byOrder.set(on, {
      addr: (r[idxShipAddr] || '').trim(),
      city: (r[idxShipCity] || '').trim(),
      state: (r[idxShipState] || '').trim(),
      zip: (r[idxShipZip] || '').trim(),
      delivLoc: (r[idxDelivLoc] || '').trim(),
      customer: (r[idxCustomer] || '').trim(),
      remarks: (r[idxRemarks] || '').trim(),
    })
  }
  console.log(`Unique OrderNumbers in CSV: ${byOrder.size}`)
  const withAddr = [...byOrder.values()].filter(v => v.addr).length
  const withDeliv = [...byOrder.values()].filter(v => v.delivLoc).length
  console.log(`  with ShippingAddress1: ${withAddr}`)
  console.log(`  with Delivery Location: ${withDeliv}`)

  // Pull Aegis Jobs missing address with their Order.orderNumber
  const jobs = await prisma.$queryRawUnsafe<Array<{
    jobId: string; jobNumber: string; builderName: string;
    currentAddress: string | null; currentCommunity: string | null;
    orderNumber: string;
  }>>(`
    SELECT j.id as "jobId", j."jobNumber", j."builderName",
           j."jobAddress" as "currentAddress",
           j.community as "currentCommunity",
           o."orderNumber"
    FROM "Job" j
    INNER JOIN "Order" o ON o.id = j."orderId"
    WHERE (j."jobAddress" IS NULL OR j."jobAddress" = ''
        OR j.community IS NULL OR j.community = '')
      AND o."orderNumber" IS NOT NULL
  `)
  console.log(`\nAegis Jobs missing addr/community with Order link: ${jobs.length}`)

  // For each, look up CSV
  let willUpdate = 0
  let unmatched = 0
  let noCsvData = 0
  const sample: string[] = []
  const writes: Array<{jobId: string, set: Record<string, string>}> = []

  for (const j of jobs) {
    const c = byOrder.get(j.orderNumber)
    if (!c) { unmatched++; continue }

    // Pick the best address. Prefer ShippingAddress1 + city if present, else delivLoc, else nothing.
    let addr: string | null = null
    if (c.addr) {
      const parts = [c.addr, c.city, c.state, c.zip].filter(x => x).join(', ')
      addr = parts
    } else if (c.delivLoc) {
      addr = c.delivLoc
    }

    const set: Record<string, string> = {}
    if (!j.currentAddress && addr) set.jobAddress = addr
    // Use delivLoc as community if it differs from address line and looks like a community name
    if (!j.currentCommunity && c.delivLoc && c.delivLoc !== c.addr) {
      // delivLoc is sometimes a subdivision name
      set.community = c.delivLoc
    }

    if (Object.keys(set).length === 0) { noCsvData++; continue }
    willUpdate++
    if (sample.length < 12) {
      sample.push(`  ${j.jobNumber.padEnd(15)} ${j.builderName.slice(0,18).padEnd(18)} → ${(set.jobAddress || set.community || '').slice(0,55)}`)
    }
    writes.push({ jobId: j.jobId, set })
  }

  console.log(`\nSample updates:`)
  sample.forEach(s => console.log(s))

  console.log(`\n══ ANALYSIS ══`)
  console.log(`  jobs to update:       ${willUpdate}`)
  console.log(`  unmatched in CSV:     ${unmatched}`)
  console.log(`  matched, no fillable: ${noCsvData}`)

  if (!COMMIT) {
    console.log(`\n(dry-run — no writes)`)
    await prisma.$disconnect()
    return
  }

  console.log(`\nApplying ${writes.length} updates in batches of 200...`)
  let done = 0
  for (let i = 0; i < writes.length; i += 200) {
    const batch = writes.slice(i, i + 200)
    await Promise.all(batch.map(w => {
      const setParts: string[] = []
      const params: any[] = []
      let idx = 1
      for (const [k, v] of Object.entries(w.set)) {
        setParts.push(`"${k}" = $${idx++}`)
        params.push(v)
      }
      params.push(w.jobId)
      return prisma.$executeRawUnsafe(
        `UPDATE "Job" SET ${setParts.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        ...params
      )
    }))
    done += batch.length
    if (done % 1000 === 0) console.log(`  ${done}/${writes.length}`)
  }
  console.log(`\nDone.`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
