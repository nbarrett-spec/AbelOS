import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const creds: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id","clientId","builderName","scopes","active","createdAt","lastUsedAt","revokedAt"
     FROM "HyphenCredential" ORDER BY "createdAt" DESC`
  ).catch(() => [])
  console.log('HyphenCredential rows:', creds.length)
  for (const c of creds) {
    console.log(`  ${c.builderName?.padEnd(15)} clientId=${c.clientId?.slice(0,16)}… active=${c.active} created=${c.createdAt?.toISOString?.()} lastUsed=${c.lastUsedAt?.toISOString?.() || 'NEVER'} revoked=${c.revokedAt?.toISOString?.() || 'no'}`)
  }
  const tokens: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as cnt, MAX("issuedAt") as latest, MAX("expiresAt") as expires
     FROM "HyphenAccessToken"`
  ).catch(() => [])
  console.log('\nHyphenAccessToken total:', tokens[0]?.cnt ?? 0, 'latest issuance:', tokens[0]?.latest)
  const events: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as cnt, MAX("receivedAt") as latest FROM "HyphenOrderEvent"`
  ).catch(() => [])
  console.log('HyphenOrderEvent (inbound from Hyphen):', events[0]?.cnt ?? 0, 'latest:', events[0]?.latest)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
