import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const envText = fs.readFileSync('.env', 'utf8');
const dbMatch = envText.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)/m);
if (dbMatch) process.env.DATABASE_URL = dbMatch[1].trim();

const p = new PrismaClient();
const models = ['Job', 'PurchaseOrder', 'Invoice'];
for (const m of models) {
  const rows = await p.$queryRawUnsafe(`SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name = $1 ORDER BY ordinal_position`, m);
  console.log(`=== ${m} (${rows.length} cols) ===`);
  rows.forEach(r => console.log(`${r.column_name} | ${r.data_type} | ${r.udt_name} | nullable=${r.is_nullable} | default=${r.column_default ?? 'null'}`));
}
await p.$disconnect();
