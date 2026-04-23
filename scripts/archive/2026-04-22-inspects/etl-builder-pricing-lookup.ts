import { PrismaClient } from '@prisma/client'

const UNMATCHED = ['Daniel', 'Hunt Homes', 'JCLI Homes', 'McClintock', 'Millcreek', 'TX BUILT CONST']

async function main() {
  const prisma = new PrismaClient()
  for (const name of UNMATCHED) {
    // Use the first token (longest alphabetic run) to search
    const token = name.split(/\s+/)[0]
    const hits = await prisma.builder.findMany({
      where: { companyName: { contains: token, mode: 'insensitive' } },
      select: { id: true, companyName: true, builderType: true, status: true },
      take: 5,
    })
    console.log(`"${name}" — token "${token}"`)
    if (hits.length === 0) console.log('  (no Aegis match on that token)')
    hits.forEach((h) => console.log(`  · ${h.companyName}  [${h.builderType}, ${h.status}]`))
    console.log()
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
