import { computeCoImpact } from '../src/lib/mrp/co-impact'
import { prisma } from '../src/lib/prisma'

async function main() {
  const jobs: any[] = await prisma.$queryRawUnsafe(
    `SELECT j.id, j."jobNumber", j."scheduledDate" FROM "Job" j
     WHERE j."scheduledDate" > NOW() AND j."orderId" IS NOT NULL
       AND j."status" NOT IN ('COMPLETE','CLOSED','INVOICED')
     ORDER BY j."scheduledDate" ASC LIMIT 3`
  )
  console.log('Future jobs:', jobs.length, jobs.map((j: any) => j.jobNumber))
  if (!jobs.length) {
    await prisma.$disconnect()
    return
  }
  const prods: any[] = await prisma.$queryRawUnsafe(
    `SELECT p.id, p.sku, p.name, i."onHand", i.available FROM "Product" p
     LEFT JOIN "InventoryItem" i ON i."productId"=p.id
     WHERE p.active=true AND COALESCE(i.available,0) > 10 LIMIT 2`
  )
  console.log('Products w/ avail:', prods)
  if (!prods.length) {
    console.log('No available product to test with.')
    await prisma.$disconnect()
    return
  }
  const result = await computeCoImpact(jobs[0].id, [
    { productId: prods[0].id, qty: 2, type: 'ADD' },
  ])
  console.log('---')
  console.log('job:', jobs[0].jobNumber, 'scheduled:', jobs[0].scheduledDate)
  console.log('overallImpact=', result.overallImpact)
  console.log('daysShifted=', result.daysShifted)
  console.log('newCompletionDate=', result.newCompletionDate)
  console.log('summary=', result.summary)
  console.log('totalNewValue=', result.totalNewValue)
  console.log(
    'line:',
    result.lines[0].status,
    '| reason:',
    result.lines[0].reason,
    '| sourcing:',
    result.lines[0].sourcing,
    '| daysToShelf=',
    result.lines[0].daysToShelf
  )
  await prisma.$disconnect()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
