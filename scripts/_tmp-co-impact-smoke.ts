import { computeCoImpact } from '../src/lib/mrp/co-impact'
import { prisma } from '../src/lib/prisma'

async function main() {
  const jobs: any[] = await prisma.$queryRawUnsafe(
    `SELECT j.id, j."jobNumber", j."scheduledDate"
     FROM "Job" j
     WHERE j."scheduledDate" IS NOT NULL
       AND j."status" NOT IN ('COMPLETE','CLOSED','INVOICED')
       AND j."orderId" IS NOT NULL
     LIMIT 5`
  )
  console.log('Candidate jobs:', jobs.length)
  if (!jobs.length) {
    await prisma.$disconnect()
    return
  }

  const jobId = jobs[0].id
  console.log('Testing on:', jobs[0].jobNumber, jobId, 'scheduled:', jobs[0].scheduledDate)

  const prod: any[] = await prisma.$queryRawUnsafe(
    `SELECT p.id, p.sku, p.name, i."onHand", i.available
     FROM "Product" p
     LEFT JOIN "InventoryItem" i ON i."productId" = p.id
     WHERE p.active = true
     LIMIT 3`
  )
  console.log('Products:', prod)

  if (prod.length === 0) {
    await prisma.$disconnect()
    return
  }

  const result = await computeCoImpact(jobId, [
    { productId: prod[0].id, qty: 5, type: 'ADD' },
    { productId: prod[1]?.id || prod[0].id, qty: 1000, type: 'ADD' },
  ])

  console.log('--- RESULT ---')
  console.log('overallImpact:', result.overallImpact)
  console.log('daysShifted:', result.daysShifted)
  console.log('newCompletionDate:', result.newCompletionDate)
  console.log('summary:', result.summary)
  console.log('lines:')
  for (const l of result.lines) {
    console.log(
      '  -',
      l.sku,
      l.input.type,
      'qty=',
      l.qty,
      'status=',
      l.status,
      'daysToShelf=',
      l.daysToShelf,
      '| reason:',
      l.reason
    )
    console.log(
      '    sourcing:',
      l.sourcing,
      'onHand=',
      l.onHand,
      'avail=',
      l.available,
      'incoming=',
      l.incomingBeforeDue
    )
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
